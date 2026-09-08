// src/app/api/agent/route.ts
//
// Lens AI as an AGENT other agents pay. An x402-priced trust & ecosystem oracle
// for Arc: another agent asks "is this project legit?", "find verified DeFi",
// "give me X's metrics" — pays a nanopayment in USDC — and gets a structured
// answer. The twist that keeps it on-mission: that payment funds the verified
// builders whose data answered it. Agents pay Lens AI → Lens AI pays builders.
//
// GET  → a self-describing manifest (agent-discoverable).
// POST → pay-per-call (x402). 402 with the price until a payment proof is sent.

export const runtime = "nodejs"
import { NextRequest, NextResponse } from "next/server"
import { enforce, getIp, rateLimit } from "@/lib/ratelimit"
import { verifyPremiumPayment, recordPremiumCall, premiumPriceE6, premiumPriceUsd, payoutForAnswer, agentPayoutBudgetE6, askPriceE6, askPriceUsd, askPayoutBudgetE6 } from "@/lib/lensPay"
import { gatewayConfigured, verifyAndSettle, paymentRequiredHeader, paymentResponseHeader } from "@/lib/gateway"
import { passesVetting } from "@/lib/trustEngine"
import { getGeminiKey, searchKnowledgeBase, projectSlugsInText } from "@/lib/aiContext"
import { getPool } from "@/lib/dbPool"

const pool = getPool()

