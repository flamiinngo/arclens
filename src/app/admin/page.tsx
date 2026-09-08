"use client"
import { useEffect, useState } from "react"
import ArcLayout from "@/components/ArcLayout"
import { CAMPAIGN_TYPE_LABELS } from "@/lib/campaignTypes"
import { SpotlightCard } from "@/components/Spotlight"

const CATEGORIES = ["Infrastructure","DeFi","AI","Payments","NFT","Gaming","Social","Developer Tools","Bridge","Identity","Wallet","Exchange","Lending","Analytics","Other"]
const BADGES = ["", "official", "verified", "claimed"]

interface Project {
  id: number; name: string; tagline: string; category: string; description: string
  logo_url: string|null; email: string|null; website: string|null; twitter: string|null
  github: string|null; discord: string|null; contract: string|null; contracts: string[]|null; badge: string|null
  trust_level?: string|null; recognition?: string|null
  approved: boolean; live: boolean; featured: boolean; created_at: string
  city: string|null; country: string|null; lat: number|null; lng: number|null
}
interface Contract {
  id: number; address: string; name: string; type: string; email: string|null
  website: string|null; twitter: string|null; badge: string|null; deployer: string|null
  flag_reason: string|null; verified: boolean; created_at: string
  description: string|null; source_code: string|null
}
interface PendingUpdate {
  id: number; project_id: number; field: string; old_value: string; new_value: string
  submitted_at: string; status: string; project_name: string; project_slug: string
}
interface Event {
  id: number; name: string; type: string|null; date: string; location: string|null
  is_online: boolean; organizer: string|null; organizer_twitter: string|null
  email: string|null; badge: string|null; featured: boolean; approved: boolean
  link: string|null; created_at: string
}
interface AdminCampaign {
  id: number; slug: string|null; title: string; tagline: string|null; type: string
  description: string; tasks: {id:string;title:string;description:string;proof_type?:string;contract_address?:string|null}[]
  review_questions: {id:string;label:string;min_words:number;required:boolean}[]
  reward_type: string; reward_description: string|null; reward_usdc_amount: number|null
  contract_address: string|null; app_url: string|null; min_rank: number; is_fcfs: boolean
  creator_wallet: string; project_name: string|null; project_logo: string|null; campaign_logo: string|null
  total_slots: number|null; expires_at: string|null; status: string; created_at: string
  max_xp_per_completion: number|null; xp_mode: string|null; deposit_tx_hash: string|null
  completion_count: number
}

