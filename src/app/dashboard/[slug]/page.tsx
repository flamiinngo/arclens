"use client"
import { useEffect, useState } from "react"
import { useParams, useSearchParams } from "next/navigation"
import ArcLayout from "@/components/ArcLayout"
import { WalletAvatar } from "@/components/WalletAvatar"
import { SpotlightCard } from "@/components/Spotlight"
import { useArcStore } from "@/store/arc"
import TvlTrackingPanel from "./TvlTrackingPanel"
import LensEarningsPanel from "@/components/LensEarningsPanel"
import { freeHostOf, hostFromUrl } from "@/lib/submissionGuards"
import { trustBadge } from "@/lib/trustBadge"

interface Project {
  id: number; name: string; slug: string; tagline: string; description: string
  category: string; logo_url: string | null; website: string | null
  twitter: string | null; github: string | null; discord: string | null
  contract: string | null; featured: boolean; badge: string | null
  color: string | null; email: string; claimed_at: string | null
  view_count: number; owner_wallet: string | null
  trust_level?: string | null; recognition?: string | null; established?: boolean | null
}

interface Review {
  id: number; wallet: string; category: string; rating: number
  review_text: string; is_public: boolean; contact: string | null
  badge: string; created_at: string
}

export default function DashboardPage() {
  const { slug }     = useParams<{ slug: string }>()
  const searchParams = useSearchParams()
  const token        = searchParams.get("token")

  const [project, setProject]       = useState<Project | null>(null)
  const [reviews, setReviews]       = useState<Review[]>([])
  const [weekViews, setWeekViews]   = useState(0)
  const [prevWeekViews, setPrevWeekViews] = useState(0)
  // Attention-panel inputs. Each is a state the founder can already be in; the
  // dashboard simply never told them about it before.
  const [pendingUpdate, setPendingUpdate]   = useState<{ count: number; oldest: string; fields: string[] } | null>(null)
  const [unratedSubs, setUnratedSubs]       = useState<{ count: number; oldest: string } | null>(null)
  const [urlScan, setUrlScan]               = useState<{ verdict: string | null; malicious: number; suspicious: number } | null>(null)
  const [hasWallet, setHasWallet]   = useState(false)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState("")
  const [mounted, setMounted]       = useState(false)
  const [activeTab, setActiveTab]   = useState<"overview"|"reviews"|"private"|"forge"|"edit"|"trust"|"tvl">("overview")
  const [forgeCampaigns, setForgeCampaigns]   = useState<any[]>([])
  const [connectedWallet, setConnectedWallet] = useState<string | null>(null)

  // Forge inline detail state
  const [selectedCampaignId, setSelectedCampaignId]     = useState<number | null>(null)
  const [campaignDetail, setCampaignDetail]             = useState<{ campaign: any; completions: any[] } | null>(null)
  const [campaignDetailLoading, setCampaignDetailLoading] = useState(false)
  const [expandedTesters, setExpandedTesters]           = useState<Set<string>>(new Set())
  const [showRatedSubs, setShowRatedSubs]               = useState(false)
  const [dashRatingWallet, setDashRatingWallet]         = useState("")
  const [dashRatingVal, setDashRatingVal]               = useState(0)
  const [dashRatingPerQ, setDashRatingPerQ]             = useState<Record<string, number>>({})
  const [dashRatingImpact, setDashRatingImpact]         = useState(false)
  const [dashRatingLoading, setDashRatingLoading]       = useState(false)
  const [dashRatingMsg, setDashRatingMsg]               = useState<string | null>(null)
  const [fundingCampaign, setFundingCampaign]           = useState(false)
  const [fundMsg, setFundMsg]                           = useState<string | null>(null)
  const [savingWallet, setSavingWallet]                 = useState(false)
  const [walletSaved, setWalletSaved]                   = useState(false)

  // Edit form
  const [editForm, setEditForm]   = useState({ tagline: "", description: "", website: "", twitter: "", github: "", discord: "", contract: "", color: "", city: "", country: "", founder_social: "", logo_url: "" })
  const [logoUploading, setLogoUploading] = useState(false)
  const [auditForm, setAuditForm] = useState({ auditor: "", audit_url: "" })
  const [auditMsg, setAuditMsg]   = useState<{ ok: boolean; text: string } | null>(null)
  const [auditSubmitting, setAuditSubmitting] = useState(false)
  const [spotForm, setSpotForm]   = useState({ title: "", subtitle: "", image_url: "", image_pos: "", cta_text: "" })
  const [spotMode, setSpotMode]   = useState<"campaign" | "custom">("campaign")
  const [spotCampaign, setSpotCampaign] = useState("")
  const [spotDurN, setSpotDurN]   = useState(7)
  const [spotDurUnit, setSpotDurUnit] = useState<"days" | "hours">("days")
  const [spotMsg, setSpotMsg]     = useState<{ ok: boolean; text: string } | null>(null)
  const [spotSubmitting, setSpotSubmitting] = useState(false)
  const [spotUploading, setSpotUploading] = useState(false)
  // Spotlight draft — progress survives reload (mirrors the campaign drafts).
  // Blob preview URLs are never persisted (they die on reload).
  useEffect(() => {
    try { const raw = localStorage.getItem("arclens-spotlight-draft"); if (raw) setSpotForm(JSON.parse(raw)) } catch {}
  }, [])
  useEffect(() => {
    try { localStorage.setItem("arclens-spotlight-draft", JSON.stringify({ ...spotForm, image_url: spotForm.image_url.startsWith("blob:") ? "" : spotForm.image_url })) } catch {}
  }, [spotForm])
  const [extraContracts, setExtraContracts] = useState<string[]>([])
  const [saving, setSaving]       = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState("")

  const mono  = "'DM Mono', monospace"
  const bdr   = "var(--bdr, rgba(255,255,255,0.06))"
  const surf  = "var(--surf, #0a0e1a)"
  const surf2 = "var(--surf2, #0e1224)"
  const t1    = "var(--t1, #e8ecff)"
  const t2    = "var(--t2, #6b7da8)"
  const t3    = "var(--t3, #2e3a5c)"
  const green = "#00b87a"

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!mounted) return

    async function tryWalletAuth() {
      await new Promise(r => setTimeout(r, 500))

      // Source of truth is localStorage — ArcLayout sets it on connect for
      // both Circle and browser wallets. If a wallet is saved, the backend
      // will accept/reject it; we don't need MetaMask to be unlocked to
      // authenticate (that was the old bug — locked extension → claim form).
      const savedAddr = localStorage.getItem("arclens-wallet")
      if (savedAddr) {
        setConnectedWallet(savedAddr)
        useArcStore.getState().setWallet(savedAddr)
        await loadDashboardWithToken(null, savedAddr)
        return true
      }

      // No saved wallet — last-ditch attempt via window.ethereum (covers
      // first-time visitors who connected MetaMask elsewhere and arrived
      // here cold). PATCH first to confirm ownership before showing data.
      try {
        if (typeof window !== "undefined" && (window as any).ethereum) {
          const accounts = await (window as any).ethereum.request({ method: "eth_accounts" })
          if (accounts?.[0]) {
            setConnectedWallet(accounts[0])
            const res  = await fetch("/api/claim", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: accounts[0] }) })
            const data = await res.json()
            const match = data.projects?.[0]
            if (match) {
              localStorage.setItem("arclens-wallet", accounts[0].toLowerCase())
              useArcStore.getState().setWallet(accounts[0].toLowerCase())
              await loadDashboardWithToken(null, accounts[0])
              return true
            }
          }
        }
      } catch { }
      return false
    }

    async function loadDashboardWithToken(tok: string | null, wallet?: string) {
      try {
        const params = new URLSearchParams()
        if (slug)   params.set("slug", slug)
        if (tok)    params.set("token", tok)
        if (wallet) params.set("wallet", wallet)
        const res  = await fetch(`/api/claim?${params}`)
        const data = await res.json()
        if (!res.ok) { setError(data.error || "Access denied"); return }
        setProject(data.project)
        setReviews(data.reviews || [])
        setWeekViews(data.weekViews || 0)
        setPrevWeekViews(data.prevWeekViews || 0)
        setPendingUpdate(data.pendingUpdate || null)
        setUnratedSubs(data.unratedSubmissions || null)
        setUrlScan(data.urlScan || null)
        setHasWallet(data.hasWallet || false)
        if (wallet) {
          fetch(`/api/trials?creator=${wallet}`)
            .then(r => r.json())
            .then(d => setForgeCampaigns(d.campaigns || []))
            .catch(() => {})
        }
        setEditForm({
          tagline: data.project.tagline || "", description: data.project.description || "",
          website: data.project.website || "", twitter: data.project.twitter || "",
          github: data.project.github || "", discord: data.project.discord || "",
          contract: data.project.contract || "", color: data.project.color || "",
          city: data.project.city || "", country: data.project.country || "",
          founder_social: data.project.founder_social || "",
          logo_url: data.project.logo_url || "",
        })
        setExtraContracts(Array.isArray(data.project.contracts) ? data.project.contracts : [])
      } catch { setError("Failed to load dashboard") }
      finally { setLoading(false) }
    }

    async function init() {
      if (token) {
        await loadDashboardWithToken(token)
        try {
          if ((window as any).ethereum) {
            const accounts = await (window as any).ethereum.request({ method: "eth_accounts" })
            if (accounts?.[0]) setConnectedWallet(accounts[0])
          }
        } catch { }
      } else {
        const walletAuthed = await tryWalletAuth()
        if (!walletAuthed) setLoading(false)
      }
    }

    init()
  }, [mounted, slug, token])

  async function openCampaign(id: number) {
    setSelectedCampaignId(id)
    setCampaignDetail(null)
    setCampaignDetailLoading(true)
    setDashRatingWallet("")
    setDashRatingVal(0)
    setDashRatingMsg(null)
    setExpandedTesters(new Set())
    setFundMsg(null)
    try {
      const res  = await fetch(`/api/trials/${id}`)
      const data = await res.json()
      if (data.campaign) setCampaignDetail(data)
    } finally { setCampaignDetailLoading(false) }
  }

  // Re-fetch campaign data WITHOUT blanking the panel — used after a rating so
  // the founder never sees a full-panel "Loading…" flash. The optimistic local
  // update has already moved the row out of the queue; this just reconciles the
  // server-computed XP/score quietly in the background.
  async function refreshCampaignSilently(id: number | null) {
    if (!id) return
    try {
      const res  = await fetch(`/api/trials/${id}`)
      const data = await res.json()
      if (data.campaign) setCampaignDetail(data)
    } catch { /* keep the optimistic state on a transient failure */ }
  }

  function toggleTester(wallet: string) {
    setExpandedTesters(prev => {
      const next = new Set(prev)
      if (next.has(wallet)) next.delete(wallet); else next.add(wallet)
      return next
    })
  }

  async function submitDashRating() {
    if (!dashRatingWallet || !selectedCampaignId) return
    // Mode B: every question must be rated 1-5 before submit. Mode A: just one rating.
    const camp = campaignDetail?.campaign
    const isModeB = camp?.xp_mode === "per_question" && camp?.max_xp_per_completion != null
    if (isModeB) {
      const qs = camp?.review_questions || []
      const missing = qs.find((q: { id: string }) => !dashRatingPerQ[q.id] || dashRatingPerQ[q.id] < 1)
      if (missing) return  // button is disabled anyway
    } else {
      if (!dashRatingVal) return
    }
    setDashRatingLoading(true)
    setDashRatingMsg(null)
    try {
      const res = await fetch(`/api/trials/${selectedCampaignId}/rate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tester_wallet:    dashRatingWallet,
          rating:           isModeB ? null : dashRatingVal,
          founder_wallet:   connectedWallet,
          impact_credited:  dashRatingImpact,
          per_question_ratings: isModeB ? dashRatingPerQ : undefined,
        }),
      })
      if (res.ok) {
        setDashRatingMsg("✓ Rating saved")
        const ratedWallet = dashRatingWallet
        const ratingVal   = isModeB ? null : dashRatingVal
        setDashRatingWallet("")
        setDashRatingVal(0)
        setDashRatingPerQ({})
        setDashRatingImpact(false)
        // Optimistic: mark this submission rated locally so it leaves the queue
        // instantly and smoothly. Mode B's exact rating is server-computed, so
        // we set a truthy placeholder and let the silent refetch correct it.
        setCampaignDetail(prev => prev ? {
          ...prev,
          completions: (prev.completions || []).map((c: any) =>
            c.tester_wallet === ratedWallet
              ? { ...c, builder_rating: ratingVal != null ? ratingVal : (c.builder_rating || 5), status: "reviewed" }
              : c
          ),
        } : prev)
        refreshCampaignSilently(selectedCampaignId)
        if (connectedWallet) {
          fetch(`/api/trials?creator=${connectedWallet}`).then(r => r.json()).then(d => setForgeCampaigns(d.campaigns || [])).catch(() => {})
        }
      }
    } finally { setDashRatingLoading(false) }
  }

  // CSV export now lives at /api/trials/[id]/feedback.csv — one canonical
  // exporter (question-per-column, injection-guarded, creator-gated) shared by
  // this dashboard and the campaign page. The old client-side version dumped
  // answers as JSON blobs in single cells, which founders couldn't read.

  async function fundCampaign(campaign: any) {
    if (!connectedWallet || !(window as any).ethereum) return
    const slots       = campaign.total_slots || 10
    const totalAmount = (campaign.reward_usdc_amount * slots).toFixed(2)
    const payoutAddr  = process.env.NEXT_PUBLIC_ARCLENS_PAYOUT_ADDRESS
    if (!payoutAddr) { setFundMsg("Payout address not configured — contact support"); return }
    setFundingCampaign(true)
    setFundMsg(null)
    try {
      const { createAdapterFromProvider } = await import("@circle-fin/adapter-viem-v2")
      const { AppKit } = await import("@circle-fin/app-kit")
      const adapter = await createAdapterFromProvider({ provider: (window as any).ethereum })
      const kit     = new AppKit()
      const result  = await kit.send({
        from:   { adapter: adapter as any, chain: "Arc_Testnet" },
        to:     payoutAddr,
        amount: totalAmount,
        token:  "USDC",
      })
      const txHash = (result as any).txHash || (result as any).hash || ""
      await fetch(`/api/trials/${campaign.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deposit_tx_hash: txHash, creator_wallet: connectedWallet }),
      })
      setFundMsg(`✓ $${totalAmount} USDC deposited — testers can claim immediately after completing`)
      if (connectedWallet) {
        fetch(`/api/trials?creator=${connectedWallet}`).then(r => r.json()).then(d => setForgeCampaigns(d.campaigns || [])).catch(() => {})
      }
      openCampaign(campaign.id)
    } catch (e: any) {
      if (e?.code !== 4001 && !String(e).includes("user rejected")) {
        setFundMsg("Transaction failed: " + (e?.message || "Unknown error"))
      }
    } finally { setFundingCampaign(false) }
  }

  // Locked-tab prompt. Deliberately thin: it asks the injected wallet for an
  // account, stores it exactly where ArcLayout stores it, and reloads so the
  // page's own mount-time tryWalletAuth does the authorisation. Duplicating
  // that flow here would be a second code path to keep correct.
  async function promptConnect() {
    try {
      const eth = typeof window !== "undefined" ? (window as any).ethereum : null
      if (!eth) { setActiveTab("overview"); return }
      const accounts = await eth.request({ method: "eth_requestAccounts" })
      if (accounts?.[0]) {
        localStorage.setItem("arclens-wallet", accounts[0].toLowerCase())
        window.location.reload()
      }
    } catch { /* user rejected — leave the prompt in place */ }
  }

  async function saveWallet() {
    if (!connectedWallet || !token || !project?.name) return
    setSavingWallet(true)
    try {
      const addr        = connectedWallet.toLowerCase()
      const walletType  = localStorage.getItem("arclens-wallet-type")
      const circleEmail = localStorage.getItem("arclens-circle-email")
      let auth: any = null

      if (walletType === "circle" && circleEmail) {
        // Circle: backend verifies email→wallet mapping in circle_wallet_users
        auth = { type: "circle", email: circleEmail }
      } else if ((window as any).ethereum) {
        // Browser wallet: sign canonical activation message (mirrors /api/claim PUT)
        const timestamp = Date.now()
        const message   = `ArcLens Founder Dashboard Activation\nProject: ${project.name}\nWallet: ${addr}\nTimestamp: ${timestamp}`
        const signature: string = await (window as any).ethereum.request({
          method: "personal_sign",
          params: [message, addr],
        })
        if (!signature) { setSavingWallet(false); return }
        auth = { type: "wallet", signature, timestamp }
      } else {
        setSavingWallet(false)
        return
      }

      const res = await fetch("/api/claim", {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, slug, wallet: addr, auth }),
      })
      if (res.ok) { setWalletSaved(true); setHasWallet(true) }
    } catch {}
    finally { setSavingWallet(false) }
  }

  // Direct logo upload — file → Vercel Blob via /api/upload → set editForm.logo_url.
  // The founder saves it like any other field; the change goes through admin review.
  async function uploadProjectLogo(file: File) {
    if (!file.type.startsWith("image/")) { setSaveError("Logo must be an image (PNG, JPG, WebP, SVG)"); return }
    if (file.size > 5 * 1024 * 1024)     { setSaveError("Logo must be under 5MB"); return }
    setLogoUploading(true)
    setSaveError("")
    try {
      const fd = new FormData()
      fd.append("image", file)
      const res  = await fetch("/api/upload", { method: "POST", body: fd })
      const data = await res.json()
      if (data.url) setEditForm(p => ({ ...p, logo_url: data.url }))
      else setSaveError(data.error || "Logo upload failed")
    } catch { setSaveError("Logo upload failed — try again") }
    finally { setLogoUploading(false) }
  }

  async function saveEdit() {
    setSaving(true)
    setSaveError("")
    setSaveSuccess(false)
    try {
      const res  = await fetch("/api/update-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, slug, wallet: connectedWallet, updates: { ...editForm, contracts: extraContracts.map(c=>c.trim()).filter(Boolean) } }),
      })
      const data = await res.json()
      if (data.success) {
        setSaveSuccess(true)
        setProject(p => p ? { ...p, ...editForm } : p)
        setTimeout(() => setSaveSuccess(false), 3000)
      } else {
        setSaveError(data.error || "Failed to save")
      }
    } catch { setSaveError("Network error") }
    finally { setSaving(false) }
  }

  if (!mounted) return <div style={{ minHeight: "100vh", background: "#060812" }} />

  const inputStyle = { width: "100%", height: "38px", background: surf2, border: "1px solid " + bdr, borderRadius: "7px", padding: "0 12px", fontSize: "12px", fontFamily: mono, color: t1, outline: "none" } as React.CSSProperties

  if (!token && !project && !loading) return (
    <ArcLayout active="ecosystem">
      {/* If the dashboard load failed because the connected wallet doesn't own
          this project, show a clearer message above the magic-link form. The
          founder can either switch wallets (most common) or use the email link. */}
      {error && connectedWallet && (
        <div style={{ maxWidth: 480, margin: "60px auto 0", padding: "14px 18px", background: "rgba(224,136,16,0.06)", border: "1px solid rgba(224,136,16,0.25)", borderRadius: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#e08810", marginBottom: 6 }}>Wrong wallet connected</div>
          <div style={{ fontSize: 12, color: t2, lineHeight: 1.6, marginBottom: 4 }}>
            Connected: <span style={{ fontFamily: mono, color: t1 }}>{connectedWallet.slice(0, 8)}…{connectedWallet.slice(-6)}</span>
          </div>
          <div style={{ fontSize: 12, color: t2, lineHeight: 1.6, marginBottom: 8 }}>
            This dashboard is owned by a different wallet. Switch your wallet to the one that submitted this project, or use the email magic link below.
          </div>
          <div style={{ fontSize: 11, color: t3, fontFamily: mono }}>
            {error}
          </div>
        </div>
      )}
      <ClaimForm slug={slug} mono={mono} bdr={bdr} surf={surf} surf2={surf2} t1={t1} t2={t2} t3={t3} />
    </ArcLayout>
  )

  if (loading) return (
    <ArcLayout active="ecosystem">
      <div style={{ padding: "80px", textAlign: "center", fontFamily: mono, fontSize: "12px", color: t3 }}>Loading your dashboard...</div>
    </ArcLayout>
  )

  if (error) return (
    <ArcLayout active="ecosystem">
      <div style={{ padding: "80px", textAlign: "center" }}>
        <div style={{ fontSize: "14px", color: "#e03348", marginBottom: "16px" }}>{error}</div>
        <button onClick={() => window.location.href = `/dashboard/${slug}`}
          style={{ height: "36px", padding: "0 20px", background: "#1a56ff", color: "#fff", fontSize: "12px", border: "none", borderRadius: "7px", cursor: "pointer", fontFamily: mono }}>
          Request new link
        </button>
      </div>
    </ArcLayout>
  )

  if (!project) return null

  const publicReviews  = reviews.filter(r => r.is_public)
  const privateReviews = reviews.filter(r => !r.is_public)
  const avgRating      = reviews.length > 0 ? (reviews.reduce((a, r) => a + r.rating, 0) / reviews.length).toFixed(1) : "—"
  const activeCampaigns = forgeCampaigns.filter(c => c.status === "active").length
  const categoryBreakdown = reviews.reduce((acc: Record<string, number>, r) => {
    acc[r.category] = (acc[r.category] || 0) + 1
    return acc
  }, {})
  const accentColor = project.color || "#1a56ff"
  const canWallet = !!connectedWallet
  const canEdit   = !!(connectedWallet || token)
  const tabLocked =
    (activeTab === "private" || activeTab === "forge") ? !canWallet
    : (activeTab === "edit" || activeTab === "trust" || activeTab === "tvl") ? !canEdit
    : false

  // ── Attention + health ───────────────────────────────────────────────────
  // The free-host rule is read from the same module the submission form uses,
  // so the dashboard can never tell a founder their domain is fine while the
  // form rejects it.
  const siteHost   = project.website ? hostFromUrl(project.website.startsWith("http") ? project.website : `https://${project.website}`) : null
  const freeHost   = siteHost ? freeHostOf(siteHost) : null
  const daysAgo    = (iso?: string | null) => iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) : 0
  const viewsDelta = prevWeekViews > 0 ? Math.round(((weekViews - prevWeekViews) / prevWeekViews) * 100) : null

  const tasks: { key: string; tone: "red" | "amber" | "blue"; icon: string; title: string; sub: string; action: string; go: () => void }[] = []
  if (freeHost) tasks.push({
    key: "domain", tone: "red", icon: "!",
    title: "Your website is on a free subdomain",
    sub: `${siteHost} · listings not on a domain you own are hidden from 11 September`,
    action: "Update website", go: () => setActiveTab("edit"),
  })
  if (unratedSubs) tasks.push({
    key: "unrated", tone: "amber", icon: String(unratedSubs.count),
    title: `${unratedSubs.count} tester submission${unratedSubs.count === 1 ? "" : "s"} waiting on your rating`,
    sub: `Oldest has been waiting ${daysAgo(unratedSubs.oldest)} day${daysAgo(unratedSubs.oldest) === 1 ? "" : "s"}`,
    action: "Review them", go: () => setActiveTab("forge"),
  })
  if (pendingUpdate) tasks.push({
    key: "pending", tone: "blue", icon: "↻",
    title: "Listing edit is pending review",
    sub: `Submitted ${daysAgo(pendingUpdate.oldest)} day${daysAgo(pendingUpdate.oldest) === 1 ? "" : "s"} ago${pendingUpdate.fields.length ? ` · ${pendingUpdate.fields.join(", ")}` : ""}`,
    action: "See what changed", go: () => setActiveTab("edit"),
  })

  const health: { k: string; v: string; tone: "ok" | "bad" | "meh" }[] = [
    { k: "Website set",      v: project.website ? "OK" : "Missing", tone: project.website ? "ok" : "bad" },
    { k: "Owned domain",     v: !project.website ? "—" : freeHost ? "Failing" : "OK", tone: !project.website ? "meh" : freeHost ? "bad" : "ok" },
    { k: "Contract on file", v: project.contract ? "OK" : "None",   tone: project.contract ? "ok" : "meh" },
    { k: "URL reputation",   v: !urlScan ? "Not scanned" : urlScan.malicious > 0 ? "Flagged" : urlScan.suspicious > 0 ? "Suspicious" : "Clean",
      tone: !urlScan ? "meh" : urlScan.malicious > 0 ? "bad" : urlScan.suspicious > 0 ? "meh" : "ok" },
    { k: "Description",      v: (project.description || "").length >= 120 ? "Good" : "Thin", tone: (project.description || "").length >= 120 ? "ok" : "meh" },
  ]

  const badgeSpec = trustBadge({ trust_level: project.trust_level, recognition: project.recognition, legacy_badge: project.badge })
  const ladder = [
    { label: "Listed",  done: true },
    { label: "Claimed", done: !!project.owner_wallet },
    { label: badgeSpec.key === "verified" || badgeSpec.mark === "check" ? "Verified" : "Verified — submit an audit", done: project.trust_level === "verified" || badgeSpec.mark === "check" },
    { label: "Established", done: !!project.established },
  ]

  return (
    <ArcLayout active="ecosystem">
      {/* Media queries can't be expressed in the inline styles this page is
          built with, so the new sections use classes. Scoped to dash-* so they
          cannot collide with anything else in the app. */}
      <style>{`
        .dash-attn{border-top:1px solid ${bdr};border-bottom:1px solid ${bdr};
          background:linear-gradient(180deg,rgba(224,160,32,0.055),rgba(224,160,32,0.012));
          box-shadow:inset 3px 0 0 #e0a020;padding:15px 20px 5px;margin-bottom:22px}
        .dash-attn-top{display:flex;align-items:center;gap:9px;margin-bottom:4px;
          font-family:${mono};font-size:10px;color:#e0a020;letter-spacing:.14em;text-transform:uppercase}
        .dash-dot{width:6px;height:6px;border-radius:50%;background:#e0a020;box-shadow:0 0 10px #e0a020;flex:none}
        .dash-task{display:flex;align-items:center;gap:13px;padding:12px 0;
          border-top:1px solid rgba(255,255,255,.045);flex-wrap:wrap}
        .dash-task:nth-of-type(2){border-top:none}
        .dash-ico{width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;
          font-size:12.5px;font-family:${mono};flex:none}
        .dash-ico-red{background:rgba(224,51,72,.12);color:#ff8494}
        .dash-ico-amber{background:rgba(224,160,32,.12);color:#ffcf7a}
        .dash-ico-blue{background:rgba(26,86,255,.14);color:#8aaeff}
        .dash-task-body{flex:1;min-width:180px}
        .dash-task-t{font-size:13.5px;font-weight:600;color:${t1}}
        .dash-task-s{font-size:12px;color:${t3};margin-top:2px;overflow-wrap:anywhere}
        .dash-act{height:29px;padding:0 13px;border-radius:7px;font-size:11.5px;font-family:${mono};
          border:1px solid ${bdr};background:rgba(255,255,255,.05);color:#cfdcff;cursor:pointer;flex:none}
        .dash-act:hover{border-color:rgba(140,165,255,.4)}

        .dash-tabs{display:flex;gap:2px;border-bottom:1px solid ${bdr};margin-bottom:22px;
          overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}
        .dash-tabs::-webkit-scrollbar{display:none}
        .dash-tab{padding:11px 14px;font-size:12.5px;font-family:${mono};color:${t3};border:none;background:none;
          cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;display:flex;align-items:center;
          gap:7px;white-space:nowrap;flex:none}
        .dash-tab.on{color:#bcd0ff;border-bottom-color:#1a56ff}
        .dash-tab:hover{color:${t2}}
        .dash-cnt{font-size:10px;padding:1px 6px;border-radius:20px;background:rgba(255,255,255,.05);color:${t2}}
        .dash-cnt.hot{background:rgba(224,160,32,.18);color:#ffcf7a}
        .dash-lock{font-size:9px;opacity:.5}

        .dash-metrics{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid ${bdr};
          border-radius:12px;overflow:hidden;margin-bottom:18px}
        .dash-metric{padding:15px 18px;border-left:1px solid ${bdr}}
        .dash-metric:first-child{border-left:none}
        .dash-metric .k{font-size:9px;font-family:${mono};color:${t3};text-transform:uppercase;letter-spacing:.1em}
        .dash-metric .v{font-size:25px;font-weight:700;letter-spacing:-.04em;margin:6px 0 3px;
          color:${t1};font-variant-numeric:tabular-nums}
        .dash-metric .d{font-size:11px;font-family:${mono}}
        .dash-spark{height:22px;margin-top:8px;display:flex;align-items:flex-end;gap:2px;max-width:200px}
        .dash-spark i{flex:1;max-width:22px;background:linear-gradient(180deg,rgba(26,86,255,.7),rgba(26,86,255,.1));
          border-radius:1px;display:block;min-height:2px}

        .dash-cols{display:grid;grid-template-columns:1fr 290px;border:1px solid ${bdr};border-radius:12px;overflow:hidden}
        .dash-main{padding:18px 20px}
        .dash-rail{border-left:1px solid ${bdr};padding:18px 20px}
        .dash-sec + .dash-sec{margin-top:22px;padding-top:18px;border-top:1px solid ${bdr}}
        .dash-sec h3{font-size:13px;font-weight:600;color:${t1}}
        .dash-sec .sub{font-size:12px;color:${t3};margin:2px 0 12px}
        .dash-row{display:flex;align-items:center;gap:11px;padding:10px 0;
          border-top:1px solid rgba(255,255,255,.045);flex-wrap:wrap}
        .dash-row:first-of-type{border-top:none}
        .dash-item{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:9px 0;
          border-top:1px solid rgba(255,255,255,.045);font-size:12.5px}
        .dash-item:first-of-type{border-top:none}
        .dash-step{display:flex;align-items:center;gap:9px;font-size:12.5px;margin-bottom:9px}
        .dash-step b{width:16px;height:16px;border-radius:50%;border:1.5px solid ${bdr};flex:none;
          display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:400}
        .dash-step.done b{background:rgba(0,184,122,.16);border-color:rgba(0,184,122,.5);color:#4fd8a5}
        .dash-step.now b{border-color:#8aaeff;box-shadow:0 0 0 3px rgba(26,86,255,.14)}

        @media (max-width: 760px){
          .dash-cols{grid-template-columns:1fr}
          .dash-rail{border-left:none;border-top:1px solid ${bdr}}
          .dash-metrics{grid-template-columns:1fr}
          .dash-metric{border-left:none;border-top:1px solid ${bdr}}
          .dash-metric:first-child{border-top:none}
          .dash-attn{padding-left:16px;padding-right:16px}
          .dash-act{width:100%}
        }
      `}</style>
      <div style={{ padding: "0 0 60px", maxWidth: "900px", margin: "0 auto" }}>

        {/* ── HERO HEADER ── */}
        <div style={{ padding: "28px 20px 24px", borderBottom: "1px solid " + bdr, marginBottom: "28px" }}>
          <div style={{ fontSize: "9px", fontFamily: mono, color: t3, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "14px" }}>Founder Dashboard</div>
          <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
            {/* Logo */}
            <div style={{ width: "56px", height: "56px", borderRadius: "12px", overflow: "hidden", flexShrink: 0, background: `${accentColor}12`, border: `1px solid ${accentColor}30`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {project.logo_url
                ? <img
                    src={project.logo_url.startsWith("blob:") || project.logo_url.startsWith("data:")
                      ? project.logo_url
                      : `/api/image-proxy?url=${encodeURIComponent(project.logo_url)}`}
                    alt={project.name}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    onError={e => (e.currentTarget.style.display = "none")} />
                : <span style={{ fontSize: "22px", fontWeight: 700, color: accentColor }}>{project.name?.[0]}</span>
              }
            </div>
            {/* Name + tagline */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <h1 style={{ fontSize: "24px", fontWeight: 700, letterSpacing: "-0.04em", color: t1, margin: 0 }}>{project.name}</h1>
                {project.badge && (
                  <span style={{ fontSize: "9px", fontFamily: mono, padding: "2px 8px", borderRadius: "4px", background: "rgba(26,86,255,0.1)", color: "#8aaeff", border: "1px solid rgba(26,86,255,0.2)", textTransform: "uppercase" }}>
                    {project.badge}
                  </span>
                )}
              </div>
              <div style={{ fontSize: "13px", color: t2, marginTop: "3px" }}>{project.tagline}</div>
            </div>
            {/* Actions */}
            <button onClick={() => window.location.href = `/ecosystem/${project.slug || project.id}`}
              style={{ height: "32px", padding: "0 14px", background: "transparent", color: t2, fontSize: "11px", fontFamily: mono, border: "1px solid " + bdr, borderRadius: "7px", cursor: "pointer", flexShrink: 0 }}>
              View public page ↗
            </button>
          </div>
        </div>

        <div style={{ padding: "0 20px" }}>

          {/* Wallet connect prompt */}
          {token && !hasWallet && !walletSaved && connectedWallet && (
            <div style={{ background: "rgba(26,86,255,0.05)", border: "1px solid rgba(26,86,255,0.18)", borderRadius: "10px", padding: "14px 18px", marginBottom: "20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
              <div>
                <div style={{ fontSize: "12px", color: t1, marginBottom: "3px", fontWeight: 500 }}>Skip the magic link next time</div>
                <div style={{ fontSize: "10px", fontFamily: mono, color: t3 }}>Save {connectedWallet.slice(0,6)}...{connectedWallet.slice(-4)} as your login wallet</div>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={saveWallet} disabled={savingWallet}
                  style={{ height: "32px", padding: "0 14px", background: "#1a56ff", color: "#fff", fontSize: "11px", fontFamily: mono, border: "none", borderRadius: "6px", cursor: "pointer", opacity: savingWallet ? 0.7 : 1 }}>
                  {savingWallet ? "Saving..." : "Save wallet"}
                </button>
                <button onClick={() => setHasWallet(true)}
                  style={{ height: "32px", padding: "0 12px", background: "transparent", color: t3, fontSize: "11px", fontFamily: mono, border: "1px solid " + bdr, borderRadius: "6px", cursor: "pointer" }}>
                  Skip
                </button>
              </div>
            </div>
          )}

          {walletSaved && (
            <div style={{ background: "rgba(0,184,122,0.06)", border: "1px solid rgba(0,184,122,0.2)", borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", fontSize: "11px", fontFamily: mono, color: green }}>
              ✓ Wallet saved — log in directly next time without a magic link
            </div>
          )}

          {/* ── NEEDS YOUR ATTENTION ──────────────────────────────────────
              The dashboard opens as a to-do list. Every item is a state the
              founder was already in; previously it took clicking through three
              tabs to discover any of them. Full-bleed band with a left stripe
              rather than a rounded card, so it reads as part of the dashboard
              that is currently lit up rather than a panel sitting on top. */}
          {tasks.length > 0 && (
            <div className="dash-attn">
              <div className="dash-attn-top">
                <i className="dash-dot" />
                <span>{tasks.length} thing{tasks.length === 1 ? "" : "s"} need{tasks.length === 1 ? "s" : ""} you</span>
              </div>
              {tasks.map(t => (
                <div key={t.key} className="dash-task">
                  <div className={"dash-ico dash-ico-" + t.tone}>{t.icon}</div>
                  <div className="dash-task-body">
                    <div className="dash-task-t">{t.title}</div>
                    <div className="dash-task-s">{t.sub}</div>
                  </div>
                  <button className="dash-act" onClick={t.go}>{t.action}</button>
                </div>
              ))}
            </div>
          )}

          {/* ── TABS ──────────────────────────────────────────────────────
              Always the same set. Previously the bar showed two tabs on a
              magic link and six with a wallet, so the navigation changed shape
              under the user. Tabs needing a wallet now prompt inside the panel
              instead of vanishing from the bar. */}
          <div className="dash-tabs" role="tablist">
            {([
              { key: "overview", label: "Overview",  count: null,                     lock: false },
              { key: "forge",    label: "Campaigns", count: forgeCampaigns.length,    lock: !connectedWallet, hot: unratedSubs?.count || 0 },
              { key: "reviews",  label: "Reviews",   count: publicReviews.length,     lock: false },
              { key: "private",  label: "Private",   count: privateReviews.length,    lock: !connectedWallet },
              { key: "edit",     label: "Listing",   count: null,                     lock: !(connectedWallet || token) },
              { key: "trust",    label: "Trust",     count: null,                     lock: !(connectedWallet || token) },
              { key: "tvl",      label: "Analytics", count: null,                     lock: !(connectedWallet || token) },
            ] as const).map(tab => (
              <button key={tab.key} role="tab" aria-selected={activeTab === tab.key}
                onClick={() => setActiveTab(tab.key as typeof activeTab)}
                className={"dash-tab" + (activeTab === tab.key ? " on" : "")}>
                {tab.label}
                {("hot" in tab && tab.hot) ? <span className="dash-cnt hot">{tab.hot}</span>
                  : tab.count !== null ? <span className="dash-cnt">{tab.count}</span> : null}
                {tab.lock && <span className="dash-lock" aria-label="needs a connected wallet">🔒</span>}
              </button>
            ))}
          </div>

          {/* ── OVERVIEW ── */}
          {tabLocked && (
            <div style={{ background: surf, border: "1px solid " + bdr, borderRadius: "12px", padding: "40px 28px", textAlign: "center" }}>
              <div style={{ fontSize: "22px", marginBottom: "10px" }}>&#128274;</div>
              <div style={{ fontSize: "13.5px", fontWeight: 600, color: t1, marginBottom: "6px" }}>Connect your wallet to open this</div>
              <div style={{ fontSize: "12px", fontFamily: mono, color: t3, lineHeight: 1.7, maxWidth: "380px", margin: "0 auto 18px" }}>
                {activeTab === "private" || activeTab === "forge"
                  ? "Campaigns and private feedback are tied to the wallet that owns this listing."
                  : "Editing your listing needs either a connected wallet or a fresh dashboard link from your email."}
              </div>
              <button onClick={promptConnect}
                style={{ height: "38px", padding: "0 20px", background: "rgba(26,86,255,0.16)", color: "#bcd0ff", fontSize: "12.5px", fontFamily: mono, border: "1px solid rgba(107,147,255,0.42)", borderRadius: "8px", cursor: "pointer" }}>
                Connect wallet
              </button>
            </div>
          )}

          {activeTab === "overview" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>

              {/* Three metrics that carry a trend, replacing five flat counts.
                  The sparkline is intentionally coarse — it exists to show
                  direction, not to be read value by value. */}
              <div className="dash-metrics">
                <div className="dash-metric">
                  <div className="k">Views this week</div>
                  <div className="v">{weekViews.toLocaleString()}</div>
                  <div className="d" style={{ color: viewsDelta === null ? t3 : viewsDelta > 0 ? green : viewsDelta < 0 ? "#ff8494" : t3 }}>
                    {viewsDelta === null ? "● no prior week" : viewsDelta === 0 ? "● unchanged" : `${viewsDelta > 0 ? "▲" : "▼"} ${Math.abs(viewsDelta)}% vs last week`}
                  </div>
                  <div className="dash-spark" aria-hidden="true">
                    {(() => {
                      const hi = Math.max(weekViews, prevWeekViews, 1)
                      return [prevWeekViews, weekViews].map((v, i) => <i key={i} style={{ height: `${Math.round((v / hi) * 100)}%` }} />)
                    })()}
                  </div>
                </div>
                <div className="dash-metric">
                  <div className="k">Avg rating</div>
                  <div className="v">{avgRating}{reviews.length > 0 && <span style={{ fontSize: "14px", color: t3 }}> / 5</span>}</div>
                  <div className="d" style={{ color: t3 }}>● {reviews.length} review{reviews.length === 1 ? "" : "s"}</div>
                  <div className="dash-spark" aria-hidden="true">
                    {[5,4,3,2,1].map(star => {
                      const n = reviews.filter(r => Math.round(r.rating) === star).length
                      const hi = Math.max(1, ...[5,4,3,2,1].map(s => reviews.filter(r => Math.round(r.rating) === s).length))
                      return <i key={star} style={{ height: `${Math.round((n / hi) * 100)}%` }} />
                    })}
                  </div>
                </div>
                <div className="dash-metric">
                  <div className="k">Campaigns</div>
                  <div className="v">{forgeCampaigns.length}</div>
                  <div className="d" style={{ color: activeCampaigns > 0 ? green : t3 }}>● {activeCampaigns} active</div>
                  <div className="dash-spark" aria-hidden="true">
                    {["active","ended","rejected"].map(s => {
                      const n = forgeCampaigns.filter(c => c.status === s).length
                      const hi = Math.max(1, forgeCampaigns.length)
                      return <i key={s} style={{ height: `${Math.round((n / hi) * 100)}%` }} />
                    })}
                  </div>
                </div>
              </div>

              {/* Trust ladder and listing health. Both read from checks the
                  server already runs — nothing here is a new signal, it is the
                  first time the founder gets to see the result. */}
              <div className="dash-cols">
                <div className="dash-main">
                  <div className="dash-sec">
                    <h3>Your trust standing</h3>
                    <div className="sub">What lifts this listing next.</div>
                    {ladder.map((s, i) => {
                      const isNow = !s.done && ladder.slice(0, i).every(p => p.done)
                      return (
                        <div key={s.label} className={"dash-step" + (s.done ? " done" : isNow ? " now" : "")}
                          style={{ color: s.done ? t2 : isNow ? t1 : t3, fontWeight: isNow ? 600 : 400 }}>
                          <b>{s.done ? "✓" : ""}</b>{s.label}
                        </div>
                      )
                    })}
                    <div style={{ fontSize: "11.5px", color: t3, lineHeight: 1.6, marginTop: "12px" }}>
                      An independent audit on record moves you to Verified. It shows on your card, your embed badge, and on-chain.
                    </div>
                  </div>
                </div>
                <div className="dash-rail">
                  <div className="dash-sec">
                    <h3>Listing health</h3>
                    <div className="sub">Checked continuously.</div>
                    {health.map(h => (
                      <div key={h.k} className="dash-item">
                        <span style={{ color: t2 }}>{h.k}</span>
                        <span style={{ fontFamily: mono, fontSize: "11.5px", color: h.tone === "ok" ? green : h.tone === "bad" ? "#ff8494" : t3 }}>{h.v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <LensEarningsPanel slug={slug} />
              {reviews.length > 0 ? (
                <div style={{ background: surf, border: "1px solid " + bdr, borderRadius: "12px", padding: "22px 24px" }}>
                  <div style={{ fontSize: "10px", fontFamily: mono, color: t3, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "16px" }}>Feedback by category</div>
                  {Object.entries(categoryBreakdown).sort((a,b) => b[1]-a[1]).map(([cat, count]) => (
                    <div key={cat} style={{ marginBottom: "10px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                        <span style={{ fontSize: "12px", fontFamily: mono, color: t2 }}>{cat}</span>
                        <span style={{ fontSize: "12px", fontFamily: mono, color: t3 }}>{count as number}</span>
                      </div>
                      <div style={{ height: "3px", background: bdr, borderRadius: "2px" }}>
                        <div style={{ height: "3px", background: accentColor, borderRadius: "2px", width: `${((count as number) / reviews.length) * 100}%`, opacity: 0.7 }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ background: surf, border: "1px solid " + bdr, borderRadius: "12px", padding: "48px", textAlign: "center" }}>
                  <div style={{ fontSize: "28px", marginBottom: "10px" }}>◎</div>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: t1, marginBottom: "6px" }}>No reviews yet</div>
                  <div style={{ fontSize: "12px", fontFamily: mono, color: t3 }}>Share your project page to start collecting feedback from the Arc community</div>
                </div>
              )}
              <div style={{ background: surf, border: "1px solid " + bdr, borderRadius: "12px", padding: "22px 24px" }}>
                <div style={{ fontSize: "10px", fontFamily: mono, color: t3, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "16px" }}>Your listing</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                  {[
                    { label: "Category",  value: project.category },
                    { label: "Badge",     value: project.badge || "None" },
                    { label: "Featured",  value: project.featured ? "Yes" : "No" },
                    { label: "Contract",  value: project.contract ? project.contract.slice(0,10) + "..." : "Not set" },
                  ].map(item => (
                    <div key={item.label}>
                      <div style={{ fontSize: "9px", fontFamily: mono, color: t3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>{item.label}</div>
                      <div style={{ fontSize: "13px", fontFamily: mono, color: t2 }}>{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── PUBLIC REVIEWS ── */}
          {activeTab === "reviews" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {publicReviews.length === 0
                ? <div style={{ padding: "48px", textAlign: "center", color: t3, fontFamily: mono, fontSize: "12px" }}>No public reviews yet</div>
                : publicReviews.map(r => <ReviewCard key={r.id} r={r} surf={surf} bdr={bdr} t2={t2} t3={t3} mono={mono} green={green} showContact={false} />)
              }
            </div>
          )}

          {/* ── PRIVATE REVIEWS ── */}
          {activeTab === "private" && canWallet && (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {privateReviews.length === 0
                ? <div style={{ padding: "48px", textAlign: "center", color: t3, fontFamily: mono, fontSize: "12px" }}>No private reviews yet</div>
                : privateReviews.map(r => <ReviewCard key={r.id} r={r} surf={surf} bdr={bdr} t2={t2} t3={t3} mono={mono} green={green} showContact={true} />)
              }
            </div>
          )}

          {/* ── CAMPAIGNS (Arc Trials) ── */}
          {activeTab === "forge" && canWallet && (
            <div>
              {selectedCampaignId === null ? (
                /* Campaign list */
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                    <div>
                      <div style={{ fontSize: "14px", fontWeight: 600, color: t1 }}>Arc Trials</div>
                      <div style={{ fontSize: "11px", fontFamily: mono, color: t3, marginTop: "2px" }}>Collect verified feedback from real Arc testers</div>
                    </div>
                    <button onClick={() => window.location.href = "/trials/create"}
                      style={{ height: "32px", padding: "0 14px", background: "#1a56ff", color: "#fff", fontSize: "11px", fontFamily: mono, border: "none", borderRadius: "6px", cursor: "pointer" }}>
                      + New Campaign
                    </button>
                  </div>

                  {forgeCampaigns.length === 0 ? (
                    <div style={{ background: surf, border: "1px solid " + bdr, borderRadius: "12px", padding: "52px", textAlign: "center" }}>
                      <div style={{ fontSize: "28px", marginBottom: "12px" }}>✦</div>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: t1, marginBottom: "6px" }}>No campaigns yet</div>
                      <div style={{ fontSize: "11px", fontFamily: mono, color: t3, marginBottom: "20px", lineHeight: 1.6 }}>Create a campaign to get structured, scored feedback from the Arc community</div>
                      <button onClick={() => window.location.href = "/trials/create"}
                        style={{ height: "36px", padding: "0 20px", background: "#1a56ff", color: "#fff", fontSize: "12px", fontFamily: mono, border: "none", borderRadius: "7px", cursor: "pointer" }}>
                        Create your first campaign
                      </button>
                    </div>
                  ) : forgeCampaigns.map((c: any) => {
                    const statusColor  = c.status === "active" ? "#00b87a" : c.status === "approved" ? "#8aaeff" : c.status === "pending_approval" ? "#e08810" : c.status === "rejected" ? "#e03348" : t3
                    const statusBg     = c.status === "active" ? "rgba(0,184,122,0.1)" : c.status === "approved" ? "rgba(26,86,255,0.1)" : c.status === "pending_approval" ? "rgba(224,136,16,0.1)" : c.status === "rejected" ? "rgba(224,51,72,0.08)" : "rgba(107,125,168,0.1)"
                    const statusBdr    = c.status === "active" ? "rgba(0,184,122,0.25)" : c.status === "approved" ? "rgba(26,86,255,0.25)" : c.status === "pending_approval" ? "rgba(224,136,16,0.25)" : c.status === "rejected" ? "rgba(224,51,72,0.2)" : bdr
                    const statusLabel  = c.status === "pending_approval" ? "Pending Review" : c.status === "approved" ? "Fund to Activate" : c.status
                    const slotFill     = c.total_slots ? Math.min((c.completion_count || 0) / c.total_slots, 1) : 0

                    return (
                      <div key={c.id} style={{ background: surf, border: "1px solid " + bdr, borderRadius: "12px", overflow: "hidden" }}>
                        <div style={{ padding: "16px 20px" }}>
                          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px", marginBottom: "10px" }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: "14px", fontWeight: 600, color: t1, marginBottom: "2px" }}>{c.title}</div>
                              <div style={{ fontSize: "11px", fontFamily: mono, color: t3 }}>
                                {c.type?.replace(/_/g, " ")} · {c.reward_type === "usdc" && c.reward_usdc_amount ? `$${c.reward_usdc_amount} USDC / tester` : c.reward_type?.replace(/_/g, " ")}
                              </div>
                            </div>
                            <span style={{ fontSize: "9px", fontFamily: mono, padding: "3px 8px", borderRadius: "4px", flexShrink: 0, textTransform: "uppercase", background: statusBg, color: statusColor, border: `1px solid ${statusBdr}` }}>
                              {statusLabel}
                            </span>
                          </div>

                          {/* Slot progress bar */}
                          {c.total_slots > 0 && (
                            <div style={{ marginBottom: "12px" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                                <span style={{ fontSize: "10px", fontFamily: mono, color: t3 }}>Tester slots</span>
                                <span style={{ fontSize: "10px", fontFamily: mono, color: t2 }}>{c.completion_count || 0} / {c.total_slots}</span>
                              </div>
                              <div style={{ height: "3px", background: bdr, borderRadius: "2px" }}>
                                <div style={{ height: "3px", background: c.status === "active" ? "#00b87a" : t3, borderRadius: "2px", width: `${slotFill * 100}%`, transition: "width 0.3s" }} />
                              </div>
                            </div>
                          )}

                          {/* Rejection reason */}
                          {c.status === "rejected" && c.rejection_reason && (
                            <div style={{ padding: "8px 12px", background: "rgba(224,51,72,0.05)", border: "1px solid rgba(224,51,72,0.15)", borderRadius: "6px", marginBottom: "10px" }}>
                              <div style={{ fontSize: "9px", fontFamily: mono, color: "#e03348", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "3px" }}>Rejection reason</div>
                              <div style={{ fontSize: "11px", color: "#e03348", opacity: 0.8, lineHeight: 1.5 }}>{c.rejection_reason}</div>
                            </div>
                          )}

                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <div style={{ fontSize: "18px", fontWeight: 700, color: t1 }}>
                              {c.completion_count || 0}
                              <span style={{ fontSize: "10px", fontFamily: mono, color: t3, fontWeight: 400, marginLeft: "5px" }}>submissions</span>
                            </div>
                            {c.status !== "rejected" && (
                              <button onClick={() => openCampaign(c.id)}
                                style={{ height: "30px", padding: "0 14px", background: "transparent", color: "#8aaeff", fontSize: "11px", fontFamily: mono, border: "1px solid rgba(26,86,255,0.25)", borderRadius: "6px", cursor: "pointer" }}>
                                View Feedback & Progress →
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                /* Campaign detail */
                <div>
                  <button onClick={() => { setSelectedCampaignId(null); setCampaignDetail(null); setFundMsg(null) }}
                    style={{ fontSize: "11px", color: t2, background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: "16px", fontFamily: mono, display: "flex", alignItems: "center", gap: "4px" }}>
                    ← All Campaigns
                  </button>

                  {campaignDetailLoading || !campaignDetail ? (
                    <div style={{ padding: "60px", textAlign: "center", fontFamily: mono, fontSize: "11px", color: t3 }}>Loading campaign data...</div>
                  ) : (() => {
                    const camp        = campaignDetail.campaign
                    const completions = campaignDetail.completions || []
                    const unrated     = completions.filter((c: any) => !c.builder_rating)
                    const rated       = completions.filter((c: any) => c.builder_rating)
                    // Default to the action queue: hide already-rated testers so
                    // the founder sees only what still needs their review. Rated
                    // ones stay one click away (and remain in the leaderboard).
                    const visibleSubs = showRatedSubs ? completions : unrated

                    return (
                      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>

                        {/* Campaign header card */}
                        <div style={{ background: surf, border: "1px solid " + bdr, borderRadius: "12px", padding: "20px 22px" }}>
                          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", marginBottom: "16px" }}>
                            <div>
                              <div style={{ fontSize: "16px", fontWeight: 700, color: t1, marginBottom: "3px" }}>{camp.title}</div>
                              {camp.tagline && <div style={{ fontSize: "12px", color: t2 }}>{camp.tagline}</div>}
                            </div>
                            <span style={{ fontSize: "9px", fontFamily: mono, padding: "3px 9px", borderRadius: "4px", flexShrink: 0, textTransform: "uppercase",
                              background: camp.status === "active" ? "rgba(0,184,122,0.1)" : camp.status === "approved" ? "rgba(26,86,255,0.1)" : camp.status === "pending_approval" ? "rgba(224,136,16,0.1)" : "rgba(107,125,168,0.1)",
                              color: camp.status === "active" ? green : camp.status === "approved" ? "#8aaeff" : camp.status === "pending_approval" ? "#e08810" : t3,
                              border: `1px solid ${camp.status === "active" ? "rgba(0,184,122,0.25)" : camp.status === "approved" ? "rgba(26,86,255,0.25)" : camp.status === "pending_approval" ? "rgba(224,136,16,0.25)" : bdr}` }}>
                              {camp.status === "pending_approval" ? "Pending Review" : camp.status === "approved" ? "Fund to Activate" : camp.status}
                            </span>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: "10px" }}>
                            {[
                              { label: "Submissions", value: completions.length.toString(), color: "#8aaeff" },
                              { label: "Unrated",     value: unrated.length.toString(), color: unrated.length > 0 ? "#e08810" : t3 },
                              { label: "Slots",       value: camp.total_slots ? `${camp.filled_slots || 0} / ${camp.total_slots}` : "Open", color: t1 },
                              { label: "Reward",      value: camp.reward_type === "usdc" && camp.reward_usdc_amount ? `$${camp.reward_usdc_amount} USDC` : camp.reward_type?.replace(/_/g," "), color: camp.reward_type === "usdc" ? green : t2 },
                            ].map(s => (
                              <div key={s.label} style={{ background: surf2, borderRadius: "8px", padding: "10px 12px", border: "1px solid " + bdr }}>
                                <div style={{ fontSize: "9px", fontFamily: mono, color: t3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "5px" }}>{s.label}</div>
                                <div style={{ fontSize: "15px", fontWeight: 700, color: s.color }}>{s.value}</div>
                              </div>
                            ))}
                          </div>
                          {completions.length > 0 && (
                            <a href={`/api/trials/${camp.slug || camp.id}/feedback.csv`}
                              download
                              onMouseEnter={e => { e.currentTarget.style.borderColor = "#00d990"; e.currentTarget.style.color = t1 }}
                              onMouseLeave={e => { e.currentTarget.style.borderColor = bdr; e.currentTarget.style.color = t2 }}
                              style={{ marginTop: "14px", height: "32px", padding: "0 14px", background: "transparent", color: t2, fontSize: "11px", fontFamily: mono, border: "1px solid " + bdr, borderRadius: "7px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "6px", transition: "all .13s", textDecoration: "none" }}>
                              ↓ Download feedback ({completions.length}) as CSV
                            </a>
                          )}
                        </div>

                        {/* Fund msg banner */}
                        {fundMsg && (
                          <div style={{ padding: "12px 16px", borderRadius: "8px", fontSize: "12px", fontFamily: mono,
                            background: fundMsg.startsWith("✓") ? "rgba(0,184,122,0.06)" : "rgba(224,51,72,0.06)",
                            border: `1px solid ${fundMsg.startsWith("✓") ? "rgba(0,184,122,0.2)" : "rgba(224,51,72,0.2)"}`,
                            color: fundMsg.startsWith("✓") ? "#00d990" : "#e03348" }}>
                            {fundMsg}
                          </div>
                        )}

                        {/* USDC fund banner */}
                        {camp.reward_type === "usdc" && camp.reward_usdc_amount && (camp.status === "approved" || camp.status === "active") && !camp.deposit_tx_hash && !fundMsg?.startsWith("✓") && (
                          <div style={{ background: "rgba(0,184,122,0.04)", border: "1px solid rgba(0,184,122,0.2)", borderRadius: "10px", padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                            <div>
                              <div style={{ fontSize: "12px", fontWeight: 600, color: green, marginBottom: "2px" }}>Fund this campaign</div>
                              <div style={{ fontSize: "11px", fontFamily: mono, color: t3, lineHeight: 1.5 }}>
                                Deposit ${(camp.reward_usdc_amount * (camp.total_slots || 10)).toFixed(2)} USDC so testers can claim immediately on completion
                              </div>
                            </div>
                            <button onClick={() => fundCampaign(camp)} disabled={fundingCampaign}
                              style={{ height: "34px", padding: "0 16px", background: green, color: "#fff", fontSize: "12px", fontFamily: mono, border: "none", borderRadius: "7px", cursor: fundingCampaign ? "default" : "pointer", opacity: fundingCampaign ? 0.6 : 1, flexShrink: 0, fontWeight: 600 }}>
                              {fundingCampaign ? "Depositing..." : `Deposit $${(camp.reward_usdc_amount * (camp.total_slots || 10)).toFixed(2)} USDC →`}
                            </button>
                          </div>
                        )}

                        {/* Top contributors — builder-rated submissions only,
                            ranked by quality + builder_rating tiebreak. */}
                        <FounderLeaderboard completions={completions} surf={surf} surf2={surf2} bdr={bdr} t1={t1} t2={t2} t3={t3} green={green} mono={mono} />



                        {/* Tester submissions */}
                        <div style={{ background: surf, border: "1px solid " + bdr, borderRadius: "12px", overflow: "hidden" }}>
                          <div style={{ padding: "14px 20px", borderBottom: "1px solid " + bdr, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
                            <div style={{ fontSize: "11px", fontFamily: mono, color: t2, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                              Tester Submissions · {completions.length}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              {unrated.length > 0 && (
                                <div style={{ fontSize: "10px", fontFamily: mono, color: "#e08810", background: "rgba(224,136,16,0.08)", border: "1px solid rgba(224,136,16,0.2)", padding: "2px 8px", borderRadius: "4px" }}>
                                  {unrated.length} awaiting your rating
                                </div>
                              )}
                              {rated.length > 0 && (
                                <button onClick={() => setShowRatedSubs(v => !v)}
                                  style={{ fontSize: "10px", fontFamily: mono, color: showRatedSubs ? t1 : t2, background: showRatedSubs ? surf2 : "transparent", border: "1px solid " + bdr, padding: "3px 9px", borderRadius: "4px", cursor: "pointer" }}>
                                  {showRatedSubs ? `Hide ${rated.length} rated` : `Show ${rated.length} rated ✓`}
                                </button>
                              )}
                            </div>
                          </div>

                          {completions.length === 0 ? (
                            <div style={{ padding: "48px", textAlign: "center", color: t3, fontFamily: mono, fontSize: "11px" }}>
                              No submissions yet — share your campaign link to get testers
                            </div>
                          ) : visibleSubs.length === 0 ? (
                            <div style={{ padding: "48px", textAlign: "center", color: t3, fontFamily: mono, fontSize: "11px", lineHeight: 1.7 }}>
                              <div style={{ color: green, marginBottom: "4px" }}>All caught up</div>
                              You&apos;ve rated every submission. {rated.length > 0 && <button onClick={() => setShowRatedSubs(true)} style={{ color: "#8aaeff", background: "none", border: "none", fontFamily: mono, fontSize: "11px", cursor: "pointer", textDecoration: "underline", padding: 0 }}>Show {rated.length} rated</button>}
                            </div>
                          ) : visibleSubs.map((comp: any, i: number) => {
                            const expanded    = expandedTesters.has(comp.tester_wallet)
                            const hasAnswers  = comp.review_answers && Object.keys(comp.review_answers).length > 0
                            const isRating    = dashRatingWallet === comp.tester_wallet
                            const scoreColor  = comp.auto_score > 70 ? "#00b87a" : comp.auto_score > 40 ? "#e08810" : "#e03348"

                            return (
                              <div key={comp.tester_wallet} style={{ borderBottom: i < visibleSubs.length - 1 ? "1px solid " + bdr : "none" }}>
                                {/* Tester row */}
                                <div style={{ padding: "14px 20px", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                                  {/* Avatar + score */}
                                  <div style={{ position: "relative", flexShrink: 0 }}>
                                    <WalletAvatar wallet={comp.tester_wallet} size={36} />
                                    <div style={{ position: "absolute", bottom: -2, right: -2, width: 16, height: 16, borderRadius: "50%", background: scoreColor, border: "2px solid var(--surf,#0a0e1a)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                      <span style={{ fontSize: "7px", fontFamily: mono, color: "#fff", fontWeight: 800, lineHeight: 1 }}>{comp.auto_score}</span>
                                    </div>
                                  </div>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <a href={`/tester/${comp.tester_wallet}`}
                                      style={{ fontSize: "11px", fontFamily: mono, color: t1, marginBottom: "3px", display: "block", textDecoration: "none" }}
                                      onMouseEnter={e => (e.currentTarget.style.color = "#8aaeff")}
                                      onMouseLeave={e => (e.currentTarget.style.color = t1)}>
                                      {comp.tester_wallet.slice(0, 10)}...{comp.tester_wallet.slice(-6)}
                                    </a>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                      {comp.quality_score && <span style={{ fontSize: "10px", fontFamily: mono, color: t3 }}>Quality: <span style={{ color: t2 }}>{Number(comp.quality_score).toFixed(1)}/5</span></span>}
                                      {comp.builder_rating && <span style={{ fontSize: "11px", color: "#c08828" }}>{"★".repeat(comp.builder_rating)}{"☆".repeat(5 - comp.builder_rating)}</span>}
                                      {comp.contract_verified !== null && comp.contract_verified !== undefined && (
                                        <span style={{ fontSize: "9px", fontFamily: mono, padding: "2px 6px", borderRadius: "4px",
                                          background: comp.contract_verified ? "rgba(0,184,122,0.08)" : "rgba(107,125,168,0.06)",
                                          color: comp.contract_verified ? green : t3,
                                          border: `1px solid ${comp.contract_verified ? "rgba(0,184,122,0.2)" : bdr}` }}>
                                          {comp.contract_verified ? "✓ on-chain" : "no on-chain"}
                                        </span>
                                      )}
                                      {camp.reward_type === "usdc" && camp.reward_usdc_amount && (
                                        <span style={{ fontSize: "9px", fontFamily: mono, padding: "2px 6px", borderRadius: "4px",
                                          background: comp.reward_delivered ? "rgba(0,184,122,0.1)" : "rgba(107,125,168,0.06)",
                                          color: comp.reward_delivered ? green : t3,
                                          border: `1px solid ${comp.reward_delivered ? "rgba(0,184,122,0.2)" : bdr}` }}>
                                          {comp.reward_delivered ? `✓ $${camp.reward_usdc_amount} claimed` : `$${camp.reward_usdc_amount} pending`}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                                    {hasAnswers && (
                                      <button onClick={() => toggleTester(comp.tester_wallet)}
                                        style={{ height: "28px", padding: "0 10px", background: expanded ? "rgba(26,86,255,0.1)" : "transparent", color: expanded ? "#8aaeff" : t2, fontSize: "10px", fontFamily: mono, border: "1px solid " + (expanded ? "rgba(26,86,255,0.25)" : bdr), borderRadius: "5px", cursor: "pointer" }}>
                                        {expanded ? "Hide ↑" : "Feedback ↓"}
                                      </button>
                                    )}
                                    {!comp.builder_rating && (
                                      <button onClick={() => { setDashRatingWallet(isRating ? "" : comp.tester_wallet); setDashRatingVal(0); setDashRatingPerQ({}) }}
                                        style={{ height: "28px", padding: "0 10px", background: isRating ? "rgba(192,136,40,0.12)" : "transparent", color: isRating ? "#c08828" : t2, fontSize: "10px", fontFamily: mono, border: "1px solid " + (isRating ? "rgba(192,136,40,0.25)" : bdr), borderRadius: "5px", cursor: "pointer" }}>
                                        {isRating ? "Cancel" : "Rate ★"}
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* Feedback answers + submitted proofs */}
                                {expanded && hasAnswers && (
                                  <div style={{ padding: "14px 20px 16px", borderTop: "1px solid " + bdr, background: surf2 }}>

                                    {/* Submitted proofs — only render if the campaign required any */}
                                    {(() => {
                                      const proofTasks = (camp.tasks || []).filter((t: any) => t.proof_type && t.proof_type !== "none")
                                      if (proofTasks.length === 0) return null
                                      return (
                                        <div style={{ marginBottom: "16px", padding: "10px 12px", background: "rgba(138,174,255,0.04)", border: "1px solid rgba(138,174,255,0.18)", borderRadius: "7px" }}>
                                          <div style={{ fontSize: "10px", fontFamily: mono, color: "#8aaeff", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>Submitted proofs</div>
                                          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                            {proofTasks.map((t: any) => {
                                              const value: string = (comp.task_proofs || {})[t.id] || ""
                                              const linkHref = !value
                                                ? null
                                                : t.proof_type === "tx_hash"
                                                  ? `https://testnet.arcscan.app/tx/${value}`
                                                  : value
                                              const labelType = t.proof_type === "x_link"     ? "X post"
                                                              : t.proof_type === "tx_hash"    ? "Tx hash"
                                                              : t.proof_type === "screenshot" ? "Screenshot"
                                                              : "URL"
                                              const isScreenshot = t.proof_type === "screenshot" && !!value

                                              return (
                                                <div key={t.id} style={{ display: "flex", alignItems: isScreenshot ? "flex-start" : "center", gap: "10px", fontSize: "11px", flexWrap: "wrap", padding: isScreenshot ? "6px 0" : 0 }}>
                                                  <span style={{ fontFamily: mono, color: t3, minWidth: "70px", paddingTop: isScreenshot ? "4px" : 0 }}>{labelType}</span>
                                                  {/* Screenshot proofs render as inline thumbnails — much faster
                                                      review than clicking through a generic URL. The proxy keeps
                                                      ad-blocker friendliness (i.ibb.co is allowlisted). */}
                                                  {isScreenshot ? (
                                                    <div style={{ display: "flex", gap: 10, alignItems: "center", flex: 1, minWidth: 0 }}>
                                                      <a href={value} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0 }}>
                                                        <img src={/\.blob\.vercel-storage\.com\//i.test(value) ? value : `/api/image-proxy?url=${encodeURIComponent(value)}`}
                                                          alt={t.title || "proof screenshot"}
                                                          style={{ width: 56, height: 42, objectFit: "cover", borderRadius: 5, border: "1px solid " + bdr, cursor: "zoom-in", display: "block" }} />
                                                      </a>
                                                      <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{ color: t2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title || t.id}</div>
                                                        <a href={value} target="_blank" rel="noopener noreferrer"
                                                          style={{ fontFamily: mono, fontSize: "10px", color: "#8aaeff", textDecoration: "none" }}>
                                                          Open full size ↗
                                                        </a>
                                                      </div>
                                                    </div>
                                                  ) : (
                                                    <>
                                                      <span style={{ color: t2, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                        {t.title || t.id}:
                                                      </span>
                                                      {linkHref ? (
                                                        <a href={linkHref} target="_blank" rel="noopener noreferrer"
                                                          style={{ fontFamily: mono, color: "#8aaeff", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" }}>
                                                          {value} ↗
                                                        </a>
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
                                      )
                                    })()}

                                    {camp.review_questions?.map((q: any) => {
                                      const ans = comp.review_answers?.[q.id]
                                      if (!ans) return null
                                      return (
                                        <div key={q.id} style={{ marginBottom: "12px" }}>
                                          <div style={{ fontSize: "10px", fontFamily: mono, color: t3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "5px" }}>{q.label}</div>
                                          <div style={{ fontSize: "12px", color: t2, lineHeight: 1.7, whiteSpace: "pre-wrap", background: surf, border: "1px solid " + bdr, borderRadius: "7px", padding: "10px 12px" }}>{ans}</div>
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}

                                {/* Rating panel — branches on the campaign's xp_mode.
                                    Mode A (default): single overall ★ rating.
                                    Mode B: founder rates each question separately so per-
                                    question XP weights translate into earned XP. */}
                                {isRating && (() => {
                                  const isModeB = camp?.xp_mode === "per_question" && camp?.max_xp_per_completion != null
                                  const qs: Array<{ id: string; label: string; xp_value?: number }> = (camp?.review_questions || []) as any
                                  const allRated  = isModeB ? qs.every(q => (dashRatingPerQ[q.id] || 0) >= 1) : (dashRatingVal > 0)
                                  // Live XP preview so founder sees what tester will earn.
                                  const xpPreview = isModeB
                                    ? Math.round(qs.reduce((s, q) => s + ((dashRatingPerQ[q.id] || 0) / 5) * (Number(q.xp_value) || 0), 0))
                                    : (camp?.max_xp_per_completion != null ? Math.round((dashRatingVal / 5) * camp.max_xp_per_completion) : 0)
                                  return (
                                    <div style={{ padding: "14px 20px", borderTop: "1px solid " + bdr, background: "rgba(192,136,40,0.03)" }}>
                                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                                        <div style={{ fontSize: "10px", fontFamily: mono, color: t3, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                                          {isModeB ? `Rate each answer (Mode B · ${camp?.max_xp_per_completion} XP pool)` : "Rate this tester's contribution"}
                                        </div>
                                        {camp?.max_xp_per_completion != null && allRated && (
                                          <div style={{ fontSize: "10px", fontFamily: mono, color: "#8aaeff", padding: "2px 8px", borderRadius: 4, background: "rgba(138,174,255,0.08)", border: "1px solid rgba(138,174,255,0.25)" }}>
                                            Awards {xpPreview} XP
                                          </div>
                                        )}
                                      </div>

                                      {isModeB ? (
                                        <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "12px" }}>
                                          {qs.map((q, qi) => (
                                            <div key={q.id} style={{ padding: "9px 12px", background: surf2, border: "1px solid " + bdr, borderRadius: 8 }}>
                                              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 7, gap: 8 }}>
                                                <span style={{ fontSize: "11px", color: t1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                  <span style={{ color: t3, fontFamily: mono, marginRight: 6 }}>Q{qi + 1}</span>
                                                  {q.label}
                                                </span>
                                                <span style={{ fontSize: "9.5px", fontFamily: mono, color: t3, flexShrink: 0 }}>
                                                  {q.xp_value || 0} XP max
                                                </span>
                                              </div>
                                              <div style={{ display: "flex", gap: "5px" }}>
                                                {[1, 2, 3, 4, 5].map(n => {
                                                  const active = (dashRatingPerQ[q.id] || 0) >= n
                                                  return (
                                                    <button key={n} onClick={() => setDashRatingPerQ(p => ({ ...p, [q.id]: n }))}
                                                      style={{ width: "28px", height: "28px", borderRadius: "6px",
                                                        background: active ? "rgba(192,136,40,0.2)" : surf, border: `1px solid ${active ? "rgba(192,136,40,0.4)" : bdr}`,
                                                        color: active ? "#c08828" : t3, fontSize: "13px", cursor: "pointer" }}>
                                                      ★
                                                    </button>
                                                  )
                                                })}
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
                                          {[1, 2, 3, 4, 5].map(n => (
                                            <button key={n} onClick={() => setDashRatingVal(n)}
                                              style={{ width: "36px", height: "36px", borderRadius: "8px", background: dashRatingVal >= n ? "rgba(192,136,40,0.2)" : surf2, border: `1px solid ${dashRatingVal >= n ? "rgba(192,136,40,0.4)" : bdr}`, color: dashRatingVal >= n ? "#c08828" : t3, fontSize: "16px", cursor: "pointer", flexShrink: 0 }}>
                                              ★
                                            </button>
                                          ))}
                                          <span style={{ fontSize: "12px", color: t3, fontFamily: mono, lineHeight: "36px", marginLeft: "4px" }}>
                                            {dashRatingVal > 0 ? ["","Poor","Fair","Good","Great","Excellent"][dashRatingVal] : ""}
                                          </span>
                                        </div>
                                      )}

                                      <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px", color: t2, cursor: "pointer", marginBottom: "10px" }}>
                                        <input type="checkbox" checked={dashRatingImpact} onChange={e => setDashRatingImpact(e.target.checked)} />
                                        Credit this tester — their feedback shaped a real product change
                                      </label>
                                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                                        <button onClick={submitDashRating} disabled={!allRated || dashRatingLoading}
                                          style={{ height: "32px", padding: "0 16px", background: allRated ? "#1a56ff" : surf2, color: allRated ? "#fff" : t3, border: "none", borderRadius: "6px", fontSize: "12px", fontFamily: mono, cursor: allRated ? "pointer" : "default", fontWeight: 600 }}>
                                          {dashRatingLoading ? "Saving..." : "Save Rating"}
                                        </button>
                                        {dashRatingMsg && <span style={{ fontSize: "11px", color: green, fontFamily: mono }}>{dashRatingMsg}</span>}
                                      </div>
                                    </div>
                                  )
                                })()}
                              </div>
                            )
                          })}
                        </div>

                      </div>
                    )
                  })()}
                </div>
              )}
            </div>
          )}

          {/* ── EDIT LISTING ── */}
          {activeTab === "edit" && canEdit && (<>
            <div style={{ background: surf, border: "1px solid " + bdr, borderRadius: "12px", padding: "24px 26px" }}>
              <div style={{ fontSize: "14px", fontWeight: 600, color: t1, marginBottom: "4px" }}>Edit your listing</div>
              <div style={{ fontSize: "11px", fontFamily: mono, color: t3, marginBottom: "22px" }}>Changes go through admin review before going live</div>

              {/* Logo — direct upload, no URL pasting */}
              <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "18px", paddingBottom: "18px", borderBottom: "1px solid " + bdr }}>
                <div style={{ width: 64, height: 64, borderRadius: 12, background: surf2, border: "1px solid " + bdr, flexShrink: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {editForm.logo_url
                    ? <img src={editForm.logo_url.startsWith("http") ? `/api/image-proxy?url=${encodeURIComponent(editForm.logo_url)}` : editForm.logo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={e => (e.currentTarget.style.display = "none")} />
                    : <span style={{ fontSize: 22, fontWeight: 700, color: t3, fontFamily: mono }}>{(project.name || "?").slice(0, 1).toUpperCase()}</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label style={{ display: "block", fontSize: "9.5px", fontFamily: mono, color: t3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px" }}>Project logo</label>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 34, padding: "0 14px", background: surf2, border: "1px solid " + bdr, borderRadius: 8, fontSize: 12, fontFamily: mono, color: logoUploading ? t3 : t1, cursor: logoUploading ? "default" : "pointer" }}>
                    {logoUploading ? "Uploading…" : editForm.logo_url ? "Change logo" : "Upload logo"}
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" disabled={logoUploading}
                      onChange={e => { const f = e.target.files?.[0]; if (f) uploadProjectLogo(f); e.currentTarget.value = "" }}
                      style={{ display: "none" }} />
                  </label>
                  <div style={{ fontSize: "10px", fontFamily: mono, color: t3, marginTop: "6px", lineHeight: 1.5 }}>Square works best · PNG, JPG, WebP or SVG · under 5MB</div>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                {[
                  { key: "tagline",     label: "Tagline",          ph: "One-line description" },
                  { key: "website",     label: "Website",          ph: "https://..." },
                  { key: "twitter",     label: "Project X / Twitter", ph: "@yourproject" },
                  { key: "github",      label: "GitHub",           ph: "https://github.com/..." },
                  { key: "discord",     label: "Discord",          ph: "https://discord.gg/..." },
                  { key: "contract",    label: "Primary Contract Address", ph: "0x..." },
                  { key: "city",        label: "City",             ph: "e.g. Lagos, Singapore, New York" },
                  { key: "country",     label: "Country",          ph: "e.g. Nigeria, Singapore, USA" },
                ].map(f => (
                  <div key={f.key}>
                    <label style={{ display: "block", fontSize: "9.5px", fontFamily: mono, color: t3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "5px" }}>{f.label}</label>
                    <input
                      value={(editForm as any)[f.key]}
                      onChange={e => setEditForm(p => ({ ...p, [f.key]: e.target.value }))}
                      placeholder={f.ph}
                      style={inputStyle}
                    />
                  </div>
                ))}
                {/* FOUNDER — the person, distinct from the project's own links above. */}
                <div style={{ paddingTop: "14px", borderTop: "1px solid " + bdr }}>
                  <label style={{ display: "block", fontSize: "9.5px", fontFamily: mono, color: t3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "5px" }}>
                    Founder <span style={{ color: t3, textTransform: "none", letterSpacing: 0 }}>— optional</span>
                  </label>
                  <input
                    value={editForm.founder_social}
                    onChange={e => setEditForm(p => ({ ...p, founder_social: e.target.value }))}
                    placeholder="Your personal X, LinkedIn, or site — e.g. @yourname"
                    style={inputStyle}
                  />
                  <div style={{ fontSize: "10px", fontFamily: mono, color: t3, marginTop: "5px", lineHeight: 1.5 }}>
                    This is <strong style={{ color: t2 }}>you</strong> — the person behind the project, not the project's own account. Shown on your project page.
                  </div>
                </div>
                {/* Additional contracts */}
                <div>
                  <label style={{ display: "block", fontSize: "9.5px", fontFamily: mono, color: t3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px" }}>Additional Contract Addresses</label>
                  {extraContracts.map((addr, i) => (
                    <div key={i} style={{ display: "flex", gap: "6px", marginBottom: "6px" }}>
                      <input value={addr} onChange={e => setExtraContracts(p => p.map((c,j) => j===i ? e.target.value : c))} placeholder={`0x... (contract ${i+2})`} style={{ ...inputStyle, flex: 1 }} />
                      <button type="button" onClick={() => setExtraContracts(p => p.filter((_,j) => j!==i))}
                        style={{ height: "38px", padding: "0 12px", background: "rgba(224,51,72,0.08)", color: "#e03348", border: "1px solid rgba(224,51,72,0.2)", borderRadius: "7px", cursor: "pointer", fontSize: "13px", flexShrink: 0 }}>✕</button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setExtraContracts(p => [...p, ""])}
                    style={{ height: "30px", padding: "0 14px", background: "rgba(26,86,255,0.07)", color: "#8aaeff", border: "1px solid rgba(26,86,255,0.2)", borderRadius: "6px", cursor: "pointer", fontSize: "10px", fontFamily: mono }}>
                    + Add another contract
                  </button>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "9.5px", fontFamily: mono, color: t3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "5px" }}>Description</label>
                  <textarea
                    value={editForm.description}
                    onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))}
                    placeholder="What does your project do?"
                    style={{ ...inputStyle, height: "100px", padding: "10px 12px", resize: "vertical", lineHeight: 1.6 } as React.CSSProperties}
                  />
                </div>
                <div style={{ padding: "10px 14px", background: "rgba(26,86,255,0.05)", border: "1px solid rgba(26,86,255,0.15)", borderRadius: "7px", fontSize: "11px", fontFamily: mono, color: t3, lineHeight: 1.6 }}>
                  Location fields (city, country) are used to place your project on the Arc globe. Updates are reviewed within 24h.
                </div>
                {saveError    && <div style={{ fontSize: "12px", color: "#e03348", fontFamily: mono }}>{saveError}</div>}
                {saveSuccess  && <div style={{ fontSize: "12px", color: green, fontFamily: mono }}>✓ Changes submitted — pending admin approval</div>}
                <button onClick={saveEdit} disabled={saving}
                  style={{ height: "42px", background: "#1a56ff", color: "#fff", fontSize: "13px", fontWeight: 600, border: "none", borderRadius: "8px", cursor: saving ? "not-allowed" : "pointer", fontFamily: mono, opacity: saving ? 0.7 : 1 }}>
                  {saving ? "Saving..." : "Save changes"}
                </button>
              </div>
            </div>

          </>)}

          {/* ── TRUST ──────────────────────────────────────────────────────
              Get Verified and Apply for Spotlight used to sit at the bottom of
              the Edit tab. Submitting an audit is not an edit, and nobody
              looking to apply for the banner thinks to look under "Edit". */}
          {activeTab === "trust" && canEdit && (<>

            {/* GET VERIFIED — submit a third-party audit for review */}
            <div style={{ background: surf, border: "1px solid " + bdr, borderRadius: "12px", padding: "24px 26px", marginTop: "16px" }}>
              <div style={{ fontSize: "14px", fontWeight: 600, color: t1, marginBottom: "4px" }}>Get Verified</div>
              <div style={{ fontSize: "11px", fontFamily: mono, color: t3, marginBottom: "18px", lineHeight: 1.6 }}>
                Have an independent security audit? Submit it and we'll review. Verified projects show a green ✓. (Not a paid badge — we just confirm the report.)
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "9.5px", fontFamily: mono, color: t3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "5px" }}>Auditor</label>
                  <input value={auditForm.auditor} onChange={e => setAuditForm(p => ({ ...p, auditor: e.target.value }))} placeholder="e.g. Hacken, CertiK, Sherlock" style={inputStyle} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "9.5px", fontFamily: mono, color: t3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "5px" }}>Report link</label>
                  <input value={auditForm.audit_url} onChange={e => setAuditForm(p => ({ ...p, audit_url: e.target.value }))} placeholder="https://link-to-the-audit-report" style={inputStyle} />
                </div>
                {auditMsg && <div style={{ fontSize: "12px", fontFamily: mono, color: auditMsg.ok ? green : "#e03348" }}>{auditMsg.ok ? "✓ " : ""}{auditMsg.text}</div>}
                <button
                  onClick={async () => {
                    if (!auditForm.auditor.trim() || !auditForm.audit_url.trim()) { setAuditMsg({ ok: false, text: "Add the auditor and the report link" }); return }
                    setAuditSubmitting(true); setAuditMsg(null)
                    try {
                      const res = await fetch("/api/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, slug, wallet: connectedWallet, auditor: auditForm.auditor, audit_url: auditForm.audit_url }) })
                      const d = await res.json().catch(() => ({}))
                      setAuditMsg(res.ok ? { ok: true, text: "Submitted — we'll review your audit." } : { ok: false, text: d.error || "Could not submit" })
                    } catch { setAuditMsg({ ok: false, text: "Network error — try again" }) }
                    finally { setAuditSubmitting(false) }
                  }}
                  disabled={auditSubmitting}
                  style={{ height: "40px", background: "rgba(0,184,122,0.1)", color: green, fontSize: "13px", fontWeight: 600, border: "1px solid rgba(0,184,122,0.3)", borderRadius: "8px", cursor: auditSubmitting ? "not-allowed" : "pointer", fontFamily: mono }}>
                  {auditSubmitting ? "Submitting…" : "Submit for review"}
                </button>
              </div>
            </div>

            {/* APPLY FOR SPOTLIGHT — request the rotating banner on the Ecosystem page */}
            <div style={{ background: surf, border: "1px solid " + bdr, borderRadius: "12px", padding: "24px 26px", marginTop: "16px" }}>
              <div style={{ fontSize: "14px", fontWeight: 600, color: t1, marginBottom: "4px" }}>Apply for the Ecosystem Spotlight</div>
              <div style={{ fontSize: "11px", fontFamily: mono, color: t3, marginBottom: "18px", lineHeight: 1.6 }}>
                Request a slot in the rotating banner at the top of the Ecosystem page. Submissions are reviewed before going live. (Risk-flagged projects aren&apos;t eligible.)
              </div>

              {/* Mode — spotlight a live campaign (recommended), or something custom */}
              <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
                {([["campaign", "A campaign"], ["custom", "Something custom"]] as const).map(([m, label]) => (
                  <button key={m} type="button" onClick={() => setSpotMode(m)}
                    style={{ flex: 1, height: "34px", fontSize: "12px", fontFamily: mono, borderRadius: "8px", cursor: "pointer", border: "1px solid " + (spotMode === m ? "rgba(26,86,255,0.4)" : bdr), background: spotMode === m ? "rgba(26,86,255,0.1)" : "transparent", color: spotMode === m ? "#8aaeff" : t2, fontWeight: spotMode === m ? 600 : 400 }}>{label}</button>
                ))}
              </div>

              {spotMode === "campaign" && (
                <div style={{ marginBottom: "16px" }}>
                  <label style={{ display: "block", fontSize: "9.5px", fontFamily: mono, color: t3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "5px" }}>Which campaign?</label>
                  {forgeCampaigns.filter((c: any) => c.status === "active").length === 0 ? (
                    <div style={{ fontSize: "11px", fontFamily: mono, color: t3, lineHeight: 1.6 }}>No live campaigns yet — launch one from the Campaigns tab, or switch to <strong style={{ color: t2 }}>Something custom</strong>.</div>
                  ) : (
                    <select value={spotCampaign} onChange={e => {
                      const id = e.target.value; setSpotCampaign(id)
                      const c = forgeCampaigns.find((x: any) => String(x.slug || x.id) === id)
                      if (c) setSpotForm(p => ({ ...p, title: String(c.title || "").slice(0, 80), subtitle: String(c.tagline || "").slice(0, 160), cta_text: p.cta_text || "Join the campaign" }))
                    }} style={inputStyle}>
                      <option value="">Select a campaign…</option>
                      {forgeCampaigns.filter((c: any) => c.status === "active").map((c: any) => <option key={c.id} value={c.slug || c.id}>{c.title}</option>)}
                    </select>
                  )}
                </div>
              )}

              {/* LIVE PREVIEW — exactly how the banner will appear */}
              <div style={{ marginBottom: "18px" }}>
                <div style={{ fontSize: "9px", fontFamily: mono, color: t3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>Live preview — exactly how it appears{spotForm.image_url ? " · drag the image to reposition" : ""}</div>
                <SpotlightCard static editable={!!spotForm.image_url} onPosChange={pos => setSpotForm(p => ({ ...p, image_pos: pos }))} item={{ kind: spotMode === "campaign" ? "campaign" : "custom", title: spotForm.title, subtitle: spotForm.subtitle, image_url: spotForm.image_url, image_pos: spotForm.image_pos, cta_text: spotForm.cta_text, accent: "#3b6bff" }} />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "9.5px", fontFamily: mono, color: t3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "5px" }}>Headline</label>
                  <input maxLength={80} value={spotForm.title} onChange={e => setSpotForm(p => ({ ...p, title: e.target.value.slice(0, 80) }))} placeholder="e.g. Trade stablecoins on Arc — live now" style={inputStyle} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "9.5px", fontFamily: mono, color: t3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "5px" }}>Subtext <span style={{ color: t3, textTransform: "none", letterSpacing: 0 }}>— optional</span></label>
                  <input maxLength={160} value={spotForm.subtitle} onChange={e => setSpotForm(p => ({ ...p, subtitle: e.target.value.slice(0, 160) }))} placeholder="One short line about what you're promoting" style={inputStyle} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "9.5px", fontFamily: mono, color: t3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "5px" }}>Banner image <span style={{ color: t3, textTransform: "none", letterSpacing: 0 }}>— optional</span></label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <label style={{ flex: 1, display: "flex", alignItems: "center", gap: "10px", height: "40px", padding: "0 14px", background: surf2, border: "1px dashed " + (spotForm.image_url ? "rgba(0,184,122,0.4)" : bdr), borderRadius: "8px", cursor: "pointer", fontFamily: mono, fontSize: "12px", color: spotForm.image_url ? green : t2 }}>
                      {spotUploading ? "Uploading…" : spotForm.image_url ? "✓ Image added — click to change" : "Click to upload a banner image"}
                      <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }} onChange={async e => {
                        const file = e.target.files?.[0]; if (!file) return
                        if (file.size > 5 * 1024 * 1024) { setSpotMsg({ ok: false, text: "Image must be under 5MB" }); return }
                        setSpotForm(p => ({ ...p, image_url: URL.createObjectURL(file) })) // instant preview
                        setSpotUploading(true)
                        try {
                          const fd = new FormData(); fd.append("image", file)
                          const r = await fetch("/api/upload", { method: "POST", body: fd })
                          const { url } = await r.json()
                          if (url) setSpotForm(p => ({ ...p, image_url: url }))
                        } catch { setSpotMsg({ ok: false, text: "Upload failed — try again" }) }
                        finally { setSpotUploading(false) }
                      }} />
                    </label>
                    {spotForm.image_url && (
                      <button type="button" onClick={() => setSpotForm(p => ({ ...p, image_url: "", image_pos: "" }))} title="Remove image"
                        style={{ width: "40px", height: "40px", flexShrink: 0, background: "rgba(224,51,72,0.08)", color: "#e03348", border: "1px solid rgba(224,51,72,0.25)", borderRadius: "8px", cursor: "pointer", fontSize: "14px" }}>✕</button>
                    )}
                  </div>
                  <div style={{ fontSize: "10px", fontFamily: mono, color: t3, marginTop: "6px", lineHeight: 1.6 }}>
                    Recommended: <strong style={{ color: t2 }}>1200 × 400 px</strong> (3:1), PNG or JPG, under 1 MB. Keep your logo / key visual on the <strong style={{ color: t2 }}>right half</strong> — the left side fades into the banner. Dark or transparent background blends best. The preview above updates as you go.
                  </div>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "9.5px", fontFamily: mono, color: t3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "5px" }}>Button text <span style={{ color: t3, textTransform: "none", letterSpacing: 0 }}>— optional</span></label>
                  <input maxLength={24} value={spotForm.cta_text} onChange={e => setSpotForm(p => ({ ...p, cta_text: e.target.value.slice(0, 24) }))} placeholder="e.g. Trade now, Learn more" style={inputStyle} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "9.5px", fontFamily: mono, color: t3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "5px" }}>Run for</label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input type="number" min={1} value={spotDurN} onChange={e => setSpotDurN(Math.max(1, parseInt(e.target.value) || 1))} style={{ ...inputStyle, width: "110px" }} />
                    <select value={spotDurUnit} onChange={e => setSpotDurUnit(e.target.value as "days" | "hours")} style={{ ...inputStyle, width: "130px" }}>
                      <option value="hours">hours</option>
                      <option value="days">days</option>
                    </select>
                  </div>
                  <div style={{ fontSize: "10px", fontFamily: mono, color: t3, marginTop: "6px", lineHeight: 1.6 }}>How long your spot stays up — it ends automatically after that.</div>
                </div>
                {spotMsg && <div style={{ fontSize: "12px", fontFamily: mono, color: spotMsg.ok ? green : "#e03348" }}>{spotMsg.ok ? "✓ " : ""}{spotMsg.text}</div>}
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    onClick={async () => {
                      if (spotMode === "campaign" && !spotCampaign) { setSpotMsg({ ok: false, text: "Pick a campaign to spotlight" }); return }
                      if (!spotForm.title.trim()) { setSpotMsg({ ok: false, text: "Add a headline" }); return }
                      setSpotSubmitting(true); setSpotMsg(null)
                      try {
                        const kind = spotMode === "campaign" ? "campaign" : "custom"
                        const link_url = spotMode === "campaign" && spotCampaign ? `/trials/${spotCampaign}` : undefined
                        const res = await fetch("/api/spotlight", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, slug, wallet: connectedWallet, kind, link_url, duration_hours: spotDurN * (spotDurUnit === "days" ? 24 : 1), ...spotForm }) })
                        const d = await res.json().catch(() => ({}))
                        if (res.ok) {
                          setSpotMsg({ ok: true, text: d.message || "Submitted — we'll review it." })
                          setSpotForm({ title: "", subtitle: "", image_url: "", image_pos: "", cta_text: "" }); setSpotCampaign("")
                          try { localStorage.removeItem("arclens-spotlight-draft") } catch {}
                        } else setSpotMsg({ ok: false, text: d.error || "Could not submit" })
                      } catch { setSpotMsg({ ok: false, text: "Network error — try again" }) }
                      finally { setSpotSubmitting(false) }
                    }}
                    disabled={spotSubmitting}
                    style={{ flex: 1, height: "40px", background: "rgba(26,86,255,0.1)", color: "#8aaeff", fontSize: "13px", fontWeight: 600, border: "1px solid rgba(26,86,255,0.3)", borderRadius: "8px", cursor: spotSubmitting ? "not-allowed" : "pointer", fontFamily: mono }}>
                    {spotSubmitting ? "Submitting…" : "Apply for Spotlight"}
                  </button>
                  {(spotForm.title || spotForm.subtitle || spotForm.image_url || spotForm.cta_text) && (
                    <button type="button" onClick={() => { setSpotForm({ title: "", subtitle: "", image_url: "", image_pos: "", cta_text: "" }); setSpotMsg(null); try { localStorage.removeItem("arclens-spotlight-draft") } catch {} }}
                      style={{ height: "40px", padding: "0 16px", background: "transparent", color: t2, fontSize: "12px", border: "1px solid " + bdr, borderRadius: "8px", cursor: "pointer", fontFamily: mono }}>
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>)}

          {activeTab === "tvl" && canEdit && (
            <TvlTrackingPanel
              slug={slug}
              token={token}
              connectedWallet={connectedWallet}
              theme={{ mono, bdr, surf, surf2, t1, t2, t3, green }}
            />
          )}

        </div>
      </div>
    </ArcLayout>
  )
}

// Pro rank color treatment — gold/silver/bronze for top 3, dimmed text for rest.
// Cleaner than emoji medals (Stripe/Linear style, no decorative graphics).
function rankColor(rank: number, fallback: string): string {
  if (rank === 1) return "#d4a447"  // gold
  if (rank === 2) return "#a5b0c5"  // silver
  if (rank === 3) return "#b88762"  // bronze
  return fallback
}

function FounderLeaderboard({ completions, surf, surf2, bdr, t1, t2, t3, green, mono }: any) {
  const [showAll, setShowAll] = useState(false)
  const SHOW_LIMIT = 5

  const ranked = (completions || [])
    .filter((c: any) => c.builder_rating != null && c.status === "reviewed")
    .slice()
    .sort((a: any, b: any) => {
      const qa = Number(a.quality_score) || 0
      const qb = Number(b.quality_score) || 0
      if (qb !== qa) return qb - qa
      return (Number(b.builder_rating) || 0) - (Number(a.builder_rating) || 0)
    })

  if (ranked.length === 0) return null
  const visible = showAll ? ranked : ranked.slice(0, SHOW_LIMIT)
  const hasMore = ranked.length > SHOW_LIMIT

  return (
    <div id="leaderboard" style={{ background: surf, border: "1px solid " + bdr, borderRadius: "12px", overflow: "hidden", scrollMarginTop: "24px" }}>
      <div style={{ padding: "14px 20px", borderBottom: "1px solid " + bdr, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
        <div style={{ fontSize: "11px", fontFamily: mono, color: t2, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Top Contributors · this campaign
        </div>
        <div style={{ fontSize: "10px", fontFamily: mono, color: t3 }}>
          {ranked.length} rated · ranked by quality
        </div>
      </div>
      <div>
        {visible.map((c: any, i: number) => {
          const rank        = i + 1
          const scoreColor  = (Number(c.quality_score) || 0) > 70 ? green : (Number(c.quality_score) || 0) > 40 ? "#e08810" : t2
          const rkColor     = rankColor(rank, t3)
          return (
            <div key={c.tester_wallet} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "11px 20px",
                  borderBottom: i < visible.length - 1 || hasMore ? "1px solid " + bdr : "none" }}>
              <div style={{ width: "32px", fontSize: "12px", fontFamily: mono, color: rkColor, fontWeight: 700, flexShrink: 0, letterSpacing: "0.04em" }}>
                {"#" + rank}
              </div>
              <WalletAvatar wallet={c.tester_wallet} size={28} />
              <a href={`/tester/${c.tester_wallet}`}
                style={{ fontSize: "12px", fontFamily: mono, color: t1, textDecoration: "none", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.tester_wallet.slice(0, 8)}…{c.tester_wallet.slice(-4)}
              </a>
              <div style={{ fontSize: "11px", fontFamily: mono, color: "#c08828", flexShrink: 0 }}>
                {"★".repeat(c.builder_rating)}<span style={{ opacity: 0.25 }}>{"★".repeat(5 - c.builder_rating)}</span>
              </div>
              <div style={{ minWidth: "48px", textAlign: "right", flexShrink: 0 }}>
                <span style={{ fontSize: "13px", fontWeight: 700, color: scoreColor, fontFamily: mono }}>{Math.round(Number(c.quality_score) || 0)}</span>
                <span style={{ fontSize: "9px", fontFamily: mono, color: t3, marginLeft: "3px" }}>/100</span>
              </div>
            </div>
          )
        })}
        {hasMore && (
          <button onClick={() => setShowAll(s => !s)}
            style={{ width: "100%", padding: "11px 20px", background: surf2, border: "none", borderTop: "1px solid " + bdr,
                     color: "#8aaeff", fontSize: "11px", fontFamily: mono, cursor: "pointer", letterSpacing: "0.04em",
                     transition: "background 0.12s" }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(26,86,255,0.06)")}
            onMouseLeave={e => (e.currentTarget.style.background = surf2)}>
            {showAll ? "Show less" : `View all ${ranked.length} contributors →`}
          </button>
        )}
      </div>
    </div>
  )
}

function ReviewCard({ r, surf, bdr, t2, t3, mono, green, showContact }: any) {
  return (
    <div style={{ background: surf, border: "1px solid " + bdr, borderRadius: "10px", padding: "18px 22px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px", flexWrap: "wrap", gap: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "11px", fontFamily: mono, color: t3 }}>{r.wallet.slice(0,6)}...{r.wallet.slice(-4)}</span>
          {r.badge === "verified"  && <span style={{ fontSize: "8px", fontFamily: mono, padding: "2px 7px", borderRadius: "4px", background: "rgba(0,184,122,0.1)", color: green, border: "1px solid rgba(0,184,122,0.2)" }}>✓ VERIFIED</span>}
          {r.badge === "arc_user"  && <span style={{ fontSize: "8px", fontFamily: mono, padding: "2px 7px", borderRadius: "4px", background: "rgba(26,86,255,0.1)", color: "#8aaeff", border: "1px solid rgba(26,86,255,0.2)" }}>◆ ARC USER</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "13px", color: "#e08810" }}>{"★".repeat(Math.max(0,Math.min(5,r.rating||0)))}{"☆".repeat(Math.max(0,5-Math.min(5,r.rating||0)))}</span>
          <span style={{ fontSize: "10px", fontFamily: mono, color: t3 }}>{r.category}</span>
        </div>
      </div>
      <p style={{ fontSize: "13px", color: t2, lineHeight: 1.7, margin: 0 }}>{r.review_text}</p>
      {showContact && r.contact && (
        <div style={{ marginTop: "10px", padding: "8px 12px", background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.2)", borderRadius: "6px", fontSize: "11px", fontFamily: mono, color: "#a855f7" }}>
          Contact: {r.contact}
        </div>
      )}
      <div style={{ fontSize: "10px", fontFamily: mono, color: t3, marginTop: "10px" }}>
        {new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
      </div>
    </div>
  )
}

function ClaimForm({ slug, mono, bdr, surf, surf2, t1, t2, t3 }: any) {
  const [email, setEmail]       = useState("")
  const [loading, setLoading]   = useState(false)
  const [success, setSuccess]   = useState(false)
  const [error, setError]       = useState("")
  const [debugUrl, setDebugUrl] = useState("")

  async function claim() {
    if (!email.trim()) { setError("Enter your email"); return }
    setLoading(true); setError("")
    try {
      const res  = await fetch("/api/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, slug }) })
      const data = await res.json()
      if (data.success) { setSuccess(true); if (data.debug_url) setDebugUrl(data.debug_url) }
      else setError(data.error || "Failed")
    } catch { setError("Network error") }
    finally { setLoading(false) }
  }

  return (
    <div style={{ padding: "80px 20px", maxWidth: "480px", margin: "0 auto" }}>
      <div style={{ fontSize: "10px", fontFamily: mono, color: t3, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "12px" }}>Founder Access</div>
      <h1 style={{ fontSize: "26px", fontWeight: 700, letterSpacing: "-0.04em", color: t1, margin: "0 0 8px" }}>Claim your dashboard</h1>
      <p style={{ fontSize: "13px", color: t2, lineHeight: 1.7, marginBottom: "28px" }}>Enter the email you used when submitting your project. We'll send you a magic link — no password needed.</p>
      {success ? (
        <div>
          <div style={{ padding: "16px", background: "rgba(0,184,122,0.06)", border: "1px solid rgba(0,184,122,0.2)", borderRadius: "8px", fontSize: "13px", color: "#00b87a", marginBottom: "10px" }}>
            ✓ Check your email for the dashboard link
          </div>
          {/* On screen, not in the email — a filtered message is never read. */}
          <div style={{ fontSize: "12px", color: t3, lineHeight: 1.7, marginBottom: "16px" }}>
            Not in your inbox after a minute? Check your spam or promotions folder — a first email from a new sender is often filtered there.
          </div>
          {debugUrl && (
            <div style={{ padding: "12px", background: surf, border: "1px solid " + bdr, borderRadius: "8px", fontSize: "11px", fontFamily: mono, color: t3, wordBreak: "break-all" }}>
              Dev link: <a href={debugUrl} style={{ color: "#8aaeff" }}>{debugUrl}</a>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <input value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && claim()} placeholder="you@email.com"
            style={{ height: "42px", background: surf, border: "1px solid " + bdr, borderRadius: "8px", padding: "0 14px", fontSize: "13px", fontFamily: mono, color: t1, outline: "none", width: "100%" }} />
          {error && <div style={{ fontSize: "12px", color: "#e03348" }}>{error}</div>}
          <button onClick={claim} disabled={loading}
            style={{ height: "42px", background: "#1a56ff", color: "#fff", fontSize: "13px", fontWeight: 600, border: "none", borderRadius: "8px", cursor: loading ? "not-allowed" : "pointer", fontFamily: mono, opacity: loading ? 0.7 : 1 }}>
            {loading ? "Sending..." : "Send magic link →"}
          </button>
        </div>
      )}
    </div>
  )
}
