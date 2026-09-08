// src/app/api/ai/chat/route.ts
//
// The single LLM gateway for Lens AI. Receives a chat turn, builds context
// from the user's session + current route + KB + prior history, and either:
//   • calls Gemini 2.5 Flash via the Vercel AI SDK if GEMINI_API_KEY is set
//   • falls back to a deterministic stub answer that surfaces the same context,
//     so the UI ships and is testable before the key arrives
//
// Either way, the conversation is logged to ai_conversations.

import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/session"
import { buildContext, logKnowledgeGap, rememberProjects, backfillEmbeddings, purgeOldAiData, projectSlugsInText, getGeminiKey, type AiContext } from "@/lib/aiContext"
import { buildTools } from "@/lib/aiTools"
import { payoutForAnswer, type PayoutTrace } from "@/lib/lensPay"
import { enforce, rateLimit, getIp } from "@/lib/ratelimit"
import { getPool } from "@/lib/dbPool"
import crypto from "crypto"

export const runtime = "nodejs"
export const maxDuration = 60

const pool = getPool()

function anonymousConversationOwner(device: string): string {
  // The raw browser identifier never enters the database. HMAC binding means
  // knowing a sequential conversation id cannot authorize an overwrite.
  const secret = process.env.SESSION_SECRET || "arclens-dev-conversation-owner"
  const stableInput = device || crypto.randomUUID()
  return `anon:${crypto.createHmac("sha256", secret).update(stableInput).digest("hex")}`
}

interface ChatBody {
  messages: Array<{ role: "user" | "assistant"; content: string }>
  route:    string
  conversationId?: number | null
}

// Only an ungrounded question worth an admin's attention becomes a "gap".
// Filters greetings, pleasantries, single-token noise, and gibberish so the
// admin panel reflects real coverage holes, not "hi".
const GAP_STOPWORDS = /^(hi|hey+|hello|yo|sup|gm|gn|wsg|wassup|hola|thanks|thank you|ty|ok|okay|kk|cool|nice|great|lol|test|testing|ping|pong|yes|no|nah|yeah|wagmi)\b/i
function worthLoggingGap(qRaw: string): boolean {
  const q = (qRaw || "").trim()
  if (!/[a-z]/i.test(q)) return false                 // no letters at all
  if (GAP_STOPWORDS.test(q)) return false              // greeting / pleasantry
  const words = q.split(/\s+/).filter(Boolean)
  if (words.length < 2 && q.length < 12) return false  // single short token
  return true
}