export default function AdminPage() {
  const [mounted, setMounted]         = useState(false)
  const [authed, setAuthed]           = useState(false)
  const [pw, setPw]                   = useState("")
  const [password, setPassword]       = useState("")
  const [loading, setLoading]         = useState(false)
  const [loadedOnce, setLoadedOnce]   = useState(false)
  const [tab, setTab]                 = useState<"pending"|"updates"|"campaign-updates"|"projects"|"contracts"|"events"|"locations"|"campaigns"|"stats"|"trust"|"tracked"|"ai"|"spotlight">("pending")
  // Spotlight tab state: items + create form.
  const [spotlight, setSpotlight]     = useState<{ items: any[]; counts: { pending: number; active: number } } | null>(null)
  const [spotForm, setSpotForm]       = useState({ kind: "custom", title: "", subtitle: "", image_url: "", image_pos: "", link_url: "", cta_text: "", accent: "", project: "" })
  const [spotBusy, setSpotBusy]       = useState(false)
  const [spotUploading, setSpotUploading] = useState(false)
  const [spotDays, setSpotDays]       = useState("")
  // Trust tab state: alerts + disputes, fetched on demand.
  const [trust, setTrust]             = useState<{ alerts: any[]; disputes: any[]; audits: any[]; flagged: any[]; counts: { open_alerts: number; open_disputes: number; open_audits: number; open_flags: number } } | null>(null)
  const [trustLoading, setTrustLoading] = useState(false)
  const [trustError, setTrustError]   = useState("")
  // Tracked Contracts tab state.
  const [tracked, setTracked]         = useState<{ contracts: any[]; counts: { total: number; working: number; errored: number; quiet: number; awaiting: number; revoked: number } } | null>(null)
  const [trackedLoading, setTrackedLoading] = useState(false)
  const [trackedError, setTrackedError] = useState("")
  // ArcLens AI insights tab (knowledge gaps + answer ratings).
  const [aiInsights, setAiInsights] = useState<{ gaps: { total: number; top: any[] }; ratings: { up: number; down: number; recent: any[] } } | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState("")
  // Knowledge-base embedding status (filled by the AI tab on load).
  const [kb, setKb] = useState<{ total: number; embedded: number; missing: number; configured?: boolean } | null>(null)
  const [kbBusy, setKbBusy] = useState(false)
  const [trackedEdit, setTrackedEdit] = useState<{ id: number; field: string; value: string } | null>(null)
  const [submissions, setSubmissions] = useState<Project[]>([])
  const [projects, setProjects]       = useState<Project[]>([])
  const [payoutBal, setPayoutBal]     = useState<null | {
    address:    string
    // null when Arcscan failed to return a balance — UI renders "—" + a clear
    // "Couldn't read the live balance" message instead of misleading $0.
    usdc:       number | null
    committed:  number
    free:       number | null
    fetchError: string | null
    alerts:     { critical: boolean; low: boolean; underwater: boolean }
    thresholds: { low: number; crit: number }
  }>(null)
  const [copiedAddr, setCopiedAddr] = useState(false)
  // Why the DCW panel didn't render — surfaced inline instead of swallowed.
  const [payoutErr, setPayoutErr]   = useState<string | null>(null)
  // Site stats panel — milestone tracking + numbers handy for grant submissions.
  const [siteStats, setSiteStats]   = useState<null | {
    users:      { totalWallets: number; circleUsers: number; uniqueTesters: number; uniqueFounders: number; uniqueReviewers: number; uniqueClaimers: number; builderProfiles: number }
    ecosystem:  { projectsLive: number; projectsTotal: number; projectsClaimed: number; contractsClaimed: number; contractsVerified: number }
    activity:   { campaignsTotal: number; campaignsActive: number; completionsTotal: number; completionsReviewed: number; completionsClaimed: number; reviewsTotal: number; projectViews: number }
    economy:    { xpAwarded: number; usdcPaid: number }
    growth30d:  { projects: number; completions: number }
    momentum7d: { completions: number; activeTesters: number }
    traffic?:   { visitorsToday: number; visitors7d: number; visitors30d: number; pageViews30d: number; topPages: Array<{ path: string; visitors: number }> }
    generated_at: string
  }>(null)
  const [contracts, setContracts]     = useState<Contract[]>([])
  const [pendingUpdates, setPendingUpdates] = useState<PendingUpdate[]>([])
  const [events, setEvents]           = useState<Event[]>([])
  const [pendingCampaigns, setPendingCampaigns] = useState<AdminCampaign[]>([])
  // URL reputation cache (VirusTotal verdicts keyed by URL) + in-flight re-checks
  const [urlScans, setUrlScans] = useState<Record<string, { verdict: string; malicious: number; suspicious: number; total_engines: number }>>({})
  const [rescanning, setRescanning] = useState<string | null>(null)
  const [pendingCampaignUpdates, setPendingCampaignUpdates] = useState<any[]>([])
  const [allCampaigns, setAllCampaigns] = useState<any[]>([])
  const [repairOpen, setRepairOpen]   = useState<number|null>(null)
  const [repairWallet, setRepairWallet] = useState("")
  // Admin completions view — keyed by campaign id. When set, expand the
  // submissions panel for that campaign. Data fetched lazily on first open.
  const [subsOpen, setSubsOpen]       = useState<number|null>(null)
  const [subsLoading, setSubsLoading] = useState(false)
  const [subsData, setSubsData]       = useState<{ campaign: any; completions: any[] } | null>(null)
  // Track which testers' feedback is expanded inside the admin submissions panel
  const [subsExpandedTester, setSubsExpandedTester] = useState<Set<string>>(new Set())

  async function loadCampaignSubmissions(campaignId: number) {
    setSubsLoading(true)
    setSubsData(null)
    setSubsExpandedTester(new Set())
    try {
      const res = await fetch(`/api/trials/${campaignId}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${password}` },
      })
      const data = await res.json()
      if (data?.campaign) setSubsData({ campaign: data.campaign, completions: data.completions || [] })
    } finally { setSubsLoading(false) }
  }
  const [acting, setActing]           = useState(false)
  const [locInputs, setLocInputs]     = useState<Record<number,{city:string;country:string;status:string;result:string}>>({})
  const [toast, setToast]             = useState<{ok:boolean;text:string}|null>(null)
  const [rejectingCampaignId, setRejectingCampaignId] = useState<number|null>(null)
  const [rejectingProjectId, setRejectingProjectId]   = useState<number|null>(null)
  const [rejectProjectReason, setRejectProjectReason] = useState("")
  const [rejectingSpotId, setRejectingSpotId]         = useState<number|null>(null)
  const [rejectSpotReason, setRejectSpotReason]       = useState("")
  const [rejectReason, setRejectReason] = useState("")
  const [editing, setEditing]         = useState<Project|null>(null)
  const [editForm, setEditForm]       = useState<Partial<Project>>({})
  const [assess, setAssess]           = useState<any>(null)
  const [assessing, setAssessing]     = useState(false)
  const [estCheck, setEstCheck]       = useState<any>(null)
  const [estChecking, setEstChecking] = useState(false)
  const [expandedContract, setExpandedContract] = useState<string|null>(null)
  const [showEventForm, setShowEventForm] = useState(false)
  const [creatingEvent, setCreatingEvent] = useState(false)
  const [eventForm, setEventForm] = useState({
    name: "", tagline: "", type: "Hackathon", description: "",
    date: "", end_date: "", timezone: "UTC",
    location: "", is_online: false,
    link: "", organizer: "", organizer_twitter: "", email: "", logo_url: "",
  })
  const [eventLogoPreview, setEventLogoPreview] = useState<string|null>(null)
  const [eventLogoUploading, setEventLogoUploading] = useState(false)
  const [search, setSearch] = useState("")
  // Projects tab: show all, only live, or only hidden (taken-down) listings.
  const [liveFilter, setLiveFilter] = useState<"all"|"live"|"hidden"|"flagged">("all")
  // Hide dialog: which project, why, and an optional note for the founder.
  const [hideFor, setHideFor]       = useState<any>(null)
  const [hideReason, setHideReason] = useState("security")
  const [hideNote, setHideNote]     = useState("")
  const [hideNotify, setHideNotify] = useState(true)
  // Restore dialog — same control as hide: optional note, and the choice not to email.
  const [restoreFor, setRestoreFor]       = useState<any>(null)
  const [restoreNote, setRestoreNote]     = useState("")
  const [restoreNotify, setRestoreNotify] = useState(true)

  const mono  = "'DM Mono', monospace"
  const surf  = "var(--surf, #0a0e1a)"
  const surf2 = "var(--surf2, #0e1224)"
  const t1    = "var(--t1, #e8ecff)"
  const t2    = "var(--t2, #6b7da8)"
  const t3    = "var(--t3, #2e3a5c)"
  const bdr   = "var(--bdr, rgba(255,255,255,0.06))"

  useEffect(() => { setMounted(true) }, [])

  function showToast(ok: boolean, text: string) {
    setToast({ ok, text })
    setTimeout(() => setToast(null), 3500)
  }

  async function login() {
    const res  = await fetch(`/api/admin?action=auth`, { headers: { Authorization: `Bearer ${pw}` } })
    const data = await res.json()
    if (data.ok) { setPassword(pw); setAuthed(true); loadAll(pw) }
    else showToast(false, "Wrong password")
  }

  async function loadAll(p = password) {
    setLoading(true)
    try {
      const res  = await fetch(`/api/admin?action=list&_=${Date.now()}`, { headers: { Authorization: `Bearer ${p}` } })
      const data = await res.json()
      setSubmissions(data.submissions || [])
      setProjects(data.projects || [])
      setContracts(data.contracts || [])
      setPendingUpdates(data.pendingUpdates || [])
      setEvents(data.events || [])
      setPendingCampaigns(data.pendingCampaigns || [])
      setPendingCampaignUpdates(data.pendingCampaignUpdates || [])
      setAllCampaigns(data.allCampaigns || [])
      setUrlScans(data.urlScans || {})

      // Surface payout wallet balance so the operator knows before the gas
      // tank runs dry. If the endpoint errors (missing env var, auth, Arcscan),
      // we now record the error string so the panel can render an actionable
      // diagnostic instead of silently hiding (which made "missing DCW panel"
      // unidentifiable in prod).
      fetch("/api/admin/payout-balance", { headers: { Authorization: `Bearer ${p}` }, cache: "no-store" })
        .then(async r => {
          const body = await r.json().catch(() => ({}))
          if (r.ok && !body.error) { setPayoutBal(body); setPayoutErr(null); return }
          setPayoutBal(null)
          setPayoutErr(body.error || `HTTP ${r.status}`)
        })
        .catch(e => { setPayoutBal(null); setPayoutErr(e?.message || "network error") })

      // Site stats for milestone tracking + grant submissions.
      fetch("/api/admin/stats", { headers: { Authorization: `Bearer ${p}` }, cache: "no-store" })
        .then(r => r.ok ? r.json() : null)
        .then(s => s && !s.error && setSiteStats(s))
        .catch(() => {})

      // Trust: alerts + disputes — same load cycle so the sidebar badge
      // shows the right count from page load.
      loadTrust(p).catch(() => {})
      // Tracked Contracts — fetched alongside for sidebar count accuracy.
      loadTracked(p).catch(() => {})
      loadAiInsights(p).catch(() => {})
      loadSpotlight(p).catch(() => {})
    } finally { setLoading(false); setLoadedOnce(true) }
  }

  async function loadTrust(p: string = pw) {
    if (!p) return
    setTrustLoading(true)
    setTrustError("")
    try {
      const r = await fetch("/api/admin/trust", { headers: { Authorization: `Bearer ${p}` }, cache: "no-store" })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || "Failed")
      setTrust(d)
    } catch (e: any) {
      setTrustError(e?.message || "Network error")
    } finally { setTrustLoading(false) }
  }

  async function resolveAlert(id: number) {
    if (!pw) return
    await fetch("/api/admin/trust", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${pw}` },
      body: JSON.stringify({ kind: "alert", id, action: "resolve" }),
    }).catch(() => {})
    await loadTrust()
  }

  async function actionDispute(id: number, action: "acknowledge" | "resolve" | "dismiss", notes?: string) {
    if (!pw) return
    await fetch("/api/admin/trust", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${pw}` },
      body: JSON.stringify({ kind: "dispute", id, action, notes }),
    }).catch(() => {})
    await loadTrust()
  }

  async function actionCaution(id: number) {
    if (!pw) return
    const r = await fetch("/api/admin/trust", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${pw}` },
      body: JSON.stringify({ kind: "caution", id, action: "acknowledge" }),
    }).catch(() => null)
    if (r?.ok) showToast(true, "Acknowledged")
    await loadTrust()
  }

  async function actionAudit(id: number, action: "approve" | "reject") {
    if (!pw) return
    const r = await fetch("/api/admin/trust", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${pw}` },
      body: JSON.stringify({ kind: "audit", id, action }),
    }).catch(() => null)
    if (r?.ok) showToast(true, action === "approve" ? "Verified — audit approved" : "Audit rejected")
    await loadTrust()
  }

  async function loadTracked(p: string = pw) {
    if (!p) return
    setTrackedLoading(true)
    setTrackedError("")
    try {
      const r = await fetch("/api/admin/tracked-contracts", { headers: { Authorization: `Bearer ${p}` }, cache: "no-store" })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || "Failed")
      setTracked(d)
    } catch (e: any) {
      setTrackedError(e?.message || "Network error")
    } finally { setTrackedLoading(false) }
  }

  async function loadAiInsights(p: string = pw) {
    if (!p) return
    setAiLoading(true); setAiError("")
    try {
      const r = await fetch("/api/admin/ai-insights", { headers: { Authorization: `Bearer ${p}` }, cache: "no-store" })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || "Failed")
      setAiInsights(d)
    } catch (e: any) {
      setAiError(e?.message || "Network error")
    } finally { setAiLoading(false) }
    loadKb(p).catch(() => {})
  }

  async function loadKb(p: string = pw) {
    if (!p) return
    try {
      const r = await fetch("/api/admin/ai-reembed", { headers: { Authorization: `Bearer ${p}` }, cache: "no-store" })
      const d = await r.json()
      if (r.ok) setKb(d)
    } catch {}
  }

  // Embed any knowledge rows missing an embedding (runs in prod where the Gemini
  // key lives). Clicks resume where the last left off, so large batches just
  // need another click until missing hits 0.
  async function reembedKb() {
    if (!pw) return
    setKbBusy(true)
    try {
      const r = await fetch("/api/admin/ai-reembed", { method: "POST", headers: { Authorization: `Bearer ${pw}` } })
      const d = await r.json()
      if (!r.ok) { showToast(false, d.error || "Re-embed failed"); return }
      setKb(d)
      showToast(true, d.complete ? `Knowledge embedded — ${d.embedded}/${d.total} ready` : `Embedded ${d.embedded_now} · ${d.missing} left, click again`)
    } catch (e: any) {
      showToast(false, e?.message || "Network error")
    } finally { setKbBusy(false) }
  }

  // Resolve a knowledge gap (covered by a fact, or just junk). Pass nothing to
  // clear them all.
  async function resolveGap(question?: string) {
    if (!pw) return
    try {
      const r = await fetch("/api/admin/ai-insights", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${pw}`, "Content-Type": "application/json" },
        body: JSON.stringify(question ? { question } : { all: true }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { showToast(false, d.error || "Failed"); return }
      showToast(true, question ? "Gap resolved" : `Cleared ${d.resolved} gap${d.resolved === 1 ? "" : "s"}`)
      await loadAiInsights()
    } catch { showToast(false, "Network error") }
  }

  async function loadSpotlight(p: string = pw) {
    if (!p) return
    try {
      const r = await fetch("/api/admin/spotlight", { headers: { Authorization: `Bearer ${p}` }, cache: "no-store" })
      const d = await r.json()
      if (r.ok) setSpotlight(d)
    } catch {}
  }
  async function spotlightAction(method: "POST" | "PATCH" | "DELETE", body?: any, id?: number) {
    if (!pw) return
    try {
      const url = method === "DELETE" ? `/api/admin/spotlight?id=${id}` : "/api/admin/spotlight"
      const r = await fetch(url, { method, headers: { Authorization: `Bearer ${pw}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { showToast(false, d.error || "Failed"); return false }
      await loadSpotlight()
      return true
    } catch { showToast(false, "Network error"); return false }
  }
  async function createSpotlight() {
    if (!spotForm.title.trim()) { showToast(false, "Title required"); return }
    setSpotBusy(true)
    const ends_at = spotDays && Number(spotDays) > 0 ? new Date(Date.now() + Number(spotDays) * 86400000).toISOString() : undefined
    const ok = await spotlightAction("POST", { ...spotForm, ends_at })
    if (ok) { setSpotForm({ kind: "custom", title: "", subtitle: "", image_url: "", image_pos: "", link_url: "", cta_text: "", accent: "", project: "" }); setSpotDays(""); showToast(true, "Spotlight item created & live") }
    setSpotBusy(false)
  }

  async function saveTrackedEdit(id: number, patch: Record<string, any>) {
    if (!pw) return
    try {
      const r = await fetch(`/api/admin/tracked-contracts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${pw}` },
        body: JSON.stringify(patch),
      })
      const d = await r.json()
      if (!r.ok) {
        setToast({ ok: false, text: d.error || "Edit failed" })
      } else {
        setToast({ ok: true, text: d.re_indexed ? "Saved · re-indexing started" : "Saved" })
      }
    } catch (e: any) {
      setToast({ ok: false, text: e?.message || "Network error" })
    }
    setTrackedEdit(null)
    await loadTracked()
  }

  async function revokeTracked(id: number) {
    if (!pw) return
    if (!confirm("Revoke this tracked contract? Soft-deletes — history preserved, indexer stops counting.")) return
    try {
      const r = await fetch(`/api/admin/tracked-contracts/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${pw}` },
      })
      const d = await r.json()
      if (!r.ok) setToast({ ok: false, text: d.error || "Revoke failed" })
      else setToast({ ok: true, text: "Revoked" })
    } catch (e: any) {
      setToast({ ok: false, text: e?.message || "Network error" })
    }
    await loadTracked()
  }

  async function act(id: number|string, action: string, table = "projects", extraData?: any) {
    setActing(true)
    try {
      const res  = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${password}` },
        body: JSON.stringify({ id, action, table, data: extraData }),
      })
      const data = await res.json()
      if (data.success || data.ok) {
        // Optimistic: drop the handled campaign from the pending list NOW —
        // loadAll() reconciles everything in the background, but the admin
        // shouldn't stare at a stale card while every dataset refetches.
        if (table === "campaigns" && (action === "approve" || action === "reject")) {
          setPendingCampaigns(p => p.filter(c => c.id !== id))
        }
        if (data.refund_failed) {
          showToast(false, "Rejected — but the USDC refund FAILED. Refund the founder manually.")
        } else {
        showToast(true, action === "approve" ? "Approved" : action === "approve-all-updates" ? "All changes applied" : action === "reject-all-updates" ? "Changes rejected" : action === "approve-update" ? "Update applied" : action === "reject-update" ? "Update rejected" : action === "approve-campaign-update" ? "Campaign update applied" : action === "reject-campaign-update" ? "Campaign update rejected" : action === "hide-listing" ? "Listing hidden — founder notified" : action === "restore-listing" ? "Listing restored" : action === "delete" || action === "reject" ? "Removed" : "Done")
        }
        loadAll()
      } else {
        showToast(false, data.error || "Action failed")
      }
    } catch { showToast(false, "Network error") }
    finally { setActing(false) }
  }

  // One admin-triggered VirusTotal check for a URL — no timers, no background
  // usage; the fresh verdict lands straight back into local state.
  async function rescanUrl(url: string) {
    setRescanning(url)
    try {
      const res  = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${password}` },
        body: JSON.stringify({ id: url, action: "rescan-url" }),
      })
      const data = await res.json()
      if (data.success && data.scan) {
        setUrlScans(p => ({ ...p, [data.scan.url]: data.scan }))
        showToast(true, data.scan.verdict === "flagged" ? "URL FLAGGED — check before approving" : `URL scan: ${data.scan.verdict}`)
      } else {
        showToast(false, data.error || "Scan failed")
      }
    } catch { showToast(false, "Network error") }
    finally { setRescanning(null) }
  }

  // Reputation chip + re-check button for a founder-submitted URL. Reads the
  // cached VirusTotal verdict (exact URL or trailing-slash variant).
  // A listing counts as flagged when VirusTotal reports any malicious or
  // suspicious engine for its website. Matches urlRepChip's lookup so the
  // filter count and the red chip can never disagree.
  // A founder emailing about a submission quotes their reference, so pasting
  // ARC-XXXXX into the search box has to find it. Hyphen-insensitive, since
  // people retype these from memory.
  function matchesSearch(p: any, q: string): boolean {
    const s = q.trim().toLowerCase()
    if (!s) return true
    if (p.name?.toLowerCase().includes(s)) return true
    const ref = (p.submission_ref || "").toLowerCase()
    return !!ref && (ref.includes(s) || ref.replace(/-/g, "").includes(s.replace(/-/g, "")))
  }

  function scanFor(url: string | null | undefined) {
    if (!url) return null
    return urlScans[url] || urlScans[url.replace(/\/$/, "")] || urlScans[url + "/"] || null
  }
  function isFlagged(url: string | null | undefined): boolean {
    return scanFor(url)?.verdict === "flagged"
  }
  // Malicious verdicts weigh far more than suspicious ones — a single engine
  // calling something suspicious is noise (Kraken and Ledger both score 1),
  // while 10+ malicious is unambiguous. Weighting keeps the real problems on top.
  function flagScore(url: string | null | undefined): number {
    const s = scanFor(url)
    if (!s || s.verdict !== "flagged") return -1
    return (s.malicious || 0) * 10 + (s.suspicious || 0)
  }

  function urlRepChip(url: string | null | undefined) {
    if (!url) return null
    const scan = urlScans[url] || urlScans[url.replace(/\/$/, "")] || urlScans[url + "/"]
    const busy = rescanning === url
    const chip = !scan
      ? { txt: "URL not scanned", c: t3, b: bdr }
      : scan.verdict === "clean"   ? { txt: `✓ URL clean · ${scan.total_engines} engines`, c: "#00d990", b: "rgba(0,217,144,0.3)" }
      : scan.verdict === "flagged" ? { txt: `⚠ URL FLAGGED by ${scan.malicious + scan.suspicious}/${scan.total_engines} engines`, c: "#e03348", b: "rgba(224,51,72,0.4)" }
      : scan.verdict === "queued"  ? { txt: "URL scan pending (VirusTotal analyzing)", c: "#e0a810", b: "rgba(224,168,16,0.3)" }
      : scan.verdict === "no_key"  ? { txt: "URL scanning not configured (VIRUSTOTAL_API_KEY)", c: t3, b: bdr }
      :                              { txt: "URL scan error", c: "#e0a810", b: "rgba(224,168,16,0.3)" }
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ ...pill(chip.c, chip.b), fontWeight: scan?.verdict === "flagged" ? 700 : 400 }}>{chip.txt}</span>
        <button
          onClick={() => rescanUrl(url)}
          disabled={busy}
          title="Re-check this URL against VirusTotal (one API call)"
          style={{ height: 20, padding: "0 8px", background: "transparent", border: "1px solid " + bdr, borderRadius: 4, fontSize: "9px", fontFamily: mono, color: t3, cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1 }}>
          {busy ? "checking…" : "re-check"}
        </button>
      </span>
    )
  }

  function confirmDelete(id: number|string, table: string) {
    if (window.confirm("Are you sure you want to delete this? This cannot be undone.")) {
      act(id, "delete", table)
    }
  }

  async function saveEdit() {
    if (!editing) return
    setActing(true)
    try {
      const res  = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${password}` },
        body: JSON.stringify({ id: editing.id, action: "update", data: editForm }),
      })
      const data = await res.json()
      if (data.success) {
        showToast(true, "Project updated")
        const merged = { ...editing, ...editForm } as Project
        setProjects(prev => prev.map(p => String(p.id) === String(editing.id) ? merged : p))
        setSubmissions(prev => prev.map(p => String(p.id) === String(editing.id) ? merged : p))
        setEditing(null)
      }
      else showToast(false, data.error || "Update failed")
    } catch { showToast(false, "Network error") }
    finally { setActing(false) }
  }

  function startEdit(p: Project) {
    setEditing(p)
    setEditForm({ ...p, audited: ((p as any).trust_level === "verified" || (p as any).audit_status === "approved") } as any)
    setAssess(null)
    setEstCheck(null)
  }

  const [logoUploading, setLogoUploading] = useState(false)
  async function uploadAdminLogo(file: File) {
    if (!file.type.startsWith("image/")) { showToast(false, "Logo must be an image"); return }
    if (file.size > 5 * 1024 * 1024)     { showToast(false, "Logo must be under 5MB"); return }
    setLogoUploading(true)
    try {
      const fd = new FormData()
      fd.append("image", file)
      const res  = await fetch("/api/upload", { method: "POST", body: fd })
      const data = await res.json()
      if (data.url) setEditForm(p => ({ ...p, logo_url: data.url }))
      else showToast(false, data.error || "Logo upload failed")
    } catch { showToast(false, "Logo upload failed") }
    finally { setLogoUploading(false) }
  }

  async function geocodeProject(id: number, fallback?: { city: string; country: string }) {
    const inp = locInputs[id] || { city: fallback?.city || "", country: fallback?.country || "", status: "", result: "" }
    if (!inp.city.trim()) return
    setLocInputs(p => ({ ...p, [id]: { ...inp, status: "loading", result: "" } }))
    try {
      const res  = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${password}` },
        body: JSON.stringify({ id, action: "geocode", data: { city: inp.city, country: inp.country } }),
      })
      const data = await res.json()
      if (data.success) {
        setLocInputs(p => ({ ...p, [id]: { ...inp, status: "done", result: `${data.lat?.toFixed(4)}, ${data.lng?.toFixed(4)}` } }))
        loadAll()
      } else {
        setLocInputs(p => ({ ...p, [id]: { ...inp, status: "error", result: data.error || "Not found" } }))
      }
    } catch {
      setLocInputs(p => ({ ...p, [id]: { ...inp, status: "error", result: "Network error" } }))
    }
  }

  async function uploadEventLogo(file: File) {
    setEventLogoUploading(true)
    try {
      const fd = new FormData()
      fd.append("image", file)
      const res  = await fetch("/api/upload", { method: "POST", body: fd })
      const data = await res.json()
      if (data.url) {
        setEventForm(p => ({ ...p, logo_url: data.url }))
        setEventLogoPreview(data.url)
      } else {
        showToast(false, "Logo upload failed")
      }
    } finally {
      setEventLogoUploading(false)
    }
  }

  async function createOfficialEvent() {
    if (!eventForm.name.trim()) { showToast(false, "Event name required"); return }
    if (!eventForm.date)        { showToast(false, "Event date required"); return }
    setCreatingEvent(true)
    try {
      const res  = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...eventForm, email: eventForm.email || "admin@arclens.app" }),
      })
      const data = await res.json()
      if (data.success && data.id) {
        await Promise.all([
          fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${password}` }, body: JSON.stringify({ id: data.id, action: "approve",      table: "events" }) }),
          fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${password}` }, body: JSON.stringify({ id: data.id, action: "badge-event", table: "events", data: { badge: "official" } }) }),
        ])
        showToast(true, "Official event created and live")
        setShowEventForm(false)
        setEventLogoPreview(null)
        setEventForm({ name: "", tagline: "", type: "Hackathon", description: "", date: "", end_date: "", timezone: "UTC", location: "", is_online: false, link: "", organizer: "", organizer_twitter: "", email: "", logo_url: "" })
        loadAll()
      } else {
        showToast(false, data.error || "Failed to create event")
      }
    } catch { showToast(false, "Network error") }
    finally { setCreatingEvent(false) }
  }

  if (!mounted) return <div style={{ minHeight:"100vh", background:"var(--bg,#060812)" }} />

  if (!authed) return (
    <ArcLayout active="">
      <div style={{ minHeight:"80vh", display:"flex", alignItems:"center", justifyContent:"center" }}>
        <div style={{ background:surf, border:"1px solid " + bdr, borderRadius:"16px", padding:"40px", width:"360px" }}>
          <div style={{ fontSize:"11px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"8px" }}>Arclens</div>
          <div style={{ fontSize:"22px", fontWeight:700, letterSpacing:"-0.04em", marginBottom:"6px", color:t1 }}>Admin Panel</div>
          <div style={{ fontSize:"12px", color:t2, marginBottom:"28px" }}>Enter your admin password to continue</div>
          <input
            type="password" value={pw} onChange={e => setPw(e.target.value)}
            onKeyDown={e => e.key==="Enter" && login()}
            placeholder="Password"
            style={{ width:"100%", height:"42px", background:surf2, border:"1px solid "+bdr, borderRadius:"8px", padding:"0 14px", fontSize:"13px", fontFamily:mono, color:t1, outline:"none", marginBottom:"14px", boxSizing:"border-box" }}
          />
          <button onClick={login} style={{ width:"100%", height:"42px", background:"#1a56ff", color:"#fff", fontSize:"13px", fontWeight:600, border:"none", borderRadius:"8px", cursor:"pointer", fontFamily:"'Geist',sans-serif" }}>
            Sign In →
          </button>
        </div>
      </div>
    </ArcLayout>
  )

  const pendingCount     = submissions.length + contracts.filter(c => !c.verified).length
  const pendingEvents    = events.filter(e => !e.approved).length
  const totalPending     = pendingCount + pendingUpdates.length + pendingEvents + pendingCampaigns.length + pendingCampaignUpdates.length
  const missingLoc       = [...submissions,...projects].filter((p:any)=>!p.lat).length
  // Same wording testers see on the proof inputs at /trials/[id]
  const PROOF_LABELS: Record<string,string> = { x_link:"X post URL", tx_hash:"transaction hash", url:"URL", screenshot:"screenshot" }
  const REWARD_TYPE_LABELS: Record<string,string>   = { whitelist:"Whitelist", early_access:"Early Access", discord_role:"Discord Role", credit:"Public Credit", token_allocation:"Token Alloc.", usdc:"USDC", other:"Other" }

  // ── Sidebar nav config ──
  const queueTabs = [
    { id: "pending"   as const, label: "Submissions",  count: submissions.length,       urgent: submissions.length > 0 },
    { id: "updates"          as const, label: "Field Updates",    count: pendingUpdates.length,         urgent: pendingUpdates.length > 0 },
    { id: "campaign-updates" as const, label: "Campaign Edits",   count: pendingCampaignUpdates.length, urgent: pendingCampaignUpdates.length > 0 },
    { id: "campaigns"        as const, label: "Campaigns",         count: pendingCampaigns.length,       urgent: pendingCampaigns.length > 0 },
    { id: "events"    as const, label: "Events",        count: pendingEvents,            urgent: pendingEvents > 0 },
    { id: "trust"     as const, label: "Trust",         count: (trust?.counts.open_alerts ?? 0) + (trust?.counts.open_disputes ?? 0) + (trust?.counts.open_audits ?? 0) + (trust?.counts.open_flags ?? 0), urgent: !!trust && ((trust.counts.open_alerts > 0) || (trust.counts.open_disputes > 0) || (trust.counts.open_audits > 0) || (trust.counts.open_flags > 0)) },
    { id: "tracked"   as const, label: "Tracked Contracts", count: tracked?.counts.total ?? 0, urgent: !!tracked && tracked.counts.errored > 0 },
    { id: "spotlight" as const, label: "Spotlight",        count: spotlight?.counts.pending ?? 0, urgent: !!spotlight && (spotlight.counts.pending > 0) },
  ]
  const manageTabs = [
    { id: "ai"        as const, label: "Lens AI",         count: aiInsights?.gaps.total ?? 0, urgent: false },
    { id: "stats"     as const, label: "Stats Dashboard", count: 0,                urgent: false },
    { id: "projects"  as const, label: "All Projects",    count: projects.length,  urgent: false },
    { id: "locations" as const, label: "Locations",       count: missingLoc,       urgent: missingLoc > 0 },
  ]

  const sidebarBtnStyle = (active: boolean): React.CSSProperties => ({
    width: "100%", height: "36px", display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "0 10px", borderRadius: "7px", border: "none", cursor: "pointer", marginBottom: "2px",
    background: active ? "rgba(26,86,255,0.12)" : "transparent",
    color: active ? "#8aaeff" : t2,
    fontSize: "12px", fontFamily: "'Geist',sans-serif", textAlign: "left",
  })

  return (
    <ArcLayout active="">
      <div style={{ display:"flex", minHeight:"100vh" }}>

        {/* ── SIDEBAR ── */}
        <div style={{ width:"220px", background:surf, borderRight:"1px solid "+bdr, display:"flex", flexDirection:"column", flexShrink:0, position:"sticky", top:0, height:"100vh", overflowY:"auto" }}>

          {/* Brand */}
          <div style={{ padding:"20px 16px 16px", borderBottom:"1px solid "+bdr }}>
            <div style={{ fontSize:"13px", fontWeight:700, color:t1, letterSpacing:"-0.02em" }}>Arclens Admin</div>
            {totalPending > 0 && (
              <div style={{ display:"inline-flex", alignItems:"center", gap:"5px", marginTop:"6px", background:"rgba(224,51,72,0.1)", border:"1px solid rgba(224,51,72,0.2)", borderRadius:"5px", padding:"2px 8px" }}>
                <span style={{ width:"5px", height:"5px", borderRadius:"50%", background:"#e03348", display:"inline-block" }} />
                <span style={{ fontSize:"10px", fontFamily:mono, color:"#e03348" }}>{totalPending} pending</span>
              </div>
            )}
          </div>

          {/* Review Queue */}
          <div style={{ padding:"16px 10px 8px" }}>
            <div style={{ fontSize:"9px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.1em", padding:"0 6px 8px" }}>Review Queue</div>
            {queueTabs.map(t => (
              <button key={t.id} onClick={() => { setTab(t.id); setSearch("") }} style={sidebarBtnStyle(tab === t.id)}>
                <span>{t.label}</span>
                {t.count > 0 && (
                  <span style={{ fontSize:"10px", fontFamily:mono, padding:"1px 6px", borderRadius:"10px",
                    background: t.urgent ? "rgba(224,51,72,0.15)" : "rgba(107,125,168,0.1)",
                    color: t.urgent ? "#e03348" : t3,
                    border: `1px solid ${t.urgent ? "rgba(224,51,72,0.2)" : bdr}` }}>
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Manage */}
          <div style={{ padding:"8px 10px" }}>
            <div style={{ fontSize:"9px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.1em", padding:"0 6px 8px", marginTop:"8px" }}>Manage</div>
            {manageTabs.map(t => (
              <button key={t.id} onClick={() => { setTab(t.id); setSearch("") }} style={sidebarBtnStyle(tab === t.id)}>
                <span>{t.label}</span>
                <span style={{ fontSize:"10px", fontFamily:mono, color: t.urgent ? "#e08810" : t3 }}>{t.count}</span>
              </button>
            ))}
          </div>

          {/* Bottom actions */}
          <div style={{ marginTop:"auto", padding:"16px 10px", borderTop:"1px solid "+bdr, display:"flex", flexDirection:"column", gap:"6px" }}>
            <button
              onClick={async () => {
                // Authorize, fetch the CSV, force a download
                try {
                  const res = await fetch("/api/admin/export-projects", { headers: { Authorization: `Bearer ${password}` } })
                  if (!res.ok) { showToast(false, "Export failed"); return }
                  const blob = await res.blob()
                  const url  = URL.createObjectURL(blob)
                  const a    = document.createElement("a")
                  const cd   = res.headers.get("content-disposition") || ""
                  const m    = /filename="([^"]+)"/.exec(cd)
                  a.href     = url
                  a.download = m?.[1] || `arclens-projects-${new Date().toISOString().slice(0,10)}.csv`
                  a.click()
                  setTimeout(() => URL.revokeObjectURL(url), 1000)
                  showToast(true, "Projects CSV downloaded")
                } catch { showToast(false, "Export failed") }
              }}
              style={{ height:"32px", background:"transparent", border:"1px solid "+bdr, borderRadius:"6px", color:t2, fontSize:"11px", fontFamily:mono, cursor:"pointer" }}>
              ⬇ Export contracts (CSV)
            </button>
            <button onClick={() => loadAll()} style={{ height:"32px", background:"transparent", border:"1px solid "+bdr, borderRadius:"6px", color:t2, fontSize:"11px", fontFamily:mono, cursor:"pointer" }}>
              ↻ Refresh
            </button>
            <button onClick={() => setAuthed(false)} style={{ height:"32px", background:"rgba(224,51,72,0.06)", border:"1px solid rgba(224,51,72,0.15)", borderRadius:"6px", color:"#e03348", fontSize:"11px", fontFamily:mono, cursor:"pointer" }}>
              Sign Out
            </button>
          </div>
        </div>

        {/* ── MAIN CONTENT ── */}
        <div style={{ flex:1, padding:"28px 32px 48px", overflowY:"auto", minWidth:0 }}>

          {/* Tab header */}
          <div style={{ marginBottom:"24px" }}>
            <div style={{ fontSize:"18px", fontWeight:700, letterSpacing:"-0.03em", color:t1 }}>
              {tab === "pending"          ? "Project Submissions"
               : tab === "updates"          ? "Founder Field Updates"
               : tab === "campaign-updates" ? "Campaign Edit Requests"
               : tab === "campaigns"        ? "Campaign Reviews"
               : tab === "events"           ? "Events"
               : tab === "projects"         ? "All Projects"
               : tab === "contracts"        ? "Contract Registry"
               : tab === "stats"            ? "Stats Dashboard"
               : tab === "trust"            ? "Trust — Alerts & Disputes"
               : tab === "tracked"          ? "Tracked Contracts"
               : tab === "ai"               ? "Lens AI"
               : tab === "spotlight"        ? "Ecosystem Spotlight"
               : "Location Mapping"}
            </div>
            <div style={{ fontSize:"11px", fontFamily:mono, color:t3, marginTop:"4px" }}>
              {tab === "pending"          ? `${submissions.length} awaiting approval`
               : tab === "updates"          ? `${pendingUpdates.length} field changes to review`
               : tab === "campaign-updates" ? `${pendingCampaignUpdates.length} campaign edit requests to review`
               : tab === "campaigns"        ? `${pendingCampaigns.length} campaigns awaiting approval`
               : tab === "events"    ? `${pendingEvents} pending · ${events.length} total`
               : tab === "projects"  ? `${projects.length} approved projects on Arc Ecosystem`
               : tab === "contracts" ? `${contracts.length} total · ${contracts.filter(c=>!c.verified).length} unverified`
               : tab === "stats"     ? "Site-wide metrics · milestone tracker · payout wallet"
               : tab === "trust"     ? "Indexer alerts · reports & disputes · pending audits"
               : tab === "tracked"   ? `${tracked?.counts.working ?? 0} working · ${tracked?.counts.errored ?? 0} errored · ${tracked?.counts.quiet ?? 0} quiet · ${tracked?.counts.revoked ?? 0} revoked`
               : tab === "ai"        ? `${aiInsights?.gaps.total ?? 0} unanswered · ${aiInsights?.ratings.up ?? 0} 👍 / ${aiInsights?.ratings.down ?? 0} 👎`
               : tab === "spotlight" ? `${spotlight?.counts.active ?? 0} live · ${spotlight?.counts.pending ?? 0} pending applications`
               : `${missingLoc} missing coordinates`}
            </div>
          </div>

          {/* Toast */}
          {toast && (
            <div style={{ position:"fixed", top:"20px", right:"24px", zIndex:9999, padding:"12px 18px", borderRadius:"10px",
              background: toast.ok ? "rgba(0,184,122,0.12)" : "rgba(224,51,72,0.12)",
              border: `1px solid ${toast.ok ? "rgba(0,184,122,0.3)" : "rgba(224,51,72,0.3)"}`,
              color: toast.ok ? "#00d990" : "#e03348", fontSize:"13px", fontFamily:"'Geist',sans-serif",
              display:"flex", alignItems:"center", gap:"10px", boxShadow:"0 8px 32px rgba(0,0,0,0.4)" }}>
              <span>{toast.ok ? "✓" : "✗"}</span>
              <span>{toast.text}</span>
            </div>
          )}

          {/* Stats Dashboard — only renders on the dedicated tab so the
              landing experience (Submissions) isn't buried under a panel. */}
          {tab === "stats" && siteStats && (() => {
            const u = siteStats.users, e = siteStats.ecosystem, a = siteStats.activity, ec = siteStats.economy
            const fmt = (n: number) => n.toLocaleString("en-US")
            // Default to t1 (theme-aware) so values stay readable on BOTH light
            // and dark admin themes — the previous hardcoded near-white made
            // every tile without an explicit color invisible on light mode.
            const Tile = ({ label, value, delta, color = t1 }: { label: string; value: string; delta?: string; color?: string }) => (
              <div style={{ background: surf2, border: "1px solid " + bdr, borderRadius: 8, padding: "11px 13px", minWidth: 0 }}>
                <div style={{ fontSize: 9, fontFamily: mono, color: t3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color, lineHeight: 1.1 }}>{value}</div>
                {delta && <div style={{ fontSize: 10, fontFamily: mono, color: "#00b87a", marginTop: 3 }}>{delta}</div>}
              </div>
            )
            return (
              <div style={{ marginBottom: 18, padding: "16px 18px", background: surf, border: "1px solid " + bdr, borderRadius: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontFamily: mono, color: t2, textTransform: "uppercase", letterSpacing: "0.08em" }}>Site Stats · Milestone Tracker</div>
                  <div style={{ fontSize: 9, fontFamily: mono, color: t3 }}>generated {new Date(siteStats.generated_at).toLocaleString()}</div>
                </div>

                {siteStats.traffic && (
                  <>
                    <div style={{ fontSize: 9, fontFamily: mono, color: t3, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 7 }}>Traffic · site visitors (cookieless)</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8, marginBottom: 14 }}>
                      <Tile label="Visitors today"   value={fmt(siteStats.traffic.visitorsToday)} color={siteStats.traffic.visitorsToday > 0 ? "#00b87a" : "#eef2ff"} />
                      <Tile label="Visitors (7d)"    value={fmt(siteStats.traffic.visitors7d)} color="#8aaeff" />
                      <Tile label="Visitors (30d)"   value={fmt(siteStats.traffic.visitors30d)} color="#8aaeff" />
                      <Tile label="Page views (30d)" value={fmt(siteStats.traffic.pageViews30d)} />
                    </div>
                    {siteStats.traffic.topPages.length > 0 && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 9, fontFamily: mono, color: t3, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 7 }}>Top pages · unique visitors (30d)</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {siteStats.traffic.topPages.map(tp => (
                            <div key={tp.path} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11, fontFamily: mono, color: t2, padding: "5px 10px", background: surf2, borderRadius: 6 }}>
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tp.path}</span>
                              <span style={{ color: t1, fontWeight: 600, flexShrink: 0 }}>{fmt(tp.visitors)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                <div style={{ fontSize: 9, fontFamily: mono, color: t3, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 7 }}>Users · wallets engaged</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8, marginBottom: 14 }}>
                  <Tile label="Total connected wallets" value={fmt(u.totalWallets)} color="#8aaeff" />
                  <Tile label="Active (7d)"             value={fmt(siteStats.momentum7d.activeTesters)} color={siteStats.momentum7d.activeTesters > 0 ? "#00b87a" : "#eef2ff"} />
                  <Tile label="Circle UCW users"        value={fmt(u.circleUsers)} color="#c08828" />
                  <Tile label="Testers"                 value={fmt(u.uniqueTesters)} />
                  <Tile label="Founders"                value={fmt(u.uniqueFounders)} />
                  <Tile label="Reviewers"               value={fmt(u.uniqueReviewers)} />
                  <Tile label="Contract claimers"       value={fmt(u.uniqueClaimers)} />
                  <Tile label="Builder profiles"        value={fmt(u.builderProfiles)} />
                </div>

                <div style={{ fontSize: 9, fontFamily: mono, color: t3, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 7 }}>Ecosystem</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8, marginBottom: 14 }}>
                  <Tile label="Live projects"         value={fmt(e.projectsLive)} delta={siteStats.growth30d.projects > 0 ? `+${fmt(siteStats.growth30d.projects)} in 30d` : undefined} color="#8aaeff" />
                  <Tile label="Total submitted"       value={fmt(e.projectsTotal)} />
                  <Tile label="Claimed by founders"   value={fmt(e.projectsClaimed)} />
                  <Tile label="Contracts in registry" value={fmt(e.contractsClaimed)} />
                  {e.contractsVerified > 0 && <Tile label="Contracts verified" value={fmt(e.contractsVerified)} />}
                </div>

                <div style={{ fontSize: 9, fontFamily: mono, color: t3, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 7 }}>Activity · Arc Trials</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8, marginBottom: 14 }}>
                  <Tile label="Campaigns total"      value={fmt(a.campaignsTotal)} />
                  <Tile label="Campaigns live"       value={fmt(a.campaignsActive)} color="#00b87a" />
                  <Tile label="Completions"          value={fmt(a.completionsTotal)} delta={siteStats.growth30d.completions > 0 ? `+${fmt(siteStats.growth30d.completions)} in 30d` : undefined} color="#8aaeff" />
                  <Tile label="Reviewed by founders" value={fmt(a.completionsReviewed)} />
                  {a.completionsClaimed > 0 && <Tile label="USDC claimed" value={fmt(a.completionsClaimed)} />}
                  <Tile label="Project reviews"      value={fmt(a.reviewsTotal)} />
                  <Tile label="Project page views"   value={fmt(a.projectViews)} />
                </div>

                <div style={{ fontSize: 9, fontFamily: mono, color: t3, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 7 }}>Economy</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
                  <Tile label="XP awarded"          value={fmt(ec.xpAwarded)} color="#c08828" />
                  {ec.usdcPaid > 0 && <Tile label="USDC rewards paid" value={`$${fmt(Math.round(ec.usdcPaid))}`} color="#00b87a" />}
                </div>
              </div>
            )
          })()}

          {/* DCW load failed — surface WHY instead of silently hiding the panel.
              Common causes: PAYOUT_WALLET_ADDRESS unset on Vercel (needs a
              redeploy after env change), admin password mismatch, or Arcscan
              down. The actual error text is shown so it's actionable. */}
          {tab === "stats" && !payoutBal && payoutErr && (
            <div style={{ marginBottom: 16, padding: "12px 16px", background: "rgba(224,136,16,0.06)", border: "1px solid rgba(224,136,16,0.25)", borderRadius: 10, fontSize: 11, fontFamily: mono, color: "#e08810", lineHeight: 1.6 }}>
              <div style={{ fontWeight: 600, marginBottom: 3 }}>Circle DCW Payout Wallet · panel didn&apos;t load</div>
              <div style={{ color: t2 }}>{payoutErr}</div>
              {/PAYOUT_WALLET_ADDRESS/i.test(payoutErr) && (
                <div style={{ marginTop: 6, color: t3 }}>Fix: set <code style={{ color: t1 }}>PAYOUT_WALLET_ADDRESS</code> in Vercel → Settings → Environment Variables → redeploy.</div>
              )}
            </div>
          )}

          {/* Circle DCW payout wallet — USDC is the native gas + payout token on Arc,
              so one balance covers both. Free = total - committed-but-unpaid liabilities. */}
          {tab === "stats" && payoutBal && (() => {
            // When Arcscan responded with an error, usdc / free are null and
            // we render a clear "unavailable" state instead of misleading $0.
            const stale = payoutBal.fetchError != null || payoutBal.usdc == null
            const crit = !stale && payoutBal.alerts.critical
            const low  = !stale && payoutBal.alerts.low
            const underwater = !stale && payoutBal.alerts.underwater
            const status = stale
              ? "balance unavailable"
              : (crit ? "critical" : underwater ? "underwater" : low ? "low" : "healthy")
            const tone = stale ? "#d7c160" : (crit || underwater) ? "#e03348" : low ? "#d7c160" : "#00b87a"
            const bg   = stale ? "rgba(255,200,0,0.04)" : (crit || underwater) ? "rgba(224,51,72,0.08)" : low ? "rgba(255,200,0,0.06)" : "rgba(0,184,122,0.04)"
            const bd   = stale ? "rgba(255,200,0,0.2)"  : (crit || underwater) ? "rgba(224,51,72,0.3)"  : low ? "rgba(255,200,0,0.2)"  : "rgba(0,184,122,0.15)"
            const explorerUrl = `https://testnet.arcscan.app/address/${payoutBal.address}`
            const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            return (
              <div style={{ marginBottom:"16px", padding:"16px 20px", background:bg, border:`1px solid ${bd}`, borderRadius:"12px" }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"12px", flexWrap:"wrap", marginBottom:"12px" }}>
                  <div style={{ fontSize:"10px", fontFamily:mono, color:tone, letterSpacing:"0.1em", textTransform:"uppercase", fontWeight:600 }}>
                    Circle DCW Payout Wallet · {status}
                  </div>
                  <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
                     style={{ fontSize:"10px", fontFamily:mono, color:t3, textDecoration:"none" }}>
                    open on arcscan ↗
                  </a>
                </div>

                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))", gap:"16px", marginBottom:"12px" }}>
                  <div>
                    <div style={{ fontSize:"10px", fontFamily:mono, color:t3, marginBottom:"4px" }}>USDC on hand</div>
                    <div style={{ fontSize:"22px", fontWeight:700, color: stale ? t3 : t1, fontFamily:mono }}>
                      {stale ? "—" : `$${fmt(payoutBal.usdc)}`}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize:"10px", fontFamily:mono, color:t3, marginBottom:"4px" }}>Committed to campaigns</div>
                    <div style={{ fontSize:"22px", fontWeight:700, color:t2, fontFamily:mono }}>${fmt(payoutBal.committed)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize:"10px", fontFamily:mono, color:t3, marginBottom:"4px" }}>Free buffer</div>
                    <div style={{ fontSize:"22px", fontWeight:700,
                      color: stale ? t3 : underwater ? "#e03348" : (payoutBal.free != null && payoutBal.free < 10 ? "#d7c160" : "#00b87a"),
                      fontFamily:mono }}>
                      {stale
                        ? "—"
                        : `${underwater ? "−" : ""}$${fmt(Math.abs(payoutBal.free ?? 0))}`}
                    </div>
                  </div>
                </div>

                {stale && (
                  <div style={{ marginBottom:"12px", fontSize:"11px", color:tone, lineHeight:1.5 }}>
                    Couldn't read the live balance from Arcscan ({payoutBal.fetchError || "unknown"}). The wallet is unchanged — just the read failed. Refresh in a few seconds to try again.
                  </div>
                )}

                <div style={{ display:"flex", alignItems:"center", gap:"8px", padding:"8px 12px", background:surf2, border:"1px solid "+bdr, borderRadius:"8px", marginBottom:(crit||low||underwater) ? "12px" : 0 }}>
                  <span style={{ fontSize:"10px", fontFamily:mono, color:t3 }}>SEND USDC TO →</span>
                  <code style={{ fontSize:"11px", fontFamily:mono, color:t1, flex:1, overflow:"hidden", textOverflow:"ellipsis" }}>{payoutBal.address}</code>
                  <button onClick={async () => { await navigator.clipboard.writeText(payoutBal.address); setCopiedAddr(true); setTimeout(() => setCopiedAddr(false), 1500) }}
                    style={{ height:"26px", padding:"0 12px", background:"transparent", border:"1px solid "+bdr, borderRadius:"6px", color:t2, fontSize:"10px", fontFamily:mono, cursor:"pointer" }}>
                    {copiedAddr ? "✓ copied" : "copy"}
                  </button>
                </div>

                {underwater && (
                  <div style={{ fontSize:"11px", color:tone, lineHeight:1.5 }}>
                    Wallet is underwater. Committed payouts (${fmt(payoutBal.committed)}) exceed the on-hand balance (${fmt(payoutBal.usdc)}). Top up USDC now or some testers won't be able to claim.
                  </div>
                )}
                {!underwater && crit && (
                  <div style={{ fontSize:"11px", color:tone, lineHeight:1.5 }}>
                    USDC balance is below ${payoutBal.thresholds.crit}. Both reward payouts and gas come out of this balance, so payouts will start failing soon. Top up the address above.
                  </div>
                )}
                {!underwater && !crit && low && (
                  <div style={{ fontSize:"11px", color:tone, lineHeight:1.5 }}>
                    USDC balance is below ${payoutBal.thresholds.low}. Top up soon to keep gas + payouts comfortable.
                  </div>
                )}
              </div>
            )
          })()}

          {loading && !loadedOnce ? (
            <div style={{ padding:"60px", textAlign:"center", fontFamily:mono, fontSize:"11px", color:t3 }}>Loading...</div>
          ) : (
            <>
              {/* ── PENDING SUBMISSIONS ── */}
              {tab === "pending" && (
                <div>
                  {submissions.length === 0 && contracts.filter(c=>!c.verified).length === 0 ? (
                    <EmptyState icon="✓" title="All caught up" sub="No pending project submissions" />
                  ) : (
                    <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
                      <input
                        value={search} onChange={e => setSearch(e.target.value)}
                        placeholder="Search by name or reference (ARC-XXXXX)..."
                        style={{ height:"36px", background:surf2, border:"1px solid "+bdr, borderRadius:"8px", padding:"0 12px", fontSize:"12px", fontFamily:mono, color:t1, outline:"none", width:"100%", boxSizing:"border-box" as const }}
                      />
                      {submissions.filter((s:any) => matchesSearch(s, search)).map((s: any) => (
                        <div key={s.id}>
                        <div style={{ background:surf, border:"1px solid "+bdr, borderRadius:"12px", padding:"18px 22px", display:"flex", alignItems:"center", gap:"16px" }}>
                          <div style={{ width:"44px", height:"44px", borderRadius:"10px", background:"rgba(26,86,255,0.08)", border:"1px solid rgba(26,86,255,0.15)", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden" }}>
                            {s.logo_url
                              ? <img src={`/api/image-proxy?url=${encodeURIComponent(s.logo_url)}`} alt={s.name} style={{ width:"100%", height:"100%", objectFit:"cover" }} onError={e=>(e.currentTarget.style.display="none")} />
                              : <span style={{ fontSize:"16px", fontWeight:700, color:"#8aaeff" }}>{s.name?.[0]}</span>
                            }
                          </div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:"14px", fontWeight:600, color:t1, marginBottom:"2px" }}>{s.name}</div>
                            <div style={{ fontSize:"12px", color:t2, marginBottom:"4px" }}>{s.tagline}</div>
                            <div style={{ display:"flex", gap:"8px", flexWrap:"wrap" }}>
                              <span style={pill(t3, bdr)}>{s.category}</span>
                              <span style={pill(t3, bdr)}>{s.email || "No email"}</span>
                              {s.website && <span style={pill(t3, bdr)}>{s.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>}
                              {s.submission_ref && <span style={pill("#8aaeff","rgba(26,86,255,0.3)")}>{s.submission_ref}</span>}
                              {s.website && urlRepChip(s.website)}
                              {s.contract && <span style={pill(t3, bdr)}>{s.contract.slice(0,6)}…{s.contract.slice(-4)}</span>}
                              <span style={pill(t3, bdr)}>{new Date(s.created_at).toLocaleString(undefined,{ day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })}</span>
                            </div>
                            {s.founder_social
                              ? <div style={{ fontSize:"11px", fontFamily:mono, color:"#8aaeff", marginTop:"6px" }}>Founder: {s.founder_social}</div>
                              : <div style={{ fontSize:"11px", fontFamily:mono, color:t3, marginTop:"6px" }}>Founder: not provided</div>}
                            {s.description && <div style={{ fontSize:"11.5px", color:t2, marginTop:"6px", lineHeight:1.5 }}>{s.description}</div>}
                          </div>
                          <div style={{ display:"flex", gap:"8px", flexShrink:0 }}>
                            <ActionBtn onClick={() => act(s.id, "approve")} disabled={acting} color="green">Approve</ActionBtn>
                            <ActionBtn onClick={() => startEdit(s)} color="blue">Edit</ActionBtn>
                            <ActionBtn onClick={() => { setRejectingProjectId(s.id); setRejectProjectReason("") }} disabled={acting} color="red">Reject</ActionBtn>
                          </div>
                        </div>
                        {rejectingProjectId === s.id && (
                          <div style={{ borderTop:"1px solid rgba(224,51,72,0.15)", padding:"14px 22px 18px", background:"rgba(224,51,72,0.03)" }}>
                            <div style={{ fontSize:"10px", fontFamily:mono, color:"#e03348", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"8px" }}>Rejection reason (sent to builder)</div>
                            <select
                              value={rejectProjectReason}
                              onChange={e => setRejectProjectReason(e.target.value)}
                              style={{ width:"100%", background:surf2, border:"1px solid rgba(224,51,72,0.2)", borderRadius:"7px", padding:"8px 12px", fontSize:"12px", fontFamily:mono, color:rejectProjectReason ? t1 : t3, outline:"none", marginBottom:"8px", boxSizing:"border-box" as const }}
                            >
                              <option value="">Select a reason or type below...</option>
                              <option value="ArcLens requires a website on a domain your project owns. Free hosting subdomains (vercel.app, netlify.app, github.io and similar) are not accepted. Point your site at a domain you own and resubmit.">No project-owned domain</option>
                              <option value="Project does not appear to be deployed or active on Arc Testnet.">Not deployed or active on Arc Testnet</option>
                              <option value="Your website was flagged as suspicious or malicious by one or more security scanners. Resolve the flag with the scanning vendors (or move to a clean domain), then resubmit — we cannot list projects whose sites security tools warn users about.">Website flagged by security scanners</option>
                              <option value="Insufficient project information — missing website, description, or verifiable links.">Insufficient information</option>
                              <option value="Logo or branding does not meet listing standards.">Logo or branding quality</option>
                              <option value="Project category or description appears misleading.">Misleading category or description</option>
                              <option value="A duplicate or near-identical listing already exists.">Duplicate listing</option>
                            </select>
                            <textarea
                              value={rejectProjectReason}
                              onChange={e => setRejectProjectReason(e.target.value)}
                              placeholder="Or write a custom reason..."
                              rows={2}
                              style={{ width:"100%", background:surf2, border:"1px solid rgba(224,51,72,0.2)", borderRadius:"7px", padding:"8px 12px", fontSize:"12px", fontFamily:mono, color:t1, outline:"none", resize:"vertical", lineHeight:1.6, boxSizing:"border-box" as const, marginBottom:"10px" }}
                            />
                            <div style={{ display:"flex", gap:"8px" }}>
                              <button
                                onClick={() => { act(s.id, "reject", "projects", { reason: rejectProjectReason }); setRejectingProjectId(null) }}
                                disabled={acting}
                                style={{ height:"30px", padding:"0 16px", background:"rgba(224,51,72,0.12)", color:"#e03348", fontSize:"11px", border:"1px solid rgba(224,51,72,0.3)", borderRadius:"5px", cursor:"pointer", fontWeight:600, opacity:acting?.6:1 }}>
                                Confirm Reject
                              </button>
                              <button onClick={() => setRejectingProjectId(null)}
                                style={{ height:"30px", padding:"0 14px", background:"transparent", color:t2, fontSize:"11px", border:"1px solid "+bdr, borderRadius:"5px", cursor:"pointer" }}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── PENDING UPDATES ── */}
              {tab === "updates" && (() => {
                // Group all pending field changes by project so admin makes one decision per project
                const groups: Record<number, { project_id: number; project_name: string; project_slug: string; submitted_at: string; fields: any[] }> = {}
                for (const u of pendingUpdates as any[]) {
                  if (!groups[u.project_id]) {
                    groups[u.project_id] = { project_id: u.project_id, project_name: u.project_name, project_slug: u.project_slug, submitted_at: u.submitted_at, fields: [] }
                  }
                  groups[u.project_id].fields.push(u)
                }
                const groupList = Object.values(groups)
                return (
                  <div>
                    {groupList.length === 0 ? (
                      <EmptyState icon="✓" title="No pending updates" sub="Founder listing changes will appear here" />
                    ) : (
                      <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
                        {groupList.map(g => (
                          <div key={g.project_id} style={{ background:surf, border:"1px solid "+bdr, borderRadius:"12px", padding:"18px 22px" }}>
                            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"14px", flexWrap:"wrap", gap:"8px" }}>
                              <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
                                <span style={{ fontSize:"14px", fontWeight:600, color:t1 }}>{g.project_name}</span>
                                <span style={{ fontSize:"10px", fontFamily:mono, color:"#8aaeff", padding:"2px 8px", background:"rgba(26,86,255,0.1)", borderRadius:"4px", border:"1px solid rgba(26,86,255,0.2)" }}>
                                  {g.fields.length} field{g.fields.length !== 1 ? "s" : ""} changed
                                </span>
                              </div>
                              <span style={{ fontSize:"10px", fontFamily:mono, color:t3 }}>{new Date(g.submitted_at).toLocaleDateString()}</span>
                            </div>

                            {/* All field changes stacked */}
                            <div style={{ display:"flex", flexDirection:"column", gap:"8px", marginBottom:"14px" }}>
                              {g.fields.map((u: any) => (
                                <div key={u.id} style={{ display:"grid", gridTemplateColumns:"90px 1fr 1fr", gap:"8px", alignItems:"start" }}>
                                  <span style={{ fontSize:"9px", fontFamily:mono, color:"#8aaeff", padding:"4px 0", textAlign:"center", background:"rgba(26,86,255,0.08)", borderRadius:"5px", border:"1px solid rgba(26,86,255,0.18)" }}>
                                    {u.field}
                                  </span>
                                  <div style={{ padding:"7px 10px", background:"rgba(224,51,72,0.04)", border:"1px solid rgba(224,51,72,0.12)", borderRadius:"6px" }}>
                                    <div style={{ fontSize:"8px", fontFamily:mono, color:"#e03348", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"3px" }}>Current</div>
                                    <div style={{ fontSize:"11px", color:t2, wordBreak:"break-all", lineHeight:1.4 }}>{u.old_value || "—"}</div>
                                  </div>
                                  <div style={{ padding:"7px 10px", background:"rgba(0,184,122,0.04)", border:"1px solid rgba(0,184,122,0.12)", borderRadius:"6px" }}>
                                    <div style={{ fontSize:"8px", fontFamily:mono, color:"#00b87a", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"3px" }}>Proposed</div>
                                    <div style={{ fontSize:"11px", color:t1, wordBreak:"break-all", lineHeight:1.4 }}>{u.new_value}</div>
                                  </div>
                                </div>
                              ))}
                            </div>

                            <div style={{ marginBottom:"10px" }}>
                              <input
                                id={`pu-reason-${g.project_id}`}
                                type="text"
                                placeholder="Rejection reason (optional — sent to founder by email)"
                                style={{ width:"100%", height:"34px", background:surf2, border:"1px solid "+bdr, borderRadius:"7px", padding:"0 12px", fontSize:"12px", color:t1, outline:"none", boxSizing:"border-box" as const, fontFamily:mono }}
                              />
                            </div>
                            <div style={{ display:"flex", gap:"8px" }}>
                              <ActionBtn onClick={() => act(g.project_id, "approve-all-updates")} disabled={acting} color="green">Apply All Changes</ActionBtn>
                              <ActionBtn onClick={() => act(g.project_id, "reject-all-updates", "projects", { reason: (document.getElementById(`pu-reason-${g.project_id}`) as HTMLInputElement)?.value || "" })} disabled={acting} color="red">Reject All</ActionBtn>
                              <a href={`/ecosystem/${g.project_slug}`} target="_blank" rel="noopener noreferrer"
                                style={{ height:"32px", padding:"0 14px", display:"flex", alignItems:"center", background:"transparent", color:"#8aaeff", fontSize:"12px", border:"1px solid rgba(26,86,255,0.2)", borderRadius:"6px", textDecoration:"none" }}>
                                View Project ↗
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* ── CAMPAIGN EDIT REQUESTS ── */}
              {tab === "campaign-updates" && (
                <div>
                  {pendingCampaignUpdates.length === 0 ? (
                    <EmptyState icon="✓" title="No campaign edit requests" sub="Founder campaign change requests will appear here for review" />
                  ) : (
                    <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
                      {pendingCampaignUpdates.map((u: any) => {
                        const ch = u.proposed_changes as Record<string, any>
                        return (
                          <div key={u.id} style={{ background:surf, border:"1px solid "+bdr, borderRadius:"12px", padding:"18px 22px" }}>
                            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"12px", flexWrap:"wrap", gap:"8px" }}>
                              <div>
                                <span style={{ fontSize:"14px", fontWeight:600, color:t1 }}>{u.campaign_title}</span>
                                <span style={{ fontSize:"10px", fontFamily:mono, color:t3, marginLeft:"8px" }}>Campaign #{u.campaign_id}</span>
                              </div>
                              <span style={{ fontSize:"10px", fontFamily:mono, color:t3 }}>{new Date(u.submitted_at).toLocaleDateString()}</span>
                            </div>
                            <div style={{ display:"flex", flexDirection:"column", gap:"8px", marginBottom:"14px" }}>
                              {Object.entries(ch).map(([field, value]) => (
                                <div key={field} style={{ display:"grid", gridTemplateColumns:"120px 1fr", gap:"10px", alignItems:"start" }}>
                                  <span style={{ fontSize:"10px", fontFamily:mono, color:"#8aaeff", padding:"3px 8px", background:"rgba(26,86,255,0.1)", borderRadius:"4px", border:"1px solid rgba(26,86,255,0.2)", textAlign:"center", height:"fit-content" }}>{field}</span>
                                  {/* Render arrays of objects (tasks / review_questions) as a
                                      readable list instead of "[object Object]". */}
                                  {Array.isArray(value) ? (
                                    <div style={{ display:"flex", flexDirection:"column", gap:"4px" }}>
                                      {value.map((item: any, i: number) => (
                                        <div key={i} style={{ fontSize:"11px", color:t1, padding:"5px 8px", background:"rgba(0,184,122,0.04)", border:"1px solid rgba(0,184,122,0.12)", borderRadius:"4px", lineHeight:1.5 }}>
                                          {(item && typeof item === "object") ? (
                                            <>
                                              <span style={{ color:t3, fontFamily:mono, fontSize:"9px", marginRight:"6px" }}>{i + 1}.</span>
                                              <span style={{ fontWeight:600 }}>{item.title || item.label || item.id || "(untitled)"}</span>
                                              {item.proof_type && item.proof_type !== "none" && (
                                                <span style={{ color:"#8aaeff", fontFamily:mono, fontSize:"9px", marginLeft:"6px" }}>· proof: {item.proof_type}</span>
                                              )}
                                              {item.contract_address && (
                                                <span style={{ color:"#00d990", fontFamily:mono, fontSize:"9px", marginLeft:"6px" }}>· {String(item.contract_address).slice(0,10)}…</span>
                                              )}
                                              {item.xp_value != null && (
                                                <span style={{ color:"#c08828", fontFamily:mono, fontSize:"9px", marginLeft:"6px" }}>· {item.xp_value} XP</span>
                                              )}
                                              {(item.description || item.placeholder) && (
                                                <div style={{ color:t2, fontSize:"10px", marginTop:"2px", marginLeft:"16px" }}>{item.description || item.placeholder}</div>
                                              )}
                                            </>
                                          ) : String(item)}
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <span style={{ fontSize:"12px", color:t1, padding:"3px 8px", background:"rgba(0,184,122,0.04)", border:"1px solid rgba(0,184,122,0.12)", borderRadius:"4px", wordBreak:"break-all" }}>{String(value)}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                            <div style={{ fontSize:"10px", fontFamily:mono, color:t3, marginBottom:"12px" }}>
                              Requested by: {u.requester_wallet?.slice(0,10)}...{u.requester_wallet?.slice(-6)}
                            </div>
                            <div style={{ marginBottom:"10px" }}>
                              <input
                                id={`cu-reason-${u.id}`}
                                type="text"
                                placeholder="Rejection reason (optional — sent to founder by email)"
                                style={{ width:"100%", height:"34px", background:surf2, border:"1px solid "+bdr, borderRadius:"7px", padding:"0 12px", fontSize:"12px", color:t1, outline:"none", boxSizing:"border-box" as const, fontFamily:mono }}
                              />
                            </div>
                            <div style={{ display:"flex", gap:"8px" }}>
                              <ActionBtn onClick={() => act(u.id, "approve-campaign-update")} disabled={acting} color="green">Apply Changes</ActionBtn>
                              <ActionBtn onClick={() => act(u.id, "reject-campaign-update", "projects", { reason: (document.getElementById(`cu-reason-${u.id}`) as HTMLInputElement)?.value || "" })} disabled={acting} color="red">Reject</ActionBtn>
                              <a href={`/trials/${u.campaign_id}`} target="_blank" rel="noopener noreferrer"
                                style={{ height:"32px", padding:"0 14px", display:"flex", alignItems:"center", background:"transparent", color:"#8aaeff", fontSize:"12px", border:"1px solid rgba(26,86,255,0.2)", borderRadius:"6px", textDecoration:"none" }}>
                                View Campaign ↗
                              </a>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── ALL PROJECTS ── */}
              {tab === "projects" && (
                <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
                  <input
                    value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Search by name or reference (ARC-XXXXX)..."
                    style={{ height:"36px", background:surf2, border:"1px solid "+bdr, borderRadius:"8px", padding:"0 12px", fontSize:"12px", fontFamily:mono, color:t1, outline:"none", width:"100%", boxSizing:"border-box" as const }}
                  />
                  {/* Hidden listings (live = false) stay in this list but were only
                      distinguishable by the ABSENCE of a Live pill, which is invisible
                      across 300+ rows. This filter makes taken-down listings findable
                      so they can be reviewed and restored. */}
                  <div style={{ display:"flex", gap:"6px", flexWrap:"wrap" }}>
                    {([["all","All"],["live","Live"],["hidden","Hidden"],["flagged","Flagged"]] as const).map(([k,l]) => {
                      const n = k === "all"     ? projects.length
                              : k === "live"    ? projects.filter((p:any)=>p.live).length
                              : k === "hidden"  ? projects.filter((p:any)=>!p.live).length
                              :                   projects.filter((p:any)=>isFlagged(p.website)).length
                      const on   = liveFilter === k
                      // Flagged is a warning, not a neutral filter — colour it so a
                      // non-zero count is noticeable without opening the tab.
                      const warn = k === "flagged" && n > 0
                      const bg   = on ? (warn ? "#c04545" : "#1a56ff") : "transparent"
                      const fg   = on ? "#fff" : (warn ? "#e05a5a" : t2)
                      const bc   = on ? bg : (warn ? "rgba(224,90,90,0.4)" : bdr)
                      return (
                        <button key={k} onClick={() => setLiveFilter(k)}
                          style={{ height:"28px", padding:"0 12px", background:bg, color:fg,
                                   fontSize:"11px", fontFamily:mono, border:"1px solid "+bc, borderRadius:"99px", cursor:"pointer" }}>
                          {l} · {n}
                        </button>
                      )
                    })}
                  </div>
                  {projects.length === 0 ? (
                    <div style={{ padding:"48px", textAlign:"center", fontFamily:mono, fontSize:"11px", color:t3 }}>No approved projects yet</div>
                  ) : projects
                      .filter((p:any) => matchesSearch(p, search))
                      .filter((p:any) => liveFilter === "all"    ? true
                                       : liveFilter === "live"   ? p.live
                                       : liveFilter === "hidden" ? !p.live
                                       :                           isFlagged(p.website))
                      // Worst offenders first when reviewing flags; newest first otherwise.
                      .sort((a:any, b:any) => liveFilter === "flagged"
                        ? flagScore(b.website) - flagScore(a.website)
                        : new Date(b.created_at||0).getTime() - new Date(a.created_at||0).getTime())
                      .map((p: any) => (
                    <div key={p.id} style={{ background:surf, border:"1px solid "+bdr, borderRadius:"10px", padding:"14px 18px", display:"flex", alignItems:"center", gap:"14px" }}>
                      <div style={{ width:"38px", height:"38px", borderRadius:"8px", background:"rgba(26,86,255,0.06)", border:"1px solid "+bdr, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden" }}>
                        {p.logo_url
                          ? <img src={`/api/image-proxy?url=${encodeURIComponent(p.logo_url!)}`} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} onError={e=>(e.currentTarget.style.display="none")} />
                          : <span style={{ fontSize:"13px", fontWeight:700, color:t3 }}>{p.name?.[0]}</span>
                        }
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:"6px", marginBottom:"2px" }}>
                          <span style={{ fontSize:"13px", fontWeight:600, color:t1 }}>{p.name}</span>
                          {p.submission_ref && <span style={{ ...pill("#8aaeff","rgba(26,86,255,0.3)"), fontFamily:mono }}>{p.submission_ref}</span>}
                          {p.badge && <span style={pill("#8aaeff","rgba(26,86,255,0.2)")}>{p.badge}</span>}
                          {p.featured && <span style={pill("#c08828","rgba(192,136,40,0.2)")}>Featured</span>}
                          {p.live
                            ? <span style={pill("#00b87a","rgba(0,184,122,0.2)")}>Live</span>
                            : <span style={pill("#e05a5a","rgba(224,90,90,0.2)")}>Hidden</span>}
                        </div>
                        <div style={{ fontSize:"11px", color:t2, display:"flex", alignItems:"center", gap:"8px", flexWrap:"wrap" }}>
                          <span>{p.category} · {p.website || "No website"}</span>
                          {p.created_at && (
                            <span style={{ fontFamily:mono, color:t3 }} title={new Date(p.created_at).toLocaleString()}>
                              {new Date(p.created_at).toLocaleDateString(undefined,{ day:"2-digit", month:"short", year:"numeric" })}
                              {", "}
                              {new Date(p.created_at).toLocaleTimeString(undefined,{ hour:"2-digit", minute:"2-digit" })}
                            </span>
                          )}
                          {p.website && urlRepChip(p.website)}
                        </div>
                      </div>
                      <div style={{ display:"flex", gap:"6px", flexShrink:0 }}>
                        <ActionBtn onClick={() => startEdit(p)} color="blue">Edit</ActionBtn>
                        {p.live
                          ? <ActionBtn onClick={() => setHideFor(p)} disabled={acting} color="red">Hide</ActionBtn>
                          : <>
                              <ActionBtn onClick={() => setRestoreFor(p)} disabled={acting} color="green">Restore</ActionBtn>
                              {/* Already hidden but never told why — re-runs the hide action,
                                  which is a no-op on state and sends the explanation email. */}
                              <ActionBtn onClick={() => setHideFor(p)} disabled={acting} color="blue">Notify</ActionBtn>
                            </>}
                        <ActionBtn onClick={() => confirmDelete(p.id, "projects")} disabled={acting} color="red">Delete</ActionBtn>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── CONTRACTS ── */}
              {tab === "contracts" && (
                <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
                  {contracts.length === 0 ? (
                    <div style={{ padding:"48px", textAlign:"center", fontFamily:mono, fontSize:"11px", color:t3 }}>No contract submissions</div>
                  ) : contracts.map((c: any) => (
                    <div key={c.address} style={{ background:surf, border:"1px solid "+bdr, borderRadius:"10px", overflow:"hidden" }}>
                      <div style={{ padding:"14px 18px", display:"flex", alignItems:"center", gap:"14px" }}>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:"6px", marginBottom:"3px" }}>
                            <span style={{ fontSize:"13px", fontWeight:600, color:t1 }}>{c.name}</span>
                            {c.verified && <span style={pill("#00b87a","rgba(0,184,122,0.2)")}>Verified</span>}
                            {c.flag_reason && <span style={pill("#e08810","rgba(224,136,16,0.2)")}>⚠ Flagged</span>}
                          </div>
                          <div style={{ fontSize:"10.5px", fontFamily:mono, color:"#8aaeff", marginBottom:"2px" }}>{c.address}</div>
                          <div style={{ fontSize:"10px", fontFamily:mono, color:t3 }}>{c.type} · {c.email || "No email"} · {new Date(c.created_at).toLocaleDateString()}</div>
                          {c.flag_reason && <div style={{ fontSize:"10px", fontFamily:mono, color:"#e08810", marginTop:"3px" }}>{c.flag_reason}</div>}
                        </div>
                        <div style={{ display:"flex", gap:"6px", flexShrink:0 }}>
                          <button onClick={() => setExpandedContract(expandedContract === c.address ? null : c.address)}
                            style={{ height:"30px", padding:"0 10px", background:"transparent", color:t2, fontSize:"11px", border:"1px solid "+bdr, borderRadius:"5px", cursor:"pointer", fontFamily:mono }}>
                            {expandedContract === c.address ? "Hide ▲" : "Review ▼"}
                          </button>
                          {!c.verified && <ActionBtn onClick={() => act(c.address, "approve", "contracts")} disabled={acting} color="green">Approve</ActionBtn>}
                          <a href={"/address/"+c.address} target="_blank" rel="noopener noreferrer"
                            style={{ height:"30px", padding:"0 10px", display:"flex", alignItems:"center", background:"transparent", color:"#8aaeff", fontSize:"11px", border:"1px solid rgba(26,86,255,0.2)", borderRadius:"5px", textDecoration:"none" }}>
                            View ↗
                          </a>
                          <ActionBtn onClick={() => confirmDelete(c.address, "contracts")} disabled={acting} color="red">Delete</ActionBtn>
                        </div>
                      </div>
                      {expandedContract === c.address && (
                        <div style={{ borderTop:"1px solid "+bdr, padding:"14px 18px", background:"rgba(0,0,0,0.2)" }}>
                          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px", marginBottom:"10px" }}>
                            {[{label:"Deployer",value:c.deployer},{label:"Website",value:c.website},{label:"Twitter",value:c.twitter},{label:"Email",value:c.email}].map(f => (
                              <div key={f.label}>
                                <div style={{ fontSize:"9px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"3px" }}>{f.label}</div>
                                <div style={{ fontSize:"11px", fontFamily:mono, color:f.value?t1:t3, wordBreak:"break-all" }}>{f.value||"—"}</div>
                              </div>
                            ))}
                          </div>
                          {c.description && <div style={{ fontSize:"12px", color:t2, lineHeight:1.6, marginBottom:"10px" }}>{c.description}</div>}
                          {c.source_code ? (
                            <pre style={{ fontSize:"10px", fontFamily:mono, color:"#6b7da8", background:"rgba(0,0,0,0.3)", border:"1px solid "+bdr, borderRadius:"6px", padding:"10px", maxHeight:"140px", overflowY:"auto", whiteSpace:"pre-wrap", wordBreak:"break-all", margin:0 }}>
                              {c.source_code.slice(0,800)}{c.source_code.length>800?"\n\n... [truncated]":""}
                            </pre>
                          ) : (
                            <div style={{ fontSize:"10px", fontFamily:mono, color:t3 }}>No source code submitted</div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* ── EVENTS ── */}
              {tab === "events" && (
                <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
                  <div style={{ display:"flex", justifyContent:"flex-end" }}>
                    <button onClick={() => setShowEventForm(!showEventForm)}
                      style={{ height:"34px", padding:"0 16px", background:showEventForm?"transparent":"#1a56ff", color:showEventForm?t2:"#fff", fontSize:"12px", fontWeight:600, border:"1px solid "+(showEventForm?bdr:"#1a56ff"), borderRadius:"7px", cursor:"pointer", fontFamily:"'Geist',sans-serif" }}>
                      {showEventForm ? "Cancel" : "+ Create Official Event"}
                    </button>
                  </div>

                  {showEventForm && (
                    <div style={{ background:surf, border:"1px solid rgba(26,86,255,0.25)", borderRadius:"12px", overflow:"hidden", marginBottom:"4px" }}>
                      <div style={{ padding:"14px 20px", borderBottom:"1px solid "+bdr, display:"flex", alignItems:"center", gap:"8px" }}>
                        <span style={pill("#8aaeff","rgba(26,86,255,0.25)")}>🔵 OFFICIAL</span>
                        <span style={{ fontSize:"13px", fontWeight:600, color:t1 }}>Create Official Event</span>
                        <span style={{ fontSize:"11px", color:t2 }}>— auto-approved and marked official</span>
                      </div>
                      <div style={{ padding:"20px", display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px" }}>
                        <div style={{ gridColumn:"1 / -1", display:"flex", alignItems:"center", gap:"16px" }}>
                          <label style={{ cursor:"pointer" }}>
                            <div style={{ width:"72px", height:"72px", borderRadius:"10px", border:"2px dashed rgba(26,86,255,0.3)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", overflow:"hidden", background:eventLogoPreview?"transparent":"rgba(26,86,255,0.04)", flexShrink:0 }}>
                              {eventLogoPreview
                                ? <img src={eventLogoPreview} alt="logo" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                                : <><div style={{ fontSize:"20px", color:t3 }}>+</div><div style={{ fontSize:"8px", fontFamily:mono, color:t3 }}>{eventLogoUploading?"...":"Logo"}</div></>
                              }
                            </div>
                            <input type="file" accept="image/*" style={{ display:"none" }} onChange={e=>{const f=e.target.files?.[0];if(f)uploadEventLogo(f)}} />
                          </label>
                          <div>
                            <div style={{ fontSize:"11px", color:t2, marginBottom:"4px" }}>Event Logo</div>
                            <div style={{ fontSize:"10px", fontFamily:mono, color:t3, lineHeight:1.6 }}>Click to upload · PNG, JPG, SVG<br/>Displayed on the events page</div>
                            {eventForm.logo_url && <div style={{ fontSize:"10px", fontFamily:mono, color:"#00b87a", marginTop:"4px" }}>✓ Uploaded</div>}
                          </div>
                        </div>
                        {[
                          {k:"name",l:"Event Name *",p:"Arc Hackathon 2025"},
                          {k:"tagline",l:"Tagline",p:"One-line description"},
                          {k:"organizer",l:"Organizer",p:"Arc Foundation"},
                          {k:"organizer_twitter",l:"Organizer Twitter",p:"@arclabs"},
                          {k:"link",l:"Event Link *",p:"https://..."},
                          {k:"email",l:"Contact Email",p:"events@arc.network"},
                        ].map((f:any) => (
                          <div key={f.k}>
                            <label style={{ display:"block", fontSize:"9.5px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"5px" }}>{f.l}</label>
                            <input value={(eventForm as any)[f.k]} onChange={e=>setEventForm(p=>({...p,[f.k]:e.target.value}))} placeholder={f.p}
                              style={{ width:"100%", height:"36px", background:surf2, border:"1px solid "+bdr, borderRadius:"7px", padding:"0 12px", fontSize:"12px", fontFamily:mono, color:t1, outline:"none", boxSizing:"border-box" as const }} />
                          </div>
                        ))}
                        <div>
                          <label style={{ display:"block", fontSize:"9.5px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"5px" }}>Event Type</label>
                          <select value={eventForm.type} onChange={e=>setEventForm(p=>({...p,type:e.target.value}))}
                            style={{ width:"100%", height:"36px", background:surf2, border:"1px solid "+bdr, borderRadius:"7px", padding:"0 10px", fontSize:"12px", fontFamily:mono, color:t1, outline:"none" }}>
                            {["Hackathon","Conference","Workshop","Office Hours","AMA","Demo Day","Community Call","Twitter Space","Grant Round","Governance Vote","Meetup","Webinar","Launch","Ecosystem Sprint","Other"].map(t=><option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <div>
                          <label style={{ display:"block", fontSize:"9.5px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"5px" }}>Timezone</label>
                          <select value={eventForm.timezone} onChange={e=>setEventForm(p=>({...p,timezone:e.target.value}))}
                            style={{ width:"100%", height:"36px", background:surf2, border:"1px solid "+bdr, borderRadius:"7px", padding:"0 10px", fontSize:"12px", fontFamily:mono, color:t1, outline:"none" }}>
                            {["UTC","America/New_York","America/Los_Angeles","Europe/London","Europe/Berlin","Asia/Dubai","Asia/Singapore","Asia/Tokyo"].map(tz=><option key={tz} value={tz}>{tz}</option>)}
                          </select>
                        </div>
                        <div>
                          <label style={{ display:"block", fontSize:"9.5px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"5px" }}>Start Date & Time *</label>
                          <input type="datetime-local" value={eventForm.date} onChange={e=>setEventForm(p=>({...p,date:e.target.value}))}
                            style={{ width:"100%", height:"36px", background:surf2, border:"1px solid "+bdr, borderRadius:"7px", padding:"0 12px", fontSize:"12px", fontFamily:mono, color:t1, outline:"none", boxSizing:"border-box" as const }} />
                        </div>
                        <div>
                          <label style={{ display:"block", fontSize:"9.5px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"5px" }}>End Date & Time</label>
                          <input type="datetime-local" value={eventForm.end_date} onChange={e=>setEventForm(p=>({...p,end_date:e.target.value}))}
                            style={{ width:"100%", height:"36px", background:surf2, border:"1px solid "+bdr, borderRadius:"7px", padding:"0 12px", fontSize:"12px", fontFamily:mono, color:t1, outline:"none", boxSizing:"border-box" as const }} />
                        </div>
                        <div>
                          <label style={{ display:"block", fontSize:"9.5px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"5px" }}>Location</label>
                          <input value={eventForm.location} onChange={e=>setEventForm(p=>({...p,location:e.target.value}))} placeholder="City, Country or Online"
                            style={{ width:"100%", height:"36px", background:surf2, border:"1px solid "+bdr, borderRadius:"7px", padding:"0 12px", fontSize:"12px", fontFamily:mono, color:t1, outline:"none", boxSizing:"border-box" as const }} />
                        </div>
                        <div style={{ display:"flex", alignItems:"center" }}>
                          <label style={{ display:"flex", alignItems:"center", gap:"10px", cursor:"pointer", fontSize:"12px", color:t2 }}>
                            <input type="checkbox" checked={eventForm.is_online} onChange={e=>setEventForm(p=>({...p,is_online:e.target.checked}))} />
                            Online / Virtual Event
                          </label>
                        </div>
                        <div style={{ gridColumn:"1 / -1" }}>
                          <label style={{ display:"block", fontSize:"9.5px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"5px" }}>Description</label>
                          <textarea value={eventForm.description} onChange={e=>setEventForm(p=>({...p,description:e.target.value}))} placeholder="What is this event about?"
                            style={{ width:"100%", height:"72px", background:surf2, border:"1px solid "+bdr, borderRadius:"7px", padding:"8px 12px", fontSize:"12px", fontFamily:mono, color:t1, outline:"none", resize:"vertical", boxSizing:"border-box" as const, lineHeight:1.6 }} />
                        </div>
                      </div>
                      <div style={{ padding:"0 20px 20px" }}>
                        <button onClick={createOfficialEvent} disabled={creatingEvent}
                          style={{ height:"38px", padding:"0 24px", background:"#1a56ff", color:"#fff", fontSize:"13px", fontWeight:600, border:"none", borderRadius:"8px", cursor:creatingEvent?"not-allowed":"pointer", fontFamily:"'Geist',sans-serif", opacity:creatingEvent?.7:1 }}>
                          {creatingEvent?"Creating...":"Create & Publish Official Event"}
                        </button>
                      </div>
                    </div>
                  )}

                  {events.map((e: any) => (
                    <div key={e.id} style={{ background:surf, border:"1px solid "+bdr, borderRadius:"10px", padding:"14px 18px", display:"flex", alignItems:"center", gap:"14px" }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:"6px", marginBottom:"3px", flexWrap:"wrap" }}>
                          <span style={{ fontSize:"13px", fontWeight:600, color:t1 }}>{e.name}</span>
                          {e.approved && <span style={pill("#00b87a","rgba(0,184,122,0.2)")}>Live</span>}
                          {!e.approved && <span style={pill("#e08810","rgba(224,136,16,0.2)")}>Pending</span>}
                          {e.featured && <span style={pill("#c08828","rgba(192,136,40,0.2)")}>Featured</span>}
                          {e.badge==="official" && <span style={pill("#8aaeff","rgba(26,86,255,0.2)")}>🔵 Official</span>}
                        </div>
                        <div style={{ fontSize:"10px", fontFamily:mono, color:t3 }}>
                          {e.type} · {e.date?new Date(e.date).toLocaleDateString():"No date"} · {e.is_online?"Online":e.location||"No location"}
                        </div>
                        {e.organizer && <div style={{ fontSize:"10px", fontFamily:mono, color:t2, marginTop:"2px" }}>by {e.organizer}{e.organizer_twitter?` · ${e.organizer_twitter}`:""}</div>}
                      </div>
                      <div style={{ display:"flex", gap:"6px", flexShrink:0, flexWrap:"wrap" }}>
                        {!e.approved && <ActionBtn onClick={() => act(e.id, "approve", "events")} disabled={acting} color="green">Approve</ActionBtn>}
                        <button onClick={() => act(e.id, "feature-event", "events")} disabled={acting}
                          style={{ height:"30px", padding:"0 10px", background:e.featured?"rgba(192,136,40,0.1)":"transparent", color:e.featured?"#c08828":t2, fontSize:"11px", border:"1px solid "+(e.featured?"rgba(192,136,40,0.2)":bdr), borderRadius:"5px", cursor:"pointer", fontFamily:"'Geist',sans-serif" }}>
                          {e.featured?"Unfeature":"Feature"}
                        </button>
                        <button onClick={() => act(e.id, "badge-event", "events", { badge: e.badge==="official"?"community":"official" } as any)} disabled={acting}
                          style={{ height:"30px", padding:"0 10px", background:e.badge==="official"?"rgba(26,86,255,0.1)":"transparent", color:e.badge==="official"?"#8aaeff":t2, fontSize:"11px", border:"1px solid "+(e.badge==="official"?"rgba(26,86,255,0.2)":bdr), borderRadius:"5px", cursor:"pointer", fontFamily:"'Geist',sans-serif" }}>
                          {e.badge==="official"?"🔵 Official":"Set Official"}
                        </button>
                        {e.link && <a href={e.link} target="_blank" rel="noopener noreferrer" style={{ height:"30px", padding:"0 10px", display:"flex", alignItems:"center", background:"transparent", color:"#8aaeff", fontSize:"11px", border:"1px solid rgba(26,86,255,0.2)", borderRadius:"5px", textDecoration:"none" }}>View ↗</a>}
                        <ActionBtn onClick={() => confirmDelete(e.id, "events")} disabled={acting} color="red">Delete</ActionBtn>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── LOCATIONS ── */}
              {tab === "locations" && (() => {
                const allProjects = [...submissions,...projects] as any[]
                const missing = allProjects.filter(p => !p.lat||!p.lng)
                const withLoc = allProjects.filter(p => p.lat&&p.lng)
                return (
                  <div>
                    <div style={{ fontSize:"12px", color:t2, marginBottom:"20px", fontFamily:mono }}>
                      {missing.length} missing coordinates · {withLoc.length} already mapped
                    </div>
                    {missing.length === 0 ? (
                      <EmptyState icon="🌍" title="All projects mapped" sub="Every project has coordinates — globe dots are real" />
                    ) : (
                      <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
                        {missing.map((p: any) => {
                          const inp = locInputs[p.id]||{city:p.city||"",country:p.country||"",status:"",result:""}
                          const isDone = inp.status==="done"; const isErr = inp.status==="error"; const isBusy = inp.status==="loading"
                          return (
                            <div key={p.id} style={{ background:surf, border:"1px solid "+bdr, borderRadius:"10px", padding:"12px 16px", display:"flex", alignItems:"center", gap:"12px", flexWrap:"wrap" }}>
                              <div style={{ width:"34px", height:"34px", borderRadius:"8px", overflow:"hidden", background:"rgba(26,86,255,0.06)", border:"1px solid "+bdr, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                                {p.logo_url?<img src={`/api/image-proxy?url=${encodeURIComponent(p.logo_url)}`} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} onError={e=>(e.currentTarget.style.display="none")} />:<span style={{ fontSize:"13px", fontWeight:700, color:t3 }}>{p.name?.[0]}</span>}
                              </div>
                              <div style={{ minWidth:"120px", flex:"0 0 auto" }}>
                                <div style={{ fontSize:"12px", fontWeight:600, color:t1 }}>{p.name}</div>
                                <div style={{ fontSize:"10px", fontFamily:mono, color:t3 }}>{p.category} · {p.approved?"live":"pending"}</div>
                              </div>
                              <input value={inp.city} onChange={e=>setLocInputs(prev=>({...prev,[p.id]:{...inp,city:e.target.value}}))}
                                onKeyDown={e=>e.key==="Enter"&&geocodeProject(p.id,{city:p.city||"",country:p.country||""})}
                                placeholder="City" style={{ flex:1, minWidth:"100px", height:"32px", background:surf2, border:"1px solid "+bdr, borderRadius:"6px", padding:"0 10px", fontSize:"12px", fontFamily:mono, color:t1, outline:"none" }} />
                              <input value={inp.country} onChange={e=>setLocInputs(prev=>({...prev,[p.id]:{...inp,country:e.target.value}}))}
                                onKeyDown={e=>e.key==="Enter"&&geocodeProject(p.id,{city:p.city||"",country:p.country||""})}
                                placeholder="Country" style={{ flex:1, minWidth:"100px", height:"32px", background:surf2, border:"1px solid "+bdr, borderRadius:"6px", padding:"0 10px", fontSize:"12px", fontFamily:mono, color:t1, outline:"none" }} />
                              <button onClick={()=>geocodeProject(p.id,{city:p.city||"",country:p.country||""})} disabled={isBusy||!inp.city.trim()}
                                style={{ height:"32px", padding:"0 14px", background:isDone?"rgba(0,184,122,0.1)":"rgba(26,86,255,0.1)", color:isDone?"#00d990":"#8aaeff", fontSize:"11px", fontFamily:mono, border:"1px solid "+(isDone?"rgba(0,184,122,0.2)":"rgba(26,86,255,0.2)"), borderRadius:"6px", cursor:"pointer", flexShrink:0 }}>
                                {isBusy?"...":isDone?"✓ Mapped":"Geocode →"}
                              </button>
                              {inp.result && <div style={{ fontSize:"10px", fontFamily:mono, color:isDone?"#00d990":"#e03348", whiteSpace:"nowrap" }}>{isErr?"✗ ":"📍 "}{inp.result}</div>}
                            </div>
                          )
                        })}
                      </div>
                    )}
                    {withLoc.length > 0 && (
                      <div style={{ marginTop:"28px" }}>
                        <div style={{ fontSize:"9px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"10px" }}>Already Mapped ({withLoc.length})</div>
                        <div style={{ display:"flex", flexDirection:"column", gap:"4px" }}>
                          {withLoc.map((p: any) => (
                            <div key={p.id} style={{ display:"flex", alignItems:"center", gap:"12px", padding:"8px 14px", background:"rgba(0,184,122,0.03)", border:"1px solid rgba(0,184,122,0.08)", borderRadius:"7px" }}>
                              <div style={{ fontSize:"12px", fontWeight:500, color:t1, flex:1 }}>{p.name}</div>
                              <div style={{ fontSize:"10px", fontFamily:mono, color:"#00b87a" }}>{p.city||"—"}{p.country?`, ${p.country}`:""}</div>
                              <div style={{ fontSize:"10px", fontFamily:mono, color:t3 }}>{Number(p.lat).toFixed(3)}, {Number(p.lng).toFixed(3)}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* ── CAMPAIGNS ── */}
              {tab === "campaigns" && (
                <div>
                  {pendingCampaigns.length === 0 ? (
                    <EmptyState icon="✦" title="No pending campaigns" sub="Campaign submissions from founders will appear here for review" />
                  ) : (
                    <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
                      {pendingCampaigns.map((c: AdminCampaign) => {
                        // Mirrors the tester flow at /trials/[id]: when the campaign (or any
                        // task) carries a contract address, ArcLens auto-verifies on-chain and
                        // proof inputs are skipped entirely.
                        const hasInternal = !!c.contract_address || (c.tasks||[]).some(t => !!t.contract_address)
                        return (
                        <div key={c.id} style={{ background:surf, border:"1px solid "+bdr, borderRadius:"12px", overflow:"hidden" }}>
                          {/* Banner preview — the exact art testers see on the campaign
                              page. Amber warning when the founder uploaded no campaign
                              banner and the project logo would be stretched instead. */}
                          {(c.campaign_logo || c.project_logo) ? (
                            <div style={{ position:"relative", width:"100%", aspectRatio:"16 / 5", background:surf2, borderBottom:"1px solid "+bdr, overflow:"hidden" }}>
                              <img src={`/api/image-proxy?url=${encodeURIComponent((c.campaign_logo || c.project_logo)!)}`} alt=""
                                onError={e => (e.currentTarget.style.display = "none")}
                                style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover" }} />
                              {!c.campaign_logo && (
                                <span style={{ position:"absolute", top:10, right:10, fontSize:"9.5px", fontFamily:mono, background:"rgba(0,0,0,0.65)", color:"#e0a810", border:"1px solid rgba(224,168,16,0.4)", padding:"3px 9px", borderRadius:4, backdropFilter:"blur(4px)" }}>
                                  ⚠ no campaign banner — project logo stretched
                                </span>
                              )}
                            </div>
                          ) : (
                            <div style={{ display:"flex", alignItems:"center", justifyContent:"center", aspectRatio:"16 / 8", background:surf2, borderBottom:"1px solid "+bdr, fontSize:"11px", fontFamily:mono, color:"#e0a810" }}>
                              ⚠ no banner art at all — reject and ask for custom art
                            </div>
                          )}
                          <div style={{ padding:"18px 22px" }}>
                            {/* Header row */}
                            <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:"12px", marginBottom:"14px" }}>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"6px" }}>
                                  {(c.campaign_logo||c.project_logo) && (
                                    <img src={`/api/image-proxy?url=${encodeURIComponent((c.campaign_logo||c.project_logo)!)}`} alt="" style={{ width:40,height:40,borderRadius:9,objectFit:"cover",flexShrink:0 }} />
                                  )}
                                  <div>
                                    <div style={{ fontSize:"15px", fontWeight:600, color:t1 }}>{c.title}</div>
                                    {c.tagline && <div style={{ fontSize:"12px", color:t2, marginTop:2 }}>{c.tagline}</div>}
                                  </div>
                                </div>
                                <div style={{ display:"flex", gap:"6px", flexWrap:"wrap", marginBottom:"8px" }}>
                                  <span style={pill("#8aaeff","rgba(26,86,255,0.2)")}>{CAMPAIGN_TYPE_LABELS[c.type]||c.type}</span>
                                  <span style={pill(c.reward_type==="usdc"?"#00d990":t2, c.reward_type==="usdc"?"rgba(0,184,122,0.2)":bdr)}>
                                    {REWARD_TYPE_LABELS[c.reward_type]||c.reward_type}{c.reward_usdc_amount?` · $${c.reward_usdc_amount} USDC`:""}
                                  </span>
                                  {c.total_slots && <span style={pill(t3,bdr)}>{c.total_slots} slots{c.is_fcfs ? " · first come, first served" : ""}</span>}
                                  {c.max_xp_per_completion != null && <span style={pill("#a78bfa","rgba(167,139,250,0.2)")}>up to {c.max_xp_per_completion} XP{c.xp_mode === "per_question" ? " · per-question" : ""}</span>}
                                  {c.expires_at && <span style={pill(t2,bdr)}>ends {new Date(c.expires_at).toLocaleDateString(undefined,{ month:"short", day:"numeric", year:"numeric" })}</span>}
                                  {c.min_rank > 0 && <span style={pill("#c08828","rgba(192,136,40,0.2)")}>Min rank: {["Scout","Builder","Verified","Trusted","Arc Proven"][c.min_rank]}</span>}
                                  {hasInternal && <span style={pill("#00d990","rgba(0,184,122,0.15)")}>✓ auto-verified on-chain</span>}
                                </div>
                                <div style={{ fontSize:"12px", color:t2 }}>
                                  {c.project_name && <><span style={{ color:t1, fontWeight:500 }}>{c.project_name}</span> · </>}
                                  <span style={{ fontFamily:mono }}>{c.creator_wallet.slice(0,10)}...{c.creator_wallet.slice(-6)}</span>
                                  <span style={{ marginLeft:10, fontSize:"10px", fontFamily:mono, color:t3 }}>Submitted {new Date(c.created_at).toLocaleDateString()}</span>
                                </div>
                              </div>
                              <div style={{ display:"flex", gap:"8px", flexShrink:0, flexWrap:"wrap", justifyContent:"flex-end" }}>
                                <a href={`/trials/${c.slug || c.id}`} target="_blank" rel="noopener noreferrer"
                                  style={{ height:"30px", padding:"0 14px", display:"inline-flex", alignItems:"center", background:"rgba(26,86,255,0.1)", color:"#8aaeff", fontSize:"11px", fontWeight:600, border:"1px solid rgba(26,86,255,0.3)", borderRadius:"5px", textDecoration:"none", fontFamily:"'Geist',sans-serif", whiteSpace:"nowrap" }}>
                                  Preview as tester ↗
                                </a>
                                <ActionBtn onClick={() => act(c.id, "approve", "campaigns")} disabled={acting} color="green">Approve</ActionBtn>
                                <ActionBtn onClick={() => { setRejectingCampaignId(c.id); setRejectReason("") }} disabled={acting} color="red">Reject</ActionBtn>
                              </div>
                            </div>

                            {/* Description — verbatim what testers read */}
                            <div style={{ padding:"10px 14px", background:surf2, border:"1px solid "+bdr, borderRadius:"8px", fontSize:"12px", color:t2, lineHeight:1.6, marginBottom:"10px" }}>
                              {c.description}
                            </div>

                            {/* Tester flow — the steps exactly as testers walk them, with each
                                step's proof requirement (or the on-chain auto-verify note) */}
                            {c.tasks?.length > 0 && (
                              <div style={{ marginBottom:"10px" }}>
                                <div style={{ fontSize:"10px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"6px" }}>
                                  Tester flow — {c.tasks.length} step{c.tasks.length === 1 ? "" : "s"}
                                </div>
                                <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
                                  {c.tasks.map((t,i) => {
                                    const pt = t.proof_type || "none"
                                    return (
                                      <div key={t.id} style={{ display:"flex", gap:"10px", padding:"8px 12px", background:surf2, border:"1px solid "+bdr, borderRadius:"8px" }}>
                                        <span style={{ fontFamily:mono, fontSize:"11px", color:t3, flexShrink:0, paddingTop:"1px" }}>{String(i+1).padStart(2,"0")}</span>
                                        <div style={{ flex:1, minWidth:0 }}>
                                          <div style={{ fontSize:"12px", color:t1, fontWeight:500 }}>{t.title}</div>
                                          {t.description && <div style={{ fontSize:"11.5px", color:t2, lineHeight:1.5, marginTop:2 }}>{t.description}</div>}
                                          <div style={{ marginTop:"5px", display:"flex", gap:"6px", flexWrap:"wrap" }}>
                                            {hasInternal
                                              ? <span style={pill("#00d990","rgba(0,184,122,0.2)")}>✓ auto-verified on-chain — no proof asked</span>
                                              : pt === "none"
                                              ? <span style={pill(t3,bdr)}>no proof required</span>
                                              : <span style={pill("#e0a810","rgba(224,168,16,0.25)")}>proof: {PROOF_LABELS[pt]||pt}</span>}
                                            {t.contract_address && <span style={{ ...pill("#00d990","rgba(0,184,122,0.15)"), fontFamily:mono }}>{t.contract_address.slice(0,10)}…{t.contract_address.slice(-6)}</span>}
                                          </div>
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Review questions — testers answer these after the final step */}
                            {c.review_questions?.length > 0 && (
                              <div style={{ marginBottom:"10px" }}>
                                <div style={{ fontSize:"10px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"6px" }}>Review questions — answered after the final step ({c.review_questions.length})</div>
                                <div style={{ display:"flex", flexDirection:"column", gap:"4px" }}>
                                  {c.review_questions.map((q,i) => (
                                    <div key={q.id} style={{ fontSize:"12px", color:t2 }}>
                                      <span style={{ fontFamily:mono, color:t3 }}>Q{i+1} </span>
                                      {q.label}
                                      <span style={{ fontFamily:mono, color:t3, marginLeft:6 }}>min {q.min_words}w{q.required?" · required":""}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* App URL + campaign contract */}
                            {(c.app_url || c.contract_address) && (
                              <div style={{ display:"flex", gap:"10px", flexWrap:"wrap", alignItems:"center" }}>
                                {c.app_url && (
                                  <a href={c.app_url} target="_blank" rel="noopener noreferrer" style={{ fontSize:"11px", fontFamily:mono, color:"#6366f1", textDecoration:"none" }}>↗ {c.app_url}</a>
                                )}
                                {c.app_url && urlRepChip(c.app_url)}
                                {c.contract_address && (
                                  <span style={{ fontSize:"11px", fontFamily:mono, color:"#00d990" }}>{c.contract_address}</span>
                                )}
                              </div>
                            )}

                            {/* Reward note — verbatim what testers read */}
                            {c.reward_description && (
                              <div style={{ marginTop:"10px", padding:"8px 12px", background:surf2, border:"1px solid "+bdr, borderRadius:"7px", fontSize:"12px", color:t2, fontStyle:"italic" }}>
                                "{c.reward_description}"
                              </div>
                            )}
                          </div>
                          {rejectingCampaignId === c.id && (
                            <div style={{ borderTop:"1px solid rgba(224,51,72,0.15)", padding:"14px 22px 18px", background:"rgba(224,51,72,0.03)" }}>
                              <div style={{ fontSize:"10px", fontFamily:mono, color:"#e03348", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"8px" }}>Rejection reason (shown to founder)</div>
                              {/* One-click templates for the recurring rejection causes */}
                              <div style={{ display:"flex", gap:"6px", flexWrap:"wrap", marginBottom:"8px" }}>
                                {[
                                  { l: "Flagged URL",     v: "Your app URL was flagged as suspicious or malicious by one or more security scanners. Resolve the flag with the scanning vendors (or move to a clean domain), then resubmit — we cannot send testers to a site security tools warn about." },
                                  { l: "Template steps",  v: "The tester steps are still generic placeholders. Rewrite each step for your app — name the exact actions, screens, and outcomes testers should verify — then resubmit." },
                                  { l: "Expired deadline", v: "The campaign deadline is already in the past — it would end the moment it goes live. Update the end date and resubmit." },
                                  { l: "Banner quality",  v: "The campaign banner does not meet listing standards — upload custom 16:9 campaign art (not a stretched logo or unrelated image) and resubmit." },
                                ].map(t => (
                                  <button key={t.l} onClick={() => setRejectReason(t.v)}
                                    style={{ height:"22px", padding:"0 10px", background: rejectReason === t.v ? "rgba(224,51,72,0.12)" : "transparent", border:"1px solid rgba(224,51,72,0.25)", borderRadius:"5px", fontSize:"9.5px", fontFamily:mono, color:"#e03348", cursor:"pointer" }}>
                                    {t.l}
                                  </button>
                                ))}
                              </div>
                              <textarea
                                value={rejectReason}
                                onChange={e => setRejectReason(e.target.value)}
                                placeholder="e.g. Duplicate campaign, insufficient detail in task descriptions, violates guidelines..."
                                rows={2}
                                style={{ width:"100%", background:surf2, border:"1px solid rgba(224,51,72,0.2)", borderRadius:"7px", padding:"8px 12px", fontSize:"12px", fontFamily:mono, color:t1, outline:"none", resize:"vertical", lineHeight:1.6, boxSizing:"border-box" as const, marginBottom:"10px" }}
                              />
                              <div style={{ display:"flex", gap:"8px" }}>
                                <button
                                  onClick={() => { act(c.id, "reject", "campaigns", { reason: rejectReason }); setRejectingCampaignId(null) }}
                                  disabled={acting}
                                  style={{ height:"30px", padding:"0 16px", background:"rgba(224,51,72,0.12)", color:"#e03348", fontSize:"11px", border:"1px solid rgba(224,51,72,0.3)", borderRadius:"5px", cursor:"pointer", fontFamily:"'Geist',sans-serif", fontWeight:600, opacity:acting?.6:1 }}>
                                  Confirm Reject
                                </button>
                                <button onClick={() => setRejectingCampaignId(null)}
                                  style={{ height:"30px", padding:"0 14px", background:"transparent", color:t2, fontSize:"11px", border:"1px solid "+bdr, borderRadius:"5px", cursor:"pointer", fontFamily:"'Geist',sans-serif" }}>
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )})}
                    </div>
                  )}

                  {/* ── All Campaigns (manage / delete) ── */}
                  {allCampaigns.length > 0 && (
                    <div style={{ marginTop: 28 }}>
                      <div style={{ fontSize:"11px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:12 }}>
                        All Campaigns ({allCampaigns.length})
                      </div>
                      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                        {allCampaigns.map((c: any) => {
                          const statusColor: Record<string,string> = {
                            active: "#00b87a", pending_approval: "#e08810", approved: "#8aaeff",
                            rejected: "#e03348", ended: "#6b7da8", completed: "#a855f7",
                          }
                          const sc = statusColor[c.status] || t3
                          const isOpen = repairOpen === c.id
                          return (
                            <div key={c.id} style={{ background:surf2, border:"1px solid "+bdr, borderRadius:9, overflow:"hidden" }}>
                              <div style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 14px" }}>
                                <div style={{ width:7, height:7, borderRadius:"50%", background:sc, flexShrink:0 }} />
                                <div style={{ flex:1, minWidth:0 }}>
                                  <div style={{ fontSize:13, fontWeight:600, color:t1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{c.title}</div>
                                  <div style={{ fontSize:10, fontFamily:mono, color:t3, marginTop:2 }}>
                                    {c.project_name && <>{c.project_name} · </>}
                                    {c.status} · {c.filled_slots}/{c.total_slots ?? "∞"} slots · {new Date(c.created_at).toLocaleDateString()}
                                  </div>
                                </div>
                                <a href={`/trials/${c.id}`} target="_blank" rel="noopener noreferrer"
                                  style={{ fontSize:10, fontFamily:mono, color:t3, textDecoration:"none", padding:"3px 8px", border:"1px solid "+bdr, borderRadius:4, flexShrink:0 }}>
                                  View
                                </a>
                                <button
                                  onClick={() => {
                                    const opening = subsOpen !== c.id
                                    setSubsOpen(opening ? c.id : null)
                                    if (opening) loadCampaignSubmissions(c.id)
                                  }}
                                  style={{ height:28, padding:"0 10px", background: subsOpen === c.id ? "rgba(138,174,255,0.12)" : "transparent", color: subsOpen === c.id ? "#8aaeff" : t3, fontSize:11, border:"1px solid "+(subsOpen === c.id ? "rgba(138,174,255,0.3)" : bdr), borderRadius:5, cursor:"pointer", fontFamily:"'Geist',sans-serif", fontWeight:600, flexShrink:0 }}>
                                  Submissions
                                </button>
                                <button
                                  onClick={() => { setRepairOpen(isOpen ? null : c.id); setRepairWallet("") }}
                                  style={{ height:28, padding:"0 10px", background: isOpen ? "rgba(26,86,255,0.12)" : "transparent", color: isOpen ? "#8aaeff" : t3, fontSize:11, border:"1px solid "+(isOpen ? "rgba(26,86,255,0.3)" : bdr), borderRadius:5, cursor:"pointer", fontFamily:"'Geist',sans-serif", fontWeight:600, flexShrink:0 }}>
                                  Repair
                                </button>
                                <button
                                  onClick={() => { if (window.confirm(`Delete "${c.title}"? This removes all completions and cannot be undone.`)) act(c.id, "delete-campaign") }}
                                  disabled={acting}
                                  style={{ height:28, padding:"0 10px", background:"rgba(224,51,72,0.08)", color:"#e03348", fontSize:11, border:"1px solid rgba(224,51,72,0.2)", borderRadius:5, cursor:"pointer", fontFamily:"'Geist',sans-serif", fontWeight:600, flexShrink:0 }}>
                                  Delete
                                </button>
                              </div>
                              {isOpen && (
                                <div style={{ borderTop:"1px solid "+bdr, padding:"12px 14px", display:"flex", flexDirection:"column", gap:8 }}>
                                  <div style={{ fontSize:10, fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:2 }}>Repair Tools</div>
                                  <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                                    <button onClick={() => { if (window.confirm("Reactivate this campaign?")) act(c.id, "reactivate-campaign", "campaigns") }} disabled={acting}
                                      style={{ height:28, padding:"0 12px", background:"rgba(0,184,122,0.08)", color:"#00b87a", fontSize:11, border:"1px solid rgba(0,184,122,0.2)", borderRadius:5, cursor:"pointer", fontWeight:600 }}>
                                      Reactivate
                                    </button>
                                    <button onClick={() => { if (window.confirm("Sync filled_slots count from actual completions?")) act(c.id, "sync-slots", "campaigns") }} disabled={acting}
                                      style={{ height:28, padding:"0 12px", background:"rgba(138,174,255,0.08)", color:"#8aaeff", fontSize:11, border:"1px solid rgba(138,174,255,0.2)", borderRadius:5, cursor:"pointer", fontWeight:600 }}>
                                      Sync Slots
                                    </button>
                                    <button onClick={() => { if (window.confirm(`Reset "${c.title}"? Clears ALL completions and resets slots to 0 but keeps the campaign active.`)) act(c.id, "reset-campaign", "campaigns") }} disabled={acting}
                                      style={{ height:28, padding:"0 12px", background:"rgba(224,136,16,0.08)", color:"#e08810", fontSize:11, border:"1px solid rgba(224,136,16,0.2)", borderRadius:5, cursor:"pointer", fontWeight:600 }}>
                                      Reset (keep active)
                                    </button>
                                  </div>
                                  <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                                    <input
                                      value={repairWallet} onChange={e => setRepairWallet(e.target.value)}
                                      placeholder="0x... tester wallet to remove"
                                      style={{ flex:1, height:30, background:"#0a0e1a", border:"1px solid "+bdr, borderRadius:5, color:t1, fontSize:11, fontFamily:mono, padding:"0 10px" }}
                                    />
                                    <button onClick={() => {
                                      if (!repairWallet.trim()) return
                                      if (window.confirm(`Remove completion for ${repairWallet.trim()} and free their slot?`))
                                        act(c.id, "remove-completion", "campaigns", { tester_wallet: repairWallet.trim() })
                                    }} disabled={acting}
                                      style={{ height:30, padding:"0 12px", background:"rgba(224,51,72,0.08)", color:"#e03348", fontSize:11, border:"1px solid rgba(224,51,72,0.2)", borderRadius:5, cursor:"pointer", fontWeight:600, whiteSpace:"nowrap" }}>
                                      Remove Tester
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* Admin submissions panel — opens when "Submissions" clicked.
                                  Fetches /api/trials/[id] (now returns task_proofs, xp_earned,
                                  per_question_ratings, full completion list up to 500).
                                  Admin sees every tester, every proof, every answer — no
                                  founder-claim wall, no auth wall, full read-only view. */}
                              {subsOpen === c.id && (
                                <div style={{ borderTop: "1px solid " + bdr, padding: "14px 14px", background: "rgba(138,174,255,0.02)" }}>
                                  {subsLoading || !subsData ? (
                                    <div style={{ padding: "24px", textAlign: "center", fontFamily: mono, fontSize: 11, color: t3 }}>Loading submissions...</div>
                                  ) : subsData.completions.length === 0 ? (
                                    <div style={{ padding: "24px", textAlign: "center", fontFamily: mono, fontSize: 11, color: t3 }}>No submissions yet.</div>
                                  ) : (() => {
                                    const proofTasks = (subsData.campaign.tasks || []).filter((t: any) => t.proof_type && t.proof_type !== "none")
                                    return (
                                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                                          <div style={{ fontSize: 10, fontFamily: mono, color: t3, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                                            All submissions · {subsData.completions.length}
                                          </div>
                                          <div style={{ fontSize: 10, fontFamily: mono, color: t3 }}>
                                            {proofTasks.length} task{proofTasks.length === 1 ? "" : "s"} require proof
                                          </div>
                                        </div>
                                        {subsData.completions.map((comp: any) => {
                                          const expanded = subsExpandedTester.has(comp.tester_wallet)
                                          const proofs = comp.task_proofs || {}
                                          const proofKeys = Object.keys(proofs)
                                          const scoreColor = comp.auto_score > 70 ? "#00b87a" : comp.auto_score > 40 ? "#e08810" : "#e03348"
                                          return (
                                            <div key={comp.tester_wallet} style={{ background: "#0a0e1a", border: "1px solid " + bdr, borderRadius: 7, overflow: "hidden" }}>
                                              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", flexWrap: "wrap" }}>
                                                <div style={{ width: 6, height: 6, borderRadius: "50%", background: scoreColor, flexShrink: 0 }} />
                                                <a href={`/tester/${comp.tester_wallet}`} target="_blank" rel="noopener noreferrer"
                                                  style={{ fontSize: 11, fontFamily: mono, color: t1, textDecoration: "none", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                  {comp.tester_wallet.slice(0, 10)}…{comp.tester_wallet.slice(-6)}
                                                </a>
                                                <span style={{ fontSize: 9, fontFamily: mono, color: t3 }}>auto {comp.auto_score}/100</span>
                                                {comp.builder_rating && <span style={{ fontSize: 10, color: "#c08828" }}>{"★".repeat(comp.builder_rating)}</span>}
                                                {comp.xp_earned > 0 && <span style={{ fontSize: 9, fontFamily: mono, color: "#8aaeff", padding: "1px 6px", background: "rgba(138,174,255,0.08)", border: "1px solid rgba(138,174,255,0.2)", borderRadius: 3 }}>{comp.xp_earned} XP</span>}
                                                <span style={{ fontSize: 9, fontFamily: mono, color: t3, padding: "1px 6px", background: "rgba(255,255,255,0.03)", borderRadius: 3 }}>
                                                  {proofKeys.length}/{proofTasks.length} proofs
                                                </span>
                                                <button onClick={() => setSubsExpandedTester(prev => {
                                                  const n = new Set(prev)
                                                  if (n.has(comp.tester_wallet)) n.delete(comp.tester_wallet); else n.add(comp.tester_wallet)
                                                  return n
                                                })}
                                                  style={{ height: 24, padding: "0 8px", background: "transparent", color: t2, fontSize: 10, fontFamily: mono, border: "1px solid " + bdr, borderRadius: 4, cursor: "pointer" }}>
                                                  {expanded ? "Hide ↑" : "Open ↓"}
                                                </button>
                                              </div>
                                              {expanded && (
                                                <div style={{ padding: "10px 12px 12px", borderTop: "1px solid " + bdr, background: "rgba(255,255,255,0.01)" }}>
                                                  {proofTasks.length > 0 && (
                                                    <div style={{ marginBottom: 12, padding: "9px 11px", background: "rgba(138,174,255,0.04)", border: "1px solid rgba(138,174,255,0.18)", borderRadius: 6 }}>
                                                      <div style={{ fontSize: 9, fontFamily: mono, color: "#8aaeff", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Submitted proofs</div>
                                                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                                        {proofTasks.map((t: any) => {
                                                          const value = proofs[t.id] || ""
                                                          const labelType = t.proof_type === "x_link" ? "X post" : t.proof_type === "tx_hash" ? "Tx hash" : t.proof_type === "screenshot" ? "Screenshot" : "URL"
                                                          const linkHref = !value ? null : t.proof_type === "tx_hash" ? `https://testnet.arcscan.app/tx/${value}` : value
                                                          const isShot = t.proof_type === "screenshot" && !!value
                                                          return (
                                                            <div key={t.id} style={{ display: "flex", alignItems: isShot ? "flex-start" : "center", gap: 8, fontSize: 10.5 }}>
                                                              <span style={{ fontFamily: mono, color: t3, minWidth: 70, flexShrink: 0 }}>{labelType}</span>
                                                              {isShot ? (
                                                                <div style={{ display: "flex", gap: 8, alignItems: "center", flex: 1, minWidth: 0 }}>
                                                                  <a href={value} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0 }}>
                                                                    <img src={/\.blob\.vercel-storage\.com\//i.test(value) ? value : `/api/image-proxy?url=${encodeURIComponent(value)}`} alt=""
                                                                      style={{ width: 48, height: 36, objectFit: "cover", borderRadius: 4, border: "1px solid " + bdr, display: "block", cursor: "zoom-in" }} />
                                                                  </a>
                                                                  <div style={{ flex: 1, minWidth: 0 }}>
                                                                    <div style={{ color: t2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</div>
                                                                    <a href={value} target="_blank" rel="noopener noreferrer" style={{ fontFamily: mono, fontSize: 9.5, color: "#8aaeff", textDecoration: "none" }}>Open full ↗</a>
                                                                  </div>
                                                                </div>
                                                              ) : (
                                                                <>
                                                                  <span style={{ color: t2, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}:</span>
                                                                  {linkHref ? (
                                                                    <a href={linkHref} target="_blank" rel="noopener noreferrer"
                                                                      style={{ fontFamily: mono, color: "#8aaeff", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "55%" }}>{value} ↗</a>
                                                                  ) : (
                                                                    <span style={{ fontFamily: mono, color: "#e08810" }}>(missing)</span>
                                                                  )}
                                                                </>
                                                              )}
                                                            </div>
                                                          )
                                                        })}
                                                      </div>
                                                    </div>
                                                  )}
                                                  {(subsData.campaign.review_questions || []).map((q: any) => {
                                                    const ans = comp.review_answers?.[q.id]
                                                    if (!ans) return null
                                                    return (
                                                      <div key={q.id} style={{ marginBottom: 9 }}>
                                                        <div style={{ fontSize: 9.5, fontFamily: mono, color: t3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{q.label}</div>
                                                        <div style={{ fontSize: 11.5, color: t2, lineHeight: 1.6, whiteSpace: "pre-wrap", background: "rgba(255,255,255,0.02)", border: "1px solid " + bdr, borderRadius: 5, padding: "8px 10px" }}>{ans}</div>
                                                      </div>
                                                    )
                                                  })}
                                                </div>
                                              )}
                                            </div>
                                          )
                                        })}
                                      </div>
                                    )
                                  })()}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── TRUST: alerts + disputes ── */}
              {tab === "trust" && (
                <div style={{ display:"flex", flexDirection:"column", gap:"18px" }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"10px", flexWrap:"wrap" }}>
                    <div style={{ fontSize:"13px", color:t2 }}>
                      {trustLoading ? "Loading…" : trust
                        ? `${trust.counts.open_alerts} open indexer alert${trust.counts.open_alerts===1?"":"s"} · ${trust.counts.open_disputes} open public dispute${trust.counts.open_disputes===1?"":"s"}`
                        : "—"}
                    </div>
                    <button onClick={() => loadTrust()} disabled={trustLoading}
                      style={{ height:"30px", padding:"0 12px", background:"rgba(26,86,255,0.07)", color:"#8aaeff", fontSize:"11px", fontFamily:mono, border:"1px solid rgba(26,86,255,0.25)", borderRadius:"6px", cursor: trustLoading ? "not-allowed" : "pointer" }}>
                      Refresh
                    </button>
                  </div>
                  {trustError && (
                    <div style={{ padding:"10px 14px", background:"rgba(224,51,72,0.05)", border:"1px solid rgba(224,51,72,0.25)", borderRadius:"8px", fontSize:"12px", color:"#e03348", fontFamily:mono }}>
                      {trustError}
                    </div>
                  )}

                  {/* Risk-engine flags — admin-only, never shown to users */}
                  <div>
                    <div style={{ fontSize:"10px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"10px" }}>
                      Flagged by the risk engine (admin-only — users never see these)
                    </div>
                    {(!trust || trust.flagged.length === 0) ? (
                      <EmptyState icon="✓" title="Nothing flagged" sub="No project is risk-flagged or awaiting caution review." />
                    ) : (
                      <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
                        {trust.flagged.map((f: any) => (
                          <div key={f.id} style={{ background:surf, border:"1px solid "+(f.hard_risk?"rgba(224,51,72,0.3)":"rgba(224,160,32,0.25)"), borderRadius:"10px", padding:"14px 18px" }}>
                            <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"6px", flexWrap:"wrap" }}>
                              <span style={{ fontSize:"9px", fontFamily:mono, padding:"2px 7px", borderRadius:"4px", background:f.hard_risk?"rgba(224,51,72,0.1)":"rgba(224,160,32,0.12)", color:f.hard_risk?"#e03348":"#e0a020", border:"1px solid "+(f.hard_risk?"rgba(224,51,72,0.25)":"rgba(224,160,32,0.3)"), textTransform:"uppercase", letterSpacing:"0.08em" }}>
                                {f.hard_risk ? "risk" : "caution"}
                              </span>
                              <a href={`/ecosystem/${f.slug}`} target="_blank" rel="noopener noreferrer" style={{ fontSize:"11px", fontFamily:mono, color:"#8aaeff", textDecoration:"none" }}>{f.name || f.slug}</a>
                            </div>
                            <div style={{ fontSize:"12px", color:t1, marginBottom:"8px", lineHeight:1.5 }}>{f.hard_risk ? (f.risk_reason || "confirmed risk — website on scam list") : (f.caution_note || "caution")}</div>
                            {!f.hard_risk && (
                              <button onClick={() => actionCaution(Number(f.id))}
                                style={{ height:"28px", padding:"0 12px", background:"rgba(0,184,122,0.08)", color:"#00b87a", fontSize:"11px", fontFamily:mono, border:"1px solid rgba(0,184,122,0.25)", borderRadius:"6px", cursor:"pointer" }}>
                                Acknowledge — reviewed, it's fine
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Indexer alerts */}
                  <div>
                    <div style={{ fontSize:"10px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"10px" }}>
                      Indexer alerts (self-audit from the cron)
                    </div>
                    {(!trust || trust.alerts.length === 0) ? (
                      <EmptyState icon="✓" title="No open indexer alerts" sub="Drift cron has reconciled every project — numbers match the chain." />
                    ) : (
                      <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
                        {trust.alerts.map((a: any) => (
                          <div key={a.id} style={{ background:surf, border:"1px solid "+(a.severity==="critical"?"rgba(224,51,72,0.3)":"rgba(192,136,40,0.25)"), borderRadius:"10px", padding:"14px 18px" }}>
                            <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"6px", flexWrap:"wrap" }}>
                              <span style={{ fontSize:"9px", fontFamily:mono, padding:"2px 7px", borderRadius:"4px",
                                background: a.severity==="critical" ? "rgba(224,51,72,0.1)" : "rgba(192,136,40,0.1)",
                                color:      a.severity==="critical" ? "#e03348"             : "#c08828",
                                border:"1px solid "+(a.severity==="critical"?"rgba(224,51,72,0.25)":"rgba(192,136,40,0.25)"),
                                textTransform:"uppercase", letterSpacing:"0.08em" }}>
                                {a.severity}
                              </span>
                              <span style={{ fontSize:"11px", fontFamily:mono, color:t2 }}>{a.kind}</span>
                              {a.slug && <span style={{ fontSize:"11px", fontFamily:mono, color:"#8aaeff" }}>· {a.slug}</span>}
                              <span style={{ fontSize:"10px", fontFamily:mono, color:t3, marginLeft:"auto" }}>
                                {new Date(a.created_at).toLocaleString()}
                              </span>
                            </div>
                            <div style={{ fontSize:"13px", color:t1, lineHeight:1.5, marginBottom:"10px", wordBreak:"break-word" }}>
                              {a.message}
                            </div>
                            <button onClick={() => resolveAlert(Number(a.id))}
                              style={{ height:"28px", padding:"0 12px", background:"rgba(0,184,122,0.08)", color:"#00b87a", fontSize:"11px", fontFamily:mono, border:"1px solid rgba(0,184,122,0.25)", borderRadius:"6px", cursor:"pointer" }}>
                              Mark resolved
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Public disputes */}
                  <div>
                    <div style={{ fontSize:"10px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"10px" }}>
                      Reports & disputes (visitor-flagged)
                    </div>
                    {(!trust || trust.disputes.length === 0) ? (
                      <EmptyState icon="✓" title="No open reports" sub="No one has flagged this listing or a number for review." />
                    ) : (
                      <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
                        {trust.disputes.map((d: any) => (
                          <div key={d.id} style={{ background:surf, border:"1px solid "+bdr, borderRadius:"10px", padding:"14px 18px" }}>
                            <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"6px", flexWrap:"wrap" }}>
                              <span style={{ fontSize:"9px", fontFamily:mono, padding:"2px 7px", borderRadius:"4px", background:"rgba(224,136,16,0.1)", color:"#e08810", border:"1px solid rgba(224,136,16,0.25)", textTransform:"uppercase", letterSpacing:"0.08em" }}>
                                {d.metric}
                              </span>
                              <span style={{ fontSize:"11px", fontFamily:mono, color:"#8aaeff" }}>{d.slug}</span>
                              <span style={{ fontSize:"10px", fontFamily:mono, color:t3 }}>· {d.status}</span>
                              <span style={{ fontSize:"10px", fontFamily:mono, color:t3, marginLeft:"auto" }}>
                                {new Date(d.created_at).toLocaleString()}
                              </span>
                            </div>
                            <div style={{ fontSize:"13px", color:t1, lineHeight:1.6, marginBottom:"8px", whiteSpace:"pre-wrap", wordBreak:"break-word" }}>
                              {d.reason}
                            </div>
                            {d.evidence_url && (
                              <div style={{ fontSize:"11px", fontFamily:mono, marginBottom:"8px" }}>
                                <a href={d.evidence_url} target="_blank" rel="noopener noreferrer" style={{ color:"#8aaeff", textDecoration:"underline", wordBreak:"break-all" }}>{d.evidence_url}</a>
                              </div>
                            )}
                            {d.reporter_email && (
                              <div style={{ fontSize:"10px", fontFamily:mono, color:t3, marginBottom:"8px" }}>
                                Reporter: {d.reporter_email}
                              </div>
                            )}
                            <div style={{ display:"flex", gap:"8px", flexWrap:"wrap" }}>
                              {d.status === "open" && (
                                <button onClick={() => actionDispute(Number(d.id), "acknowledge")}
                                  style={{ height:"28px", padding:"0 12px", background:"rgba(26,86,255,0.08)", color:"#8aaeff", fontSize:"11px", fontFamily:mono, border:"1px solid rgba(26,86,255,0.25)", borderRadius:"6px", cursor:"pointer" }}>
                                  Acknowledge
                                </button>
                              )}
                              <button onClick={() => actionDispute(Number(d.id), "resolve")}
                                style={{ height:"28px", padding:"0 12px", background:"rgba(0,184,122,0.08)", color:"#00b87a", fontSize:"11px", fontFamily:mono, border:"1px solid rgba(0,184,122,0.25)", borderRadius:"6px", cursor:"pointer" }}>
                                Mark resolved
                              </button>
                              <button onClick={() => actionDispute(Number(d.id), "dismiss")}
                                style={{ height:"28px", padding:"0 12px", background:"rgba(224,51,72,0.06)", color:"#e03348", fontSize:"11px", fontFamily:mono, border:"1px solid rgba(224,51,72,0.2)", borderRadius:"6px", cursor:"pointer" }}>
                                Dismiss
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Pending audits — founders who submitted via "Get Verified" */}
                  <div style={{ marginTop:"24px" }}>
                    <div style={{ fontSize:"10px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"10px" }}>
                      Pending audits (founder-submitted)
                    </div>
                    {(!trust || trust.audits.length === 0) ? (
                      <EmptyState icon="✓" title="No pending audits" sub="No founder has submitted an audit for review." />
                    ) : (
                      <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
                        {trust.audits.map((a: any) => (
                          <div key={a.id} style={{ background:surf, border:"1px solid "+bdr, borderRadius:"10px", padding:"14px 18px" }}>
                            <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"6px", flexWrap:"wrap" }}>
                              <span style={{ fontSize:"9px", fontFamily:mono, padding:"2px 7px", borderRadius:"4px", background:"rgba(0,200,150,0.1)", color:"#00c896", border:"1px solid rgba(0,200,150,0.25)", textTransform:"uppercase", letterSpacing:"0.08em" }}>audit</span>
                              <a href={`/ecosystem/${a.slug}`} target="_blank" rel="noopener noreferrer" style={{ fontSize:"11px", fontFamily:mono, color:"#8aaeff", textDecoration:"none" }}>{a.name || a.slug}</a>
                              <span style={{ fontSize:"10px", fontFamily:mono, color:t3, marginLeft:"auto" }}>{a.trust_updated_at ? new Date(a.trust_updated_at).toLocaleString() : ""}</span>
                            </div>
                            <div style={{ fontSize:"13px", color:t1, marginBottom:"4px" }}>Auditor: {a.auditor || "—"}</div>
                            {a.audit_url && <div style={{ fontSize:"11px", fontFamily:mono, marginBottom:"8px" }}><a href={a.audit_url} target="_blank" rel="noopener noreferrer" style={{ color:"#8aaeff", textDecoration:"underline", wordBreak:"break-all" }}>{a.audit_url}</a></div>}
                            <div style={{ display:"flex", gap:"8px", flexWrap:"wrap" }}>
                              <button onClick={() => actionAudit(Number(a.id), "approve")}
                                style={{ height:"28px", padding:"0 12px", background:"rgba(0,184,122,0.08)", color:"#00b87a", fontSize:"11px", fontFamily:mono, border:"1px solid rgba(0,184,122,0.25)", borderRadius:"6px", cursor:"pointer" }}>
                                Approve — grant Verified
                              </button>
                              <button onClick={() => actionAudit(Number(a.id), "reject")}
                                style={{ height:"28px", padding:"0 12px", background:"rgba(224,51,72,0.06)", color:"#e03348", fontSize:"11px", fontFamily:mono, border:"1px solid rgba(224,51,72,0.2)", borderRadius:"6px", cursor:"pointer" }}>
                                Reject
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── TRACKED CONTRACTS: founder-registered TVL/Volume/Revenue rows ── */}
              {tab === "ai" && (
                <div style={{ display:"flex", flexDirection:"column", gap:"18px" }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"10px", flexWrap:"wrap" }}>
                    <div style={{ fontSize:"13px", color:t2 }}>
                      {aiLoading ? "Loading…" : aiInsights
                        ? <><span style={{color:"#00b87a"}}>{aiInsights.ratings.up} 👍</span>{"  ·  "}<span style={{color:"#e03348"}}>{aiInsights.ratings.down} 👎</span>{"  ·  "}<span style={{color:t3}}>{aiInsights.gaps.total} unanswered question{aiInsights.gaps.total===1?"":"s"}</span></>
                        : "—"}
                    </div>
                    <button onClick={() => loadAiInsights()} disabled={aiLoading}
                      style={{ height:"30px", padding:"0 12px", background:"rgba(26,86,255,0.07)", color:"#8aaeff", fontSize:"11px", fontFamily:mono, border:"1px solid rgba(26,86,255,0.25)", borderRadius:"6px", cursor: aiLoading?"not-allowed":"pointer" }}>
                      Refresh
                    </button>
                  </div>
                  {aiError && <div style={{ padding:"10px 14px", background:"rgba(224,51,72,0.05)", border:"1px solid rgba(224,51,72,0.25)", borderRadius:"8px", fontSize:"12px", color:"#e03348", fontFamily:mono }}>{aiError}</div>}

                  {kb && (
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"12px", flexWrap:"wrap", padding:"12px 14px", background:surf, border:"1px solid "+bdr, borderRadius:"8px" }}>
                      <div style={{ minWidth:0 }}>
                        <div style={{ fontSize:"11px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"4px" }}>Knowledge base</div>
                        <div style={{ fontSize:"13px", color:t1 }}>
                          {kb.embedded}/{kb.total} facts embedded
                          {kb.missing > 0
                            ? <span style={{ color:"#e08810" }}>{"  ·  "}{kb.missing} need embedding</span>
                            : <span style={{ color:"#00b87a" }}>{"  ·  "}all current</span>}
                          {kb.configured === false && <span style={{ color:"#e03348" }}>{"  ·  "}no Gemini key in prod</span>}
                        </div>
                      </div>
                      <button onClick={reembedKb} disabled={kbBusy || kb.missing === 0}
                        style={{ height:"30px", padding:"0 12px", background: kb.missing>0 ? "rgba(0,184,122,0.1)" : "rgba(127,127,127,0.06)", color: kb.missing>0 ? "#00b87a" : t3, fontSize:"11px", fontFamily:mono, border:"1px solid "+(kb.missing>0?"rgba(0,184,122,0.3)":bdr), borderRadius:"6px", cursor: (kbBusy||kb.missing===0)?"not-allowed":"pointer", flexShrink:0 }}>
                        {kbBusy ? "Embedding…" : kb.missing>0 ? "Re-embed missing" : "Up to date"}
                      </button>
                    </div>
                  )}

                  <div>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"10px", marginBottom:"10px" }}>
                      <div style={{ fontSize:"11px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.08em" }}>Questions the AI couldn&apos;t answer</div>
                      {aiInsights && aiInsights.gaps.top.length > 0 && (
                        <button onClick={() => resolveGap()}
                          style={{ height:"24px", padding:"0 10px", background:"transparent", color:t3, fontSize:"10px", fontFamily:mono, border:"1px solid "+bdr, borderRadius:"5px", cursor:"pointer" }}>
                          Clear all
                        </button>
                      )}
                    </div>
                    {(!aiInsights || aiInsights.gaps.top.length === 0) ? (
                      <EmptyState icon="◌" title="Nothing logged yet" sub="When the AI can't answer a question, it lands here so you can add a fact or a tool to cover it." />
                    ) : (
                      <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
                        {aiInsights.gaps.top.map((g:any, i:number) => (
                          <div key={i} style={{ display:"flex", alignItems:"center", gap:"12px", padding:"11px 14px", background:surf, border:"1px solid "+bdr, borderRadius:"8px" }}>
                            <span style={{ fontSize:"10px", fontFamily:mono, color:"#e08810", padding:"2px 7px", borderRadius:"4px", background:"rgba(224,136,16,0.1)", border:"1px solid rgba(224,136,16,0.25)", flexShrink:0 }}>{g.times}×</span>
                            <span style={{ flex:1, fontSize:"13px", color:t1, minWidth:0 }}>{g.question}</span>
                            <span style={{ fontSize:"10px", fontFamily:mono, color:t3, flexShrink:0 }}>{new Date(g.last_asked).toLocaleDateString()}</span>
                            <button onClick={() => resolveGap(g.question)} title="Mark resolved"
                              style={{ flexShrink:0, height:"24px", padding:"0 10px", background:"rgba(0,184,122,0.08)", color:"#00b87a", fontSize:"10px", fontFamily:mono, border:"1px solid rgba(0,184,122,0.25)", borderRadius:"5px", cursor:"pointer" }}>
                              Resolve
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <div style={{ fontSize:"11px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"10px" }}>Recent answer ratings</div>
                    {(!aiInsights || aiInsights.ratings.recent.length === 0) ? (
                      <div style={{ fontSize:"12px", color:t3, fontFamily:mono }}>No ratings yet — 👍/👎 on AI answers show up here.</div>
                    ) : (
                      <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
                        {aiInsights.ratings.recent.map((r:any, i:number) => (
                          <div key={i} style={{ padding:"11px 14px", background:surf, border:"1px solid "+bdr, borderRadius:"8px", borderLeft:"3px solid "+(r.rating===1?"#00b87a":"#e03348") }}>
                            <div style={{ display:"flex", justifyContent:"space-between", gap:"10px", alignItems:"flex-start" }}>
                              <span style={{ fontSize:"13px", color:t1, fontWeight:600 }}>{r.rating===1?"👍":"👎"} {r.question}</span>
                              <span style={{ fontSize:"10px", fontFamily:mono, color:t3, flexShrink:0 }}>{new Date(r.created_at).toLocaleString()}</span>
                            </div>
                            {r.answer && <div style={{ fontSize:"12px", color:t2, lineHeight:1.55, marginTop:"6px" }}>{String(r.answer).slice(0,260)}{String(r.answer).length>260?"…":""}</div>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {tab === "spotlight" && (() => {
                const si = { width:"100%", height:"36px", background:surf2, border:"1px solid "+bdr, borderRadius:"7px", padding:"0 12px", fontSize:"12px", fontFamily:mono, color:t1, outline:"none", boxSizing:"border-box" as const }
                const lbl = { display:"block", fontSize:"9px", fontFamily:mono, color:t3, textTransform:"uppercase" as const, letterSpacing:"0.08em", marginBottom:"4px" }
                return (
                <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"10px", flexWrap:"wrap" }}>
                    <div style={{ fontSize:"13px", color:t2 }}>
                      {spotlight ? <><span style={{color:"#00b87a"}}>{spotlight.counts.active} live</span>{"  ·  "}<span style={{color:"#e08810"}}>{spotlight.counts.pending} pending</span></> : "—"}
                    </div>
                    <button onClick={() => loadSpotlight()} style={{ height:"30px", padding:"0 12px", background:"rgba(26,86,255,0.07)", color:"#8aaeff", fontSize:"11px", fontFamily:mono, border:"1px solid rgba(26,86,255,0.25)", borderRadius:"6px", cursor:"pointer" }}>Refresh</button>
                  </div>

                  {/* Create */}
                  <div style={{ background:surf, border:"1px solid "+bdr, borderRadius:"12px", padding:"18px 20px" }}>
                    <div style={{ fontSize:"12px", fontWeight:600, color:t1, marginBottom:"12px" }}>Add a spotlight item (goes live immediately)</div>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))", gap:"10px", marginBottom:"10px" }}>
                      <div><label style={lbl}>Kind</label>
                        <select value={spotForm.kind} onChange={e=>setSpotForm(p=>({...p,kind:e.target.value}))} style={si}>
                          {["custom","campaign","event","project"].map(k=><option key={k} value={k}>{k}</option>)}
                        </select>
                      </div>
                      <div><label style={lbl}>Project slug (optional)</label><input value={spotForm.project} onChange={e=>setSpotForm(p=>({...p,project:e.target.value}))} placeholder="ties + trust-gates" style={si} /></div>
                      <div><label style={lbl}>Button text</label><input value={spotForm.cta_text} onChange={e=>setSpotForm(p=>({...p,cta_text:e.target.value}))} placeholder="Learn more" style={si} /></div>
                      <div><label style={lbl}>Accent (hex)</label><input value={spotForm.accent} onChange={e=>setSpotForm(p=>({...p,accent:e.target.value}))} placeholder="#3b6bff" style={si} /></div>
                      <div><label style={lbl}>Run for (days · blank = always)</label><input type="number" min={1} value={spotDays} onChange={e=>setSpotDays(e.target.value)} placeholder="e.g. 14" style={si} /></div>
                    </div>
                    <div style={{ marginBottom:"10px" }}><label style={lbl}>Headline *</label><input value={spotForm.title} onChange={e=>setSpotForm(p=>({...p,title:e.target.value}))} placeholder="What you're spotlighting" style={si} /></div>
                    <div style={{ marginBottom:"10px" }}><label style={lbl}>Subtext</label><input value={spotForm.subtitle} onChange={e=>setSpotForm(p=>({...p,subtitle:e.target.value}))} placeholder="One short supporting line" style={si} /></div>
                    <div style={{ marginBottom:"10px" }}><label style={lbl}>Link URL</label><input value={spotForm.link_url} onChange={e=>setSpotForm(p=>({...p,link_url:e.target.value}))} placeholder="/ecosystem/slug or https://…" style={si} spellCheck={false} /></div>
                    <div style={{ marginBottom:"12px" }}>
                      <label style={lbl}>Banner image (optional · 1200×400, key visual on the right)</label>
                      <div style={{ display:"flex", gap:"8px" }}>
                        <label style={{ flex:1, display:"flex", alignItems:"center", gap:"10px", height:"36px", padding:"0 12px", background:surf2, border:"1px dashed "+(spotForm.image_url ? "rgba(0,184,122,0.4)" : bdr), borderRadius:"7px", cursor:"pointer", fontFamily:mono, fontSize:"12px", color: spotForm.image_url ? "#00b87a" : t2 }}>
                          {spotUploading ? "Uploading…" : spotForm.image_url ? "✓ Image added — click to change" : "Click to upload"}
                          <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display:"none" }} onChange={async e => {
                            const file = e.target.files?.[0]; if (!file) return
                            if (file.size > 5*1024*1024) { showToast(false, "Image must be under 5MB"); return }
                            setSpotForm(p=>({...p, image_url: URL.createObjectURL(file) }))
                            setSpotUploading(true)
                            try { const fd = new FormData(); fd.append("image", file); const r = await fetch("/api/upload", { method:"POST", body: fd }); const { url } = await r.json(); if (url) setSpotForm(p=>({...p, image_url: url })) }
                            catch { showToast(false, "Upload failed") } finally { setSpotUploading(false) }
                          }} />
                        </label>
                        {spotForm.image_url && (
                          <button type="button" onClick={()=>setSpotForm(p=>({...p, image_url:"", image_pos:"" }))} title="Remove image"
                            style={{ width:"36px", height:"36px", flexShrink:0, background:"rgba(224,51,72,0.08)", color:"#e03348", border:"1px solid rgba(224,51,72,0.25)", borderRadius:"7px", cursor:"pointer", fontSize:"13px" }}>✕</button>
                        )}
                      </div>
                    </div>

                    {/* Live preview — exactly how it appears */}
                    <div style={{ marginBottom:"14px" }}>
                      <div style={{ fontSize:"9px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"8px" }}>Live preview{spotForm.image_url ? " · drag the image to reposition" : ""}</div>
                      <SpotlightCard static editable={!!spotForm.image_url} onPosChange={pos => setSpotForm(p => ({ ...p, image_pos: pos }))} item={{ kind: spotForm.kind as any, title: spotForm.title, subtitle: spotForm.subtitle, image_url: spotForm.image_url, image_pos: spotForm.image_pos, cta_text: spotForm.cta_text, accent: spotForm.accent || "#3b6bff" }} />
                    </div>

                    <button onClick={createSpotlight} disabled={spotBusy} style={{ height:"38px", padding:"0 18px", background:"#1a56ff", color:"#fff", fontSize:"12px", fontWeight:600, border:"none", borderRadius:"8px", cursor: spotBusy?"not-allowed":"pointer", fontFamily:mono, opacity: spotBusy?.6:1 }}>{spotBusy ? "Creating…" : "Create & publish"}</button>
                  </div>

                  {/* List */}
                  {(!spotlight || spotlight.items.length === 0) ? (
                    <EmptyState icon="✦" title="No spotlight items yet" sub="Create one above, or approve a founder application when it lands here." />
                  ) : (
                    <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
                      {spotlight.items.map((it:any) => {
                        const tone = it.status==="active" ? "#00b87a" : it.status==="pending" ? "#e08810" : t3
                        return (
                        <div key={it.id} style={{ background:surf, border:"1px solid "+(it.status==="pending"?"rgba(224,136,16,0.35)":bdr), borderRadius:"10px", padding:"13px 16px", display:"flex", flexDirection:"column", gap:"12px" }}>
                          {/* Exactly how this banner will appear on the site — review before approving */}
                          <div style={{ maxWidth:"540px" }}>
                            <SpotlightCard static item={{ kind: it.kind, title: it.title, subtitle: it.subtitle, image_url: it.image_url, image_pos: it.image_pos, link_url: it.link_url, cta_text: it.cta_text, accent: it.accent || "#3b6bff" }} />
                          </div>
                          <div style={{ display:"flex", alignItems:"center", gap:"12px", flexWrap:"wrap" }}>
                            <span style={pill(tone, tone+"33")}>{it.status}</span>
                            <span style={{ fontSize:"9px", fontFamily:mono, color:t3, textTransform:"uppercase" }}>{it.kind}</span>
                            <div style={{ flex:1, minWidth:"180px" }}>
                              <div style={{ fontSize:"10px", fontFamily:mono, color:t3 }}>
                                {it.project_name ? `${it.project_name} · ` : ""}{it.created_by === "admin" ? "by admin" : (it.created_by === "token" ? "founder (link)" : "founder")} · {it.link_url || "no link"}
                              </div>
                            </div>
                            <div style={{ display:"flex", gap:"6px", flexShrink:0 }}>
                              {it.status === "pending" && <ActionBtn onClick={() => spotlightAction("PATCH", { id: it.id, action: "approve" })} color="green">Approve</ActionBtn>}
                              {it.status === "active"  && <ActionBtn onClick={() => spotlightAction("PATCH", { id: it.id, action: "deactivate" })} color="blue">Unpublish</ActionBtn>}
                              {it.status === "pending" && <ActionBtn onClick={() => { setRejectingSpotId(it.id); setRejectSpotReason("") }} color="red">Reject</ActionBtn>}
                              <ActionBtn onClick={() => spotlightAction("DELETE", undefined, it.id)} color="red">Delete</ActionBtn>
                            </div>
                          </div>
                          {rejectingSpotId === it.id && (
                            <div style={{ borderTop:"1px solid rgba(224,51,72,0.15)", paddingTop:"14px", marginTop:"2px" }}>
                              <div style={{ fontSize:"10px", fontFamily:mono, color:"#e03348", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"8px" }}>Rejection reason (sent to the founder)</div>
                              <select
                                value={rejectSpotReason}
                                onChange={e => setRejectSpotReason(e.target.value)}
                                style={{ width:"100%", background:surf2, border:"1px solid rgba(224,51,72,0.2)", borderRadius:"7px", padding:"8px 12px", fontSize:"12px", fontFamily:mono, color:rejectSpotReason ? t1 : t3, outline:"none", marginBottom:"8px", boxSizing:"border-box" as const }}
                              >
                                <option value="">Select a reason or type below...</option>
                                <option value="The banner image is low quality, blurry, or cropped awkwardly. Upload a cleaner, higher-resolution image and resubmit.">Banner image quality</option>
                                <option value="The headline or copy is unclear, too promotional, or doesn't describe what you're spotlighting. Refine the wording and resubmit.">Headline / copy needs work</option>
                                <option value="Your project isn't active or established enough on Arc Testnet yet to feature in the spotlight. Build some traction first, then reapply.">Not enough traction yet</option>
                                <option value="The spotlight slot is fully booked for your requested window. Please reapply for a later window.">Slot fully booked</option>
                                <option value="The link destination is broken or doesn't point to a relevant, working page.">Broken or irrelevant link</option>
                                <option value="The content doesn't fit ArcLens spotlight guidelines (no unrelated promotions, token sales, or off-topic content).">Doesn't fit guidelines</option>
                              </select>
                              <textarea
                                value={rejectSpotReason}
                                onChange={e => setRejectSpotReason(e.target.value)}
                                placeholder="Or write a custom reason..."
                                rows={2}
                                style={{ width:"100%", background:surf2, border:"1px solid rgba(224,51,72,0.2)", borderRadius:"7px", padding:"8px 12px", fontSize:"12px", fontFamily:mono, color:t1, outline:"none", resize:"vertical", lineHeight:1.6, boxSizing:"border-box" as const, marginBottom:"10px" }}
                              />
                              <div style={{ display:"flex", gap:"8px" }}>
                                <button
                                  onClick={async () => { const ok = await spotlightAction("PATCH", { id: it.id, action: "reject", reason: rejectSpotReason }); if (ok) { setRejectingSpotId(null); showToast(true, "Spotlight rejected — founder emailed") } }}
                                  disabled={spotBusy}
                                  style={{ height:"30px", padding:"0 16px", background:"rgba(224,51,72,0.12)", color:"#e03348", fontSize:"11px", border:"1px solid rgba(224,51,72,0.3)", borderRadius:"5px", cursor:"pointer", fontWeight:600, opacity:spotBusy?.6:1 }}>
                                  Confirm Reject
                                </button>
                                <button onClick={() => setRejectingSpotId(null)}
                                  style={{ height:"30px", padding:"0 14px", background:"transparent", color:t2, fontSize:"11px", border:"1px solid "+bdr, borderRadius:"5px", cursor:"pointer" }}>
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )})}
                    </div>
                  )}
                </div>
                )
              })()}

              {tab === "tracked" && (
                <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"10px", flexWrap:"wrap" }}>
                    <div style={{ fontSize:"13px", color:t2 }}>
                      {trackedLoading ? "Loading…" : tracked
                        ? <>
                            {tracked.counts.total} live ·{" "}
                            <span style={{ color: "#00b87a" }}>{tracked.counts.working} working</span> ·{" "}
                            <span style={{ color: "#e03348" }}>{tracked.counts.errored} errored</span> ·{" "}
                            <span style={{ color: t3 }}>{tracked.counts.quiet} quiet</span>
                          </>
                        : "—"}
                    </div>
                    <button onClick={() => loadTracked()} disabled={trackedLoading}
                      style={{ height:"30px", padding:"0 12px", background:"rgba(26,86,255,0.07)", color:"#8aaeff", fontSize:"11px", fontFamily:mono, border:"1px solid rgba(26,86,255,0.25)", borderRadius:"6px", cursor: trackedLoading ? "not-allowed" : "pointer" }}>
                      Refresh
                    </button>
                  </div>
                  {trackedError && (
                    <div style={{ padding:"10px 14px", background:"rgba(224,51,72,0.05)", border:"1px solid rgba(224,51,72,0.25)", borderRadius:"8px", fontSize:"12px", color:"#e03348", fontFamily:mono }}>
                      {trackedError}
                    </div>
                  )}

                  {(!tracked || tracked.contracts.length === 0) ? (
                    <EmptyState icon="◉" title="No tracked contracts yet" sub="When a founder registers a TVL/Volume/Revenue contract via deployer signature, it appears here automatically. Self-service — no approval needed." />
                  ) : (
                    <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
                      {tracked.contracts.map((c: any) => {
                        const statusMeta: Record<string, { color: string; bg: string; border: string; label: string }> = {
                          working:  { color:"#00b87a", bg:"rgba(0,184,122,0.1)",  border:"rgba(0,184,122,0.3)",  label:"✓ working" },
                          awaiting: { color:"#8aaeff", bg:"rgba(26,86,255,0.1)",  border:"rgba(26,86,255,0.3)",  label:"⏳ awaiting" },
                          errored:  { color:"#e03348", bg:"rgba(224,51,72,0.1)",  border:"rgba(224,51,72,0.3)",  label:"⚠ errored" },
                          quiet:    { color:t3,        bg:"rgba(107,125,168,0.1)", border:"rgba(107,125,168,0.25)", label:"🔇 quiet" },
                          revoked:  { color:t3,        bg:"rgba(255,255,255,0.04)", border:bdr, label:"⏸ revoked" },
                        }
                        const sm = statusMeta[c.status] || statusMeta.quiet
                        const roleColor = c.role === "tvl" ? "#8aaeff" : c.role === "volume" ? "#c08828" : c.role === "revenue" ? "#00b87a" : "#a855f7"
                        return (
                          <div key={c.id} style={{ background:surf, border:"1px solid "+bdr, borderRadius:"10px", padding:"14px 18px", opacity: c.status === "revoked" ? 0.55 : 1 }}>
                            <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"8px", flexWrap:"wrap" }}>
                              <span style={{ fontSize:"9px", fontFamily:mono, padding:"2px 7px", borderRadius:"4px", background:sm.bg, color:sm.color, border:"1px solid "+sm.border, textTransform:"uppercase", letterSpacing:"0.06em" }}>
                                {sm.label}
                              </span>
                              <span style={{ fontSize:"9px", fontFamily:mono, padding:"2px 7px", borderRadius:"4px", background: roleColor+"1a", color: roleColor, border:"1px solid "+roleColor+"33", textTransform:"uppercase", letterSpacing:"0.06em" }}>
                                {c.role}{c.role === "volume" && c.volume?.method ? ` · ${c.volume.method === "outflow_transfer" ? "outflow" : "swap"}` : ""}
                              </span>
                              <a href={`/ecosystem/${c.project_slug || c.project_id}`} target="_blank" rel="noopener noreferrer"
                                style={{ fontSize:"13px", fontWeight:600, color:"#8aaeff", textDecoration:"none" }}>
                                {c.project_name}
                              </a>
                              <span style={{ fontSize:"10px", fontFamily:mono, color:t3, marginLeft:"auto" }}>
                                {new Date(c.created_at).toLocaleString()}
                              </span>
                            </div>
                            <div style={{ display:"grid", gridTemplateColumns:"180px 1fr", gap:"6px 14px", fontSize:"11.5px", fontFamily:mono, marginBottom:"10px" }}>
                              <div style={{ color:t3 }}>Address</div>
                              <div style={{ color:t1, wordBreak:"break-all" }}>
                                <a href={`https://testnet.arcscan.app/address/${c.address}`} target="_blank" rel="noopener noreferrer" style={{ color:"#8aaeff", textDecoration:"none" }}>
                                  {c.address}
                                </a>
                              </div>
                              <div style={{ color:t3 }}>Deployer</div>
                              <div style={{ color:t2, wordBreak:"break-all" }}>{c.deployer_address || "—"}</div>
                              <div style={{ color:t3 }}>Label</div>
                              <div style={{ color:t1, display:"flex", alignItems:"center", gap:"8px" }}>
                                {trackedEdit?.id === c.id && trackedEdit.field === "label" ? (
                                  <>
                                    <input value={trackedEdit.value} onChange={e => setTrackedEdit({ ...trackedEdit, value: e.target.value })}
                                      style={{ background:surf2, border:"1px solid "+bdr, color:t1, padding:"4px 8px", borderRadius:"5px", fontFamily:mono, fontSize:"11.5px", width:"260px" }} />
                                    <button onClick={() => saveTrackedEdit(c.id, { label: trackedEdit.value })}
                                      style={{ fontSize:"10px", padding:"3px 9px", background:"rgba(0,184,122,0.1)", color:"#00b87a", border:"1px solid rgba(0,184,122,0.3)", borderRadius:"5px", cursor:"pointer", fontFamily:mono }}>Save</button>
                                    <button onClick={() => setTrackedEdit(null)}
                                      style={{ fontSize:"10px", padding:"3px 9px", background:"transparent", color:t3, border:"1px solid "+bdr, borderRadius:"5px", cursor:"pointer", fontFamily:mono }}>Cancel</button>
                                  </>
                                ) : (
                                  <>
                                    <span>{c.label || <span style={{ color:t3, fontStyle:"italic" }}>(none)</span>}</span>
                                    {!c.revoked_at && (
                                      <button onClick={() => setTrackedEdit({ id: c.id, field: "label", value: c.label || "" })}
                                        style={{ fontSize:"10px", padding:"2px 8px", background:"transparent", color:"#8aaeff", border:"1px solid rgba(26,86,255,0.25)", borderRadius:"5px", cursor:"pointer", fontFamily:mono }}>edit</button>
                                    )}
                                  </>
                                )}
                              </div>
                              <div style={{ color:t3 }}>Start block</div>
                              <div style={{ color:t2 }}>{Number(c.start_block).toLocaleString()}</div>
                              {c.role === "volume" && c.volume && (
                                <>
                                  <div style={{ color:t3 }}>Event signature</div>
                                  <div style={{ color:t2, wordBreak:"break-all" }}>{c.volume.event_signature || <span style={{ color:t3, fontStyle:"italic" }}>(outflow method — none required)</span>}</div>
                                  <div style={{ color:t3 }}>Amount arg / stable</div>
                                  <div style={{ color:t2 }}>{c.volume.amount_arg ?? "—"} · {c.volume.stablecoin_symbol || "—"}</div>
                                  <div style={{ color:t3 }}>Events captured</div>
                                  <div style={{ color: c.volume.event_count > 0 ? "#00b87a" : t3 }}>{c.volume.event_count.toLocaleString()}</div>
                                </>
                              )}
                              {c.role === "revenue" && c.revenue && (
                                <>
                                  <div style={{ color:t3 }}>Fee events captured</div>
                                  <div style={{ color: c.revenue.event_count > 0 ? "#00b87a" : t3 }}>{c.revenue.event_count.toLocaleString()}</div>
                                </>
                              )}
                              {c.role === "tvl" && c.tvl && (
                                <>
                                  <div style={{ color:t3 }}>Last indexed</div>
                                  <div style={{ color:t2 }}>{c.tvl.last_indexed_at ? new Date(c.tvl.last_indexed_at).toLocaleString() : "—"}</div>
                                </>
                              )}
                            </div>
                            {c.last_alert && (
                              <div style={{ padding:"8px 12px", background:"rgba(224,51,72,0.05)", border:"1px solid rgba(224,51,72,0.2)", borderRadius:"7px", marginBottom:"10px" }}>
                                <div style={{ fontSize:"10px", fontFamily:mono, color:"#e03348", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"4px" }}>
                                  Last alert · {c.last_alert.kind} · {new Date(c.last_alert.created_at).toLocaleString()}
                                </div>
                                <div style={{ fontSize:"11.5px", color:t1, lineHeight:1.5, wordBreak:"break-word" }}>{c.last_alert.message}</div>
                              </div>
                            )}
                            {c.revoked_at && (
                              <div style={{ fontSize:"10px", fontFamily:mono, color:t3, marginBottom:"6px" }}>
                                Revoked {new Date(c.revoked_at).toLocaleString()} {c.revoke_reason ? `· ${c.revoke_reason}` : ""}
                              </div>
                            )}
                            {!c.revoked_at && (
                              <button onClick={() => revokeTracked(c.id)}
                                style={{ height:"28px", padding:"0 12px", background:"rgba(224,51,72,0.06)", color:"#e03348", fontSize:"11px", fontFamily:mono, border:"1px solid rgba(224,51,72,0.2)", borderRadius:"6px", cursor:"pointer" }}>
                                Revoke
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── EDIT MODAL ── */}
      {/* Restore dialog — deliberately mirrors the hide dialog so the two halves
          of the same decision feel like one tool. */}
      {restoreFor && (
        <div onClick={() => setRestoreFor(null)}
          style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.72)", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(4px)" }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width:"100%", maxWidth:"520px", margin:"0 16px", background:surf, border:"1px solid "+bdr, borderRadius:"14px", padding:"26px" }}>
            <div style={{ fontSize:"16px", fontWeight:600, color:t1, marginBottom:"4px" }}>Restore: {restoreFor.name}</div>
            <div style={{ fontSize:"11px", fontFamily:mono, color:t3, marginBottom:"20px" }}>
              Puts it back in the public directory straight away.
            </div>

            <div style={{ fontSize:"11px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"8px" }}>Note to founder (optional)</div>
            <textarea value={restoreNote} onChange={e => setRestoreNote(e.target.value)} rows={3}
              placeholder="e.g. Thanks for getting the flag cleared."
              style={{ width:"100%", background:surf2, border:"1px solid "+bdr, borderRadius:"8px", padding:"10px 12px", fontSize:"12px", color:t1, outline:"none", boxSizing:"border-box" as const, fontFamily:"'Geist',sans-serif", resize:"vertical" as const, marginBottom:"14px" }} />

            <label style={{ display:"flex", alignItems:"center", gap:"8px", cursor:"pointer", fontSize:"12px", color:t2, marginBottom:"20px" }}>
              <input type="checkbox" checked={restoreNotify} onChange={e => setRestoreNotify(e.target.checked)} />
              Email the founder
            </label>

            <div style={{ display:"flex", gap:"10px" }}>
              <button disabled={acting}
                onClick={async () => {
                  const p = restoreFor
                  setRestoreFor(null)
                  await act(p.id, "restore-listing", "projects", { note: restoreNote, notify: restoreNotify })
                  setRestoreNote("")
                }}
                style={{ flex:1, height:"40px", background:"#00976a", color:"#fff", fontSize:"13px", fontWeight:600, border:"none", borderRadius:"8px", cursor:"pointer", fontFamily:"'Geist',sans-serif" }}>
                Restore listing
              </button>
              <button onClick={() => setRestoreFor(null)}
                style={{ height:"40px", padding:"0 20px", background:"transparent", color:t2, fontSize:"13px", border:"1px solid "+bdr, borderRadius:"8px", cursor:"pointer", fontFamily:"'Geist',sans-serif" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hide dialog — pick why, optionally add a note, and the founder gets an
          email explaining what to fix and that the listing is recoverable. */}
      {hideFor && (
        <div onClick={() => setHideFor(null)}
          style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.72)", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(4px)" }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width:"100%", maxWidth:"520px", margin:"0 16px", background:surf, border:"1px solid "+bdr, borderRadius:"14px", padding:"26px", maxHeight:"86vh", overflowY:"auto" }}>
            <div style={{ fontSize:"16px", fontWeight:600, color:t1, marginBottom:"4px" }}>Hide: {hideFor.name}</div>
            <div style={{ fontSize:"11px", fontFamily:mono, color:t3, marginBottom:"20px" }}>
              Removes it from the public directory. Nothing is deleted — restore any time.
            </div>

            <div style={{ fontSize:"11px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"10px" }}>Reason</div>
            <div style={{ display:"flex", flexDirection:"column", gap:"6px", marginBottom:"18px" }}>
              {[
                ["security",   "Security flag",          "Website flagged malicious by security vendors"],
                ["offline",    "Website unreachable",    "Site errors or does not respond"],
                ["not_arc",    "No Arc connection",      "No evidence the project builds on Arc"],
                ["branding",   "Misleading branding",    "Name could be mistaken for another company"],
                ["duplicate",  "Duplicate listing",      "Same project already listed"],
                ["no_domain",  "No project domain",      "Points at free hosting, not an owned domain"],
                ["incomplete", "Incomplete information", "Missing details needed to verify"],
                ["other",      "Other",                  "Use the note below to explain"],
              ].map(([k, l, d]) => (
                <label key={k} style={{ display:"flex", alignItems:"flex-start", gap:"10px", cursor:"pointer", padding:"9px 11px",
                          background: hideReason === k ? "rgba(26,86,255,0.08)" : "transparent",
                          border:"1px solid "+(hideReason === k ? "rgba(26,86,255,0.35)" : bdr), borderRadius:"8px" }}>
                  <input type="radio" name="hidereason" checked={hideReason === k} onChange={() => setHideReason(k)} style={{ marginTop:"2px" }} />
                  <span>
                    <span style={{ fontSize:"12px", fontWeight:600, color:t1, display:"block" }}>{l}</span>
                    <span style={{ fontSize:"11px", color:t3 }}>{d}</span>
                  </span>
                </label>
              ))}
            </div>

            <div style={{ fontSize:"11px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"8px" }}>Note to founder (optional)</div>
            <textarea value={hideNote} onChange={e => setHideNote(e.target.value)} rows={3}
              placeholder="Anything specific they should know…"
              style={{ width:"100%", background:surf2, border:"1px solid "+bdr, borderRadius:"8px", padding:"10px 12px", fontSize:"12px", color:t1, outline:"none", boxSizing:"border-box" as const, fontFamily:"'Geist',sans-serif", resize:"vertical" as const, marginBottom:"14px" }} />

            <label style={{ display:"flex", alignItems:"center", gap:"8px", cursor:"pointer", fontSize:"12px", color:t2, marginBottom:"20px" }}>
              <input type="checkbox" checked={hideNotify} onChange={e => setHideNotify(e.target.checked)} />
              Email the founder
            </label>

            <div style={{ display:"flex", gap:"10px" }}>
              <button disabled={acting}
                onClick={async () => {
                  const p = hideFor
                  setHideFor(null)
                  await act(p.id, "hide-listing", "projects", { reason: hideReason, note: hideNote, notify: hideNotify })
                  setHideNote("")
                }}
                style={{ flex:1, height:"40px", background:"#c04545", color:"#fff", fontSize:"13px", fontWeight:600, border:"none", borderRadius:"8px", cursor:"pointer", fontFamily:"'Geist',sans-serif" }}>
                Hide listing
              </button>
              <button onClick={() => setHideFor(null)}
                style={{ height:"40px", padding:"0 20px", background:"transparent", color:t2, fontSize:"13px", border:"1px solid "+bdr, borderRadius:"8px", cursor:"pointer", fontFamily:"'Geist',sans-serif" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:"20px" }}>
          <div style={{ background:"var(--surf,#0a0e1a)", border:"1px solid var(--bdr,rgba(255,255,255,0.06))", borderRadius:"16px", padding:"28px", width:"100%", maxWidth:"560px", maxHeight:"90vh", overflowY:"auto" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"20px" }}>
              <div style={{ fontSize:"16px", fontWeight:600, color:t1 }}>Edit: {editing.name}</div>
              <button onClick={() => setEditing(null)} style={{ background:"none", border:"none", color:t2, cursor:"pointer", fontSize:"20px", lineHeight:1 }}>×</button>
            </div>

            {/* Logo — direct upload, applies instantly on save (no raw URL) */}
            <div style={{ display:"flex", alignItems:"center", gap:"14px", marginBottom:"16px", paddingBottom:"16px", borderBottom:"1px solid "+bdr }}>
              <div style={{ width:56, height:56, borderRadius:11, background:surf2, border:"1px solid "+bdr, flexShrink:0, overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center" }}>
                {(editForm as any).logo_url
                  ? <img src={String((editForm as any).logo_url).startsWith("http") ? `/api/image-proxy?url=${encodeURIComponent((editForm as any).logo_url)}` : (editForm as any).logo_url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} onError={e=>(e.currentTarget.style.display="none")} />
                  : <span style={{ fontSize:20, fontWeight:700, color:t3, fontFamily:mono }}>{(editing.name||"?").slice(0,1).toUpperCase()}</span>}
              </div>
              <div>
                <label style={{ display:"block", fontSize:"10px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"5px" }}>Logo</label>
                <label style={{ display:"inline-flex", alignItems:"center", gap:8, height:32, padding:"0 14px", background:surf2, border:"1px solid "+bdr, borderRadius:7, fontSize:12, fontFamily:mono, color:logoUploading?t3:t1, cursor:logoUploading?"default":"pointer" }}>
                  {logoUploading ? "Uploading…" : (editForm as any).logo_url ? "Change logo" : "Upload logo"}
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" disabled={logoUploading}
                    onChange={e=>{ const f=e.target.files?.[0]; if(f) uploadAdminLogo(f); e.currentTarget.value="" }} style={{ display:"none" }} />
                </label>
              </div>
            </div>

            {[
              {k:"name",l:"Name",type:"text"},{k:"tagline",l:"Tagline",type:"text"},{k:"description",l:"Description",type:"textarea"},
              {k:"website",l:"Website",type:"text"},{k:"twitter",l:"Twitter",type:"text"},{k:"github",l:"GitHub",type:"text"},
              {k:"discord",l:"Discord",type:"text"},{k:"contract",l:"Primary Contract Address",type:"text"},{k:"email",l:"Email",type:"text"},
              {k:"founder_social",l:"Founder (personal X / link)",type:"text"},
              {k:"city",l:"City",type:"text"},{k:"country",l:"Country",type:"text"},
              {k:"lat",l:"Latitude",type:"text"},{k:"lng",l:"Longitude",type:"text"},
            ].map((f:any) => (
              <div key={f.k} style={{ marginBottom:"10px" }}>
                <label style={{ display:"block", fontSize:"10px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"4px" }}>{f.l}</label>
                {f.type==="textarea"
                  ? <textarea value={(editForm as any)[f.k]||""} onChange={e=>setEditForm(p=>({...p,[f.k]:e.target.value}))}
                      style={{ width:"100%", height:"72px", background:"var(--surf2,#0e1224)", border:"1px solid var(--bdr,rgba(255,255,255,0.06))", borderRadius:"7px", padding:"8px 12px", fontSize:"12px", fontFamily:mono, color:t1, outline:"none", resize:"vertical", boxSizing:"border-box" }} />
                  : <input value={(editForm as any)[f.k]||""} onChange={e=>setEditForm(p=>({...p,[f.k]:e.target.value}))}
                      style={{ width:"100%", height:"36px", background:"var(--surf2,#0e1224)", border:"1px solid var(--bdr,rgba(255,255,255,0.06))", borderRadius:"7px", padding:"0 12px", fontSize:"12px", fontFamily:mono, color:t1, outline:"none", boxSizing:"border-box" }} />
                }
              </div>
            ))}
            {/* Additional contract addresses */}
            <div style={{ marginBottom:"10px" }}>
              <label style={{ display:"block", fontSize:"10px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"6px" }}>Additional Contract Addresses</label>
              {((editForm as any).contracts || []).map((addr: string, i: number) => (
                <div key={i} style={{ display:"flex", gap:"6px", marginBottom:"6px" }}>
                  <input value={addr} onChange={e => setEditForm(p => { const arr = [...((p as any).contracts||[])]; arr[i]=e.target.value; return {...p, contracts: arr} })}
                    style={{ flex:1, height:"34px", background:"var(--surf2,#0e1224)", border:"1px solid var(--bdr,rgba(255,255,255,0.06))", borderRadius:"7px", padding:"0 10px", fontSize:"11px", fontFamily:mono, color:t1, outline:"none", boxSizing:"border-box" as any }} placeholder="0x..." />
                  <button onClick={() => setEditForm(p => { const arr = ((p as any).contracts||[]).filter((_:any, j:number)=>j!==i); return {...p, contracts: arr} })}
                    style={{ height:"34px", padding:"0 10px", background:"rgba(224,51,72,0.08)", color:"#e03348", border:"1px solid rgba(224,51,72,0.2)", borderRadius:"7px", cursor:"pointer", fontSize:"12px" }}>✕</button>
                </div>
              ))}
              <button onClick={() => setEditForm(p => ({...p, contracts: [...((p as any).contracts||[]), ""]}))}
                style={{ height:"30px", padding:"0 12px", background:"rgba(26,86,255,0.08)", color:"#8aaeff", border:"1px solid rgba(26,86,255,0.2)", borderRadius:"6px", cursor:"pointer", fontSize:"11px", fontFamily:mono }}>
                + Add Contract
              </button>
            </div>
            <div style={{ marginBottom:"10px" }}>
              <label style={{ display:"block", fontSize:"10px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"4px" }}>Category</label>
              <select value={editForm.category||""} onChange={e=>setEditForm(p=>({...p,category:e.target.value}))}
                style={{ width:"100%", height:"36px", background:"var(--surf2,#0e1224)", border:"1px solid var(--bdr,rgba(255,255,255,0.06))", borderRadius:"7px", padding:"0 10px", fontSize:"12px", fontFamily:mono, color:t1, outline:"none" }}>
                {CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ fontSize:"11px", fontFamily:mono, color:t2, textTransform:"uppercase", letterSpacing:"0.1em", margin:"6px 0 12px", paddingTop:"14px", borderTop:"1px solid var(--bdr,rgba(255,255,255,0.08))" }}>Trust &amp; verification</div>
            <div style={{ display:"flex", gap:"16px", marginBottom:"18px" }}>
              <div style={{ flex:1 }}>
                <label style={{ display:"block", fontSize:"10px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"4px" }}>Trust level <span style={{ textTransform:"none", letterSpacing:0, color:t3 }}>· automatic</span></label>
                <div style={{ height:"36px", display:"flex", alignItems:"center", gap:"8px", background:"var(--surf2,#0e1224)", border:"1px solid var(--bdr,rgba(255,255,255,0.06))", borderRadius:"7px", padding:"0 10px", fontSize:"12px", fontFamily:mono, color:t2 }}>
                  {editForm.trust_level||"listed"}
                  <span style={{ fontSize:"10px", color:t3 }}>— set by claim + contract checks</span>
                </div>
              </div>
              <div style={{ flex:1 }}>
                <label style={{ display:"block", fontSize:"10px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"4px" }}>Recognition</label>
                <select value={editForm.recognition||"none"} onChange={e=>setEditForm(p=>({...p,recognition:e.target.value}))}
                  style={{ width:"100%", height:"36px", background:"var(--surf2,#0e1224)", border:"1px solid var(--bdr,rgba(255,255,255,0.06))", borderRadius:"7px", padding:"0 10px", fontSize:"12px", fontFamily:mono, color:t1, outline:"none" }}>
                  <option value="none">None</option>
                  <option value="partner">Arc Partner</option>
                  <option value="official">Arc Official</option>
                </select>
              </div>
            </div>
            <div style={{ background:"var(--surf2,#0e1224)", border:"1px solid var(--bdr,rgba(255,255,255,0.06))", borderRadius:"8px", padding:"12px 14px", marginBottom:"18px" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"10px" }}>
                <div style={{ fontSize:"10px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.08em" }}>Safety checks (advisory — you still decide)</div>
                <button
                  onClick={async () => {
                    if (!editing) return
                    setAssessing(true); setAssess(null)
                    try {
                      const r = await fetch("/api/admin", { method:"POST", headers:{ "Content-Type":"application/json", Authorization:`Bearer ${password}` }, body: JSON.stringify({ id: editing.id, action:"assess-project" }) })
                      const j = await r.json().catch(()=>({})); if (r.ok) setAssess(j)
                    } finally { setAssessing(false) }
                  }}
                  disabled={assessing}
                  style={{ height:"28px", padding:"0 12px", background:"transparent", color:t2, fontSize:"11px", fontFamily:mono, border:"1px solid var(--bdr,rgba(255,255,255,0.12))", borderRadius:"6px", cursor: assessing ? "default" : "pointer" }}>
                  {assessing ? "Checking…" : "Run checks"}
                </button>
              </div>
              {assess && (
                <div style={{ fontSize:"11px", fontFamily:mono, color:t2, lineHeight:1.7, marginTop:"10px" }}>
                  {assess.hardRisk && <div style={{ color:"#e03348", fontWeight:700, marginBottom:"4px" }}>HARD RISK — website on scam list (auto-red)</div>}
                  {assess.profile?.caution && <div style={{ color:"#e0a020", fontWeight:600, marginBottom:"4px" }}>caution: {assess.profile.caution_note}</div>}
                  <div>website: {assess.profile?.website?.verdict || "—"}</div>
                  {((assess.profile?.contracts || []).length === 0) && <div style={{ color:t3 }}>no contracts registered</div>}
                  {(assess.profile?.contracts || []).map((c:any, idx:number) => (
                    <div key={idx} style={{ marginTop:"4px", color:t1 }}>
                      {c.role} {String(c.address).slice(0,8)}… — source {c.source_verified ? "verified" : "NOT verified"} · {c.upgradeable ? "upgradeable(" + c.admin + ")" : "immutable"} · owner {c.ownership}{c.powers_to_review?.length ? " · powers: " + c.powers_to_review.join(",") : ""}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ background:"var(--surf2,#0e1224)", border:"1px solid var(--bdr,rgba(255,255,255,0.06))", borderRadius:"8px", padding:"12px 14px", marginBottom:"18px" }}>
              <div style={{ fontSize:"10px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"8px" }}>
                Verified — independent audit
                {(editForm as any).audit_status === "pending" && <span style={{ marginLeft:"8px", color:"#e08810", textTransform:"none", letterSpacing:0 }}>· founder submitted, awaiting review</span>}
              </div>
              <div style={{ display:"flex", gap:"10px", marginBottom:"10px" }}>
                <input value={(editForm as any).auditor || ""} onChange={e=>setEditForm(p=>({...p, auditor:e.target.value}))} placeholder="Auditor (e.g. Hacken, CertiK)"
                  style={{ flex:1, height:"34px", background:"var(--surf,#070b18)", border:"1px solid var(--bdr,rgba(255,255,255,0.1))", borderRadius:"6px", padding:"0 10px", fontSize:"12px", fontFamily:mono, color:t1, outline:"none" }} />
                <input value={(editForm as any).audit_url || ""} onChange={e=>setEditForm(p=>({...p, audit_url:e.target.value}))} placeholder="Report URL"
                  style={{ flex:2, height:"34px", background:"var(--surf,#070b18)", border:"1px solid var(--bdr,rgba(255,255,255,0.1))", borderRadius:"6px", padding:"0 10px", fontSize:"12px", fontFamily:mono, color:t1, outline:"none" }} />
              </div>
              <label style={{ display:"flex", alignItems:"center", gap:"8px", cursor:"pointer", fontSize:"12px", color:(editForm as any).audited ? "#00c896" : t2 }}>
                <input type="checkbox" checked={!!(editForm as any).audited} onChange={e=>setEditForm(p=>({...p, audited:e.target.checked}))} />
                Verified — audit confirmed (grants the green ✓)
              </label>
            </div>
            <div style={{ background:"var(--surf2,#0e1224)", border:"1px solid var(--bdr,rgba(255,255,255,0.06))", borderRadius:"8px", padding:"12px 14px", marginBottom:"18px" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"10px" }}>
                <div style={{ fontSize:"10px", fontFamily:mono, color:t3, textTransform:"uppercase", letterSpacing:"0.08em" }}>
                  Established — track record
                  {(editForm as any).established && <span style={{ marginLeft:"8px", color:"#8aaeff", textTransform:"none", letterSpacing:0 }}>· granted</span>}
                </div>
                <button
                  onClick={async () => {
                    if (!editing) return
                    setEstChecking(true); setEstCheck(null)
                    try {
                      const r = await fetch("/api/admin", { method:"POST", headers:{ "Content-Type":"application/json", Authorization:`Bearer ${password}` }, body: JSON.stringify({ id: editing.id, action:"check-established" }) })
                      const j = await r.json().catch(()=>({})); if (r.ok) setEstCheck(j)
                    } finally { setEstChecking(false) }
                  }}
                  disabled={estChecking}
                  style={{ height:"28px", padding:"0 12px", background:"transparent", color:t2, fontSize:"11px", fontFamily:mono, border:"1px solid var(--bdr,rgba(255,255,255,0.12))", borderRadius:"6px", cursor: estChecking ? "default":"pointer" }}>
                  {estChecking ? "Checking…" : "Check eligibility"}
                </button>
              </div>
              {estCheck && (
                <div style={{ fontSize:"11px", fontFamily:mono, color:t2, lineHeight:1.7, marginTop:"10px" }}>
                  <div style={{ color: estCheck.eligible ? "#00c896" : "#e08810", fontWeight:700 }}>
                    {estCheck.eligible ? "✓ ELIGIBLE" : "✗ NOT ELIGIBLE"}
                  </div>
                  <div>deploy age: {estCheck.ageDays ?? "unknown"}{estCheck.ageDays!=null?"d":""} · distinct callers: {estCheck.distinctCallers} · claimed: {String(estCheck.claimed)}</div>
                  {(estCheck.reasons||[]).length>0 && <div style={{ color:t3 }}>blocked by: {estCheck.reasons.join(", ")}</div>}
                </div>
              )}
              <label style={{ display:"flex", alignItems:"center", gap:"8px", cursor:((editForm as any).established || estCheck?.eligible) ? "pointer":"not-allowed", fontSize:"12px", color:(editForm as any).established ? "#8aaeff" : t2, marginTop:"10px", opacity:((editForm as any).established || estCheck?.eligible) ? 1 : 0.5 }}>
                <input type="checkbox" checked={!!(editForm as any).established}
                  disabled={!((editForm as any).established || estCheck?.eligible)}
                  onChange={async e => {
                    const next = e.target.checked
                    try {
                      const r = await fetch("/api/admin", { method:"POST", headers:{ "Content-Type":"application/json", Authorization:`Bearer ${password}` }, body: JSON.stringify({ id: editing!.id, action:"set-established", data:{ established: next } }) })
                      if (r.ok) { setEditForm(p=>({...p, established: next } as any)); showToast(true, next ? "Established granted" : "Established removed") }
                      else showToast(false, "Failed")
                    } catch { showToast(false, "Network error") }
                  }} />
                Grant Established (only enabled once it passes the eligibility check)
              </label>
            </div>
            <div style={{ display:"flex", gap:"16px", marginBottom:"18px" }}>
              {[{k:"featured",l:"Featured"},{k:"live",l:"Live"}].map((f:any) => (
                <label key={f.k} style={{ display:"flex", alignItems:"center", gap:"8px", cursor:"pointer", fontSize:"12px", color:t2 }}>
                  <input type="checkbox" checked={!!(editForm as any)[f.k]} onChange={e=>setEditForm(p=>({...p,[f.k]:e.target.checked}))} />
                  {f.l}
                </label>
              ))}
            </div>
            <div style={{ display:"flex", gap:"10px" }}>
              <button onClick={saveEdit} disabled={acting}
                style={{ flex:1, height:"40px", background:"#1a56ff", color:"#fff", fontSize:"13px", fontWeight:600, border:"none", borderRadius:"8px", cursor:"pointer", fontFamily:"'Geist',sans-serif" }}>
                {acting?"Saving...":"Save Changes"}
              </button>
              <button onClick={() => setEditing(null)}
                style={{ height:"40px", padding:"0 20px", background:"transparent", color:t2, fontSize:"13px", border:"1px solid "+bdr, borderRadius:"8px", cursor:"pointer", fontFamily:"'Geist',sans-serif" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </ArcLayout>
  )
}

// ── Shared micro-components ──
function pill(color: string, border: string): React.CSSProperties {
  return { fontSize:"9px", fontFamily:"'DM Mono',monospace", padding:"2px 7px", borderRadius:"4px", color, border:`1px solid ${border}`, background:"transparent", display:"inline-flex", alignItems:"center" }
}

function ActionBtn({ onClick, disabled, color, children }: { onClick: () => void; disabled?: boolean; color: "green"|"blue"|"red"; children: React.ReactNode }) {
  const colors = {
    green: { bg:"rgba(0,184,122,0.1)", text:"#00d990", border:"rgba(0,184,122,0.2)" },
    blue:  { bg:"rgba(26,86,255,0.08)", text:"#8aaeff", border:"rgba(26,86,255,0.2)" },
    red:   { bg:"rgba(224,51,72,0.08)", text:"#e03348", border:"rgba(224,51,72,0.2)" },
  }[color]
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ height:"30px", padding:"0 12px", background:colors.bg, color:colors.text, fontSize:"11px", border:`1px solid ${colors.border}`, borderRadius:"5px", cursor:"pointer", fontFamily:"'Geist',sans-serif", opacity:disabled?.6:1 }}>
      {children}
    </button>
  )
}

function EmptyState({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <div style={{ padding:"64px", textAlign:"center" }}>
      <div style={{ fontSize:"32px", marginBottom:"12px" }}>{icon}</div>
      <div style={{ fontSize:"15px", fontWeight:600, color:"var(--t1,#e8ecff)", marginBottom:"6px" }}>{title}</div>
      <div style={{ fontSize:"12px", color:"var(--t2,#6b7da8)", fontFamily:"'DM Mono',monospace" }}>{sub}</div>
    </div>
  )
}
