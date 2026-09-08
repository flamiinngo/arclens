"use client"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { useParams, useRouter } from "next/navigation"
import ArcLayout from "@/components/ArcLayout"
import { WalletAvatar } from "@/components/WalletAvatar"
import { useArcStore } from "@/store/arc"
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core"
import type { DragEndEvent } from "@dnd-kit/core"
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { getTypeMeta } from "@/lib/campaignTypes"

type ProofType = "none" | "x_link" | "tx_hash" | "url" | "screenshot"
interface Task {
  id: string
  title: string
  description: string
  contract_address?: string
  proof_type?: ProofType
}

interface ReviewQuestion {
  id: string
  label: string
  placeholder: string
  min_words: number
  required: boolean
}

interface Campaign {
  id: number
  title: string
  tagline: string | null
  description: string
  type: string
  status: string
  reward_type: string
  reward_description: string | null
  reward_usdc_amount: number | null
  total_slots: number | null
  filled_slots: number
  is_fcfs: boolean
  min_rank: number
  project_name: string | null
  project_logo: string | null
  campaign_logo: string | null
  banner_position: string | null
  creator_wallet: string
  tasks: Task[]
  review_questions: ReviewQuestion[]
  created_at: string
  expires_at: string | null
  completion_count: number
  reviewed_count: number
  rejection_reason: string | null
  contract_address: string | null
  app_url: string | null
  slug: string | null
  invite_codes:           string[] | null
  invite_codes_note:      string | null
  max_xp_per_completion:  number | null
  xp_mode:                "batch" | "per_question" | null
  project_twitter:        string | null
}

// ── Description formatter ────────────────────────────────────────────────────
// Founders type plain text with "• " bullets and bare URLs. Render it with real
// structure: consecutive bullet lines become <ul>, URLs become links, and short
// heading-like lines (no ending punctuation) become subheads. Content-safe by
// construction — every line renders as SOMETHING; worst case it stays a <p>.