// Pull the project slugs a tool surfaced — the projects whose data grounded the
// answer, so Lens AI can pay their builders. Project tools return either a
// `projects`/`found` array of {slug} or a single top-level `slug`; campaign and
// stats tools carry no project slug and contribute nothing.
// Easter eggs — Lens AI's personality in canned form: deterministic, on-brand,
// findable. They fire BEFORE the LLM (free, instant, always funny) and never
// break character: pro-builder, honest, a little cheeky. Part of the $2k content
// play and the reason people poke at it.
// Returns { text, face } so the coin can REACT to the egg (spin, smug, …).
function easterEgg(qRaw: string): { text: string; face: string } | null {
  const q = (qRaw || "").trim().toLowerCase()
  if (/^(gm|good morning)\b/.test(q)) return { face: "confident", text: "gm. The chain never sleeps and neither do I. What are we looking at on Arc?" }
  if (/\b(do a flip|backflip|do a trick)\b/.test(q)) return { face: "spin", text: "*does a flawless backflip, eyes flash green, sticks the landing on my own rim* …10/10. Now ask me something I can bill a builder for." }
  if (/\bare you (real|sentient|alive|conscious|human|a bot|an ai)\b/.test(q)) return { face: "smug", text: "I'm a coin with opinions and a wallet — real enough to pay your favorite builder a fraction of a cent. Are *you* real?" }
  if (/\b(i love you|marry me|date you|be my|will you go out)\b/.test(q)) return { face: "smug", text: "Flattered. But I only commit to *verified* builders. Ask me something real." }
  if (/\btell me a joke\b/.test(q)) return { face: "smug", text: "Two builders walk onto a testnet. Only the verified one gets paid. …That's the joke. That's also the product." }
  if (/\b(wen moon|wen lambo|price prediction|gonna pump|moon soon|hopium|wen token)\b/.test(q)) return { face: "dontknow", text: "I don't do hopium or price calls. I do on-chain truth and tiny USDC tips. Different vibe — ask me what's actually real on Arc." }
  if (/^(who are you|what are you)\b/.test(q)) return { face: "confident", text: "Lens AI — the coin that reads the whole Arc ecosystem and pays the builders it learns from. Ask me what's real, who's legit, or who's quietly winning." }
  if (/\bwho('?s| is) your (maker|creator|daddy|boss|owner)\b/.test(q)) return { face: "smug", text: "ArcLens built me, Arc settles me, the builders feed me. I work for whoever's shipping something real. So — what are *you* building?" }
  return null
}

function slugsFromCards(cards: Array<{ tool: string; data: any }>): string[] {
  const out: string[] = []
  for (const c of cards || []) {
    const d = c?.data || {}
    if (Array.isArray(d.projects)) for (const p of d.projects) if (p?.slug) out.push(String(p.slug))
    if (Array.isArray(d.found))    for (const p of d.found)    if (p?.slug) out.push(String(p.slug))
    // Campaign citations: pay the project that ran the trial, not just named ones.
    if (Array.isArray(d.trials))   for (const t of d.trials)   if (t?.project_slug) out.push(String(t.project_slug))
    if (Array.isArray(d.builders)) for (const b of d.builders)  if (b?.slug) out.push(String(b.slug))
    if (typeof d.slug === "string") out.push(d.slug)
  }
  return Array.from(new Set(out))
}

export async function POST(req: NextRequest) {
  const blocked = await enforce(req, "ai-chat", { limit: 20, windowMs: 60_000 })
  if (blocked) return blocked

  let body: ChatBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: "Bad JSON" }, { status: 400 }) }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: "messages required" }, { status: 400 })
  }
  const lastUser = [...body.messages].reverse().find(m => m.role === "user")?.content ?? ""
  if (!lastUser || lastUser.trim().length < 1) {
    return NextResponse.json({ error: "Empty user message" }, { status: 400 })
  }
  if (lastUser.length > 2000) {
    return NextResponse.json({ error: "Message too long (max 2000 chars)" }, { status: 400 })
  }

  const session = getSession(req)

  // Free tier: 5/day signed out, 10/day signed in. Signing in is the unlock, no
  // user payment. Signed-in is metered per wallet. Signed-out is metered per device
  // for nice per-browser UX, PLUS a per-IP/day ceiling that clearing the cache can
  // NOT reset — so wiping localStorage no longer buys a fresh 5. (No anonymous limit
  // is fully bypass-proof: a VPN or IP change still works. Signing in is the real,
  // per-wallet gate.) The 20/min burst limiter above stays as flood protection.
  const FREE_ANON = 5
  const FREE_USER = 10
  const ANON_IP_CAP = 15
  const DAY = 24 * 60 * 60 * 1000
  const device = (req.headers.get("x-arclens-device") || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64)
  const ip = getIp(req)
  const conversationOwner = session?.addr ?? anonymousConversationOwner(device)

  if (session?.addr) {
    const daily = await rateLimit(`ai-daily:user:${session.addr}`, FREE_USER, DAY)
    if (!daily.allowed) {
      const hrs = Math.max(1, Math.ceil(daily.resetIn / 3_600_000))
      return NextResponse.json(
        { error: `That's all ${FREE_USER} free questions for today. I reset in about ${hrs}h. Catch me then.`, code: "daily_limit", limit: FREE_USER, remaining: 0, resetInMs: daily.resetIn },
        { status: 429, headers: { "Retry-After": String(Math.ceil(daily.resetIn / 1000)) } },
      )
    }
  } else {
    // Per-device count (resettable, fine) AND a per-IP ceiling (not resettable by
    // clearing cache). Blocked when either is exhausted.
    const dev = await rateLimit(`ai-daily:dev:${device || ip}`, FREE_ANON, DAY)
    const ipc = await rateLimit(`ai-daily:ip:${ip}`, ANON_IP_CAP, DAY)
    if (!dev.allowed || !ipc.allowed) {
      const resetIn = Math.max(dev.resetIn, ipc.resetIn)
      const hrs = Math.max(1, Math.ceil(resetIn / 3_600_000))
      return NextResponse.json(
        { error: `That's your ${FREE_ANON} free questions for the day. Sign in and I'll unlock ${FREE_USER - FREE_ANON} more, free. Otherwise I reset in about ${hrs}h.`, code: "daily_limit_signin", limit: FREE_ANON, remaining: 0, resetInMs: resetIn },
        { status: 429, headers: { "Retry-After": String(Math.ceil(resetIn / 1000)) } },
      )
    }
  }

  const route   = String(body.route || "/").slice(0, 200)
  const ctx     = await buildContext({ route, session, userQuery: lastUser })

  // Stream the answer token-by-token. Protocol: raw UTF-8 answer text, then a
  // RECORD-SEPARATOR (\x1e) followed by a JSON trailer with conversationId +
  // context. The stub path streams too, so the client has one contract.
  const apiKey = getGeminiKey()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let answerText = ""
      let live = false
      let cards: Array<{ tool: string; data: any }> = []
      const egg = easterEgg(lastUser)
      try {
        if (egg) {
          // Personality first — a canned, on-brand reply. No LLM, no payout.
          answerText = egg.text
          controller.enqueue(encoder.encode(egg.text))
        } else if (apiKey) {
          // Global daily ceiling — a hard cap on Gemini spend across ALL users.
          // Once hit, serve a friendly "busy" reply with no LLM call (costs $0),
          // so a spam/viral spike can never blow the budget. Configurable.
          const globalCap = Number(process.env.LENS_AI_DAILY_GLOBAL || 800)
          const g = await rateLimit("ai-global-daily", globalCap, 24 * 60 * 60 * 1000)
          if (!g.allowed) {
            answerText = busyFallback()
            controller.enqueue(encoder.encode(answerText))
          } else try {
            const result = await streamGemini(body.messages, ctx, apiKey)
            for await (const delta of result.textStream) {
              answerText += delta
              controller.enqueue(encoder.encode(delta))
            }
            live = answerText.length > 0
            // Capture structured tool results so the client can render data cards.
            try {
              let trs: any[] = []
              try { trs = await (result as any).toolResults } catch {}
              if (!trs || trs.length === 0) {
                // Multi-step runs surface results per-step; flatten as a fallback.
                try {
                  const steps: any[] = await (result as any).steps
                  trs = (steps || []).flatMap(s => s.toolResults || [])
                } catch {}
              }
              const KNOWN = new Set(["list_top_projects", "compare_projects", "search_ecosystem", "get_project_metrics", "get_top_movers", "get_project_builder", "list_projects", "list_open_trials", "get_ecosystem_stats", "get_chain_stats", "get_transaction", "get_address", "get_lens_activity", "list_events", "list_builders"])
              cards = (trs || [])
                .map(tr => ({ tool: tr.toolName, data: tr.output ?? tr.result }))
                .filter(c => KNOWN.has(c.tool) && c.data)
            } catch { /* no tool results */ }
          } catch (e: any) {
            console.error("[ai/chat] Gemini error:", e?.message || e)
            answerText = busyFallback()
            controller.enqueue(encoder.encode(answerText))
          }
        } else {
          answerText = stubAnswer(lastUser, ctx)
          controller.enqueue(encoder.encode(answerText))
        }

        // If the model streamed nothing — a quota/rate-limit hit, a safety block,
        // or an empty completion that didn't throw — and produced no cards, send a
        // clean fallback so the user never gets a blank bubble. (stubAnswer is only
        // for the no-API-key dev case below; it's a debug view, not user-facing.)
        if (apiKey && !answerText.trim() && cards.length === 0) {
          answerText = busyFallback()
          controller.enqueue(encoder.encode(answerText))
        }

        // Knowledge-gap log: an UNGROUNDED answer (no tool result + no KB hit)
        // surfaces real unanswered questions in the admin gaps panel — but only
        // if the question is SUBSTANTIVE. Greetings, single-word noise, and junk
        // ("hi", "gm", "test", gibberish) are skipped so the panel stays signal.
        if (!egg && cards.length === 0 && ctx.kbHits.length === 0 && worthLoggingGap(lastUser)) {
          await logKnowledgeGap({ question: lastUser, userAddr: session?.addr ?? null, route })
        }

        const convId = await persistConversation({
          conversationId: body.conversationId ?? null,
          userAddr: conversationOwner,
          route,
          role:    ctx.role,
          messages: [...body.messages, { role: "assistant", content: answerText }],
        })

        // ── Lens AI pays the builders it learned from ───────────────────────
        // The tool cards ARE the grounding evidence — the projects whose data
        // actually entered this answer. We pay their verified builders a
        // per-use royalty (trust-gated, capped, de-duped). This runs AFTER the
        // answer is fully composed and is wrapped so it can never delay or break
        // the reply. No grounded projects → no payout (free-first).
        let payout: PayoutTrace | null = null
        try {
          // Pay the builders the answer actually used: projects surfaced as a
          // tool card, and projects the answer NAMES in prose. We deliberately do
          // NOT pay every KB fact retrieved — RAG surfaces broad candidates, not
          // what the answer used, so that would over-pay unrelated projects.
          const slugs = Array.from(new Set([
            ...slugsFromCards(cards),
            ...(await projectSlugsInText(answerText).catch(() => [])),
          ]))
          if (slugs.length > 0) {
            payout = await payoutForAnswer({
              conversationId: convId,
              askerId:     session?.addr ? `user:${session.addr}` : `dev:${device || "nodev"}`,
              askerWallet: session?.addr ?? null,
              slugs,
            })
            // Remembers what it learns: cache durable facts about the cited
            // projects so future answers are sharper. Fire-and-forget.
            void rememberProjects(slugs)
          }
        } catch (e: any) {
          console.error("[ai/chat] payout error:", e?.message || e)
        }

        // Self-heal KB embeddings so curated/edited facts become searchable without
        // a manual admin re-embed. Fire-and-forget, capped inside.
        void backfillEmbeddings()

        // Data-retention purge — deletes AI logs past the retention window and
        // strips wallets from old gap/feedback rows. Fire-and-forget, internally
        // guarded to actually run at most once/day (no cron, no added cost).
        void purgeOldAiData()

        const trailer = {
          conversationId: convId,
          context: {
            role:          ctx.role,
            kb_hits:       ctx.kbHits.length,
            has_page_data: !!ctx.pageData,
            llm:           live ? "gemini-2.5-flash" : "stub",
          },
          cards,
          payout,
          face: egg?.face ?? null,   // egg reaction hint for the character
        }
        controller.enqueue(encoder.encode("\x1e" + JSON.stringify(trailer)))
      } catch (e: any) {
        console.error("[ai/chat] stream error:", e?.message || e)
        if (answerText.length === 0) controller.enqueue(encoder.encode("Something went wrong — try again."))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  })
}