const TRUST_COLS = `trust_level, recognition, established, COALESCE((trust_profile->>'hard_risk')::bool, false) AS hard_risk`
function trustLabel(p: any): string {
  if (p.hard_risk) return "Risk flagged"
  const base =
    p.recognition === "official" ? "Arc Official" :
    p.recognition === "partner"  ? "Arc Partner"  :
    p.trust_level === "verified" ? "Verified" :
    p.trust_level === "claimed"  ? "Claimed"  : "Listed"
  return p.established ? (base === "Claimed" || base === "Listed" ? "Established" : `${base} · Established`) : base
}
function fmtUsd(e6: string | null): string {
  if (e6 == null) return "$0"
  const n = Number(BigInt(e6)) / 1e6
  if (!Number.isFinite(n) || n === 0) return "$0"
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

const MANIFEST = {
  name: "Lens AI",
  summary: "Pay-per-call trust & ecosystem intelligence for Arc, settled in USDC. Ask who's legit, who's building what, or for a project's live metrics — and your call pays the verified builders whose data answers it.",
  protocol: "x402",
  network: "Arc",
  token: "USDC",
  price: premiumPriceUsd,
  price_e6: premiumPriceE6,
  pay_header: "payment-signature",
  actions: {
    trust:    { description: "Trust verdict for a project on Arc.", params: { target: "project name or slug" } },
    discover: { description: "Find Arc projects, optionally trusted-only.", params: { category: "optional", trusted_only: "optional bool", limit: "1-20 (default 8)" } },
    project:  { description: "A project's live metrics + trust standing.", params: { name: "project name or slug" } },
    metrics:  { description: "Verified metrics history for a project — TVL series, daily volume & revenue, all-time totals.", params: { name: "project name or slug", days: "history window 7-90 (default 30)" } },
    risk:     { description: "Deep risk verdict — trust tier, contract analysis (upgradeability, admin keys, verified source), multi-engine website reputation.", params: { name: "project name or slug" } },
    ask:      { description: "A full Lens AI answer to any question about Arc — grounded in live on-chain data, the trust graph, and the knowledge base. Priced higher than the structured lookups.", params: { question: "your question (max 500 chars)" }, price: askPriceUsd, price_e6: askPriceE6 },
  },
}

export async function GET() {
  return NextResponse.json(MANIFEST, { headers: { "Cache-Control": "public, s-maxage=300" } })
}

export async function POST(req: NextRequest) {
  const blocked = await enforce(req, "agent-api", { limit: 30, windowMs: 60_000 })
  if (blocked) return blocked

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: "Bad JSON" }, { status: 400 }) }
  const action = String(body?.action || "").toLowerCase()
  if (!["trust", "discover", "project", "metrics", "risk", "ask"].includes(action)) {
    return NextResponse.json({ error: "Unknown action — see manifest.", ...MANIFEST }, { status: 400 })
  }

  // ask preconditions BEFORE the payment gate — an agent must never be charged
  // for an answer we already know we can't produce. Also a tighter rate bucket:
  // every ask spends real LLM tokens, so it gets 6/min instead of 30/min.
  let askQuestion = ""
  if (action === "ask") {
    askQuestion = String(body?.question || body?.q || "").trim().slice(0, 500)
    if (!askQuestion) return NextResponse.json({ error: "question required (max 500 chars)" }, { status: 400 })
    if (!getGeminiKey()) return NextResponse.json({ error: "ask is temporarily unavailable" }, { status: 503 })
    const askBlocked = await enforce(req, "agent-ask", { limit: 6, windowMs: 60_000 })
    if (askBlocked) return askBlocked
    // Global daily ceiling — per-IP limits fall to IP rotation, but every ask
    // spends real LLM tokens. This caps the absolute worst-case daily spend
    // no matter who's calling. Tune via LENS_ASK_DAILY_MAX.
    const daily = await rateLimit("agent-ask:global", Number(process.env.LENS_ASK_DAILY_MAX || 300), 86_400_000)
    if (!daily.allowed) {
      return NextResponse.json(
        { error: "ask is at capacity for today — try again later", code: "daily_capacity" },
        { status: 429, headers: { "Retry-After": String(Math.ceil(daily.resetIn / 1000)) } },
      )
    }
  }

  // Per-action pricing: ask costs more than the structured lookups.
  const priceE6  = action === "ask" ? askPriceE6 : premiumPriceE6
  const priceUsd = action === "ask" ? askPriceUsd : premiumPriceUsd

  // x402 — pay per call. Real Circle Gateway settlement when a standard
  // `payment-signature` header is present (and SELLER_ADDRESS configured);
  // otherwise a local-development-only demo proof. No payment → 402.
  const sig = req.headers.get("payment-signature") || ""
  let paid = false
  let settledTx: string | null = null
  if (sig && gatewayConfigured()) {
    const st = await verifyAndSettle(sig, priceE6)
    paid = st.ok
    settledTx = st.tx ?? null
    if (!paid) console.error("[agent] gateway verify/settle failed:", st.reason)
  } else {
    const proof = req.headers.get("x-lens-pay") || ""
    paid = proof ? await verifyPremiumPayment(proof) : false
  }
  if (!paid) {
    return NextResponse.json(
      { error: "Payment required — this is a pay-per-call service.", code: "payment_required", ...MANIFEST },
      {
        status: 402,
        headers: {
          "x-payment-price": priceUsd,
          "x-payment-token": "USDC",
          "x-payment-network": "Arc",
          "PAYMENT-REQUIRED": paymentRequiredHeader(priceE6, "/api/agent"),
        },
      },
    )
  }

  const agentId = "agent:" + (req.headers.get("x-agent-id") || getIp(req))
  const slugs: string[] = []
  let result: any = {}

  try {
    if (action === "trust" || action === "project") {
      const q = String(body?.target || body?.name || "").trim()
      if (!q) return NextResponse.json({ error: "target/name required" }, { status: 400 })
      const r = await pool.query(
        `SELECT name, slug, category, tagline, ${TRUST_COLS},
                tvl_usd_e6::text tvl, volume_cum_usd_e6::text volume, revenue_cum_usd_e6::text revenue
           FROM projects WHERE approved AND live AND (slug ILIKE $1 OR name ILIKE $1)
          ORDER BY (slug = LOWER($2)) DESC LIMIT 1`,
        [`%${q}%`, q.toLowerCase()],
      )
      if (!r.rows[0]) result = { found: false, note: `No live Arc project matching "${q}".` }
      else {
        const p = r.rows[0]; slugs.push(p.slug)
        result = action === "trust"
          ? { found: true, name: p.name, slug: p.slug, trust: trustLabel(p) }
          : { found: true, name: p.name, slug: p.slug, category: p.category, trust: trustLabel(p), tvl: fmtUsd(p.tvl), volume: fmtUsd(p.volume), revenue: fmtUsd(p.revenue) }
      }
    } else if (action === "metrics") {
      const q = String(body?.target || body?.name || "").trim()
      if (!q) return NextResponse.json({ error: "target/name required" }, { status: 400 })
      const days = Math.min(Math.max(Number(body?.days) || 30, 7), 90)
      const r = await pool.query(
        `SELECT id, name, slug, category, ${TRUST_COLS},
                tvl_usd_e6::text tvl, tvl_ath_usd_e6::text tvl_ath,
                volume_cum_usd_e6::text volume_cum, revenue_cum_usd_e6::text revenue_cum
           FROM projects WHERE approved AND live AND (slug ILIKE $1 OR name ILIKE $1)
          ORDER BY (slug = LOWER($2)) DESC LIMIT 1`,
        [`%${q}%`, q.toLowerCase()],
      )
      if (!r.rows[0]) result = { found: false, note: `No live Arc project matching "${q}".` }
      else {
        const p = r.rows[0]; slugs.push(p.slug)
        const e6 = (v: string | null) => v == null ? null : Number(BigInt(v)) / 1e6
        const [vol, rev, tvlSeries] = await Promise.all([
          pool.query(
            `SELECT day::text, total_usd_e6::text FROM volume_daily
              WHERE project_id = $1 AND day >= CURRENT_DATE - $2::int ORDER BY day ASC`,
            [p.id, days],
          ),
          pool.query(
            `SELECT day::text, total_usd_e6::text FROM revenue_daily
              WHERE project_id = $1 AND day >= CURRENT_DATE - $2::int ORDER BY day ASC`,
            [p.id, days],
          ),
          // Downsampled to ≤ 60 points so agent payloads stay small.
          pool.query(
            `WITH s AS (
               SELECT block_time, total_usd_e6::text,
                      ROW_NUMBER() OVER (ORDER BY block_number ASC) rn,
                      COUNT(*) OVER () n
                 FROM tvl_snapshots
                WHERE project_id = $1 AND block_time >= NOW() - make_interval(days => $2::int)
             )
             SELECT block_time, total_usd_e6 FROM s
              WHERE rn % GREATEST(1, n / 60) = 0 OR rn = 1 OR rn = n
              ORDER BY block_time ASC`,
            [p.id, days],
          ),
        ])
        result = {
          found: true, name: p.name, slug: p.slug, trust: trustLabel(p), window_days: days,
          totals: { tvl: fmtUsd(p.tvl), tvl_ath: fmtUsd(p.tvl_ath), volume_all_time: fmtUsd(p.volume_cum), revenue_all_time: fmtUsd(p.revenue_cum) },
          tvl_series:    tvlSeries.rows.map((x: any) => ({ t: x.block_time, usd: e6(x.total_usd_e6) })),
          daily_volume:  vol.rows.map((x: any) => ({ day: x.day, usd: e6(x.total_usd_e6) })),
          daily_revenue: rev.rows.map((x: any) => ({ day: x.day, usd: e6(x.total_usd_e6) })),
          methodology: "on-chain-verified by ArcLens; protocol-reported figures are excluded from this endpoint",
        }
      }
    } else if (action === "risk") {
      const q = String(body?.target || body?.name || "").trim()
      if (!q) return NextResponse.json({ error: "target/name required" }, { status: 400 })
      const r = await pool.query(
        `SELECT id, name, slug, website, trust_profile, ${TRUST_COLS}
           FROM projects WHERE approved AND live AND (slug ILIKE $1 OR name ILIKE $1)
          ORDER BY (slug = LOWER($2)) DESC LIMIT 1`,
        [`%${q}%`, q.toLowerCase()],
      )
      if (!r.rows[0]) result = { found: false, note: `No live Arc project matching "${q}".` }
      else {
        const p = r.rows[0]; slugs.push(p.slug)
        const profile: any = p.trust_profile || {}
        // Cached multi-engine reputation for the project's website (vendor
        // deliberately unnamed in public responses).
        let webRep: any = { verdict: "unscanned" }
        try {
          if (p.website) {
            const us = await pool.query(
              `SELECT verdict, malicious, suspicious, total_engines, scanned_at
                 FROM url_scans WHERE url = $1 OR url = $1 || '/'
                ORDER BY scanned_at DESC LIMIT 1`,
              [p.website],
            )
            if (us.rows[0] && us.rows[0].verdict !== "no_key") {
              const u = us.rows[0]
              webRep = { verdict: u.verdict, flagged_by: u.malicious + u.suspicious, engines: u.total_engines, checked_at: u.scanned_at }
            }
          }
        } catch { /* scan cache unavailable — report unscanned, never fail the call */ }
        result = {
          found: true, name: p.name, slug: p.slug, trust: trustLabel(p),
          verdict: {
            hard_risk: !!p.hard_risk,
            risk_reason: profile.risk_reason ?? null,
            caution: !!profile.caution,
            caution_note: profile.caution_note ?? null,
            vetted: passesVetting(profile),
          },
          website_reputation: webRep,
          contracts: (profile.contracts || []).map((c: any) => ({
            address: c.address, role: c.role,
            source_verified: !!c.source_verified,
            upgradeable: !!c.upgradeable, admin: c.admin ?? "n/a", ownership: c.ownership ?? "unknown",
            powers_to_review: c.powers_to_review ?? [],
          })),
          assessed_at: profile.computed_at ?? null,
        }
      }
    } else if (action === "ask") {
      // One-shot Lens answer: same tools + knowledge base as the /lens chat,
      // but generateText (no streaming) with hard token/step caps so the real
      // LLM spend stays safely under the call price.
      const [{ generateText, stepCountIs }, { createGoogleGenerativeAI }, { buildTools }] = await Promise.all([
        import("ai"),
        import("@ai-sdk/google"),
        import("@/lib/aiTools"),
      ])
      const kb = await searchKnowledgeBase(askQuestion, 5).catch(() => [])
      const kbBlock = kb.length
        ? "\nCurated facts that may help (cite naturally, never invent):\n" + kb.map((h: any) => `- ${h.fact ?? h.text ?? JSON.stringify(h)}`).join("\n")
        : ""
      const google = createGoogleGenerativeAI({ apiKey: getGeminiKey() })
      const res = await generateText({
        model: google("gemini-2.5-flash"),
        system:
          "You are Lens AI, ArcLens's trust & ecosystem oracle for Arc (Circle's stablecoin L1), answering a PAID API call from another agent. " +
          "Answer from your tools and the curated facts only — never guess or invent projects, numbers, or addresses. " +
          "Be direct and complete in at most 180 words of plain text (no markdown, no links). " +
          "Name the Arc projects your answer relies on so they can be credited. " +
          "If the data genuinely doesn't answer the question, say so plainly." + kbBlock,
        prompt: askQuestion,
        tools: buildTools(),
        stopWhen: stepCountIs(4),
        maxOutputTokens: 500,
      })
      const answer = (res.text || "").trim()
      if (!answer) {
        result = { question: askQuestion, answer: "Lens couldn't produce a grounded answer for this — the underlying data didn't cover it.", cited: [] }
      } else {
        const cited = await projectSlugsInText(answer).catch(() => [] as string[])
        for (const s of cited) slugs.push(s)
        result = { question: askQuestion, answer, cited }
      }
    } else {
      const lim = Math.min(Math.max(Number(body?.limit) || 8, 1), 20)
      const params: any[] = []
      const where = ["approved", "live"]
      if (body?.category) { params.push(body.category); where.push(`category ILIKE $${params.length}`) }
      if (body?.trusted_only) where.push(`(recognition IN ('official','partner') OR trust_level='verified' OR established=true) AND COALESCE((trust_profile->>'hard_risk')::bool, false) = false`)
      params.push(lim)
      const r = await pool.query(
        `SELECT name, slug, category, tagline, ${TRUST_COLS} FROM projects
          WHERE ${where.join(" AND ")} ORDER BY featured DESC, view_count DESC NULLS LAST LIMIT $${params.length}`,
        params,
      )
      for (const p of r.rows) slugs.push(p.slug)
      result = { count: r.rows.length, projects: r.rows.map((p: any) => ({ name: p.name, slug: p.slug, category: p.category, tagline: p.tagline, trust: trustLabel(p) })) }
    }
  } catch (e: any) {
    console.error("[agent]", e?.message || e)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }

  // The agent's payment funds the builders whose data answered it, then we log
  // the premium. Never block the response on the money plumbing.
  let payout: any = null
  // budgetE6 caps the total builder payout for this paid call below what the
  // agent paid, so Lens AI stays net-positive on every agent-to-agent call.
  try { if (slugs.length) payout = await payoutForAnswer({ conversationId: null, askerId: agentId, askerWallet: null, slugs, budgetE6: action === "ask" ? askPayoutBudgetE6 : agentPayoutBudgetE6 }) } catch {}
  recordPremiumCall(agentId, priceE6, settledTx).catch(() => {})

  return NextResponse.json(
    {
      action,
      result,
      paid_to_builders: payout?.paid?.map((b: any) => ({ project: b.name, amount: b.amountUsd, trust: b.trust, tx: b.txHash })) ?? [],
      settled_on: "Arc",
    },
    settledTx ? { headers: { "PAYMENT-RESPONSE": paymentResponseHeader(settledTx) } } : undefined,
  )
}