function linkify(text: string, keyBase: string): ReactNode[] {
  const parts = text.split(/(https?:\/\/[^\s]+)/g)
  return parts.map((part, i) =>
    /^https?:\/\//.test(part)
      ? <a key={`${keyBase}-${i}`} href={part} target="_blank" rel="noopener noreferrer"
          style={{ color: "#8aaeff", textDecoration: "none", wordBreak: "break-all" }}>{part.replace(/^https?:\/\//, "")}</a>
      : part
  )
}

function FormattedDescription({ text }: { text: string }) {
  const lines = text.split(/\r?\n/)
  const blocks: ReactNode[] = []
  let bullets: string[] = []
  let key = 0

  const flushBullets = () => {
    if (!bullets.length) return
    blocks.push(
      <ul key={`ul-${key++}`} style={{ margin: "0 0 14px", padding: 0, listStyle: "none" }}>
        {bullets.map((b, i) => (
          <li key={i} style={{ fontSize: 13.5, lineHeight: 1.65, color: "var(--t2,#6b7da8)", position: "relative", paddingLeft: 20, marginBottom: 6, maxWidth: "62ch" }}>
            <span style={{ position: "absolute", left: 2, top: "0.62em", width: 6, height: 6, borderRadius: 2, background: "#1a56ff", opacity: 0.65 }} />
            {linkify(b, `li-${key}-${i}`)}
          </li>
        ))}
      </ul>
    )
    bullets = []
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) { flushBullets(); continue }
    const bulletMatch = line.match(/^[•\-\*]\s+(.*)/)
    if (bulletMatch) { bullets.push(bulletMatch[1]); continue }
    flushBullets()
    // Heading heuristic: short line, no sentence-ending punctuation, no URL.
    const isHeading = line.length <= 60 && !/[.!?:;,]$/.test(line) && !/https?:\/\//.test(line)
    if (isHeading) {
      blocks.push(<h4 key={`h-${key++}`} style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em", color: "var(--t1,#e8ecff)", margin: "20px 0 8px" }}>{line}</h4>)
    } else {
      blocks.push(<p key={`p-${key++}`} style={{ fontSize: 13.5, lineHeight: 1.7, color: "var(--t2,#6b7da8)", margin: "0 0 12px", maxWidth: "62ch" }}>{linkify(line, `p-${key}`)}</p>)
    }
  }
  flushBullets()
  return <>{blocks}</>
}

// Normalize Twitter/X handle: accepts "@handle", "handle", or any x.com/twitter.com
// URL form and returns just the handle (no leading @). Returns null when empty.
function normalizeXHandle(raw: string | null | undefined): string | null {
  if (!raw) return null
  let s = String(raw).trim()
  if (!s) return null
  const m = s.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([^/?#]+)/i)
  if (m) s = m[1]
  s = s.replace(/^@+/, "").trim()
  return s || null
}

interface Completion {
  tester_wallet:   string
  auto_score:      number
  builder_rating:  number | null
  quality_score:   number | null
  xp_earned:       number | null
  status:          string
  reward_delivered: boolean
  review_answers:  Record<string, string>
  task_proofs:     Record<string, string>
  created_at:      string
}


const REWARD_META: Record<string, { label: string; color: string }> = {
  usdc:             { label: "USDC",            color: "#00d990" },
  whitelist:        { label: "Whitelist",       color: "#8aaeff" },
  early_access:     { label: "Early Access",    color: "#a855f7" },
  discord_role:     { label: "Discord Role",    color: "#6366f1" },
  credit:           { label: "Public Credit",   color: "#c08828" },
  token_allocation: { label: "Token Alloc.",    color: "#1a56ff" },
  other:            { label: "Custom Reward",   color: "#6b7da8" },
}

const RANK_LABELS = ["Scout", "Builder", "Verified", "Trusted", "Arc Proven"]
const RANK_COLORS = ["#6b7da8", "#00b87a", "#8aaeff", "#c08828", "#a855f7"]

function wordCount(s: string) {
  return s.trim().split(/\s+/).filter(Boolean).length
}

export default function CampaignDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id     = params.id as string

  const [campaign, setCampaign]       = useState<Campaign | null>(null)
  const [completions, setCompletions] = useState<Completion[]>([])
  const [loading, setLoading]         = useState(true)
  const wallet    = useArcStore(s => s.walletAddr)
  const setWallet = useArcStore(s => s.setWallet)
  const [isOwner, setIsOwner]         = useState(false)

  // Submission flow: 0..tasks.length-1 = task steps, tasks.length = review, tasks.length+1 = done
  const [flowStep, setFlowStep]         = useState(0)
  const [answers, setAnswers]           = useState<Record<string, string>>({})
  // Tester-submitted proofs per task (Tower-style verification). Keyed by task.id.
  // For text proofs (x_link/tx_hash/url) the value is the URL or hash string.
  // For screenshot proofs the value is the imgbb URL returned by /api/upload.
  const [proofs, setProofs]             = useState<Record<string, string>>({})
  // Per-task upload state — keyed by task.id, true while imgbb upload is in flight
  const [uploading, setUploading]       = useState<Record<string, boolean>>({})
  const [uploadError, setUploadError]   = useState<string>("")
  const [submitting, setSubmitting]     = useState(false)
  const [submitError, setSubmitError]   = useState("")
  const [autoScore, setAutoScore]       = useState<number | null>(null)
  const [contractVerified, setContractVerified] = useState<boolean | null>(null)
  const [alreadyDone, setAlreadyDone]   = useState(false)
  const [testerRank, setTesterRank]     = useState<number | null>(null)
  const [testerProgress, setTesterProgress] = useState<{ label: string; campaigns_needed: number; score_needed: number } | null>(null)

  // Tester progress draft: keep typed answers + uploaded proof URLs + current
  // step in localStorage so a submission failure (network, rate-limit, validation)
  // doesn't wipe their work. Cleared only on successful submission. Keyed per
  // (campaign, wallet) so each wallet has its own draft per campaign, and so
  // switching wallets doesn't leak one tester's draft into another's view.
  const testerDraftKey = (campaign && wallet) ? `arclens-trial-draft-${campaign.id}-${wallet.toLowerCase()}` : null
  const testerDraftRestoredRef = useRef(false)

  // Restore the draft once the campaign + wallet are known. Skipped entirely if
  // the tester already submitted (no point — they can't resubmit anyway).
  useEffect(() => {
    if (!testerDraftKey || testerDraftRestoredRef.current || alreadyDone) return
    testerDraftRestoredRef.current = true
    try {
      const raw = localStorage.getItem(testerDraftKey)
      if (!raw) return
      const draft = JSON.parse(raw)
      if (draft.answers && typeof draft.answers === "object") setAnswers(draft.answers)
      if (draft.proofs  && typeof draft.proofs  === "object") setProofs(draft.proofs)
      if (typeof draft.flowStep === "number" && draft.flowStep >= 0 && campaign && draft.flowStep <= campaign.tasks.length) {
        setFlowStep(draft.flowStep)
      }
    } catch { /* corrupted draft — ignore and start fresh */ }
  }, [testerDraftKey, alreadyDone, campaign])

  // Save the draft on every change AFTER restore has run, so we don't clobber a
  // saved draft with the empty initial state before restoration completes.
  useEffect(() => {
    if (!testerDraftKey || !testerDraftRestoredRef.current || alreadyDone) return
    try {
      localStorage.setItem(testerDraftKey, JSON.stringify({ answers, proofs, flowStep, ts: Date.now() }))
    } catch { /* localStorage full or private-mode — silently ignore */ }
  }, [testerDraftKey, answers, proofs, flowStep, alreadyDone])

  // Builder rating state
  // Rating state lives entirely on the founder dashboard (/dashboard/[slug]).

  // Claim state
  const [myCompletion, setMyCompletion] = useState<Completion | null>(null)
  const [claiming, setClaiming]         = useState(false)
  const [claimed, setClaimed]           = useState(false)
  const [claimError, setClaimError]     = useState("")

  // Owner edit state
  const [editOpen, setEditOpen]             = useState(false)
  const [editForm, setEditForm]             = useState<Record<string, string>>({})
  // Editable copies of tasks + review_questions. null = founder hasn't opened
  // those sections yet, so we don't send them in the PUT (only changed fields
  // go to the admin queue). When opened, we hydrate from the current campaign.
  const [editTasks, setEditTasks]           = useState<Task[] | null>(null)
  const [editQs, setEditQs]                 = useState<ReviewQuestion[] | null>(null)
  const [tasksSectionOpen, setTasksSectionOpen]       = useState(false)
  const [qsSectionOpen, setQsSectionOpen]             = useState(false)
  const [draftRestored, setDraftRestored]   = useState(false)
  // Re-auth state — surfaces a "Sign in to save" button when the PUT fails
  // with 401 (session cookie expired or absent). Re-mints via personal_sign
  // and retries the edit silently, so the founder doesn't lose any work.
  const [needsReauth, setNeedsReauth]       = useState(false)
  const [reauthing, setReauthing]           = useState(false)

  // Drag-and-drop reorder for the edit-panel tasks list. Pointer sensor with
  // 6px activation distance so clicking the title input doesn't accidentally
  // start a drag. Keyboard sensor makes it accessible.
  const editDndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  function onEditTaskDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    setEditTasks(prev => {
      if (!prev) return prev
      const from = prev.findIndex(t => t.id === active.id)
      const to   = prev.findIndex(t => t.id === over.id)
      if (from < 0 || to < 0) return prev
      return arrayMove(prev, from, to)
    })
  }
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editSubmitted, setEditSubmitted]   = useState(false)
  const [editError, setEditError]           = useState("")
  const [editMessage, setEditMessage]       = useState("")
  const [shareDone,   setShareDone]         = useState(false)
  const [pendingUpdate, setPendingUpdate]   = useState<{ status: string; admin_note?: string; submitted_at: string } | null>(null)

  useEffect(() => {
    load()
  }, [id])

  useEffect(() => {
    if (wallet && campaign) {
      setIsOwner(campaign.creator_wallet.toLowerCase() === wallet.toLowerCase())
      checkAlreadyDone(wallet)
      // Fetch rank only if campaign has a rank requirement
      if (campaign.min_rank > 0) {
        fetch(`/api/trials/reputation?wallet=${encodeURIComponent(wallet)}`)
          .then(r => r.json())
          .then(d => {
            setTesterRank(d.reputation?.rank ?? 0)
            if (d.reputation?.next_rank) setTesterProgress(d.reputation.next_rank)
          })
          .catch(() => setTesterRank(0))
      }
    }
  }, [wallet, campaign])

  // Restore edit-panel draft when the campaign loads. Founders who refresh
  // mid-edit (or hit a 401 and reload) get their changes back. Cleared after
  // a successful submit.
  useEffect(() => {
    if (!campaign || draftRestored) return
    try {
      const raw = localStorage.getItem(`arclens-edit-${campaign.id}`)
      if (raw) {
        const d = JSON.parse(raw)
        if (d.editForm   && typeof d.editForm === "object")  setEditForm(d.editForm)
        if (Array.isArray(d.editTasks))                      setEditTasks(d.editTasks)
        if (Array.isArray(d.editQs))                         setEditQs(d.editQs)
      }
    } catch { /* corrupt draft — ignore */ }
    setDraftRestored(true)
  }, [campaign, draftRestored])

  // Auto-save the edit draft on every change. Debounced naturally by React's
  // state update cadence; localStorage writes are cheap.
  useEffect(() => {
    if (!campaign || !draftRestored) return
    try {
      // Only save when there's actually something to save
      const hasFormEdits  = Object.values(editForm).some(v => typeof v === "string" && v.trim())
      const hasTaskEdits  = editTasks !== null
      const hasQEdits     = editQs    !== null
      if (!hasFormEdits && !hasTaskEdits && !hasQEdits) {
        localStorage.removeItem(`arclens-edit-${campaign.id}`)
        return
      }
      localStorage.setItem(`arclens-edit-${campaign.id}`, JSON.stringify({
        editForm, editTasks, editQs, savedAt: Date.now(),
      }))
    } catch { /* storage full — silent */ }
  }, [editForm, editTasks, editQs, campaign, draftRestored])

  async function load() {
    setLoading(true)
    try {
      const res  = await fetch(`/api/trials/${id}`, { credentials: "include" })
      const data = await res.json()
      if (data.campaign) {
        setCampaign(data.campaign)
        setCompletions(data.completions || [])
        if (data.pendingUpdate) setPendingUpdate(data.pendingUpdate)
      }
    } finally {
      setLoading(false)
    }
  }

  async function checkAlreadyDone(w: string) {
    const found = completions.find(c => c.tester_wallet.toLowerCase() === w.toLowerCase())
    if (found) {
      setAlreadyDone(true)
      setMyCompletion(found)
      if (found.reward_delivered) setClaimed(true)
    }
  }

  async function claimReward() {
    if (!wallet || !campaign) return
    setClaiming(true)
    setClaimError("")
    try {
      const res  = await fetch(`/api/trials/${id}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tester_wallet: wallet }),
      })
      const data = await res.json()
      if (!res.ok) { setClaimError(data.error || "Claim failed"); return }
      setClaimed(true)
    } finally {
      setClaiming(false)
    }
  }

  async function submitCompletion() {
    if (!wallet) return
    setSubmitting(true)
    setSubmitError("")
    try {
      const res  = await fetch(`/api/trials/${id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tester_wallet:  wallet,
          tx_hashes:      [],
          review_answers: answers,
          task_proofs:    proofs,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.contract_required) {
          setSubmitError("You haven't interacted with this campaign's contract on Arc Testnet yet. Complete the on-chain steps first, then come back to submit.")
        } else {
          setSubmitError(data.error || "Submission failed")
        }
        return
      }
      setAutoScore(data.auto_score)
      setContractVerified(data.contract_verified ?? null)
      setFlowStep(campaign!.tasks.length + 1)
      // Successful submit — drop the saved draft so a refresh doesn't restore
      // stale state on a campaign they've already completed.
      if (testerDraftKey) { try { localStorage.removeItem(testerDraftKey) } catch {} }
    } finally {
      setSubmitting(false)
    }
  }

  async function connectWallet() {
    try {
      if (!(window as any).ethereum) return
      const accounts = await (window as any).ethereum.request({ method: "eth_requestAccounts" })
      if (accounts?.[0]) {
        localStorage.setItem("arclens-wallet", accounts[0].toLowerCase())
        setWallet(accounts[0])
      }
    } catch { }
  }

  // Re-mint the session cookie via personal_sign and resubmit the edit.
  // Tower-style scenario: the founder's 7-day session expired, they tried to
  // save changes, server returned 401. Instead of dropping the form state we
  // surface a single "Sign in to save" button that runs this flow.
  async function reauthAndRetry() {
    if (!wallet) { setEditError("Wallet not detected. Reconnect your wallet."); return }
    if (typeof window === "undefined" || !(window as any).ethereum) {
      setEditError("No browser wallet detected. Open this page with MetaMask / Rabby connected.")
      return
    }
    setReauthing(true)
    setEditError("")
    try {
      const nonce     = (crypto.randomUUID?.() || Math.random().toString(36).slice(2)).replace(/-/g, "")
      const timestamp = Date.now()
      const message   = `Sign in to ArcLens\nWallet: ${wallet}\nTimestamp: ${timestamp}\nNonce: ${nonce}`
      const signature = await (window as any).ethereum.request({
        method: "personal_sign",
        params: [message, wallet],
      })
      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ type: "wallet", address: wallet, signature, timestamp, nonce }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setEditError(data?.error || "Sign-in failed — try again.")
        return
      }
      // Session minted — clear the prompt and retry the original save.
      setNeedsReauth(false)
      await submitCampaignEdit()
    } catch (e: any) {
      if (e?.code === 4001 || /reject/i.test(e?.message || "")) {
        setEditError("Sign-in cancelled. Click 'Sign in to save' to try again.")
      } else {
        setEditError("Sign-in failed: " + (e?.message || "unknown error"))
      }
    } finally {
      setReauthing(false)
    }
  }

  async function submitCampaignEdit() {
    if (!wallet || !campaign) return
    setEditError("")
    const changes: Record<string, any> = {}
    if (editForm.title?.trim()) changes.title = editForm.title.trim()
    if (editForm.expires_at) changes.expires_at = editForm.expires_at
    if (editForm.total_slots) changes.total_slots = parseInt(editForm.total_slots)
    if (editForm.max_xp_per_completion?.trim()) changes.max_xp_per_completion = parseInt(editForm.max_xp_per_completion)
    if (editForm.tagline?.trim()) changes.tagline = editForm.tagline.trim()
    if (editForm.description?.trim()) changes.description = editForm.description.trim()
    if (editForm.app_url?.trim()) changes.app_url = editForm.app_url.trim()
    if (editForm.reward_description?.trim()) changes.reward_description = editForm.reward_description.trim()
    if (editForm.contract_address !== undefined && editForm.contract_address !== "") changes.contract_address = editForm.contract_address.trim()
    // Invite codes — instant cosmetic edit. The textarea holds the raw text;
    // parse into a deduped array only if the founder touched the field.
    if (editForm.invite_codes_text !== undefined) {
      const parsed: string[] = []
      const seen = new Set<string>()
      for (const raw of editForm.invite_codes_text.split(/[\n,;\s]+/)) {
        const c = raw.trim().slice(0, 64)
        if (!c) continue
        const k = c.toUpperCase()
        if (seen.has(k)) continue
        seen.add(k); parsed.push(c)
        if (parsed.length >= 200) break
      }
      changes.invite_codes = parsed
    }
    if (editForm.invite_codes_note !== undefined) {
      changes.invite_codes_note = editForm.invite_codes_note.trim().slice(0, 500)
    }
    // Tasks + review_questions: only send if founder actually edited them
    // (i.e., opened the section, which hydrates the editable copy). Compared
    // by deep JSON equality so untouched edits don't queue a noop admin item.
    if (editTasks && JSON.stringify(editTasks) !== JSON.stringify(campaign.tasks)) {
      // Strip empty rows before submitting
      const cleaned = editTasks.filter(t => t.title.trim() || t.description.trim())
      if (cleaned.length === 0) { setEditError("Tasks can't all be empty"); return }
      changes.tasks = cleaned
    }
    if (editQs && JSON.stringify(editQs) !== JSON.stringify(campaign.review_questions)) {
      const cleaned = editQs.filter(q => q.label.trim())
      if (cleaned.length === 0) { setEditError("Review questions can't all be empty"); return }
      changes.review_questions = cleaned
    }
    if (!Object.keys(changes).length) { setEditError("No changes entered"); return }
    setEditSubmitting(true)
    setNeedsReauth(false)
    try {
      const res  = await fetch(`/api/trials/${id}`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body:    JSON.stringify({ creator_wallet: wallet, changes }),
      })
      const data = await res.json()
      // Session expired / wallet not signed in. Don't clear the form — show
      // a Sign-In button that re-mints the session and retries the PUT.
      if (res.status === 401) {
        setNeedsReauth(true)
        setEditError("Your sign-in expired. Sign in again to save these changes.")
        return
      }
      if (!res.ok) { setEditError(data.error || "Submission failed"); return }
      // Successful save — clear the saved draft.
      try { if (campaign) localStorage.removeItem(`arclens-edit-${campaign.id}`) } catch {}
      // Backend now distinguishes "applied live" (cosmetic) from "queued for admin" (material).
      // Surface that distinction so founders know exactly what happened.
      setEditSubmitted(true)
      setEditMessage(data.message || "Changes submitted")
      setEditOpen(false)
      // If anything went live immediately, refresh the page state
      if (data.appliedInstant && data.appliedInstant > 0) {
        try {
          const r = await fetch(`/api/trials/${id}`, { cache: "no-store", credentials: "include" })
          const d = await r.json()
          if (d.campaign) setCampaign(d.campaign)
          if (d.pendingUpdate !== undefined) setPendingUpdate(d.pendingUpdate)
        } catch {}
      }
    } finally { setEditSubmitting(false) }
  }

  if (loading) {
    return (
      <ArcLayout active="trials">
        <div style={{ padding: "60px 28px", textAlign: "center", color: "var(--t2,#6b7da8)" }}>
          <div style={{ fontSize: 13, fontFamily: "var(--font-mono,monospace)" }}>Loading campaign...</div>
        </div>
      </ArcLayout>
    )
  }

  if (!campaign) {
    return (
      <ArcLayout active="trials">
        <div style={{ padding: "60px 28px", textAlign: "center", color: "var(--t2,#6b7da8)" }}>
          <div style={{ fontSize: 18, marginBottom: 8 }}>Campaign not found</div>
          <button onClick={() => router.push("/trials")} style={{ fontSize: 13, color: "#1a56ff", background: "none", border: "none", cursor: "pointer" }}>← Back to Trials</button>
        </div>
      </ArcLayout>
    )
  }

  const tm      = getTypeMeta(campaign.type)
  const rm      = REWARD_META[campaign.reward_type] || REWARD_META.other
  const isFull  = campaign.total_slots && campaign.filled_slots >= campaign.total_slots
  const slotsLeft = campaign.total_slots ? Math.max(0, campaign.total_slots - campaign.filled_slots) : null

  const totalSteps     = campaign.tasks.length
  const isReviewStep   = flowStep === totalSteps
  const isDoneStep     = flowStep === totalSteps + 1
  const requiredQs     = campaign.review_questions.filter(q => q.required)
  const reviewComplete = requiredQs.every(q => wordCount(answers[q.id] || "") >= (q.min_words || 20))

  return (
    <ArcLayout active="trials">
      <div className="forge-page-wrap" style={{ padding: "24px 16px", maxWidth: 860, margin: "0 auto" }}>

        {/* ── Back ── */}
        <button onClick={() => router.push("/trials")} style={{ fontSize: 12, color: "var(--t2,#6b7da8)", background: "none", border: "none", cursor: "pointer", marginBottom: 20, padding: 0 }}>
          ← Arc Trials
        </button>

        {/* ── Status Banners ── */}
        {campaign.status === "pending_approval" && (
          <div style={{ padding: "12px 16px", background: "rgba(224,136,16,0.06)", border: "1px solid rgba(224,136,16,0.2)", borderRadius: 10, marginBottom: 20, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#e08810", flexShrink: 0, boxShadow: "0 0 6px #e0881080" }} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#e08810", marginBottom: 2 }}>Pending Admin Approval</div>
              <div style={{ fontSize: 11, color: "var(--t2,#6b7da8)" }}>This campaign is under review. It will go live once approved and funded.</div>
            </div>
          </div>
        )}
        {campaign.status === "approved" && (
          <div style={{ padding: "12px 16px", background: "rgba(26,86,255,0.06)", border: "1px solid rgba(26,86,255,0.2)", borderRadius: 10, marginBottom: 20, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#8aaeff", flexShrink: 0, boxShadow: "0 0 6px #8aaeff80" }} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#8aaeff", marginBottom: 2 }}>Awaiting Founder Deposit</div>
              <div style={{ fontSize: 11, color: "var(--t2,#6b7da8)" }}>Approved — the founder needs to deposit USDC before this campaign goes live for testers.</div>
            </div>
          </div>
        )}
        {campaign.status === "rejected" && (
          <div style={{ padding: "12px 16px", background: "rgba(224,51,72,0.06)", border: "1px solid rgba(224,51,72,0.2)", borderRadius: 10, marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#e03348", marginBottom: 4 }}>Campaign Rejected</div>
            {campaign.rejection_reason && <div style={{ fontSize: 11, color: "#e03348", opacity: 0.8, lineHeight: 1.5, marginBottom: 4 }}>{campaign.rejection_reason}</div>}
            <div style={{ fontSize: 11, color: "var(--t2,#6b7da8)" }}>Contact the Arclens team if you have questions.</div>
          </div>
        )}
        {campaign.status === "ended" && (
          <div style={{ padding: "12px 16px", background: "rgba(107,125,168,0.06)", border: "1px solid rgba(107,125,168,0.15)", borderRadius: 10, marginBottom: 20, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#6b7da8", flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--t2,#6b7da8)", marginBottom: 2 }}>Campaign Ended</div>
              <div style={{ fontSize: 11, color: "var(--t3,#2e3a5c)" }}>This campaign has closed. New submissions are no longer accepted.</div>
            </div>
          </div>
        )}

        {/* ── Hero Banner ── */}
        <div style={{ background: "var(--surf,#0a0e1a)", border: "1px solid var(--bdr,rgba(255,255,255,0.06))", borderRadius: 16, marginBottom: 24, overflow: "hidden", boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}>
          {/* Banner image — uses a true 16:9 aspect ratio so the full upload
              renders (no edge cropping for branded banners like Tower x ArcLens).
              maxHeight caps it on ultra-wide screens so it doesn't dominate. */}
          <div className="heroBanner" style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", maxHeight: 420, background: `linear-gradient(135deg, ${tm.color}22 0%, ${tm.color}08 50%, #0a0e1a 100%)`, overflow: "hidden" }}>
            {/* Fallback: large abbr centered */}
            <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 80, fontWeight: 900, fontFamily: "var(--font-mono,monospace)", color: `${tm.color}18`, letterSpacing: "-0.04em", userSelect: "none" }}>{tm.abbr}</span>
            {/* Accent line at top */}
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${tm.color}, ${tm.color}40)` }} />
            {(campaign.campaign_logo || campaign.project_logo) && (
              <img
                src={`/api/image-proxy?url=${encodeURIComponent((campaign.campaign_logo || campaign.project_logo)!)}`}
                alt=""
                onError={e => (e.currentTarget.style.display = "none")}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: (campaign as any).banner_position || "50% 50%" }}
              />
            )}
            {/* Gradient overlay so text below is always readable */}
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 80, background: "linear-gradient(0deg, var(--surf,#0a0e1a) 0%, transparent 100%)" }} />
          </div>
          {/* Title + badges below banner.
              flexWrap lets the share buttons drop below the title block on
              narrow phones so they never overlap or get cut off. */}
          <div style={{ padding: "24px 28px 24px" }}>
            <div className="forge-title-row" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h1 className="forge-title" style={{ fontSize: 26, fontWeight: 600, color: "var(--t1,#e8ecff)", margin: "0 0 8px", letterSpacing: "-0.025em", lineHeight: 1.2 }}>{campaign.title}</h1>
                {campaign.tagline && <p style={{ fontSize: 14, color: "var(--t2,#6b7da8)", margin: "0 0 16px", lineHeight: 1.65, maxWidth: 640 }}>{campaign.tagline}</p>}
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10, fontFamily: "var(--font-mono,monospace)", background: `${tm.color}15`, color: tm.color, border: `1px solid ${tm.color}25`, padding: "4px 10px", borderRadius: 5, letterSpacing: "0.03em" }}>{tm.label}</span>
                  <span style={{ fontSize: 10, fontFamily: "var(--font-mono,monospace)", background: `${rm.color}15`, color: rm.color, border: `1px solid ${rm.color}25`, padding: "4px 10px", borderRadius: 5, letterSpacing: "0.03em" }}>{rm.label}</span>
                  {campaign.project_name && (
                    <span style={{ fontSize: 11, color: "var(--t3,#2e3a5c)", fontFamily: "var(--font-mono,monospace)" }}>· {campaign.project_name}</span>
                  )}
                </div>
              </div>

              {/* Share + Leaderboard buttons. Leaderboard only appears when at
                  least one rated submission exists — empty campaigns hide it. */}
              <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap", alignItems: "center" }}>
                {/* Primary CTA — scrolls to the tester flow. Only for joinable
                    campaigns; pending/ended/full states have nothing to start. */}
                {campaign.status === "active" && !isFull && !isOwner && (
                  <button
                    onClick={() => document.getElementById("tester-flow")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    style={{ height: 34, padding: "0 18px", background: "#1a56ff", color: "#fff", border: "none", borderRadius: 8, fontSize: 12.5, fontWeight: 650, cursor: "pointer", whiteSpace: "nowrap", letterSpacing: "-0.01em", boxShadow: "0 3px 12px rgba(26,86,255,0.35)" }}>
                    Start testing →
                  </button>
                )}
                {/* Leaderboard link — always rendered so it's reachable even
                    before any tester is rated. The destination page handles the
                    empty state gracefully. Clean text-only pill. */}
                <a
                  href={`/trials/${campaign.slug || campaign.id}/leaderboard`}
                  title="View top contributors"
                  style={{ height: 32, padding: "0 14px", background: "transparent", border: "1px solid var(--bdr,rgba(255,255,255,0.08))", borderRadius: 7, color: "var(--t2,#6b7da8)", fontSize: 11, fontFamily: "var(--font-mono,monospace)", cursor: "pointer", whiteSpace: "nowrap", textDecoration: "none", display: "inline-flex", alignItems: "center" }}
                >
                  leaderboard
                </a>
                <button
                  title="Copy link"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(typeof window !== "undefined" ? window.location.origin + window.location.pathname + "?ref=share" : "")
                      setShareDone(true)
                      setTimeout(() => setShareDone(false), 1500)
                    } catch {}
                  }}
                  style={{ height: 32, padding: "0 12px", background: shareDone ? "rgba(0,184,122,0.08)" : "transparent", border: `1px solid ${shareDone ? "rgba(0,184,122,0.25)" : "var(--bdr,rgba(255,255,255,0.08))"}`, borderRadius: 7, color: shareDone ? "#00d990" : "var(--t2,#6b7da8)", fontSize: 11, fontFamily: "var(--font-mono,monospace)", cursor: "pointer", whiteSpace: "nowrap" }}>
                  {shareDone ? "✓ copied" : "↗ copy link"}
                </button>
                <a
                  href={typeof window !== "undefined"
                    ? (() => {
                        // Neutral share copy. Always tags @arclens_app and mentions
                        // Arc Testnet (the actual chain campaigns run on). If the
                        // project has an X handle, the title becomes credit enough
                        // — we don't repeat the name "by @same_name" (which read
                        // as nonsense when handle matches project name).
                        const ph = normalizeXHandle(campaign.project_twitter)
                        const by = ph ? ` by @${ph}` : ""
                        const text = `${campaign.title}${by} — an Arc Testnet campaign live on @arclens_app. Join in:`
                        return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(window.location.origin + window.location.pathname + "?ref=share")}`
                      })()
                    : "#"
                  }
                  target="_blank" rel="noopener noreferrer"
                  style={{ height: 32, padding: "0 12px", background: "transparent", border: "1px solid var(--bdr,rgba(255,255,255,0.08))", borderRadius: 7, color: "var(--t2,#6b7da8)", fontSize: 11, fontFamily: "var(--font-mono,monospace)", cursor: "pointer", textDecoration: "none", display: "flex", alignItems: "center", gap: 6 }}>
                  <svg width={11} height={11} viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.261 5.635 5.903-5.635Zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                  share
                </a>
              </div>
            </div>
          </div>
          {/* Stat bar */}
          {(() => {
            // Zero completions reads as an invitation, not an empty room.
            // pg returns COUNT(*) as a string — coerce before comparing.
            const noneYet = Number(campaign.completion_count) === 0 && campaign.status !== "ended"
            const items: { label: string; value: string; color: string }[] = [
              { label: "slots left", value: slotsLeft !== null ? (slotsLeft === 0 ? "Full" : String(slotsLeft)) : "Open", color: slotsLeft === 0 ? "#e03348" : "#00b87a" },
              noneYet
                ? { label: "be the first tester", value: "✦ Open", color: "#8aaeff" }
                : { label: "completed", value: String(campaign.completion_count), color: "var(--t1,#e8ecff)" },
            ]
            if (campaign.max_xp_per_completion != null) {
              items.push({ label: "max xp", value: String(campaign.max_xp_per_completion), color: "#8aaeff" })
            }
            if (campaign.expires_at) {
              items.push({ label: "closes", value: new Date(campaign.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), color: "var(--t2,#6b7da8)" })
            }
            return (
          <div className="forge-stat-bar" style={{ display: "grid", gridTemplateColumns: `repeat(${items.length}, 1fr)`, borderTop: "1px solid var(--bdr,rgba(255,255,255,0.06))" }}>
            {items.map((s, i, arr) => (
              <div key={i} style={{ padding: "18px 0", textAlign: "center", borderRight: i < arr.length - 1 ? "1px solid var(--bdr,rgba(255,255,255,0.06))" : "none" }}>
                <div style={{ fontSize: 22, fontWeight: 600, color: s.color, fontFamily: "var(--font-mono,monospace)", lineHeight: 1, letterSpacing: "-0.02em" }}>{s.value}</div>
                <div style={{ fontSize: 9, color: "var(--t3,#2e3a5c)", textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 7, fontFamily: "var(--font-mono,monospace)" }}>{s.label}</div>
              </div>
            ))}
          </div>
          )
          })()}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 20, alignItems: "start" }}
          className="forge-detail-grid"
        >

          {/* ── Left column ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>

            {/* Description — one continuous surface: no box, mono eyebrow +
                whitespace do the separating. Founder text gets real structure
                (lists, links, subheads) via FormattedDescription. */}
            <div style={{ padding: "6px 4px 0" }}>
              <div style={{ fontSize: 10, fontFamily: "var(--font-mono,monospace)", color: "var(--t3,#2e3a5c)", textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 14 }}>About this campaign</div>
              <FormattedDescription text={campaign.description} />
              {campaign.app_url && (
                <a href={campaign.app_url} target="_blank" rel="noopener noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 38, padding: "0 18px", marginTop: 8, background: "rgba(26,86,255,0.1)", color: "#8aaeff", border: "1px solid rgba(26,86,255,0.25)", borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: "none", letterSpacing: "-0.01em" }}>
                  Open app →
                </a>
              )}
            </div>

            {/* ── Step-by-step tester flow ──
                Boxed container for the interactive states (connect / tasks /
                submit). The pending read-only walkthrough renders borderless —
                part of the continuous article surface. */}
            {!isOwner && (
              <div id="tester-flow" style={campaign.status === "pending_approval"
                ? { padding: "0 4px" }
                : { background: "var(--surf,#0a0e1a)", border: "1px solid var(--bdr,rgba(255,255,255,0.06))", borderRadius: 12, overflow: "hidden", scrollMarginTop: 20 }}>

                {/* Campaign not active */}
                {campaign.status !== "active" ? (
                  campaign.status === "pending_approval" && campaign.tasks?.length > 0 ? (
                    /* Read-only walkthrough while under review — the exact steps testers
                       will walk once live, shown without inputs so admins and founders
                       can review the full flow before approval. */
                    (() => {
                      const hasInternal = !!campaign.contract_address || campaign.tasks.some(t => !!t.contract_address)
                      const PROOF_PREVIEW: Record<string, string> = { x_link: "X post URL", tx_hash: "transaction hash", url: "URL", screenshot: "screenshot" }
                      return (
                        <div style={{ padding: "26px 0 0" }}>
                          <div style={{ fontSize: 10, fontFamily: "var(--font-mono,monospace)", color: "var(--t3,#2e3a5c)", textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 6 }}>
                            The walkthrough — {campaign.tasks.length} step{campaign.tasks.length === 1 ? "" : "s"}
                          </div>
                          <div style={{ fontSize: 12, color: "var(--t2,#6b7da8)", lineHeight: 1.6, marginBottom: 18, maxWidth: "60ch" }}>
                            Read-only while under review. Once live, testers walk these steps one at a time{hasInternal ? " — completion is auto-verified on-chain, no manual proof asked" : ""}.
                          </div>
                          <div>
                            {campaign.tasks.map((t, i) => {
                              const pt = t.proof_type || "none"
                              const isLast = i === campaign.tasks.length - 1
                              return (
                                <div key={t.id} style={{ display: "flex", gap: 18, position: "relative", paddingBottom: isLast ? 0 : 26 }}>
                                  {/* Rail segment connecting this node to the next */}
                                  {!isLast && <div style={{ position: "absolute", left: 15, top: 34, bottom: 0, width: 2, background: "var(--bdr,rgba(255,255,255,0.08))" }} />}
                                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--surf,#0a0e1a)", border: "1.5px solid #1a56ff", color: "#8aaeff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, fontFamily: "var(--font-mono,monospace)", flexShrink: 0, position: "relative", zIndex: 1 }}>
                                    {i + 1}
                                  </div>
                                  <div style={{ paddingTop: 5, minWidth: 0 }}>
                                    <div style={{ fontSize: 14, fontWeight: 650, color: "var(--t1,#e8ecff)", letterSpacing: "-0.01em" }}>{t.title}</div>
                                    {t.description && <div style={{ fontSize: 12.5, color: "var(--t2,#6b7da8)", lineHeight: 1.6, marginTop: 3, maxWidth: "56ch" }}>{t.description}</div>}
                                    <div style={{ marginTop: 8 }}>
                                      {hasInternal ? (
                                        <span style={{ fontSize: 9.5, fontFamily: "var(--font-mono,monospace)", color: "#00d990", background: "rgba(0,217,144,0.08)", padding: "3px 9px", borderRadius: 4, letterSpacing: "0.04em" }}>✓ auto-verified on-chain</span>
                                      ) : pt === "none" ? (
                                        <span style={{ fontSize: 9.5, fontFamily: "var(--font-mono,monospace)", color: "var(--t3,#2e3a5c)", border: "1px solid var(--bdr,rgba(255,255,255,0.08))", padding: "3px 9px", borderRadius: 4, letterSpacing: "0.04em" }}>no proof required</span>
                                      ) : (
                                        <span style={{ fontSize: 9.5, fontFamily: "var(--font-mono,monospace)", color: "#e0a810", background: "rgba(224,168,16,0.09)", padding: "3px 9px", borderRadius: 4, letterSpacing: "0.04em" }}>proof: {PROOF_PREVIEW[pt] || pt}</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                          {campaign.review_questions?.length > 0 && (
                            <div style={{ marginTop: 30 }}>
                              <div style={{ fontSize: 10, fontFamily: "var(--font-mono,monospace)", color: "var(--t3,#2e3a5c)", textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 14 }}>
                                Then testers answer {campaign.review_questions.length} review question{campaign.review_questions.length === 1 ? "" : "s"}
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                                {campaign.review_questions.map((q, i) => (
                                  <div key={q.id} style={{ borderLeft: "2px solid var(--bdr,rgba(255,255,255,0.08))", paddingLeft: 16 }}>
                                    <div style={{ fontSize: 13.5, color: "var(--t1,#e8ecff)", fontWeight: 550, lineHeight: 1.5 }}>{q.label}</div>
                                    <div style={{ fontFamily: "var(--font-mono,monospace)", color: "var(--t3,#2e3a5c)", fontSize: 10, letterSpacing: "0.04em", marginTop: 3 }}>Q{i + 1} · min {q.min_words} words{q.required ? " · required" : ""}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })()
                  ) : (
                  <div style={{ padding: "32px 20px", textAlign: "center", color: "var(--t2,#6b7da8)", fontSize: 13 }}>
                    {campaign.status === "approved"
                      ? "This campaign is approved but not yet funded — check back soon"
                      : campaign.status === "ended"
                      ? "This campaign has ended and is no longer accepting submissions"
                      : "This campaign is not currently accepting submissions"}
                  </div>
                  )

                ) : isFull ? (
                  <div style={{ padding: "32px 20px", textAlign: "center", color: "var(--t2,#6b7da8)", fontSize: 13 }}>
                    All tester slots are filled for this campaign
                  </div>

                ) : !wallet ? (
                  <div style={{ padding: "36px 20px", textAlign: "center" }}>
                    <div style={{ fontSize: 13, color: "var(--t2,#6b7da8)", marginBottom: 16, lineHeight: 1.6 }}>
                      Connect your wallet to participate and earn <strong style={{ color: rm.color }}>{rm.label}</strong>
                    </div>
                    <button onClick={connectWallet}
                      style={{ height: 42, padding: "0 28px", background: "#1a56ff", color: "#fff", border: "none", borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      Connect Wallet
                    </button>
                    <div style={{ fontSize: 10, fontFamily: "var(--font-mono,monospace)", color: "var(--t3,#2e3a5c)", marginTop: 12 }}>
                      MetaMask, Rabby, or any injected wallet
                    </div>
                  </div>

                ) : campaign.min_rank > 0 && testerRank !== null && testerRank < campaign.min_rank ? (
                  <div style={{ padding: "28px 24px 24px" }}>
                    {/* Lock header */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 24 }}>
                      <div style={{ width: 44, height: 44, borderRadius: 12, background: "var(--surf2,#0e1224)", border: "1px solid var(--bdr,rgba(255,255,255,0.06))", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" style={{ color: "var(--t2,#6b7da8)" }}>
                          <rect x="4" y="9" width="12" height="9" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                          <path d="M7 9V6a3 3 0 016 0v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--t1,#e8ecff)", marginBottom: 5 }}>Access Restricted</div>
                      <div style={{ fontSize: 12, color: "var(--t2,#6b7da8)", textAlign: "center", lineHeight: 1.7, maxWidth: 280 }}>
                        This campaign requires <strong style={{ color: RANK_COLORS[campaign.min_rank] }}>{RANK_LABELS[campaign.min_rank]}</strong> rank. Build your reputation to unlock it.
                      </div>
                    </div>

                    {/* Rank comparison — collapses to vertical stack on narrow screens */}
                    <div className="rankCompareGrid" style={{ display: "grid", gridTemplateColumns: "1fr 28px 1fr", alignItems: "center", gap: 8, marginBottom: 20 }}>
                      {/* Current rank */}
                      <div style={{ background: "var(--surf2,#0e1224)", border: `1px solid ${RANK_COLORS[testerRank]}25`, borderRadius: 10, padding: "14px 12px", textAlign: "center" }}>
                        <div style={{ fontSize: 9, fontFamily: "var(--font-mono,monospace)", color: "var(--t3,#2e3a5c)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Your rank</div>
                        <div style={{ width: 28, height: 28, borderRadius: "50%", background: `${RANK_COLORS[testerRank]}15`, border: `2px solid ${RANK_COLORS[testerRank]}50`, margin: "0 auto 8px" }} />
                        <div style={{ fontSize: 12, fontWeight: 700, color: RANK_COLORS[testerRank] }}>{RANK_LABELS[testerRank]}</div>
                      </div>
                      {/* Arrow */}
                      <div style={{ display: "flex", justifyContent: "center" }}>
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: "var(--t3,#2e3a5c)" }}>
                          <path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                      {/* Required rank */}
                      <div style={{ background: "var(--surf2,#0e1224)", border: `1px solid ${RANK_COLORS[campaign.min_rank]}25`, borderRadius: 10, padding: "14px 12px", textAlign: "center" }}>
                        <div style={{ fontSize: 9, fontFamily: "var(--font-mono,monospace)", color: "var(--t3,#2e3a5c)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Required</div>
                        <div style={{ width: 28, height: 28, borderRadius: "50%", background: `${RANK_COLORS[campaign.min_rank]}15`, border: `2px dashed ${RANK_COLORS[campaign.min_rank]}50`, margin: "0 auto 8px", position: "relative" }}>
                          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <svg width="10" height="10" viewBox="0 0 20 20" fill="none" style={{ color: `${RANK_COLORS[campaign.min_rank]}80` }}>
                              <rect x="4" y="9" width="12" height="9" rx="2" stroke="currentColor" strokeWidth="2"/>
                              <path d="M7 9V6a3 3 0 016 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                            </svg>
                          </div>
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: RANK_COLORS[campaign.min_rank] }}>{RANK_LABELS[campaign.min_rank]}</div>
                      </div>
                    </div>

                    {/* What it takes */}
                    {testerProgress && (
                      <div style={{ background: "var(--surf2,#0e1224)", border: "1px solid var(--bdr,rgba(255,255,255,0.06))", borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
                        <div style={{ fontSize: 10, fontFamily: "var(--font-mono,monospace)", color: "var(--t3,#2e3a5c)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
                          Path to {testerProgress.label}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1px 1fr", gap: 12, alignItems: "center" }}>
                          <div style={{ textAlign: "center" }}>
                            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--t1,#e8ecff)", fontFamily: "var(--font-mono,monospace)", lineHeight: 1, marginBottom: 4 }}>
                              {testerProgress.campaigns_needed}
                            </div>
                            <div style={{ fontSize: 10, color: "var(--t2,#6b7da8)", lineHeight: 1.4 }}>more campaigns<br/>to complete</div>
                          </div>
                          <div style={{ background: "var(--bdr,rgba(255,255,255,0.06))", height: "100%", minHeight: 40 }} />
                          <div style={{ textAlign: "center" }}>
                            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--t1,#e8ecff)", fontFamily: "var(--font-mono,monospace)", lineHeight: 1, marginBottom: 4 }}>
                              {testerProgress.score_needed}+
                            </div>
                            <div style={{ fontSize: 10, color: "var(--t2,#6b7da8)", lineHeight: 1.4 }}>avg quality<br/>score needed</div>
                          </div>
                        </div>
                      </div>
                    )}

                    <button onClick={() => router.push("/trials")}
                      style={{ width: "100%", height: 42, background: "rgba(26,86,255,0.08)", color: "#8aaeff", border: "1px solid rgba(26,86,255,0.2)", borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: "pointer", letterSpacing: "-0.01em" }}>
                      Browse open campaigns →
                    </button>
                  </div>

                ) : alreadyDone ? (
                  /* Already submitted */
                  <div style={{ padding: "28px 20px", textAlign: "center" }}>
                    <div style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(0,184,122,0.1)", border: "1px solid rgba(0,184,122,0.25)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", fontSize: 16, color: "#00b87a" }}>✓</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#00b87a", marginBottom: 6 }}>Already submitted</div>
                    <div style={{ fontSize: 12, color: "var(--t2,#6b7da8)", marginBottom: campaign.reward_type === "usdc" && campaign.reward_usdc_amount && !claimed ? 18 : 0 }}>
                      Your completion is pending builder review
                    </div>
                    {campaign.reward_type === "usdc" && campaign.reward_usdc_amount ? (
                      claimed ? (
                        <div style={{ padding: "10px 16px", background: "rgba(0,184,122,0.08)", border: "1px solid rgba(0,184,122,0.2)", borderRadius: 8, fontSize: 13, color: "#00d990", fontWeight: 600 }}>
                          ✓ ${campaign.reward_usdc_amount} USDC claimed
                        </div>
                      ) : (
                        <div>
                          {claimError && <div style={{ fontSize: 11, color: "#e03348", marginBottom: 8 }}>{claimError}</div>}
                          <button onClick={claimReward} disabled={claiming}
                            style={{ width: "100%", height: 42, background: claiming ? "var(--surf2,#0e1224)" : "rgba(0,184,122,0.12)", color: claiming ? "var(--t2,#6b7da8)" : "#00d990", border: "1px solid rgba(0,184,122,0.3)", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: claiming ? "default" : "pointer" }}>
                            {claiming ? "Claiming..." : `Claim $${campaign.reward_usdc_amount} USDC →`}
                          </button>
                        </div>
                      )
                    ) : null}
                  </div>

                ) : isDoneStep ? (
                  /* Submission complete */
                  <div style={{ padding: "28px 20px", textAlign: "center" }}>
                    <div style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(0,184,122,0.1)", border: "1px solid rgba(0,184,122,0.25)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", fontSize: 16, color: "#00b87a" }}>✓</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#00b87a", marginBottom: 6 }}>Submission received</div>
                    <div style={{ fontSize: 13, color: "var(--t2,#6b7da8)", marginBottom: 10 }}>
                      Quality score: <strong style={{ color: "var(--t1,#e8ecff)" }}>{autoScore}/100</strong>
                    </div>
                    {/* If this campaign has XP, show the tester their earned XP
                        once the builder has rated. Before rating, show the max
                        they can earn so they know what's on the line. */}
                    {campaign.max_xp_per_completion != null && (() => {
                      const mine = completions.find(c => c.tester_wallet.toLowerCase() === wallet?.toLowerCase())
                      const earned = mine?.xp_earned != null && mine.xp_earned > 0 ? mine.xp_earned : null
                      return (
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 14px", marginBottom: 12,
                          background: earned ? "rgba(138,174,255,0.08)" : "rgba(138,174,255,0.04)",
                          border: "1px solid rgba(138,174,255,0.25)", borderRadius: 7 }}>
                          <span style={{ fontSize: 11, fontFamily: "var(--font-mono,monospace)", color: "#8aaeff", letterSpacing: "0.04em" }}>
                            {earned != null
                              ? `+${earned} XP earned for ${campaign.project_name || "this project"}`
                              : `Up to ${campaign.max_xp_per_completion} XP — awarded after the builder rates`}
                          </span>
                        </div>
                      )
                    })()}
                    {contractVerified !== null && (
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 6, marginBottom: 12,
                        background: contractVerified ? "rgba(0,184,122,0.08)" : "rgba(107,125,168,0.06)",
                        border: `1px solid ${contractVerified ? "rgba(0,184,122,0.2)" : "rgba(107,125,168,0.12)"}` }}>
                        <span style={{ fontSize: 10, fontFamily: "var(--font-mono,monospace)", color: contractVerified ? "#00d990" : "var(--t2,#6b7da8)" }}>
                          {contractVerified ? "✓ On-chain activity verified" : "On-chain activity not detected"}
                        </span>
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: "var(--t2,#6b7da8)", marginBottom: campaign.reward_type === "usdc" && campaign.reward_usdc_amount ? 16 : 0 }}>
                      Your reputation updates once the builder rates your feedback.
                    </div>
                    {campaign.reward_type === "usdc" && campaign.reward_usdc_amount ? (
                      claimed ? (
                        <div style={{ padding: "10px 16px", background: "rgba(0,184,122,0.08)", border: "1px solid rgba(0,184,122,0.2)", borderRadius: 8, fontSize: 13, color: "#00d990", fontWeight: 600 }}>
                          ✓ ${campaign.reward_usdc_amount} USDC claimed
                        </div>
                      ) : (
                        <div>
                          {claimError && <div style={{ fontSize: 11, color: "#e03348", marginBottom: 8 }}>{claimError}</div>}
                          <button onClick={claimReward} disabled={claiming}
                            style={{ width: "100%", height: 42, background: claiming ? "var(--surf2,#0e1224)" : "rgba(0,184,122,0.12)", color: claiming ? "var(--t2,#6b7da8)" : "#00d990", border: "1px solid rgba(0,184,122,0.3)", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: claiming ? "default" : "pointer" }}>
                            {claiming ? "Claiming..." : `Claim $${campaign.reward_usdc_amount} USDC →`}
                          </button>
                        </div>
                      )
                    ) : null}
                  </div>

                ) : (
                  /* Active flow — tasks + review */
                  <div>
                    {/* Invite-code panel — only shown if the founder pasted codes
                        (e.g. closed-beta DEX). ArcLens displays them verbatim;
                        redemption happens on the founder's product, not here. */}
                    {Array.isArray(campaign.invite_codes) && campaign.invite_codes.length > 0 && (
                      <InviteCodesPanel
                        codes={campaign.invite_codes}
                        appUrl={campaign.app_url}
                        productName={campaign.project_name}
                        note={campaign.invite_codes_note || null}
                        walletConnected={!!wallet}
                        onConnect={connectWallet}
                      />
                    )}
                    {/* How this works — shown only before the first step */}
                    {flowStep === 0 && !isReviewStep && (
                      <div style={{ padding: "10px 20px", borderBottom: "1px solid var(--bdr,rgba(255,255,255,0.06))", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                        {(["Do the steps", "Write feedback", `Earn ${rm.label}`] as string[]).map((s, i, arr) => (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                            <div style={{ width: 16, height: 16, borderRadius: "50%", background: "rgba(26,86,255,0.1)", border: "1px solid rgba(26,86,255,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 700, color: "#8aaeff", fontFamily: "var(--font-mono,monospace)" }}>{i + 1}</div>
                            <span style={{ fontSize: 11, color: "var(--t2,#6b7da8)", fontFamily: "var(--font-mono,monospace)" }}>{s}</span>
                            {i < arr.length - 1 && <span style={{ fontSize: 9, color: "var(--t3,#2e3a5c)" }}>→</span>}
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Progress header */}
                    <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--bdr,rgba(255,255,255,0.06))", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ fontSize: 11, fontFamily: "var(--font-mono,monospace)", color: "var(--t2,#6b7da8)" }}>
                        {isReviewStep
                          ? `All ${totalSteps} steps done · Share your feedback`
                          : `Step ${flowStep + 1} of ${totalSteps}`}
                      </div>
                      {/* Progress dots — click any completed step to jump back to it */}
                      <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                        {campaign.tasks.map((_, i) => {
                          const isPast = i < flowStep
                          const isCurrent = i === flowStep && !isReviewStep
                          return (
                            <button
                              key={i}
                              type="button"
                              onClick={() => { if (i <= flowStep || isReviewStep) setFlowStep(i) }}
                              title={isPast ? `Back to step ${i + 1}` : isCurrent ? `Step ${i + 1}` : `Step ${i + 1} (locked)`}
                              disabled={i > flowStep && !isReviewStep}
                              style={{
                                width: isPast || isCurrent ? 16 : 6,
                                height: 6,
                                borderRadius: 3,
                                padding: 0,
                                border: "none",
                                background: isPast ? "#00b87a" : isCurrent ? "#1a56ff" : "var(--bdr,rgba(255,255,255,0.06))",
                                cursor: (i <= flowStep || isReviewStep) ? "pointer" : "default",
                                transition: "all 0.2s",
                              }}
                            />
                          )
                        })}
                        <div style={{ width: isReviewStep ? 16 : 6, height: 6, borderRadius: 3,
                          background: isDoneStep ? "#00b87a" : isReviewStep ? "#1a56ff" : "var(--bdr,rgba(255,255,255,0.06))",
                          transition: "all 0.2s" }} />
                      </div>
                    </div>

                    {/* Completed steps summary */}
                    {flowStep > 0 && (
                      <div style={{ padding: "10px 20px", borderBottom: "1px solid var(--bdr,rgba(255,255,255,0.06))", display: "flex", flexDirection: "column", gap: 6 }}>
                        {campaign.tasks.slice(0, flowStep).map((task, i) => (
                          <div key={task.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ width: 18, height: 18, borderRadius: "50%", background: "rgba(0,184,122,0.1)", border: "1px solid rgba(0,184,122,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#00b87a", flexShrink: 0 }}>✓</div>
                            <span style={{ fontSize: 11, color: "var(--t2,#6b7da8)", opacity: 0.7 }}>{task.title}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Current task card OR review form */}
                    <div style={{ padding: "20px 20px 22px" }}>
                      {!isReviewStep ? (
                        /* Current task */
                        <div>
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 20 }}>
                            <div style={{ width: 36, height: 36, borderRadius: 9, background: "rgba(26,86,255,0.1)", border: "1px solid rgba(26,86,255,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#8aaeff", fontFamily: "var(--font-mono,monospace)", flexShrink: 0 }}>
                              {String(flowStep + 1).padStart(2, "0")}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--t1,#e8ecff)", marginBottom: 6, lineHeight: 1.3 }}>
                                {campaign.tasks[flowStep].title}
                              </div>
                              {campaign.tasks[flowStep].description && (
                                <div style={{ fontSize: 13, color: "var(--t2,#6b7da8)", lineHeight: 1.6 }}>
                                  {campaign.tasks[flowStep].description}
                                </div>
                              )}
                            </div>
                          </div>
                          {campaign.app_url && (
                            <a href={campaign.app_url} target="_blank" rel="noopener noreferrer"
                              style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 14px", background: "rgba(26,86,255,0.06)", color: "#8aaeff", border: "1px solid rgba(26,86,255,0.2)", borderRadius: 7, fontSize: 12, textDecoration: "none", marginBottom: 10 }}>
                              Open app ↗
                            </a>
                          )}
                          <div style={{ fontSize: 11, color: "var(--t3,#2e3a5c)", fontFamily: "var(--font-mono,monospace)", marginBottom: 12, lineHeight: 1.6 }}>
                            Complete this step in the app, then mark it done below.
                          </div>
                          {/* Per-task proof — required by founder for verification.
                              Text inputs for x_link/tx_hash/url; built-in file upload
                              for screenshot (hosted on our /api/upload imgbb pipeline).
                              SKIPPED entirely when the campaign uses internal on-chain
                              verification (any contract address set) — ArcLens auto-
                              checks Arc Testnet logs in that case. */}
                          {(() => {
                            const currentTask  = campaign.tasks[flowStep]
                            const pt           = currentTask.proof_type || "none"
                            const hasInternal  = !!campaign.contract_address || campaign.tasks.some(t => !!t.contract_address)
                            if (pt === "none" || hasInternal) return null
                            const value = proofs[currentTask.id] || ""
                            const isUploading = !!uploading[currentTask.id]

                            // Screenshot branch — file picker + preview, no manual URL pasting.
                            if (pt === "screenshot") {
                              const hasImage = !!value
                              return (
                                <div style={{ marginBottom: 12, padding: "11px 12px", background: "var(--surf2,#0e1224)",
                                  border: `1px solid ${hasImage ? "rgba(0,184,122,0.3)" : "var(--bdr,rgba(255,255,255,0.06))"}`, borderRadius: 8 }}>
                                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
                                    <span style={{ fontSize: 10, fontFamily: "var(--font-mono,monospace)", color: "var(--t3,#2e3a5c)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                                      Proof — screenshot
                                    </span>
                                    {hasImage && (
                                      <span style={{ fontSize: 9.5, fontFamily: "var(--font-mono,monospace)", color: "#00d990" }}>
                                        ✓ uploaded
                                      </span>
                                    )}
                                  </div>
                                  {hasImage ? (
                                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                                      <img src={/\.blob\.vercel-storage\.com\//i.test(value) ? value : `/api/image-proxy?url=${encodeURIComponent(value)}`}
                                        alt="proof"
                                        style={{ width: 96, height: 72, objectFit: "cover", borderRadius: 6, border: "1px solid var(--bdr,rgba(255,255,255,0.06))" }} />
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 10.5, fontFamily: "var(--font-mono,monospace)", color: "var(--t2,#6b7da8)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 8 }}>
                                          {value.replace(/^https?:\/\//, "")}
                                        </div>
                                        <button type="button"
                                          onClick={() => setProofs(p => { const n = { ...p }; delete n[currentTask.id]; return n })}
                                          style={{ fontSize: 10, fontFamily: "var(--font-mono,monospace)", color: "#e03348", background: "transparent", border: "1px solid rgba(224,51,72,0.2)", padding: "4px 9px", borderRadius: 5, cursor: "pointer" }}>
                                          Replace
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                                      height: 72, border: "1px dashed var(--bdr,rgba(255,255,255,0.12))", borderRadius: 7, cursor: isUploading ? "default" : "pointer",
                                      fontSize: 12, color: isUploading ? "var(--t3,#2e3a5c)" : "var(--t2,#6b7da8)", background: "rgba(255,255,255,0.01)" }}>
                                      {isUploading ? (
                                        <span>Uploading…</span>
                                      ) : (
                                        <>
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                            <polyline points="17 8 12 3 7 8"/>
                                            <line x1="12" y1="3" x2="12" y2="15"/>
                                          </svg>
                                          <span>Click to upload screenshot · PNG/JPG/WebP, max 5 MB</span>
                                        </>
                                      )}
                                      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" style={{ display: "none" }}
                                        disabled={isUploading}
                                        onChange={async e => {
                                          const file = e.target.files?.[0]
                                          if (!file) return
                                          setUploadError("")
                                          setUploading(u => ({ ...u, [currentTask.id]: true }))
                                          try {
                                            const fd = new FormData()
                                            fd.append("image", file)
                                            const res = await fetch("/api/upload", { method: "POST", body: fd })
                                            const data = await res.json()
                                            if (!res.ok || !data?.url) {
                                              setUploadError(data?.error || "Upload failed")
                                            } else {
                                              setProofs(p => ({ ...p, [currentTask.id]: data.url }))
                                            }
                                          } catch {
                                            setUploadError("Upload failed — try again")
                                          } finally {
                                            setUploading(u => ({ ...u, [currentTask.id]: false }))
                                          }
                                          e.target.value = ""
                                        }} />
                                    </label>
                                  )}
                                  {uploadError && (
                                    <div style={{ fontSize: 10, color: "#e03348", marginTop: 6, fontFamily: "var(--font-mono,monospace)" }}>{uploadError}</div>
                                  )}
                                </div>
                              )
                            }

                            // Text-input branches (x_link / tx_hash / url)
                            const meta = pt === "x_link"
                              ? { label: "Proof — X post URL", placeholder: "https://x.com/yourhandle/status/...", validate: (v: string) => /^https?:\/\/(www\.)?(x|twitter)\.com\/[^/]+\/status\/\d+/i.test(v) }
                              : pt === "tx_hash"
                              ? { label: "Proof — transaction hash",  placeholder: "0x… (64 hex chars)",            validate: (v: string) => /^0x[a-fA-F0-9]{64}$/.test(v) }
                              : { label: "Proof — URL", placeholder: "https://… (proof page)", validate: (v: string) => { try { const u = new URL(v); return u.protocol === "https:" || u.protocol === "http:" } catch { return false } } }
                            const ok = !!value && meta.validate(value)
                            return (
                              <div style={{ marginBottom: 12, padding: "11px 12px", background: "var(--surf2,#0e1224)", border: `1px solid ${ok ? "rgba(0,184,122,0.3)" : value ? "rgba(224,51,72,0.3)" : "var(--bdr,rgba(255,255,255,0.06))"}`, borderRadius: 8 }}>
                                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
                                  <span style={{ fontSize: 10, fontFamily: "var(--font-mono,monospace)", color: "var(--t3,#2e3a5c)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                                    {meta.label}
                                  </span>
                                  {value && (
                                    <span style={{ fontSize: 9.5, fontFamily: "var(--font-mono,monospace)", color: ok ? "#00d990" : "#e03348" }}>
                                      {ok ? "✓ valid format" : "invalid format"}
                                    </span>
                                  )}
                                </div>
                                <input
                                  type="text"
                                  value={value}
                                  onChange={e => setProofs(p => ({ ...p, [currentTask.id]: e.target.value }))}
                                  placeholder={meta.placeholder}
                                  style={{ width: "100%", height: 34, background: "transparent", border: "none", outline: "none", fontSize: 12, fontFamily: "var(--font-mono,monospace)", color: "var(--t1,#e8ecff)", padding: 0, boxSizing: "border-box" }}
                                />
                              </div>
                            )
                          })()}
                          {(() => {
                            const currentTask = campaign.tasks[flowStep]
                            const pt          = currentTask.proof_type || "none"
                            const hasInternal = !!campaign.contract_address || campaign.tasks.some(t => !!t.contract_address)
                            // Internal verification → no proof required at all.
                            const proofOk     = hasInternal || pt === "none" || (() => {
                              const v = proofs[currentTask.id] || ""
                              if (!v) return false
                              if (pt === "tx_hash")    return /^0x[a-fA-F0-9]{64}$/.test(v)
                              if (pt === "x_link")     return /^https?:\/\/(www\.)?(x|twitter)\.com\/[^/]+\/status\/\d+/i.test(v)
                              if (pt === "screenshot") return /^https?:\/\/([a-z0-9-]+\.)?ibb\.co\//i.test(v) || /\.blob\.vercel-storage\.com\//i.test(v)
                              try { const u = new URL(v); return u.protocol === "https:" || u.protocol === "http:" } catch { return false }
                            })()
                            return (
                              <div style={{ display: "flex", gap: 8 }}>
                                {flowStep > 0 && (
                                  <button
                                    onClick={() => setFlowStep(s => Math.max(0, s - 1))}
                                    style={{ height: 42, padding: "0 18px", background: "transparent", color: "var(--t2,#6b7da8)", border: "1px solid var(--bdr,rgba(255,255,255,0.06))", borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-mono,monospace)" }}>
                                    ← Back
                                  </button>
                                )}
                                <button
                                  onClick={() => setFlowStep(s => s + 1)}
                                  disabled={!proofOk}
                                  style={{ flex: 1, height: 42, background: proofOk ? "#1a56ff" : "var(--surf2,#0e1224)", color: proofOk ? "#fff" : "var(--t2,#6b7da8)", border: proofOk ? "none" : "1px solid var(--bdr,rgba(255,255,255,0.06))", borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: proofOk ? "pointer" : "default", letterSpacing: "-0.01em" }}>
                                  {!proofOk ? "Add proof to continue" : flowStep < totalSteps - 1 ? `Done — Next step →` : `Done — Share feedback →`}
                                </button>
                              </div>
                            )
                          })()}
                        </div>
                      ) : (
                        /* Feedback questions */
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--t1,#e8ecff)", marginBottom: 4 }}>Share your feedback</div>
                          <p style={{ fontSize: 12, color: "var(--t2,#6b7da8)", marginBottom: 18, lineHeight: 1.5 }}>
                            Be specific — reference what you actually did, what you saw, and what could be better.
                          </p>
                          {campaign.review_questions.map(q => {
                            const words  = wordCount(answers[q.id] || "")
                            const min    = q.min_words || 20
                            const enough = words >= min
                            return (
                              <div key={q.id} style={{ marginBottom: 16 }}>
                                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
                                  <label style={{ fontSize: 12, fontWeight: 500, color: "var(--t1,#e8ecff)" }}>
                                    {q.label}{q.required && <span style={{ color: "#e03348", marginLeft: 2 }}>*</span>}
                                  </label>
                                  <span style={{ fontSize: 10, color: enough ? "#00b87a" : "var(--t3,#2e3a5c)", fontFamily: "var(--font-mono,monospace)" }}>
                                    {words}/{min}
                                  </span>
                                </div>
                                <textarea
                                  placeholder={q.placeholder}
                                  value={answers[q.id] || ""}
                                  onChange={e => setAnswers(p => ({ ...p, [q.id]: e.target.value }))}
                                  rows={4}
                                  style={{ width: "100%", background: "var(--surf2,#0e1224)", border: `1px solid ${enough ? "rgba(0,184,122,0.3)" : "var(--bdr,rgba(255,255,255,0.06))"}`, borderRadius: 8, padding: "10px 12px", fontSize: 12, color: "var(--t1,#e8ecff)", outline: "none", resize: "vertical", lineHeight: 1.5, fontFamily: "inherit", boxSizing: "border-box" }}
                                />
                              </div>
                            )
                          })}
                          {submitError && (
                            <div style={{ fontSize: 12, color: "#e03348", marginBottom: 12, padding: "8px 12px", background: "rgba(224,51,72,0.08)", borderRadius: 8 }}>{submitError}</div>
                          )}
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              onClick={() => setFlowStep(s => Math.max(0, s - 1))}
                              style={{ height: 42, padding: "0 18px", background: "transparent", color: "var(--t2,#6b7da8)", border: "1px solid var(--bdr,rgba(255,255,255,0.06))", borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-mono,monospace)" }}>
                              ← Back to tasks
                            </button>
                            <button
                              onClick={submitCompletion}
                              disabled={submitting || !reviewComplete}
                              style={{ flex: 1, height: 42, background: reviewComplete ? "#1a56ff" : "var(--surf2,#0e1224)", color: reviewComplete ? "#fff" : "var(--t2,#6b7da8)", border: reviewComplete ? "none" : "1px solid var(--bdr,rgba(255,255,255,0.06))", borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: reviewComplete && !submitting ? "pointer" : "default", letterSpacing: "-0.01em" }}>
                              {submitting ? "Submitting..." : "Submit Completion →"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Top contributors live on a dedicated page (/trials/[id]/leaderboard)
                so they never compete for vertical space with the wizard. The
                small pill in the header (added near share buttons) links there. */}

            {/* Rating happens exclusively on the founder dashboard (/dashboard/[slug]).
                The campaign page stays focused on the tester experience. Founders
                viewing their own campaign here see a small link to the dashboard. */}
            {isOwner && completions.length > 0 && (
              <a href={`/dashboard/${(campaign as any).project_slug || campaign.slug || campaign.id}`}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "13px 18px",
                  background: "var(--surf,#0a0e1a)", border: "1px solid var(--bdr,rgba(255,255,255,0.06))", borderRadius: 10,
                  textDecoration: "none", transition: "border-color 0.12s" }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = "rgba(26,86,255,0.3)")}
                onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--bdr,rgba(255,255,255,0.06))")}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--t1,#e8ecff)", marginBottom: 2 }}>
                    {completions.filter(c => c.builder_rating == null).length} submission{completions.filter(c => c.builder_rating == null).length === 1 ? "" : "s"} awaiting your rating
                  </div>
                  <div style={{ fontSize: 11, fontFamily: "var(--font-mono,monospace)", color: "var(--t3,#2e3a5c)" }}>
                    Rate testers and see all submissions on your founder dashboard
                  </div>
                </div>
                <span style={{ fontSize: 11, fontFamily: "var(--font-mono,monospace)", color: "#8aaeff", flexShrink: 0 }}>
                  Open dashboard →
                </span>
              </a>
            )}

            {/* ── Owner: export feedback as CSV ── */}
            {isOwner && completions.length > 0 && (
              <a href={`/api/trials/${campaign.slug || campaign.id}/feedback.csv`}
                download
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "13px 18px",
                  background: "var(--surf,#0a0e1a)", border: "1px solid var(--bdr,rgba(255,255,255,0.06))", borderRadius: 10,
                  textDecoration: "none", transition: "border-color 0.12s" }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = "rgba(0,184,122,0.3)")}
                onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--bdr,rgba(255,255,255,0.06))")}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--t1,#e8ecff)", marginBottom: 2 }}>
                    Download all feedback as CSV
                  </div>
                  <div style={{ fontSize: 11, fontFamily: "var(--font-mono,monospace)", color: "var(--t3,#2e3a5c)" }}>
                    {completions.length} submission{completions.length === 1 ? "" : "s"} · answers, scores, and proofs — opens in Excel or Sheets
                  </div>
                </div>
                <span style={{ fontSize: 11, fontFamily: "var(--font-mono,monospace)", color: "#00d990", flexShrink: 0 }}>
                  ↓ CSV
                </span>
              </a>
            )}

            {/* ── Owner: Edit Campaign ── */}
            {isOwner && (
              <div style={{ background: "var(--surf,#0a0e1a)", border: "1px solid var(--bdr,rgba(255,255,255,0.06))", borderRadius: 12, overflow: "hidden" }}>
                <button onClick={() => setEditOpen(o => !o)}
                  style={{ width: "100%", padding: "15px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--t1,#e8ecff)" }}>Edit Campaign</div>
                    <div style={{ fontSize: 11, fontFamily: "var(--font-mono,monospace)", color: "var(--t3,#2e3a5c)", marginTop: 2 }}>Cosmetic edits (invite codes, description, banner) apply instantly · material edits go to admin</div>
                  </div>
                  <span style={{ fontSize: 12, color: "var(--t3,#2e3a5c)", transform: editOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s", display: "inline-block" }}>▾</span>
                </button>

                {editOpen && (
                  <div style={{ borderTop: "1px solid var(--bdr,rgba(255,255,255,0.06))", padding: "16px 20px 20px" }}>
                    {editSubmitted && editMessage && (
                      <div style={{ marginBottom: 12, padding: "10px 14px", background: "rgba(0,184,122,0.07)", border: "1px solid rgba(0,184,122,0.2)", borderRadius: 8, fontSize: 12, color: "#00d990", lineHeight: 1.5 }}>
                        ✓ {editMessage}
                      </div>
                    )}
                    {/* Pending state — only shown if there's actually a queued material edit */}
                    {pendingUpdate?.status === "pending" ? (
                      <div style={{ textAlign: "center", padding: "8px 0" }}>
                        <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(224,136,16,0.1)", border: "1px solid rgba(224,136,16,0.25)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px", fontSize: 14, color: "#e08810" }}>⏳</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#e08810", marginBottom: 4 }}>Material change pending admin review</div>
                        <div style={{ fontSize: 11, fontFamily: "var(--font-mono,monospace)", color: "var(--t2,#6b7da8)" }}>You'll be notified by email once approved or rejected. Cosmetic edits (description, links, banner) are already live.</div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        <div style={{ fontSize: 11, color: "var(--t3,#2e3a5c)", fontFamily: "var(--font-mono,monospace)", lineHeight: 1.6, padding: "10px 12px", background: "rgba(26,86,255,0.04)", border: "1px solid rgba(26,86,255,0.12)", borderRadius: 6 }}>
                          <strong style={{ color: "#8aaeff" }}>Tagline, description, app URL, reward details, banner, invite codes</strong> apply instantly. <strong style={{ color: "#8aaeff" }}>Title, slots, deadline, max XP, contract, tasks, questions</strong> require admin approval.
                        </div>
                        <EF label="Campaign title">
                          <input type="text" value={editForm.title || ""} onChange={e => setEditForm(f => ({ ...f, title: e.target.value.slice(0, 80) }))} placeholder={campaign.title} style={ei} />
                        </EF>
                        {pendingUpdate?.status === "rejected" && (
                          <div style={{ padding: "10px 14px", background: "rgba(224,51,72,0.07)", border: "1px solid rgba(224,51,72,0.2)", borderRadius: 8 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "#e03348", marginBottom: pendingUpdate.admin_note ? 4 : 0 }}>Last edit request was not approved</div>
                            {pendingUpdate.admin_note && (
                              <div style={{ fontSize: 11, color: "#e03348", opacity: 0.85, lineHeight: 1.5 }}>{pendingUpdate.admin_note}</div>
                            )}
                            <div style={{ fontSize: 10, fontFamily: "var(--font-mono,monospace)", color: "var(--t3,#2e3a5c)", marginTop: 4 }}>Submit a revised request below</div>
                          </div>
                        )}
                        <div className="forge-edit-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                          <EF label="Extend deadline">
                            <input type="date" value={editForm.expires_at || ""} onChange={e => setEditForm(f => ({ ...f, expires_at: e.target.value }))} style={ei} />
                          </EF>
                          <EF label={`Slots${campaign.filled_slots > 0 ? ` (${campaign.filled_slots} filled)` : ""}`}>
                            <input type="number" min={campaign.filled_slots || 1} value={editForm.total_slots || ""} onChange={e => setEditForm(f => ({ ...f, total_slots: e.target.value }))} placeholder={campaign.total_slots ? String(campaign.total_slots) : "—"} style={ei} />
                          </EF>
                        </div>
                        {campaign.max_xp_per_completion != null && (
                          <EF label="Max XP per completion">
                            <input type="number" min={1} max={10000} value={editForm.max_xp_per_completion || ""} onChange={e => setEditForm(f => ({ ...f, max_xp_per_completion: e.target.value }))} placeholder={String(campaign.max_xp_per_completion)} style={ei} />
                          </EF>
                        )}
                        <EF label="Tagline">
                          <input type="text" value={editForm.tagline || ""} onChange={e => setEditForm(f => ({ ...f, tagline: e.target.value }))} placeholder={campaign.tagline || "One-line hook"} style={ei} />
                        </EF>
                        <EF label="Description">
                          <textarea value={editForm.description || ""} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} rows={3} placeholder="Updated description..." style={{ ...ei, height: "auto", padding: "8px 10px", resize: "vertical", lineHeight: 1.6, fontFamily: "inherit" }} />
                        </EF>
                        <div className="forge-edit-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                          <EF label="App URL">
                            <input type="url" value={editForm.app_url || ""} onChange={e => setEditForm(f => ({ ...f, app_url: e.target.value }))} placeholder={campaign.app_url || "https://"} style={ei} />
                          </EF>
                          <EF label="Reward details">
                            <input type="text" value={editForm.reward_description || ""} onChange={e => setEditForm(f => ({ ...f, reward_description: e.target.value }))} placeholder={campaign.reward_description || "What testers earn"} style={ei} />
                          </EF>
                        </div>
                        <EF label="Contract address" >
                          <input type="text" value={editForm.contract_address || ""} onChange={e => setEditForm(f => ({ ...f, contract_address: e.target.value.trim() }))} placeholder={campaign.contract_address || "0x... (leave blank to keep current)"} style={{ ...ei, fontFamily: "'DM Mono', monospace", fontSize: 11 }} />
                        </EF>

                        {/* Invite codes — instant cosmetic edit. Hydrate the textarea
                            from the current campaign codes on first focus so the
                            founder edits the live set rather than starting blank. */}
                        <EF label="Invite codes (one per line)">
                          <textarea
                            value={editForm.invite_codes_text ?? (Array.isArray(campaign.invite_codes) ? campaign.invite_codes.join("\n") : "")}
                            onChange={e => setEditForm(f => ({ ...f, invite_codes_text: e.target.value }))}
                            rows={4}
                            placeholder={"TWR-A1B2-C3D4\nTWR-E5F6-G7H8\n(paste codes — one per line, applies instantly)"}
                            style={{ ...ei, height: "auto", padding: "8px 10px", resize: "vertical", minHeight: 70, lineHeight: 1.6, fontFamily: "'DM Mono', monospace", fontSize: 11 }}
                          />
                        </EF>
                        <EF label="Invite codes note (shown to testers)">
                          <input type="text"
                            value={editForm.invite_codes_note ?? (campaign.invite_codes_note || "")}
                            onChange={e => setEditForm(f => ({ ...f, invite_codes_note: e.target.value.slice(0, 500) }))}
                            placeholder="e.g. Each code can be used up to 11 times"
                            style={ei} />
                        </EF>

                        {/* ── Tasks editor — collapsible, hydrates on open. Edits + new
                             additions go to the admin queue along with the rest. ── */}
                        <div style={{ background: "var(--surf2,#0e1224)", border: "1px solid var(--bdr,rgba(255,255,255,0.06))", borderRadius: 8, overflow: "hidden" }}>
                          <button type="button"
                            onClick={() => {
                              if (!tasksSectionOpen && editTasks === null) setEditTasks(campaign.tasks.map(t => ({ ...t })))
                              setTasksSectionOpen(o => !o)
                            }}
                            style={{ width: "100%", padding: "10px 12px", background: "transparent", border: "none", color: "var(--t1,#e8ecff)", fontSize: 12, fontWeight: 600, cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <span>Tasks · {(editTasks ?? campaign.tasks).length} step{(editTasks ?? campaign.tasks).length === 1 ? "" : "s"}</span>
                            <span style={{ fontSize: 11, color: "var(--t3,#2e3a5c)", fontFamily: "var(--font-mono,monospace)" }}>{tasksSectionOpen ? "−" : "+"}</span>
                          </button>
                          {tasksSectionOpen && editTasks && (
                            <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                              <DndContext sensors={editDndSensors} collisionDetection={closestCenter} onDragEnd={onEditTaskDragEnd}>
                                <SortableContext items={editTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
                                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                    {editTasks.map((t, i) => {
                                      const proofType = (t.proof_type as ProofType | undefined) || "none"
                                      const contractValid = !!t.contract_address && /^0x[a-fA-F0-9]{40}$/.test(t.contract_address)
                                      return (
                                        <SortableEditTaskRow key={t.id} id={t.id}>
                                          {({ listeners, setActivatorNodeRef, isDragging }) => (
                                            <div style={{ background: "var(--surf,#0a0e1a)", border: `1px solid ${isDragging ? "rgba(26,86,255,0.4)" : "var(--bdr,rgba(255,255,255,0.06))"}`, borderRadius: 7, padding: "9px 10px" }}>
                                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                                                <button
                                                  ref={setActivatorNodeRef}
                                                  {...listeners}
                                                  type="button"
                                                  aria-label={`Reorder step ${i + 1}`}
                                                  style={{ width: 12, height: 22, background: "transparent", border: "none", color: "var(--t3,#2e3a5c)", cursor: "grab", padding: 0, fontSize: 12, lineHeight: 1, fontFamily: "var(--font-mono,monospace)", flexShrink: 0, touchAction: "none" }}
                                                >⋮⋮</button>
                                                <span style={{ fontSize: 9, fontFamily: "var(--font-mono,monospace)", color: "var(--t3,#2e3a5c)", flexShrink: 0 }}>{String(i + 1).padStart(2, "0")}</span>
                                                <input type="text" value={t.title} placeholder="Step title"
                                                  onChange={e => setEditTasks(p => p?.map(x => x.id === t.id ? { ...x, title: e.target.value } : x) ?? null)}
                                                  style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontSize: 12, fontWeight: 500, color: "var(--t1,#e8ecff)" }} />
                                                {editTasks.length > 1 && (
                                                  <button type="button" onClick={() => setEditTasks(p => p?.filter(x => x.id !== t.id) ?? null)}
                                                    style={{ fontSize: 12, color: "#e03348", background: "transparent", border: "none", cursor: "pointer", padding: "0 4px" }}>✕</button>
                                                )}
                                              </div>
                                              <input type="text" value={t.description} placeholder="What testers should do"
                                                onChange={e => setEditTasks(p => p?.map(x => x.id === t.id ? { ...x, description: e.target.value } : x) ?? null)}
                                                style={{ width: "calc(100% - 34px)", background: "transparent", border: "none", outline: "none", fontSize: 11, color: "var(--t2,#6b7da8)", marginLeft: 34, boxSizing: "border-box" }} />
                                              <div style={{ marginTop: 8, marginLeft: 34, paddingTop: 8, borderTop: "1px solid var(--bdr,rgba(255,255,255,0.04))", display: "flex", flexDirection: "column", gap: 6 }}>
                                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                  <span style={{ fontSize: 9, fontFamily: "var(--font-mono,monospace)", color: "var(--t3,#2e3a5c)", textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0, width: 60 }}>Proof</span>
                                                  <select value={proofType}
                                                    onChange={e => setEditTasks(p => p?.map(x => x.id === t.id ? { ...x, proof_type: e.target.value as ProofType } : x) ?? null)}
                                                    style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontSize: 10.5, fontFamily: "var(--font-mono,monospace)", color: proofType !== "none" ? "#8aaeff" : "var(--t3,#2e3a5c)", cursor: "pointer" }}>
                                                    <option value="none">None — no proof required</option>
                                                    <option value="x_link">X (Twitter) post link</option>
                                                    <option value="tx_hash">Transaction hash</option>
                                                    <option value="screenshot">Screenshot upload</option>
                                                    <option value="url">Custom URL</option>
                                                  </select>
                                                </div>
                                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                  <span style={{ fontSize: 9, fontFamily: "var(--font-mono,monospace)", color: "var(--t3,#2e3a5c)", textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0, width: 60 }}>Contract</span>
                                                  <input type="text" value={t.contract_address || ""} placeholder="0x… (optional — for internal verification)"
                                                    onChange={e => setEditTasks(p => p?.map(x => x.id === t.id ? { ...x, contract_address: e.target.value.trim() } : x) ?? null)}
                                                    style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontSize: 10.5, fontFamily: "var(--font-mono,monospace)",
                                                      color: contractValid ? "#00d990" : t.contract_address ? "#e03348" : "var(--t3,#2e3a5c)" }} />
                                                  {contractValid && (
                                                    <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#00d990", flexShrink: 0 }} />
                                                  )}
                                                </div>
                                              </div>
                                            </div>
                                          )}
                                        </SortableEditTaskRow>
                                      )
                                    })}
                                  </div>
                                </SortableContext>
                              </DndContext>
                              <button type="button"
                                onClick={() => setEditTasks(p => [...(p ?? []), { id: "t" + Date.now().toString(36), title: "", description: "" }])}
                                style={{ height: 32, background: "transparent", color: "var(--t3,#2e3a5c)", border: "1px dashed var(--bdr,rgba(255,255,255,0.12))", borderRadius: 7, fontSize: 11, cursor: "pointer", fontFamily: "var(--font-mono,monospace)" }}>
                                + Add step
                              </button>
                              <div style={{ fontSize: 10, fontFamily: "var(--font-mono,monospace)", color: "var(--t3,#2e3a5c)", lineHeight: 1.6 }}>
                                Drag the ⋮⋮ handle to reorder. Edits + reorders + new additions all go to admin for review.
                              </div>
                            </div>
                          )}
                        </div>

                        {/* ── Review questions editor — same pattern ── */}
                        <div style={{ background: "var(--surf2,#0e1224)", border: "1px solid var(--bdr,rgba(255,255,255,0.06))", borderRadius: 8, overflow: "hidden" }}>
                          <button type="button"
                            onClick={() => {
                              if (!qsSectionOpen && editQs === null) setEditQs(campaign.review_questions.map(q => ({ ...q })))
                              setQsSectionOpen(o => !o)
                            }}
                            style={{ width: "100%", padding: "10px 12px", background: "transparent", border: "none", color: "var(--t1,#e8ecff)", fontSize: 12, fontWeight: 600, cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <span>Review questions · {(editQs ?? campaign.review_questions).length}</span>
                            <span style={{ fontSize: 11, color: "var(--t3,#2e3a5c)", fontFamily: "var(--font-mono,monospace)" }}>{qsSectionOpen ? "−" : "+"}</span>
                          </button>
                          {qsSectionOpen && editQs && (
                            <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                              {editQs.map((q, i) => (
                                <div key={q.id} style={{ background: "var(--surf,#0a0e1a)", border: "1px solid var(--bdr,rgba(255,255,255,0.06))", borderRadius: 7, padding: "9px 10px" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                                    <span style={{ fontSize: 9, fontFamily: "var(--font-mono,monospace)", color: "var(--t3,#2e3a5c)", flexShrink: 0 }}>Q{i + 1}</span>
                                    <input type="text" value={q.label} placeholder="Question for testers"
                                      onChange={e => setEditQs(p => p?.map(x => x.id === q.id ? { ...x, label: e.target.value } : x) ?? null)}
                                      style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontSize: 12, fontWeight: 500, color: "var(--t1,#e8ecff)" }} />
                                    {editQs.length > 1 && (
                                      <button type="button" onClick={() => setEditQs(p => p?.filter(x => x.id !== q.id) ?? null)}
                                        style={{ fontSize: 12, color: "#e03348", background: "transparent", border: "none", cursor: "pointer", padding: "0 4px" }}>✕</button>
                                    )}
                                  </div>
                                  <input type="text" value={q.placeholder} placeholder="Placeholder text (hint for testers)"
                                    onChange={e => setEditQs(p => p?.map(x => x.id === q.id ? { ...x, placeholder: e.target.value } : x) ?? null)}
                                    style={{ width: "100%", background: "transparent", border: "none", outline: "none", fontSize: 11, color: "var(--t2,#6b7da8)", marginLeft: 22, boxSizing: "border-box" }} />
                                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, marginLeft: 22 }}>
                                    <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--t3,#2e3a5c)", fontFamily: "var(--font-mono,monospace)" }}>
                                      <span>Min words</span>
                                      <input type="number" min={0} max={500} value={q.min_words}
                                        onChange={e => setEditQs(p => p?.map(x => x.id === q.id ? { ...x, min_words: Math.max(0, parseInt(e.target.value) || 0) } : x) ?? null)}
                                        style={{ width: 50, height: 22, background: "var(--surf2,#0e1224)", border: "1px solid var(--bdr,rgba(255,255,255,0.06))", borderRadius: 4, padding: "0 6px", fontSize: 10, color: "var(--t1,#e8ecff)", outline: "none" }} />
                                    </label>
                                    <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--t3,#2e3a5c)", fontFamily: "var(--font-mono,monospace)", cursor: "pointer" }}>
                                      <input type="checkbox" checked={q.required !== false}
                                        onChange={e => setEditQs(p => p?.map(x => x.id === q.id ? { ...x, required: e.target.checked } : x) ?? null)} />
                                      Required
                                    </label>
                                  </div>
                                </div>
                              ))}
                              <button type="button"
                                onClick={() => setEditQs(p => [...(p ?? []), { id: "q" + Date.now().toString(36), label: "", placeholder: "", min_words: 20, required: true }])}
                                style={{ height: 32, background: "transparent", color: "var(--t3,#2e3a5c)", border: "1px dashed var(--bdr,rgba(255,255,255,0.12))", borderRadius: 7, fontSize: 11, cursor: "pointer", fontFamily: "var(--font-mono,monospace)" }}>
                                + Add question
                              </button>
                              <div style={{ fontSize: 10, fontFamily: "var(--font-mono,monospace)", color: "var(--t3,#2e3a5c)", lineHeight: 1.6 }}>
                                Question edits go to admin for review.
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Re-auth prompt — shows when PUT returned 401. The
                            form state stays intact; this button signs a new
                            message and retries the save automatically. */}
                        {needsReauth && (
                          <div style={{ padding: "11px 14px", background: "rgba(224,136,16,0.07)", border: "1px solid rgba(224,136,16,0.25)", borderRadius: 8 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "#e08810", marginBottom: 4 }}>
                              Your sign-in expired
                            </div>
                            <div style={{ fontSize: 11, color: "var(--t2,#6b7da8)", lineHeight: 1.55, marginBottom: 10 }}>
                              Your changes are still here — they won't be lost. Sign in once and we'll save automatically.
                            </div>
                            <button onClick={reauthAndRetry} disabled={reauthing}
                              style={{ height: 32, padding: "0 14px", background: reauthing ? "var(--surf2,#0e1224)" : "#1a56ff", color: reauthing ? "var(--t2,#6b7da8)" : "#fff", border: "none", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: reauthing ? "default" : "pointer" }}>
                              {reauthing ? "Signing in..." : "Sign in to save"}
                            </button>
                          </div>
                        )}
                        {editError && !needsReauth && (
                          <div style={{ fontSize: 11, color: "#e03348", padding: "7px 10px", background: "rgba(224,51,72,0.08)", borderRadius: 6, fontFamily: "var(--font-mono,monospace)" }}>{editError}</div>
                        )}
                        <button onClick={submitCampaignEdit} disabled={editSubmitting}
                          style={{ height: 38, background: editSubmitting ? "var(--surf2,#0e1224)" : "#1a56ff", color: editSubmitting ? "var(--t2,#6b7da8)" : "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: editSubmitting ? "default" : "pointer" }}>
                          {editSubmitting ? "Submitting..." : "Submit for Review"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Right sidebar — one sticky facts panel: reward header, details
                 rows, hosted-by footer. Replaces three separate boxes. ── */}
          <div style={{ position: "sticky", top: 20 }}>
            <div style={{ background: "var(--surf,#0a0e1a)", border: "1px solid var(--bdr,rgba(255,255,255,0.06))", borderRadius: 14, overflow: "hidden" }}>

              {/* Reward header */}
              <div style={{ padding: "16px 20px", background: `${rm.color}0d`, borderBottom: "1px solid var(--bdr,rgba(255,255,255,0.06))" }}>
                <div style={{ fontSize: 10, fontFamily: "var(--font-mono,monospace)", color: rm.color, textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 5 }}>What you get</div>
                <div style={{ fontSize: 17, fontWeight: 700, color: "var(--t1,#e8ecff)", letterSpacing: "-0.02em" }}>{rm.label}</div>
                {campaign.reward_description && (
                  <p style={{ fontSize: 11.5, color: "var(--t2,#6b7da8)", margin: "4px 0 0", lineHeight: 1.5 }}>{campaign.reward_description}</p>
                )}
              </div>

              {/* Details rows */}
              <div style={{ padding: "6px 20px" }}>
                {[
                  { label: "Type",      value: getTypeMeta(campaign.type).label },
                  { label: "Slots",     value: campaign.total_slots ? `${campaign.filled_slots}/${campaign.total_slots}` : "Unlimited" },
                  { label: "Selection", value: campaign.is_fcfs ? "First come, first served" : "Builder selects" },
                  { label: "Tasks",     value: `${campaign.tasks.length} step${campaign.tasks.length !== 1 ? "s" : ""}` },
                  ...(campaign.min_rank > 0 ? [{ label: "Rank required", value: RANK_LABELS[campaign.min_rank] }] : []),
                  { label: "Posted",    value: new Date(campaign.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) },
                  ...(campaign.expires_at ? [{ label: "Closes", value: new Date(campaign.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) }] : []),
                ].map((d, i, arr) => (
                  <div key={d.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, padding: "9px 0", borderBottom: i < arr.length - 1 ? "1px solid var(--bdr,rgba(255,255,255,0.04))" : "none" }}>
                    <span style={{ fontSize: 11.5, color: "var(--t3,#2e3a5c)", flexShrink: 0 }}>{d.label}</span>
                    <span style={{ fontSize: 12, color: d.label === "Rank required" ? "#c08828" : "var(--t1,#e8ecff)", fontWeight: 550, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{d.value}</span>
                  </div>
                ))}
              </div>

              {/* Hosted-by footer */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", borderTop: "1px solid var(--bdr,rgba(255,255,255,0.06))", background: "var(--surf2,#0e1224)" }}>
                <div style={{ position: "relative", width: 38, height: 38, borderRadius: 9, overflow: "hidden", flexShrink: 0, border: "1px solid var(--bdr,rgba(255,255,255,0.06))", background: "var(--surf,#0a0e1a)" }}>
                  <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "var(--t3,#2e3a5c)", fontFamily: "var(--font-mono,monospace)" }}>
                    {(campaign.project_name || "?").slice(0, 1).toUpperCase()}
                  </span>
                  {(campaign.project_logo || campaign.campaign_logo) && (
                    <img src={`/api/image-proxy?url=${encodeURIComponent((campaign.project_logo || campaign.campaign_logo)!)}`} alt="" onError={e => (e.currentTarget.style.display = "none")} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {campaign.project_name
                    ? <a href={`/ecosystem/${campaign.project_name.toLowerCase().replace(/\s+/g, "-")}`}
                        style={{ fontSize: 13, fontWeight: 700, color: "var(--t1,#e8ecff)", textDecoration: "none", display: "block", marginBottom: 2 }}
                        onMouseOver={e => (e.currentTarget.style.color = "#8aaeff")}
                        onMouseOut={e => (e.currentTarget.style.color = "var(--t1,#e8ecff)")}
                      >
                        {campaign.project_name}
                      </a>
                    : <span style={{ fontSize: 13, fontWeight: 700, color: "var(--t1,#e8ecff)", display: "block", marginBottom: 2 }}>Unknown Project</span>
                  }
                  <div style={{ fontSize: 10.5, color: "#00d990" }}>✓ Verified on Arc Ecosystem</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile-only overrides — kept as a single style block at the page root
          so they cascade everywhere. Below 680px the main 2-col layout already
          stacks via globals.css; everything below tightens individual cards. */}
      <style>{`
        /* Tighten the entire page padding + title size on phones */
        @media (max-width: 560px) {
          .forge-page-wrap {
            padding: 18px 12px !important;
          }
          /* Stack title above share buttons on narrow viewports — otherwise
             flex-wrap doesn't kick in (title shrinks to a tiny column and the
             share group hogs the right). */
          .forge-title-row {
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 12px !important;
          }
          .forge-title-row > div:first-child {
            order: 0;
          }
          .forge-title-row > div:last-child {
            order: 1;
            justify-content: flex-start !important;
          }
          .forge-title {
            font-size: 22px !important;
          }
          .forge-tagline {
            font-size: 13px !important;
          }
          /* Stat bar: 2-up grid instead of cramming 3-4 cols into 360px */
          .forge-stat-bar {
            grid-template-columns: repeat(2, 1fr) !important;
          }
          .forge-stat-bar > div {
            padding: 14px 0 !important;
          }
          .forge-stat-bar > div > div:first-child {
            font-size: 18px !important;
          }
          /* Hero banner stays 16:9 — let it occupy proportional height. The
             aspect ratio naturally gives ~200px height at 360px width which
             is the sweet spot. No artificial cap below 560px. */
          .heroBanner {
            max-height: none !important;
          }
          /* Card paddings tighten so content gets more width */
          .forge-card {
            padding: 14px 14px !important;
          }
          /* Wizard task card number badge shrinks */
          .forge-step-num {
            width: 30px !important;
            height: 30px !important;
            font-size: 11px !important;
          }
          /* Edit Campaign 2-col fields stack on phones */
          .forge-edit-2col {
            grid-template-columns: 1fr !important;
          }
          .rankCompareGrid {
            grid-template-columns: 1fr !important;
          }
          .rankCompareGrid > div:nth-child(2) {
            display: none !important;
          }
        }
        @media (max-width: 380px) {
          .forge-title {
            font-size: 19px !important;
          }
          .forge-stat-bar > div > div:first-child {
            font-size: 16px !important;
          }
        }
      `}</style>
    </ArcLayout>
  )
}

const ei: React.CSSProperties = {
  width: "100%", height: 34, background: "var(--surf2,#0e1224)",
  border: "1px solid var(--bdr,rgba(255,255,255,0.06))", borderRadius: 7,
  padding: "0 10px", fontSize: 12, color: "var(--t1,#e8ecff)", outline: "none",
  boxSizing: "border-box", fontFamily: "inherit",
}

function EF({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 500, color: "var(--t2,#6b7da8)", marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  )
}

// Pro rank color treatment — gold/silver/bronze for top 3, dimmed for rest.
function rankColor(rank: number, fallback: string): string {
  if (rank === 1) return "#d4a447"
  if (rank === 2) return "#a5b0c5"
  if (rank === 3) return "#b88762"
  return fallback
}

// Drag-handle wrapper for the Edit Campaign tasks list. Same render-prop
// pattern as the create-page SortableTaskRow so the handle (only) starts
// the drag — clicks on title/description inputs still focus normally.
function SortableEditTaskRow({
  id,
  children,
}: {
  id: string
  children: (handle: {
    listeners: ReturnType<typeof useSortable>["listeners"]
    setActivatorNodeRef: ReturnType<typeof useSortable>["setActivatorNodeRef"]
    isDragging: boolean
  }) => React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        zIndex: isDragging ? 10 : "auto",
      }}
    >
      {children({ listeners, setActivatorNodeRef, isDragging })}
    </div>
  )
}

// Public per-campaign leaderboard. Builder-rated submissions only — keeps
// unreviewed spam from gaming the public-facing board on USDC campaigns.
function TopContributorsLeaderboard({ completions }: { completions: Completion[] }) {
  const [showAll, setShowAll] = useState(false)
  const SHOW_LIMIT = 5
  const mono = "'DM Mono', monospace"

  const ranked = completions
    .filter(c => c.builder_rating != null && c.status === "reviewed")
    .slice()
    .sort((a, b) => {
      const qa = Number(a.quality_score) || 0
      const qb = Number(b.quality_score) || 0
      if (qb !== qa) return qb - qa
      return (Number(b.builder_rating) || 0) - (Number(a.builder_rating) || 0)
    })

  if (ranked.length === 0) return null
  const visible = showAll ? ranked : ranked.slice(0, SHOW_LIMIT)
  const hasMore = ranked.length > SHOW_LIMIT

  return (
    <div id="leaderboard" style={{ background: "var(--surf,#0a0e1a)", border: "1px solid var(--bdr,rgba(255,255,255,0.06))", borderRadius: 12, overflow: "hidden", scrollMarginTop: 24 }}>
      <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--bdr,rgba(255,255,255,0.06))", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 11, fontFamily: mono, color: "var(--t2,#6b7da8)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Top Contributors
        </div>
        <div style={{ fontSize: 10, fontFamily: mono, color: "var(--t3,#2e3a5c)" }}>
          {ranked.length} rated · ranked by quality
        </div>
      </div>
      <div>
        {visible.map((c, i) => {
          const rank       = i + 1
          const qs         = Math.round(Number(c.quality_score) || 0)
          const scoreColor = qs > 70 ? "#00b87a" : qs > 40 ? "#e08810" : "var(--t2,#6b7da8)"
          const rkColor    = rankColor(rank, "var(--t3,#2e3a5c)")
          return (
            <a key={c.tester_wallet} href={`/tester/${c.tester_wallet}`}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 20px",
                       borderBottom: (i < visible.length - 1 || hasMore) ? "1px solid var(--bdr,rgba(255,255,255,0.06))" : "none",
                       textDecoration: "none" }}>
              <div style={{ width: 32, fontSize: 12, fontFamily: mono, color: rkColor, fontWeight: 700, flexShrink: 0, letterSpacing: "0.04em" }}>
                {"#" + rank}
              </div>
              <WalletAvatar wallet={c.tester_wallet} size={26} />
              <span style={{ fontSize: 12, fontFamily: mono, color: "var(--t1,#e8ecff)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.tester_wallet.slice(0, 8)}…{c.tester_wallet.slice(-4)}
              </span>
              <div style={{ fontSize: 11, fontFamily: mono, color: "#c08828", flexShrink: 0 }}>
                {"★".repeat(c.builder_rating || 0)}<span style={{ opacity: 0.25 }}>{"★".repeat(5 - (c.builder_rating || 0))}</span>
              </div>
              <div style={{ minWidth: 50, textAlign: "right", flexShrink: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: scoreColor, fontFamily: mono }}>{qs}</span>
                <span style={{ fontSize: 9, fontFamily: mono, color: "var(--t3,#2e3a5c)", marginLeft: 3 }}>/100</span>
              </div>
            </a>
          )
        })}
        {hasMore && (
          <button onClick={() => setShowAll(s => !s)}
            style={{ width: "100%", padding: "11px 20px", background: "var(--surf2,#0e1224)", border: "none",
                     color: "#8aaeff", fontSize: 11, fontFamily: mono, cursor: "pointer", letterSpacing: "0.04em",
                     transition: "background 0.12s" }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(26,86,255,0.06)")}
            onMouseLeave={e => (e.currentTarget.style.background = "var(--surf2,#0e1224)")}>
            {showAll ? "Show less" : `View all ${ranked.length} contributors →`}
          </button>
        )}
      </div>
    </div>
  )
}

// Closed-beta invite codes. ArcLens just displays the founder's codes; the
// founder's own product validates them. Tester taps to copy. Each chip fades
// up into place on mount (~200ms) and the panel ends with a big primary CTA
// pointing to the product so the workflow — copy code → go use it there →
// come back — is unmissable.
function InviteCodesPanel({ codes, appUrl, productName, note, walletConnected, onConnect }: { codes: string[]; appUrl: string | null; productName: string | null; note: string | null; walletConnected: boolean; onConnect: () => void }) {
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const mono = "'DM Mono', monospace"

  function copy(code: string) {
    try {
      navigator.clipboard.writeText(code)
      setCopiedCode(code)
      window.setTimeout(() => setCopiedCode(c => (c === code ? null : c)), 1400)
    } catch { /* clipboard blocked — no-op, visible code still works */ }
  }

  // Derive button label: prefer the project name (e.g. "Tower Exchange"), fall
  // back to a generic "Open product" if the campaign didn't set one.
  const ctaLabel = productName ? `Open ${productName}` : "Open product"

  // Gate: codes are hidden until the tester connects a wallet. Stops drive-by
  // scraping — only people actually starting the campaign see the codes. The
  // count is shown so they know access exists, but the values stay locked.
  if (!walletConnected) {
    return (
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--bdr,rgba(255,255,255,0.06))", background: "rgba(0,184,122,0.04)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#00b87a", flexShrink: 0 }} />
          <div style={{ fontSize: 11, fontFamily: mono, color: "#00b87a", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>
            Closed-beta access · locked
          </div>
          <span style={{ marginLeft: "auto", fontSize: 10, fontFamily: mono, color: "#00b87a", padding: "2px 8px", borderRadius: 4, background: "rgba(0,184,122,0.1)", border: "1px solid rgba(0,184,122,0.2)" }}>
            {codes.length} code{codes.length === 1 ? "" : "s"} available
          </span>
        </div>
        <div style={{ fontSize: 12, color: "var(--t2,#6b7da8)", marginBottom: 12, lineHeight: 1.6 }}>
          Connect your wallet to reveal an invite code. Codes are only shown to participants — connect to claim your access.
        </div>
        <button onClick={onConnect}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", height: 42,
            background: "linear-gradient(135deg, #1a56ff 0%, #2563ff 100%)", color: "#fff", border: "none", borderRadius: 9,
            fontSize: 13, fontWeight: 700, cursor: "pointer", letterSpacing: "-0.01em" }}>
          Connect wallet to reveal code →
        </button>
      </div>
    )
  }

  return (
    <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--bdr,rgba(255,255,255,0.06))", background: "rgba(0,184,122,0.04)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#00b87a", flexShrink: 0 }} />
        <div style={{ fontSize: 11, fontFamily: mono, color: "#00b87a", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>
          Closed-beta access · tap to copy
        </div>
        <span style={{ marginLeft: "auto", fontSize: 10, fontFamily: mono, color: "#00b87a", padding: "2px 8px", borderRadius: 4, background: "rgba(0,184,122,0.1)", border: "1px solid rgba(0,184,122,0.2)" }}>
          {codes.length} code{codes.length === 1 ? "" : "s"}
        </span>
      </div>
      <div style={{ fontSize: 12, color: "var(--t2,#6b7da8)", marginBottom: 12, lineHeight: 1.6 }}>
        {note && note.trim()
          ? note.trim()
          : "Use one of these on the product to access the closed beta, then come back here to complete the steps."}
      </div>
      {/* Scrollable container — when there are >12 codes, the grid scrolls
          internally instead of pushing the rest of the page down. Cleaner UX
          while still letting every code be reached. */}
      <div className="arclens-codes-grid" style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
        gap: 6,
        maxHeight: codes.length > 12 ? 256 : "none",
        overflowY: codes.length > 12 ? "auto" : "visible",
        paddingRight: codes.length > 12 ? 4 : 0,
      }}>
        {codes.map((code, i) => {
          const isCopied = copiedCode === code
          return (
            <button
              key={code}
              type="button"
              onClick={() => copy(code)}
              className="arclens-code-chip"
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                padding: "9px 11px",
                background: isCopied ? "rgba(0,184,122,0.16)" : "rgba(0,184,122,0.08)",
                border: `1px solid ${isCopied ? "rgba(0,184,122,0.45)" : "rgba(0,184,122,0.22)"}`,
                borderRadius: 6,
                cursor: "pointer",
                color: "#00d990",
                fontFamily: mono,
                fontSize: 12,
                letterSpacing: "0.02em",
                transition: "all 0.15s",
                // Stagger each chip's fade-in by ~30ms so they reveal in sequence,
                // not all at once — feels intentional rather than glitchy.
                animationDelay: `${Math.min(i * 30, 240)}ms`,
              }}
              onMouseEnter={e => { if (!isCopied) e.currentTarget.style.background = "rgba(0,184,122,0.12)" }}
              onMouseLeave={e => { if (!isCopied) e.currentTarget.style.background = "rgba(0,184,122,0.08)" }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{code}</span>
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, color: isCopied ? "#00d990" : "var(--t3,#2e3a5c)", flexShrink: 0, transition: "color 0.15s" }}>
                {isCopied ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                )}
              </span>
            </button>
          )
        })}
      </div>

      {/* Primary CTA — full-width so the next action is unmissable after the
          tester copies a code. Only renders if the founder set an app URL. */}
      {appUrl && (
        <a
          href={appUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="arclens-codes-cta"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            marginTop: 14, height: 44,
            background: "linear-gradient(135deg, #1a56ff 0%, #2563ff 100%)",
            color: "#fff", textDecoration: "none", borderRadius: 9,
            fontSize: 13, fontWeight: 700, letterSpacing: "-0.01em",
            boxShadow: "0 4px 14px rgba(26,86,255,0.25)",
            transition: "transform 0.12s, box-shadow 0.12s",
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 6px 20px rgba(26,86,255,0.35)" }}
          onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 4px 14px rgba(26,86,255,0.25)" }}
        >
          <span>{ctaLabel}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"/>
            <polyline points="12 5 19 12 12 19"/>
          </svg>
        </a>
      )}

      <style>{`
        @keyframes arclensCodeReveal {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .arclens-code-chip {
          opacity: 0;
          animation: arclensCodeReveal 200ms ease forwards;
        }
        .arclens-codes-cta {
          opacity: 0;
          animation: arclensCodeReveal 240ms ease 100ms forwards;
        }
        @media (prefers-reduced-motion: reduce) {
          .arclens-code-chip, .arclens-codes-cta { animation: none; opacity: 1; }
        }
      `}</style>
    </div>
  )
}