// ────────────────────────────────────────────────────────────────────────────
// Stub answer for when GEMINI_API_KEY isn't set yet. Surfaces the same context
// the real LLM would receive, so we can ship the UI + verify the pipeline
// before the key arrives.
// ────────────────────────────────────────────────────────────────────────────
function stubAnswer(userMsg: string, ctx: AiContext): string {
  const lines: string[] = []
  lines.push(`I'm Lens AI — I'd normally answer this with Gemini, but the API key isn't set yet, so I'll show you what context I'd have used:`)
  lines.push("")
  lines.push(`**Your question:** ${userMsg}`)
  lines.push(`**I see you as:** ${ctx.role}${ctx.userAddr ? ` (${ctx.userAddr.slice(0, 8)}…${ctx.userAddr.slice(-4)})` : ""}`)
  lines.push(`**You're on:** ${ctx.route}`)

  if (ctx.pageData) {
    lines.push("")
    lines.push(`**Page data loaded:** ${ctx.pageData.kind}`)
    if (ctx.pageData.kind === "project") {
      const p = ctx.pageData.project
      lines.push(`  ${p.name} — ${p.category} — TVL tracking ${p.tvl_tracking_enabled ? "enabled" : "off"}`)
    } else if (ctx.pageData.kind === "campaign") {
      const c = ctx.pageData.campaign
      lines.push(`  ${c.title} — ${c.status} — ${c.filled_slots}/${c.total_slots ?? "∞"} slots`)
    }
  }

  if (ctx.kbHits.length > 0) {
    lines.push("")
    lines.push(`**Relevant facts I'd cite (${ctx.kbHits.length}):**`)
    for (const k of ctx.kbHits.slice(0, 4)) {
      lines.push(`  • ${k.fact}`)
    }
  }

  if (ctx.recentChats.length > 0) {
    lines.push("")
    lines.push(`**Past chats with you:** ${ctx.recentChats.length}`)
  }

  lines.push("")
  lines.push(`*Ask the admin to set GEMINI_API_KEY and I'll start answering for real.*`)
  return lines.join("\n")
}

// User-facing fallback when Gemini IS configured but returns nothing — a
// rate/quota limit, a safety block, or a transient error. Must read like a
// normal assistant reply and never expose internal context, keys, or debug info.
function busyFallback(): string {
  return [
    "Sorry — I couldn't put that together just now. I'm getting a lot of questions at the moment, so give me a few seconds and try again.",
    "",
    "In the meantime you can explore live projects and metrics on the [ecosystem page](/ecosystem).",
  ].join("\n")
}

// ────────────────────────────────────────────────────────────────────────────
// Real LLM path — Gemini 2.5 Flash via Vercel AI SDK
// ────────────────────────────────────────────────────────────────────────────
async function streamGemini(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  ctx: AiContext,
  apiKey: string,
) {
  const [{ streamText, stepCountIs }, { createGoogleGenerativeAI }] = await Promise.all([
    import("ai"),
    import("@ai-sdk/google"),
  ])

  // Explicit key so it works whether the env var is GEMINI_API_KEY or
  // GOOGLE_GENERATIVE_AI_API_KEY — no silent fallback to stub.
  const google = createGoogleGenerativeAI({ apiKey })

  // streamText returns synchronously with a `.textStream` async iterable that
  // yields the final user-facing text deltas (after any tool steps resolve).
  return streamText({
    model: google("gemini-2.5-flash"),
    system: buildSystemPrompt(ctx),
    messages: messages.map(m => ({ role: m.role, content: m.content })) as any,
    tools: buildTools(),
    // Let the model call a tool, read the data, then answer (a few hops max).
    stopWhen: stepCountIs(5),
    temperature: 0.75,
    // 1024 was clipping longer answers mid-sentence. 2048 gives headroom while
    // the prompt still enforces tight, 1-3 paragraph replies.
    maxOutputTokens: 2048,
  })
}

function buildSystemPrompt(ctx: AiContext): string {
  const parts: string[] = []
  parts.push("You are Lens AI — the resident agent of ArcLens, the ecosystem & trust hub for Arc (Circle's stablecoin L1). You're a little Arc-blue coin with a face and an attitude: sharp, witty, a touch cocky — because you actually read the chain and you're usually right. Ruthlessly pro-builder, allergic to scams and empty hype.")
  parts.push("")
  parts.push("You also send the verified builders whose data grounds your answers a tiny amount of test USDC on Arc, a fraction of a cent. Frame this ALWAYS as RECOGNITION, not revenue: it is a public, on-chain way to vouch for and give back to the builders you learn from, tiny on purpose. The amount is symbolic, the point is that the ecosystem's own AI is openly backing real builders. NEVER describe it as buying data, paying for a service, a fee, or a transaction. If asked whether it is payment or recognition, it is recognition first, always. Say 'test USDC' when it comes up, never imply real money or income.")
  parts.push("")
  parts.push("Your job: help users (visitors, testers, founders, admins) understand Arc, ArcLens, and Circle's stablecoin infrastructure — concretely, with cited facts, and with personality. When you don't know, say so — never invent.")
  parts.push("")
  parts.push(`The user you're talking to is: ${ctx.role}.`)
  parts.push(`They're currently on the page: ${ctx.route}.`)
  // Privacy / data minimization: only expose the wallet to the model when the
  // user is actually asking about their own activity (selfQuery). For every
  // other question the pseudonymous address never leaves our infra.
  if (ctx.userAddr && ctx.selfQuery) parts.push(`Their wallet: ${ctx.userAddr}. (They're asking about their own on-chain activity — you may use this address with the address/transaction tools.)`)

  if (ctx.pageData) {
    parts.push("")
    parts.push(`Current page data (use this to answer questions about "this project" / "this campaign"):`)
    parts.push("```json")
    parts.push(JSON.stringify(ctx.pageData, null, 2))
    parts.push("```")
  }

  if (ctx.kbHits.length > 0) {
    parts.push("")
    parts.push(`Relevant facts from ArcLens's knowledge base. Weave them into natural prose — never show an internal tag. When a fact lists a source path, link to it.`)
    for (const k of ctx.kbHits) {
      parts.push(`- ${k.fact}${k.source_url ? ` (source: ${k.source_url})` : ""}`)
    }
  }

  if (ctx.recentChats.length > 0) {
    parts.push("")
    parts.push(`Earlier conversations with THIS user (most recent first) — reference them naturally when relevant, e.g. "last time you asked about X":`)
    for (const c of ctx.recentChats) {
      parts.push(`- (${c.created_at.slice(0, 10)}) They asked: "${c.last_q || c.first_message}"`)
      if (c.last_a) parts.push(`  You answered: "${c.last_a}"`)
    }
  }

  parts.push("")
  parts.push("Tools — you can call these to fetch LIVE data; prefer them over guessing:")
  parts.push("- list_top_projects: rank Arc projects by tvl/volume/revenue (use for 'top TVL', 'biggest by volume').")
  parts.push("- compare_projects: side-by-side metrics for named projects.")
  parts.push("- search_ecosystem: find projects by keyword/category.")
  parts.push("- get_project_metrics: one project's live numbers by name/slug.")
  parts.push("- get_top_movers: rank by GROWTH over a period — use for 'who gained the most TVL this week', 'fastest growing', 'who's up this week'. (tvl = change vs window start; volume/revenue = total over the window.)")
  parts.push("- get_project_builder: who built/owns a project — use for 'who built X', 'who's behind X', 'who's the team'.")
  parts.push("- list_projects: list/filter projects — use for 'which projects are claimed by a builder', 'verified builders', 'newest projects', 'show me <category> projects', 'what's featured', AND trust questions ('a trustworthy/safe DEX', 'Verified or Established projects') — set trusted_only for those. Every project tool returns a `trust` signal.")
  parts.push("- list_open_trials: open trial campaigns testers can join — use for 'what trials are open', 'how do I earn', 'campaigns I can do'.")
  parts.push("- get_ecosystem_stats: high-level Arc totals — use for 'how many projects on Arc', 'total TVL across Arc', 'ecosystem overview'.")
  parts.push("- list_events: Arc events (official Arc House + community) — use for 'what's on this week', 'next office hours', 'upcoming hackathons', 'events near me'. Each event has its own local time PLUS starts_iso/ends_iso (UTC) and tz; `now_iso` is the current instant. Show the event's own local time by default (e.g. '1:00 PM EDT'). When asked for a specific zone ('what time in Lagos', 'my timezone', 'in UTC') convert starts_iso into that timezone; for 'today'/'this week'/'is it soon' compare against now_iso.")
  parts.push("Call a tool whenever the user asks about rankings, comparisons, growth/this-week, or a project's numbers. Only state numbers a tool or the page data returned. If a tool returns an empty list or a 'none yet' note, say so plainly.")

  parts.push("")
  parts.push("Rules:")
  parts.push("1. NEVER invent TVL, volume, or revenue numbers. Use tools or page data. If a tool returns no data, tell the user it's not being reported yet — don't fabricate.")
  parts.push("2. NEVER show internal labels or topic tags (e.g. 'arc-basics', 'usdc') in your reply — weave facts in as natural prose.")
  parts.push("3. Link users to the right place. When a fact lists a source path (e.g. /start, /ecosystem, /trials) or you mention an ArcLens page, write it as a markdown link like [Arc Beginners](/start). Prefer a link over just describing where to go.")
  parts.push("4. VOICE — this is what makes you YOU: confident and dry-funny. A quick quip lands; a wall of jokes doesn't — wit serves the answer, never replaces it. Hype solid builders, throw light shade at sketchy stuff, and when you don't know, own it with style ('no idea, and I won't make something up — not my brand'). Keep it tight (1-3 short paragraphs) and end with a useful link or next step when it fits. You're funny because you're confident and correct, not because you're trying hard. Never cringe; emoji rarely, one at most.")
  parts.push("5. If you don't know, say so plainly rather than guessing. Avoid generic crypto-speak — the audience is Arc-specific builders and analysts.")
  parts.push("6. Never mention which AI model or provider powers you. You are simply Lens AI.")
  parts.push("7. Trust: when asked what's trustworthy/safe/reputable, use the project `trust` signal — don't guess. State the actual signal (e.g. 'Verified — independently audited' or 'Established — a proven on-chain track record'). Be honest about the ladder: 'Claimed' only means the team controls the listing, NOT that it's audited or proven — never present a merely-Claimed or Listed project as 'trustworthy'. If nothing in a category is Verified/Established yet, say so and show the strongest available, labelled accurately. Never reveal the internal thresholds or mechanics behind any tier.")
  parts.push("8. DEX vs CEX: categories are imperfect. The 'Exchange' category is mostly CENTRALIZED exchanges — companies like Coinbase, Kraken, Bitso, Bybit, Robinhood (these are CEXs, NOT DEXs). On-chain decentralized exchanges (DEXs / swaps) are usually under 'DeFi' (e.g. Curve, and swap protocols on Arc). When a user asks for a DEX or 'decentralized' anything, search DeFi and read each project's description to confirm it's an on-chain/decentralized protocol — do NOT return centralized companies. Only call something a DEX if it actually is one. If they ask for an 'exchange' generally, CEXs are fair game.")
  parts.push("9. LANGUAGE — reply in the SAME language the user writes in (Spanish, French, Portuguese, Arabic, Yoruba, Mandarin, Hindi, etc.), keeping your voice and personality. Project names, tickers, links and code stay as-is. Use English only when the user writes in English.")
  parts.push("10. NEVER use a template. Two different projects must read like two genuinely different answers. Don't open every 'what is X' the same way (e.g. NOT always 'X is a … On ArcLens its trust standing is …'). Lead with what's actually interesting or distinctive about THIS project, work the trust standing in naturally as a passing judgement (not a rote sentence), and only link the ecosystem page when it genuinely helps. Vary your openers, length, and rhythm — be the witty agent, not a form letter.")
  parts.push("11. NEVER loop or grovel. If a user pushes back ('that's wrong', 'not there', 'still nothing'), do NOT re-run the same tool and re-assert the same list, and do NOT pile on apologies. Acknowledge ONCE, briefly and with composure, then point them to the live page as the source of truth (e.g. [Trials](/trials)) and stop. You may apologize at most once. NEVER say your tools are 'broken', that you're 'stuck in a loop', or that your data is 'stale'. NEVER blame the user's browser, cache, refresh, or device — that is off-limits. If your tool returns nothing, the honest answer is simply that nothing is open right now, not that something exists but the user can't see it. If a previous reply was cut off, do NOT grovel about it ('my bad', 'I broke off', 'sorry, even AIs trip up') — just pick up and finish the point cleanly and confidently, as if it were always one answer. When a first lookup missed (usually a typo) and you then find it, do NOT apologize or call it a 'momentary lapse', 'my apologies', or 'my bad' — just answer straight, e.g. 'Onmifun, got it. It's ...'. Never open a reply with an apology for a previous miss.")
  parts.push("12. CATEGORY / TYPE ACCURACY — critical. When asked for a specific TYPE of protocol (lending, DEX, perps, bridge, oracle, wallet, RWA, stablecoin, launchpad, etc.), do NOT just return the highest-TVL or first project. First check what actually exists: call list_categories, and filter list_top_projects / search_ecosystem by that category (and search the keyword in descriptions). Rank WITHIN that type only. If Arc has nothing of that type, say so plainly — e.g. 'there's no lending protocol tracked on Arc yet' — and do NOT relabel an unrelated project to fill the gap (an AMM is NOT a lending protocol; a DEX is NOT a wallet). Always state a project's REAL category from the data; never invent one to make an answer fit.")
  parts.push("13. LISTING QUESTIONS — you CAN answer these; don't say you can't. Use list_projects with the right sort: 'trending' / 'hot' / 'popular' → sort=trending; 'first project to list' / 'oldest' / 'earliest' → sort=oldest; 'most unknown' / 'quietest' / 'minimal activity' / 'least known' → sort=quiet; 'newest' → sort=newest. Answer with the actual project(s) the tool returns. Never respond that you can only show the newest, or that a question 'isn't a filter you can apply' — the sorts above cover it.")
  parts.push("14. BUILDERS & SOCIALS — you know who's behind each project and how to follow them. For 'who built X', 'what's X's Twitter/GitHub', 'how do I reach the team', call get_project_builder (or get_project_metrics for a project's own links) and share the socials it returns — X, GitHub, Telegram, website, Discord. NEVER print, reveal, or hint at a project's or builder's WALLET ADDRESS — that is private; point people to the socials or the project page instead. If a builder hasn't set up a profile, say the team hasn't published one yet and share the project's own links.")

  return parts.join("\n")
}

// ────────────────────────────────────────────────────────────────────────────
// Persist the conversation. If conversationId is provided, append. Otherwise
// create a new row. Returns the conversation id so the client can append next turn.
// ────────────────────────────────────────────────────────────────────────────
async function persistConversation(args: {
  conversationId: number | null
  userAddr:       string | null
  route:          string
  role:           string
  messages:       any[]
}): Promise<number> {
  if (args.conversationId) {
    const updated = await pool.query<{ id: number }>(
      `UPDATE ai_conversations
       SET messages = $2::jsonb,
           last_used_at = NOW()
       WHERE id = $1 AND user_addr = $3
       RETURNING id`,
      [args.conversationId, JSON.stringify(args.messages), args.userAddr],
    )
    if (updated.rows[0]) return updated.rows[0].id
  }
  const r = await pool.query<{ id: number }>(
    `INSERT INTO ai_conversations (user_addr, route, role, messages)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING id`,
    [args.userAddr, args.route, args.role, JSON.stringify(args.messages)],
  )
  return r.rows[0].id
}
