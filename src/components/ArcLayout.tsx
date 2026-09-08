"use client"
import { useEffect, useState, useRef } from "react"
import { useArcStore } from "@/store/arc"
import { detectWallets, EIP6963Provider } from "@/context/web3modal"
import ArcLensAI from "@/components/ArcLensAI"
import WalletPanel from "@/components/WalletPanel"

const NAV = [
  { section: "", items: [
    { id: "home", label: "Home", icon: "⬡", href: "/" },
  ]},
  { section: "INTELLIGENCE", items: [
    { id: "lens",         label: "Lens AI",           icon: "◐", href: "/lens", tag: "AI" },
  ]},
  { section: "DISCOVER", items: [
    { id: "ecosystem",    label: "Arc Ecosystem",     icon: "◎", href: "/ecosystem" },
    { id: "trials",       label: "Arc Trials",        icon: "✦", href: "/trials" },
    { id: "events",       label: "Events",            icon: "◆", href: "/events" },
    { id: "start",        label: "Arc Beginners",     icon: "◈", href: "/start" },
  ]},
  { section: "EXPLORER", items: [
    { id: "overview",     label: "Overview",          icon: "◈", href: "/overview" },
    { id: "transactions", label: "Transactions",      icon: "⇄", href: "/transactions" },
  ]},
  { section: "TOOLS", items: [
    { id: "approvals",    label: "Approval Manager",  icon: "⚠", href: "/approvals", tag: "SAFETY" },
  ]},
  { section: "DEVELOPERS", items: [
    { id: "builders",     label: "Builder Profiles",  icon: "◎", href: "/builders" },
    { id: "dev",          label: "Dev Console",       icon: "⌘", href: "/dev" },
  ]},
]

const TAG_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  NEW:    { bg: "rgba(26,86,255,0.12)",  color: "#8aaeff", border: "rgba(26,86,255,0.2)" },
  AI:     { bg: "rgba(0,184,122,0.12)",  color: "#00d990", border: "rgba(0,184,122,0.2)" },
  SAFETY: { bg: "rgba(224,51,72,0.1)",   color: "#e03348", border: "rgba(224,51,72,0.2)" },
}


export default function ArcLayout({ children, active, lockDark }: { children: React.ReactNode; active?: string; lockDark?: boolean }) {
  const [mounted, setMounted]         = useState(false)
  const [dark, setDark]               = useState(true)
  const [blockNum, setBlockNum]       = useState("")
  const [gas, setGas]                 = useState("")
  const [connected, setConnected]     = useState(false)
  const [searchQ, setSearchQ]         = useState("")
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [copied, setCopied]           = useState(false)

  // Wallet funds panel (expands from the connected chip)
  const [walletPanelOpen, setWalletPanelOpen] = useState(false)
  // Connect modal state
  const [showConnectModal, setShowConnectModal] = useState(false)
  const [connectView, setConnectView]           = useState<"choose" | "wallets" | "email" | "otp" | "pin">("choose")
  const [walletType, setWalletType]             = useState<"metamask" | "circle" | null>(null)
  const [detectedWallets, setDetectedWallets]   = useState<EIP6963Provider[]>([])
  const [walletLoading, setWalletLoading]       = useState(false)
  const [emailInput, setEmailInput]             = useState("")
  const [emailLoading, setEmailLoading]         = useState(false)
  const [emailError, setEmailError]             = useState("")
  const [savedCircleEmail, setSavedCircleEmail] = useState("")
  const [isSignInFlow, setIsSignInFlow]         = useState(false)
  const prefetchedSession = useRef<{ email: string; data: any } | null>(null)
  const prefetchTimer     = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Custom OTP flow state
  const [otpDigits,    setOtpDigits]    = useState<string[]>(["", "", "", "", "", ""])
  const [otpVerifying, setOtpVerifying] = useState(false)
  const [otpError,     setOtpError]     = useState("")
  const [otpExpiresAt, setOtpExpiresAt] = useState<number | null>(null)
  const [now,          setNow]          = useState(Date.now())
  const [pinPhase,     setPinPhase]     = useState<"pin" | "finalizing">("pin")
  const otpRefs = useRef<(HTMLInputElement | null)[]>([])

  const walletAddr  = useArcStore(s => s.walletAddr)
  const walletBal   = useArcStore(s => s.walletBal)
  const myProject   = useArcStore(s => s.myProject)
  const setWallet   = useArcStore(s => s.setWallet)
  const clearWallet = useArcStore(s => s.clearWallet)
  const searchRef = useRef<HTMLInputElement>(null)
  const sdkRef    = useRef<any>(null)

  // Builder profile mini-card
  const [builderProfile, setBuilderProfile] = useState<{ display_name: string | null; avatar_url: string | null; claimed: boolean } | null>(null)

  useEffect(() => {
    setMounted(true)
    const saved = typeof window !== "undefined" ? localStorage.getItem("arclens-theme") : null
    if (saved === "light") setDark(false)
    else setDark(true)
    const wt = typeof window !== "undefined" ? localStorage.getItem("arclens-wallet-type") : null
    if (wt === "metamask" || wt === "circle") setWalletType(wt)
  }, [])

  // Preload Circle SDK + iframe at mount so the popup opens instantly when user connects
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_CIRCLE_APP_ID) return
    import("@circle-fin/w3s-pw-web-sdk").catch(() => {})
    const t = setTimeout(() => {
      if (document.getElementById("circleWarmupFrame")) return
      const frame = document.createElement("iframe")
      frame.src = `https://pw-auth.circle.com/social/verify-email?origin=${encodeURIComponent(window.location.origin)}`
      frame.style.cssText = "position:fixed;width:0;height:0;border:0;pointer-events:none;visibility:hidden;top:0;left:0"
      frame.id = "circleWarmupFrame"
      frame.onload = () => frame.remove()
      document.body.appendChild(frame)
    }, 3000)
    return () => { clearTimeout(t); document.getElementById("circleWarmupFrame")?.remove() }
  }, [])

  useEffect(() => {
    if (!mounted) return

    // Restore wallet from localStorage on page load
    const saved = localStorage.getItem("arclens-wallet")
    if (saved) {
      setWallet(saved)
      fetchWalletBal(saved)
      // Circle users have no popup, so silently keep the session warm.
      // Browser wallets defer to next protected action so we never surprise
      // the user with a "sign this" popup just from refreshing the page.
      const savedType = localStorage.getItem("arclens-wallet-type") as "metamask" | "circle" | null
      if (savedType === "circle") establishSession(saved.toLowerCase(), savedType).catch(() => {})
      fetch("/api/claim", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: saved }),
      }).then(r => r.json()).then(d => {
        if (d.projects?.length > 0) {
          const p = d.projects[0]
          useArcStore.setState({ myProject: { name: p.name, slug: p.slug || String(p.id) } })
        }
      }).catch(() => {})
      fetchBuilderProfile(saved)
    }

  }, [mounted])

  async function fetchWalletBal(addr: string) {
    try {
      const res  = await fetch("/api/blockscout?path=" + encodeURIComponent("v2/addresses/" + addr))
      const data = await res.json()
      const bal  = Number(data.coin_balance || 0) / 1e18
      const balStr = "$" + bal.toLocaleString(undefined, { maximumFractionDigits: 2 })
      useArcStore.setState(s => ({ walletBal: balStr, myProject: s.myProject }))
    } catch { useArcStore.setState({ walletBal: null }) }
  }

  function connect() {
    const saved = typeof window !== "undefined" ? localStorage.getItem("arclens-circle-email") || "" : ""
    setSavedCircleEmail(saved)
    // Returning Circle user → skip directly to email view with one-click sign-in
    setConnectView(saved ? "email" : "choose")
    setEmailInput(saved)
    setEmailError("")
    setIsSignInFlow(!!saved)
    setShowConnectModal(true)
  }

  async function afterConnect(addr: string, type: "metamask" | "circle") {
    localStorage.setItem("arclens-wallet", addr)
    localStorage.setItem("arclens-wallet-type", type)
    setWallet(addr)
    setWalletType(type)
    fetchWalletBal(addr)

    // Establish a signed session cookie so subsequent protected edits
    // (builder profile, founder claim) don't need another wallet popup.
    await establishSession(addr.toLowerCase(), type)

    try {
      const r = await fetch("/api/claim", { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: addr }) })
      const d = await r.json()
      if (d.projects?.length > 0) {
        const p = d.projects[0]
        useArcStore.setState({ myProject: { name: p.name, slug: p.slug || String(p.id) } })
      }
    } catch {}
    fetchBuilderProfile(addr)
  }

  // Establish session cookie so the user signs in once per week instead of
  // per edit. Browser wallets do one personal_sign; Circle is friction-free
  // because the backend can verify the email/wallet mapping in the DB.
  async function establishSession(addr: string, type: "metamask" | "circle") {
    try {
      const existing = await fetch("/api/auth/session", { credentials: "include" }).then(r => r.json()).catch(() => null)
      if (existing?.signedIn && existing.address?.toLowerCase() === addr) return

      if (type === "circle") {
        // Circle sessions are minted by the email-OTP flow (otp/verify +
        // circle/wallet), so the cookie is already set right after sign-in.
        // We can't silently re-mint here without re-verifying the email — if the
        // cookie has expired the user re-verifies on their next protected action.
        return
      }

      // Browser wallet — one personal_sign establishes the session
      const wallets = await detectWallets()
      let provider: any = null
      for (const w of wallets) {
        try {
          const accs: string[] = await w.provider.request({ method: "eth_accounts" })
          if (accs?.some(a => a.toLowerCase() === addr)) { provider = w.provider; break }
        } catch {}
      }
      if (!provider) provider = (window as any).ethereum
      if (!provider) return

      const timestamp = Date.now()
      const nonce     = crypto.randomUUID()
      const message   = `Sign in to ArcLens\nWallet: ${addr}\nTimestamp: ${timestamp}\nNonce: ${nonce}`
      const signature: string = await provider.request({ method: "personal_sign", params: [message, addr] })
      if (!signature) return
      await fetch("/api/auth/session", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ type: "wallet", address: addr, signature, timestamp, nonce }),
      })
    } catch {
      // Session is opt-in — silent failure means user just signs per request, no UX break
    }
  }

  async function fetchBuilderProfile(addr: string) {
    try {
      const r = await fetch(`/api/builder?address=${addr}`)
      const d = await r.json()
      setBuilderProfile({
        display_name: d.profile?.display_name || null,
        avatar_url:   d.profile?.avatar_url   || null,
        claimed:      !!d.profile?.claimed_at,
      })
    } catch {}
  }

  async function openBrowserWallets() {
    setWalletLoading(true)
    setConnectView("wallets")
    const wallets = await detectWallets()
    setDetectedWallets(wallets)
    setWalletLoading(false)
  }

  async function connectEIP6963(wallet: EIP6963Provider) {
    try {
      const accounts: string[] = await wallet.provider.request({ method: "eth_requestAccounts" })
      if (!accounts?.[0]) return
      setShowConnectModal(false)
      await afterConnect(accounts[0].toLowerCase(), "metamask")
    } catch (e: any) {
      // user rejected or error — stay on wallets view
      console.error("[eip6963] connect error", e)
    }
  }

  function onEmailChange(val: string) {
    setEmailInput(val)
    setEmailError("")
  }

  // 1-second tick — drives the live countdown on resend cooldown + expiry
  useEffect(() => {
    if (connectView !== "otp") return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [connectView])

  const [resendAvailableAt, setResendAvailableAt] = useState<number>(0)
  const [resentToast,       setResentToast]       = useState(false)

  const resendSecondsLeft = Math.max(0, Math.ceil((resendAvailableAt - now) / 1000))
  const codeSecondsLeft   = otpExpiresAt ? Math.max(0, Math.ceil((otpExpiresAt - now) / 1000)) : 0

  async function connectCircle() {
    if (!emailInput.includes("@")) { setEmailError("Enter a valid email address"); return }
    const email = emailInput.toLowerCase().trim()
    setEmailLoading(true)
    setEmailError("")
    setOtpError("")
    setOtpDigits(["", "", "", "", "", ""])

    try {
      const res = await fetch("/api/auth/otp/send", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) {
        setEmailError(data.error || "Failed to send verification code")
        setEmailLoading(false)
        return
      }
      setOtpExpiresAt(Date.now() + 10 * 60 * 1000)
      setResendAvailableAt(Date.now() + 30 * 1000)
      setNow(Date.now())
      setConnectView("otp")
      setEmailLoading(false)
      setTimeout(() => otpRefs.current[0]?.focus(), 60)
    } catch (e: any) {
      setEmailError(e?.message || "Network error. Try again.")
      setEmailLoading(false)
    }
  }

  async function verifyOTP(fullCode: string) {
    if (otpVerifying) return
    const email = emailInput.toLowerCase().trim()
    setOtpVerifying(true)
    setOtpError("")
    try {
      const res = await fetch("/api/auth/otp/verify", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email, code: fullCode }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        setOtpError(data.error || "Verification failed")
        setOtpVerifying(false)
        // Clear the boxes and refocus on first one for retry
        setOtpDigits(["", "", "", "", "", ""])
        setTimeout(() => otpRefs.current[0]?.focus(), 50)
        return
      }

      // Returning user — wallet already known, complete login
      if (data.address && !data.needsPinSetup) {
        localStorage.setItem("arclens-circle-email", email)
        setSavedCircleEmail(email)
        setShowConnectModal(false)
        setOtpVerifying(false)
        await afterConnect(data.address, "circle")
        return
      }

      // First-time user — needs PIN setup via Circle iframe (UCW security requirement)
      if (data.needsPinSetup && data.challengeId) {
        setPinPhase("pin")
        setConnectView("pin")
        await runPinSetup(email, data.challengeId, data.userToken, data.encryptionKey)
      }
    } catch (e: any) {
      setOtpError(e?.message || "Network error. Try again.")
      setOtpVerifying(false)
    }
  }

  async function runPinSetup(email: string, challengeId: string, userToken: string, encryptionKey: string) {
    const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID!
    try {
      const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk")
      const prev = (W3SSdk as any).instance
      if (prev) { try { prev.unSubscribeMessage() } catch {} }
      ;(W3SSdk as any).instance = null
      document.getElementById("sdkIframe")?.remove()

      const sdk = new W3SSdk()
      sdk.setAppSettings({ appId })
      sdk.setAuthentication({ userToken, encryptionKey })
      sdk.setThemeColor({
        backdrop:        "#04091a",
        backdropOpacity: 0.85,
        bg:              "#0a0e1a",
        divider:         "rgba(255,255,255,0.06)",
        textMain:        "#e8ecff",
        textAuxiliary:   "#6b7da8",
        textSummary:     "#4e6091",
        inputBg:         "#0e1224",
        dropdownBg:      "#0a0e1a",
        dropdownBorder:  "rgba(255,255,255,0.06)",
        primary:         "#1a56ff",
        primaryText:     "#ffffff",
        success:         "#00b87a",
        error:           "#e03348",
        iconColor:       "#1a56ff",
      } as any)
      sdkRef.current = sdk

      sdk.execute(challengeId, async (error: any) => {
        sdkRef.current = null
        if (error) {
          setOtpError(error.message || "PIN setup was cancelled or failed. Sign in again to retry.")
          setOtpVerifying(false)
          setOtpDigits(["", "", "", "", "", ""])
          setConnectView("email")
          return
        }

        // PIN created. Circle provisions the wallet asynchronously —
        // poll with backoff so we don't show a false "not ready" error.
        setPinPhase("finalizing")
        const delays = [600, 800, 1000, 1200, 1500, 1800, 2200, 2600]
        for (let i = 0; i < delays.length; i++) {
          try {
            const walletRes  = await fetch("/api/auth/circle/wallet", {
              method:  "POST",
              headers: { "Content-Type": "application/json" },
              body:    JSON.stringify({ email }),
            })
            const walletData = await walletRes.json()
            if (walletRes.ok && walletData.address) {
              localStorage.setItem("arclens-circle-email", email)
              setSavedCircleEmail(email)
              setShowConnectModal(false)
              setOtpVerifying(false)
              setPinPhase("pin")
              await afterConnect(walletData.address, "circle")
              return
            }
          } catch {
            // network blip — keep retrying
          }
          await new Promise(r => setTimeout(r, delays[i]))
        }

        setOtpError("Your wallet is still being created. Please sign in again in a moment.")
        setOtpVerifying(false)
        setOtpDigits(["", "", "", "", "", ""])
        setPinPhase("pin")
        setConnectView("email")
      })
    } catch (e: any) {
      setOtpError(e?.message || "PIN setup failed. Try again.")
      setOtpVerifying(false)
      setConnectView("otp")
    }
  }

  function cancelCircle() {
    if (sdkRef.current) {
      try { sdkRef.current.unSubscribeMessage() } catch {}
      sdkRef.current = null
    }
    document.getElementById("sdkIframe")?.remove()
    setEmailLoading(false)
    setOtpVerifying(false)
    setOtpDigits(["", "", "", "", "", ""])
    setOtpError("")
    setConnectView("email")
    setEmailError("")
  }

  async function resendOTP() {
    if (resendSecondsLeft > 0 || !emailInput) return
    const email = emailInput.toLowerCase().trim()
    setOtpError("")
    setOtpDigits(["", "", "", "", "", ""])
    try {
      const res = await fetch("/api/auth/otp/send", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) {
        setOtpError(data.error || "Failed to resend code")
        return
      }
      setOtpExpiresAt(Date.now() + 10 * 60 * 1000)
      setResendAvailableAt(Date.now() + 30 * 1000)
      setNow(Date.now())
      setResentToast(true)
      setTimeout(() => setResentToast(false), 2500)
      setTimeout(() => otpRefs.current[0]?.focus(), 50)
    } catch (e: any) {
      setOtpError(e?.message || "Network error. Try again.")
    }
  }

  function setOtpDigitAt(idx: number, raw: string) {
    const digit = raw.replace(/\D/g, "").slice(-1)
    setOtpDigits(prev => {
      const next = [...prev]
      next[idx] = digit
      // Auto-advance focus
      if (digit && idx < 5) setTimeout(() => otpRefs.current[idx + 1]?.focus(), 0)
      // Auto-submit when complete
      if (next.every(d => d !== "")) {
        const code = next.join("")
        setTimeout(() => verifyOTP(code), 50)
      }
      return next
    })
    setOtpError("")
  }

  function handleOtpKeyDown(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !otpDigits[idx] && idx > 0) {
      otpRefs.current[idx - 1]?.focus()
    } else if (e.key === "ArrowLeft" && idx > 0) {
      otpRefs.current[idx - 1]?.focus()
    } else if (e.key === "ArrowRight" && idx < 5) {
      otpRefs.current[idx + 1]?.focus()
    }
  }

  function handleOtpPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6)
    if (pasted.length === 0) return
    e.preventDefault()
    const next = ["", "", "", "", "", ""]
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i]
    setOtpDigits(next)
    otpRefs.current[Math.min(pasted.length, 5)]?.focus()
    if (pasted.length === 6) setTimeout(() => verifyOTP(pasted), 50)
  }

  function disconnectWallet() {
    clearWallet()
    setWalletType(null)
    localStorage.removeItem("arclens-wallet")
    localStorage.removeItem("arclens-wallet-type")
    localStorage.removeItem("arclens-circle-email")
    // Best-effort: clear the server-side session cookie
    fetch("/api/auth/session", { method: "DELETE", credentials: "include" }).catch(() => {})
  }

  function copyAddress() {
    if (!walletAddr) return
    navigator.clipboard.writeText(walletAddr).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  useEffect(() => {
    if (!mounted) return
    async function fetchStats() {
      try {
        const [blockRes, gasRes] = await Promise.all([
          fetch("https://rpc.testnet.arc.network", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }) }),
          fetch("https://rpc.testnet.arc.network", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "eth_gasPrice", params: [], id: 2 }) }),
        ])
        const blockData = await blockRes.json()
        const gasData   = await gasRes.json()
        const num  = parseInt(blockData.result, 16)
        const gwei = parseInt(gasData.result, 16) / 1e9
        setBlockNum(num.toLocaleString())
        setGas("$" + (gwei * 46000 * 1e-9).toFixed(4))
        setConnected(true)
      } catch { setConnected(false) }
    }
    fetchStats()
    const t = setInterval(fetchStats, 30000)
    return () => clearInterval(t)
  }, [mounted])

  useEffect(() => {
    if (!mounted) return
    const d = lockDark || dark   // homepage locks dark regardless of the toggle
    document.documentElement.style.setProperty("--bg",    d ? "#060812" : "#f0f2f8")
    document.documentElement.style.setProperty("--surf",  d ? "#0a0e1a" : "#ffffff")
    document.documentElement.style.setProperty("--surf2", d ? "#0e1224" : "#f5f7fc")
    document.documentElement.style.setProperty("--t1",    d ? "#e8ecff" : "#0a0e1a")
    document.documentElement.style.setProperty("--t2",    d ? "#6b7da8" : "#4a5578")
    document.documentElement.style.setProperty("--t3",    d ? "#2e3a5c" : "#8899bb")
    document.documentElement.style.setProperty("--bdr",   d ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)")
  }, [dark, mounted, lockDark])

  // Close sidebar when clicking outside
  useEffect(() => {
    if (!sidebarOpen) return
    function handleClick(e: MouseEvent) {
      const sidebar = document.getElementById("arc-sidebar")
      const hamburger = document.getElementById("arc-hamburger")
      if (sidebar && !sidebar.contains(e.target as Node) && hamburger && !hamburger.contains(e.target as Node)) {
        setSidebarOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [sidebarOpen])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = searchQ.trim().replace(/\s/g, "")
    if (!q) return
    setSearchQ("")
    if (/^0x[0-9a-fA-F]{40}$/i.test(q)) { window.location.href = "/address/" + q; return }
    if (/^0x[0-9a-fA-F]{64}$/i.test(q)) { window.location.href = "/tx/" + q; return }
    if (/^\d+$/.test(q)) { window.location.href = "/blocks"; return }
    window.location.href = "/search?q=" + encodeURIComponent(q)
  }

  function addNetwork() {
    if (!(window as any).ethereum) { alert("No wallet detected"); return }
    ;(window as any).ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: "0x4cef52", chainName: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: ["https://rpc.testnet.arc.network"], blockExplorerUrls: ["https://arclenz.xyz"] }]
    })
  }

  if (!mounted) return <div style={{ minHeight: "100vh", background: "#060812" }} />

  const mono  = "'DM Mono', monospace"
  const sans  = "'Geist', system-ui, sans-serif"
  const bdr   = "var(--bdr, rgba(255,255,255,0.06))"
  const surf  = "var(--surf, #0a0e1a)"
  const t1    = "var(--t1, #e8ecff)"
  const t2    = "var(--t2, #6b7da8)"
  const t3    = "var(--t3, #2e3a5c)"
  const arc   = "#1a56ff"
  const usdc  = "#00b87a"

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg, #060812)", color: t1, fontFamily: sans, fontSize: "14px" }}>

      {/* OVERLAY — shown when sidebar is open */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 39, backdropFilter: "blur(2px)" }}
        />
      )}

      {/* SIDEBAR — slides in from left, hidden by default */}
      <aside
        id="arc-sidebar"
        style={{
          width: "220px",
          flexShrink: 0,
          background: surf,
          borderRight: "1px solid " + bdr,
          display: "flex",
          flexDirection: "column",
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          zIndex: 40,
          transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
          boxShadow: sidebarOpen ? "4px 0 24px rgba(0,0,0,0.4)" : "none",
        }}
      >
        {/* LOGO + CLOSE */}
        <div style={{ padding: "16px 16px 14px", borderBottom: "1px solid " + bdr, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <a href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "8px" }} onClick={() => setSidebarOpen(false)}>
            <svg width="30" height="30" viewBox="0 0 64 64" fill="none" style={{ flexShrink: 0 }}>
              <defs>
                <linearGradient id="archG" x1="32" y1="6" x2="32" y2="52" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#ffffff"/>
                  <stop offset="35%" stopColor="#a0beff"/>
                  <stop offset="100%" stopColor="#1845cc"/>
                </linearGradient>
                <linearGradient id="bgG" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#101c3d"/>
                  <stop offset="100%" stopColor="#060c20"/>
                </linearGradient>
                <linearGradient id="scanG" x1="0" y1="0" x2="1" y2="0" gradientUnits="objectBoundingBox">
                  <stop offset="0%" stopColor="#00d990" stopOpacity="0"/>
                  <stop offset="50%" stopColor="#00d990"/>
                  <stop offset="100%" stopColor="#00d990" stopOpacity="0"/>
                </linearGradient>
              </defs>
              <rect width="64" height="64" rx="15" fill="url(#bgG)"/>
              <path d="M10 54 C10 54 10 24 32 9 C54 24 54 54 54 54" stroke="url(#archG)" strokeWidth="6" strokeLinecap="round" fill="none"/>
              <path d="M20 54 C20 54 20 32 32 21 C44 32 44 54 44 54" stroke="url(#archG)" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.35"/>
              <line x1="16" y1="38" x2="48" y2="38" stroke="url(#scanG)" strokeWidth="1.5"/>
              <circle cx="32" cy="38" r="2.5" fill="#00d990" opacity="0.9"/>
            </svg>
            <div>
              <span style={{ fontSize: "15px", fontWeight: 700, letterSpacing: "-0.03em", color: t1 }}>Arc</span>
              <span style={{ fontSize: "15px", fontWeight: 700, letterSpacing: "-0.03em", color: arc }}>Lens</span>
            </div>
          </a>
          {/* Close X button */}
          <button
            onClick={() => setSidebarOpen(false)}
            style={{ background: "none", border: "none", color: t2, cursor: "pointer", fontSize: "20px", lineHeight: 1, padding: "2px 6px", borderRadius: "4px" }}
          >
            ×
          </button>
        </div>

        {/* NETWORK BADGE */}
        <div style={{ padding: "10px 14px", borderBottom: "1px solid " + bdr }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "5px 8px", background: connected ? "rgba(0,184,122,0.06)" : "rgba(26,86,255,0.06)", borderRadius: "6px", border: "1px solid " + (connected ? "rgba(0,184,122,0.15)" : "rgba(26,86,255,0.12)") }}>
            <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: connected ? usdc : t3, animation: connected ? "pulse 2s infinite" : "none", flexShrink: 0 }} />
            <span style={{ fontSize: "10px", fontFamily: mono, color: connected ? usdc : t3, letterSpacing: "0.04em" }}>Arc Testnet · 2588</span>
          </div>
        </div>

        {/* NAV */}
        <nav style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {NAV.map((group: any) => (
            <div key={group.section || group.items[0]?.id} style={{ marginBottom: "4px" }}>
              {group.section && (
                <div style={{ padding: "10px 16px 4px", fontSize: "9px", fontFamily: mono, color: t3, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                  {group.section}
                </div>
              )}
              {group.items.map((item: any) => {
                const isActive = active === item.id
                return (
                  <a key={item.id} href={item.href}
                    onClick={() => setSidebarOpen(false)}
                    style={{ display: "flex", alignItems: "center", gap: "9px", padding: "8px 16px", margin: "1px 6px", borderRadius: "7px", textDecoration: "none", background: isActive ? "rgba(26,86,255,0.1)" : "transparent", color: isActive ? "#8aaeff" : t2, fontSize: "13px", fontWeight: isActive ? 500 : 400, transition: "all .12s", borderLeft: isActive ? "2px solid " + arc : "2px solid transparent" }}
                    onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.color = t1 } }}
                    onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = t2 } }}
                  >
                    <span style={{ fontSize: "12px", opacity: .7, fontFamily: mono, flexShrink: 0 }}>{item.icon}</span>
                    <span style={{ flex: 1 }}>{item.label}</span>
                    {item.tag && (
                      <span style={{ fontSize: "8px", fontFamily: mono, padding: "2px 5px", borderRadius: "3px", ...TAG_STYLE[item.tag] }}>
                        {item.tag}
                      </span>
                    )}
                  </a>
                )
              })}
            </div>
          ))}
          {/* MY PROJECT — dynamic, only when wallet owns a project */}
          {myProject && (
            <div style={{ marginBottom: "4px" }}>
              <div style={{ padding: "10px 16px 4px", fontSize: "9px", fontFamily: mono, color: t3, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                MY DASHBOARD
              </div>
              <a href={`/dashboard/${myProject.slug}`}
                onClick={() => setSidebarOpen(false)}
                style={{ display: "flex", alignItems: "center", gap: "9px", padding: "8px 16px", margin: "1px 6px", borderRadius: "7px", textDecoration: "none", background: "rgba(0,184,122,0.08)", color: "#00b87a", fontSize: "13px", fontWeight: 500, borderLeft: "2px solid #00b87a" }}>
                <span style={{ fontSize: "12px", opacity: .7, fontFamily: mono, flexShrink: 0 }}>◆</span>
                <span style={{ flex: 1 }}>{myProject.name}</span>
              </a>
            </div>
          )}
        </nav>

        {/* WALLET */}
        <div style={{ padding: "10px 12px", borderTop: "1px solid " + bdr }}>
          {walletAddr ? (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
                <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: usdc, flexShrink: 0 }}/>
                <div style={{ fontSize: "9.5px", fontFamily: mono, color: usdc }}>Connected</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                <div onClick={() => { window.location.href = "/address/" + walletAddr; setSidebarOpen(false) }}
                  style={{ fontSize: "10.5px", fontFamily: mono, color: "#8aaeff", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                  {walletAddr.slice(0,8)}...{walletAddr.slice(-6)}
                </div>
                <button onClick={copyAddress} title={copied ? "Copied!" : "Copy address"}
                  style={{ flexShrink: 0, background: "none", border: "none", color: copied ? usdc : t3, cursor: "pointer", padding: "2px", display: "flex", alignItems: "center", transition: "color .15s", fontSize: "11px" }}>
                  {copied ? "✓" : (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                  )}
                </button>
              </div>
              {walletBal && <div style={{ fontSize: "13px", fontWeight: 700, color: usdc, letterSpacing: "-0.02em", marginBottom: "6px" }}>{walletBal} USDC</div>}
              <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
                <button onClick={() => { setWalletPanelOpen(true); setSidebarOpen(false) }}
                  style={{ flex: 1, height: "26px", background: "rgba(0,184,122,0.08)", color: usdc, fontSize: "10px", fontFamily: mono, border: "1px solid rgba(0,184,122,0.2)", borderRadius: "5px", cursor: "pointer" }}>
                  My Wallet
                </button>
                <button onClick={disconnectWallet}
                  style={{ height: "26px", padding: "0 8px", background: "transparent", color: t3, fontSize: "10px", fontFamily: mono, border: "1px solid " + bdr, borderRadius: "5px", cursor: "pointer" }}>
                  ✕
                </button>
              </div>
              {/* BUILDER PROFILE MINI CARD */}
              <div
                onClick={() => { window.location.href = "/builder/" + walletAddr; setSidebarOpen(false) }}
                style={{ cursor: "pointer", padding: "8px 10px", background: builderProfile?.claimed ? "rgba(0,184,122,0.05)" : "rgba(26,86,255,0.05)", border: "1px solid " + (builderProfile?.claimed ? "rgba(0,184,122,0.15)" : "rgba(26,86,255,0.12)"), borderRadius: "8px", display: "flex", alignItems: "center", gap: "8px", transition: "border-color .12s" }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = builderProfile?.claimed ? "rgba(0,184,122,0.35)" : "rgba(26,86,255,0.3)")}
                onMouseLeave={e => (e.currentTarget.style.borderColor = builderProfile?.claimed ? "rgba(0,184,122,0.15)" : "rgba(26,86,255,0.12)")}
              >
                <img
                  src={builderProfile?.avatar_url || `https://api.dicebear.com/9.x/identicon/svg?seed=${walletAddr}&backgroundColor=0e1224&radius=50`}
                  onError={e => { (e.target as HTMLImageElement).src = `https://api.dicebear.com/9.x/identicon/svg?seed=${walletAddr}&backgroundColor=0e1224&radius=50` }}
                  alt="avatar"
                  style={{ width: "26px", height: "26px", borderRadius: "50%", border: "1px solid " + bdr, background: "var(--surf2,#0e1224)", flexShrink: 0 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: builderProfile?.claimed ? usdc : "#8aaeff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {builderProfile?.claimed ? (builderProfile.display_name || "Builder Profile") : "Claim Builder Profile"}
                  </div>
                  <div style={{ fontSize: "9px", fontFamily: mono, color: t3 }}>
                    {builderProfile?.claimed ? "◎ Verified" : "Set up your identity →"}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <button onClick={connect}
              style={{ width: "100%", height: "34px", background: "rgba(26,86,255,0.08)", color: "#8aaeff", fontSize: "11px", fontFamily: mono, border: "1px solid rgba(26,86,255,0.2)", borderRadius: "8px", cursor: "pointer" }}>
              Connect Wallet
            </button>
          )}
        </div>

        {/* FOOTER */}
        <div style={{ padding: "10px 12px", borderTop: "1px solid " + bdr }}>
          <div style={{ fontSize: "9px", fontFamily: mono, color: t3, lineHeight: 1.8 }}>
            <div>Chain ID <span style={{ color: t2 }}>2588</span></div>
            <div>Gas token <span style={{ color: usdc }}>USDC</span></div>
            <div>Base fee <span style={{ color: t2 }}>160 Gwei ≈ $0.01</span></div>
            <div>Finality <span style={{ color: "#8aaeff" }}>{"< 1 second"}</span></div>
          </div>
        </div>
      </aside>

      {/* MAIN — always full width since sidebar is overlaid.
          overflowX: "clip" (instead of overflow:hidden) prevents horizontal
          scrollbars from leaking content but does NOT establish a containing
          block, so descendants using position:sticky still work as expected. */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: "100vh", width: "100%", maxWidth: "100vw", overflowX: "clip" }}>

        {/* TOPBAR */}
        <header style={{ height: "52px", background: surf, borderBottom: "1px solid " + bdr, display: "flex", alignItems: "center", padding: "0 16px", gap: "10px", position: "sticky", top: 0, zIndex: 30, backdropFilter: "blur(8px)" }}>

          {/* HAMBURGER — always visible */}
          <button
            id="arc-hamburger"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{ background: "none", border: "1px solid " + bdr, color: t2, cursor: "pointer", padding: "5px 8px", fontSize: "16px", lineHeight: 1, flexShrink: 0, borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", transition: "all .12s" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(26,86,255,0.4)"; e.currentTarget.style.color = t1 }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = bdr; e.currentTarget.style.color = t2 }}
          >
            {sidebarOpen ? "×" : "☰"}
          </button>

          {/* LOGO in topbar */}
          <a href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
            <span style={{ fontSize: "15px", fontWeight: 700, letterSpacing: "-0.03em", color: t1 }}>Arc</span>
            <span style={{ fontSize: "15px", fontWeight: 700, letterSpacing: "-0.03em", color: arc }}>Lens</span>
          </a>

          {/* LIVE DOT — hidden on mobile to make room for the full wallet control */}
          <div className="hide-sm" style={{ display: "flex", alignItems: "center", gap: "5px", flexShrink: 0 }}>
            <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: connected ? usdc : t3, animation: connected ? "pulse 2s infinite" : "none" }} />
            <span style={{ fontSize: "10px", fontFamily: mono, color: connected ? usdc : t3 }}>Live</span>
          </div>

          {/* SEARCH — hidden on mobile; Lens AI covers tx/address lookups there */}
          <form onSubmit={handleSearch} className="hide-sm" style={{ flex: 1, maxWidth: "560px" }}>
            <div style={{ position: "relative" }}>
              <input
                ref={searchRef}
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                placeholder="Search addresses, tx, blocks…"
                style={{ width: "100%", height: "34px", background: "var(--surf2, #0e1224)", border: "1px solid " + bdr, borderRadius: "8px", padding: "0 12px 0 34px", fontSize: "12px", fontFamily: mono, color: t1, outline: "none", transition: "border-color .12s" }}
                onFocus={e => (e.currentTarget.style.borderColor = "rgba(26,86,255,0.4)")}
                onBlur={e => (e.currentTarget.style.borderColor = bdr)}
              />
              <svg style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", opacity: .35 }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={t1} strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
            </div>
          </form>

          <div style={{ flex: 1 }} />

          {/* BLOCK + GAS — hide on very small screens */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
            <div className="hide-sm" style={{ fontSize: "11px", fontFamily: mono, color: t3 }}>
              Block <span style={{ color: "#8aaeff", fontWeight: 500 }}>#{blockNum || "..."}</span>
            </div>
            <div className="hide-sm" style={{ fontSize: "11px", fontFamily: mono, color: t3 }}>
              Gas <span style={{ color: usdc, fontWeight: 500 }}>{gas || "..."}</span>
            </div>
          </div>

          {/* ADD NETWORK */}
          <button onClick={addNetwork}
            className="hide-sm"
            style={{ height: "30px", padding: "0 12px", background: "transparent", color: t2, fontSize: "11px", fontFamily: mono, border: "1px solid " + bdr, borderRadius: "6px", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0, transition: "all .12s" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(26,86,255,0.4)"; e.currentTarget.style.color = "#8aaeff" }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = bdr; e.currentTarget.style.color = t2 }}>
            + Add Arc
          </button>

          {/* WALLET — compact topbar button */}
          {connected && walletAddr ? (
            <div style={{ display: "flex", alignItems: "center", gap: "2px", flexShrink: 0 }}>
              <button onClick={() => setWalletPanelOpen(true)} title="Wallet · balances & send"
                style={{ height: "30px", padding: "0 10px", background: "rgba(0,184,122,0.08)", color: usdc, fontSize: "11px", fontFamily: mono, border: "1px solid rgba(0,184,122,0.2)", borderRadius: "6px 0 0 6px", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px" }}>
                <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: usdc, flexShrink: 0 }} />
                {walletAddr.slice(0,6)}...{walletAddr.slice(-4)}
              </button>
              <button onClick={copyAddress} title={copied ? "Copied!" : "Copy address"}
                className="hide-sm"
                style={{ height: "30px", padding: "0 7px", background: "rgba(0,184,122,0.08)", color: copied ? usdc : t3, fontSize: "11px", border: "1px solid rgba(0,184,122,0.2)", borderLeft: "none", cursor: "pointer", display: "flex", alignItems: "center", transition: "color .15s" }}>
                {copied ? "✓" : (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                )}
              </button>
              <button onClick={disconnectWallet}
                style={{ height: "30px", padding: "0 8px", background: "rgba(0,184,122,0.08)", color: t3, fontSize: "13px", fontFamily: mono, border: "1px solid rgba(0,184,122,0.2)", borderLeft: "none", borderRadius: "0 6px 6px 0", cursor: "pointer" }}>
                ×
              </button>
            </div>
          ) : (
            <button onClick={connect}
              style={{ height: "30px", padding: "0 10px", background: "rgba(26,86,255,0.08)", color: "#8aaeff", fontSize: "11px", fontFamily: mono, border: "1px solid rgba(26,86,255,0.2)", borderRadius: "6px", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0, display: "flex", alignItems: "center", gap: "5px" }}>
              <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#8aaeff", flexShrink: 0 }} />
              Connect
            </button>
          )}

          {/* THEME — hidden on lock-dark pages (e.g. the homepage) */}
          {!lockDark && (
            <button onClick={() => { const next = !dark; setDark(next); localStorage.setItem("arclens-theme", next ? "dark" : "light") }}
              style={{ width: "30px", height: "30px", background: "transparent", border: "1px solid " + bdr, borderRadius: "6px", cursor: "pointer", color: t2, fontSize: "14px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {dark ? "☀" : "☾"}
            </button>
          )}
        </header>

        {/* PAGE CONTENT — always full width */}
        <main style={{ flex: 1, width: "100%" }}>
          {children}
        </main>

        {/* FOOTER */}
        <footer style={{ borderTop: "1px solid " + bdr }}>
          <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "18px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
            {/* Social marks live on the LEFT, beside the copyright. The Ask Lens
                launcher is fixed to the bottom-right corner and was covering
                them there — GitHub and X included, long before Telegram joined. */}
            <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
              <span style={{ fontSize: "11px", fontFamily: mono, color: t3 }}>© 2026 ArcLens</span>
              <a href="https://github.com/arclens-app/arclens" target="_blank" rel="noopener noreferrer" aria-label="ArcLens on GitHub"
                style={{ color: t3, textDecoration: "none", display: "flex", alignItems: "center", transition: "color .12s" }}
                onMouseEnter={e => e.currentTarget.style.color = t2}
                onMouseLeave={e => e.currentTarget.style.color = t3}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
                </svg>
              </a>
              <a href="https://x.com/arclens_app" target="_blank" rel="noopener noreferrer" aria-label="ArcLens on X"
                style={{ color: t3, textDecoration: "none", display: "flex", alignItems: "center", transition: "color .12s" }}
                onMouseEnter={e => e.currentTarget.style.color = t2}
                onMouseLeave={e => e.currentTarget.style.color = t3}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.254 5.622 5.91-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
              </a>
              <a href="https://t.me/arclenschat" target="_blank" rel="noopener noreferrer" aria-label="ArcLens on Telegram"
                style={{ color: t3, textDecoration: "none", display: "flex", alignItems: "center", transition: "color .12s" }}
                onMouseEnter={e => e.currentTarget.style.color = t2}
                onMouseLeave={e => e.currentTarget.style.color = t3}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                </svg>
              </a>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "24px", flexWrap: "wrap", paddingRight: "160px" }}>
              {[
                { label: "About",   href: "/about" },
                { label: "Docs",    href: "https://docs.arclenz.xyz" },
                { label: "Terms",   href: "/terms" },
                { label: "Privacy", href: "/privacy" },
                { label: "support@arclenz.xyz", href: "mailto:support@arclenz.xyz" },
              ].map(l => (
                <a key={l.label} href={l.href}
                  style={{ fontSize: "11px", fontFamily: mono, color: t3, textDecoration: "none", transition: "color .12s" }}
                  onMouseEnter={e => e.currentTarget.style.color = t2}
                  onMouseLeave={e => e.currentTarget.style.color = t3}>
                  {l.label}
                </a>
              ))}
            </div>
          </div>
          {/* Independence notice — states plainly that ArcLens is a third party.
              Without it the "Hub for Arc" framing plus wallet flows reads as
              brand impersonation to abuse classifiers and human reviewers. The
              seed-phrase warning lives on the connect modal instead, where it
              is read at the moment of risk rather than buried down here. */}
          <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 28px 20px", fontSize: "10px", fontFamily: mono, color: t3, lineHeight: 1.7, opacity: 0.7 }}>
            ArcLens is an independent platform. Not affiliated with, endorsed by, or sponsored by Circle Internet Group or the Arc network.
          </div>
        </footer>

      </div>

      {/* CONNECT MODAL */}
      {showConnectModal && (
        <div
          onClick={() => { if (connectView === "pin") { cancelCircle() } else if (!emailLoading && !otpVerifying) { setShowConnectModal(false) } }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: "100%", maxWidth: "360px", margin: "0 16px", background: "var(--surf, #0a0e1a)", border: "1px solid var(--bdr, rgba(255,255,255,0.06))", borderRadius: "14px", padding: "28px", boxShadow: "0 24px 64px rgba(0,0,0,0.6)" }}>

            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
              <div>
                <div style={{ fontSize: "9px", fontFamily: mono, color: t3, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: "4px" }}>
                  {connectView === "choose" ? "Connect" : connectView === "wallets" ? "Browser Wallets" : connectView === "email" ? "Email Wallet" : connectView === "otp" ? "Verify Email" : "Secure Setup"}
                </div>
                <div style={{ fontSize: "16px", fontWeight: 700, letterSpacing: "-0.03em", color: t1 }}>
                  {connectView === "choose" ? "Connect to ArcLens" : connectView === "wallets" ? "Choose a wallet" : connectView === "email" ? "Enter your email" : connectView === "otp" ? "Enter your code" : "Set your PIN"}
                </div>
              </div>
              <button
                onClick={() => { if (connectView === "pin") cancelCircle(); else if (!emailLoading && !otpVerifying) setShowConnectModal(false) }}
                style={{ background: "none", border: "none", color: t3, cursor: "pointer", fontSize: "20px", lineHeight: 1, padding: "4px" }}>×</button>
            </div>

            {/* Choose view */}
            {connectView === "choose" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <button onClick={openBrowserWallets}
                  style={{ width: "100%", height: "48px", background: "rgba(255,255,255,0.03)", border: "1px solid var(--bdr)", borderRadius: "9px", color: t1, fontSize: "13px", fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: "10px", padding: "0 16px", transition: "border-color .12s, background .12s" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; e.currentTarget.style.background = "rgba(255,255,255,0.05)" }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--bdr)"; e.currentTarget.style.background = "rgba(255,255,255,0.03)" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <rect x="2" y="5" width="20" height="14" rx="2"/><path d="M16 12h.01"/>
                  </svg>
                  Browser Wallet
                  <span style={{ marginLeft: "auto", fontSize: "9px", fontFamily: mono, color: t3 }}>Rabby, MetaMask…</span>
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div style={{ flex: 1, height: "1px", background: "var(--bdr)" }} />
                  <span style={{ fontSize: "10px", fontFamily: mono, color: t3 }}>or</span>
                  <div style={{ flex: 1, height: "1px", background: "var(--bdr)" }} />
                </div>
                <button onClick={() => setConnectView("email")}
                  style={{ width: "100%", height: "48px", background: "rgba(26,86,255,0.06)", border: "1px solid rgba(26,86,255,0.2)", borderRadius: "9px", color: "#8aaeff", fontSize: "13px", fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: "10px", padding: "0 16px", transition: "border-color .12s, background .12s" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(26,86,255,0.4)"; e.currentTarget.style.background = "rgba(26,86,255,0.1)" }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(26,86,255,0.2)"; e.currentTarget.style.background = "rgba(26,86,255,0.06)" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 7 10-7"/>
                  </svg>
                  Continue with Email
                  <span style={{ marginLeft: "auto", fontSize: "9px", fontFamily: mono, padding: "2px 7px", borderRadius: "4px", background: "rgba(26,86,255,0.15)", color: "#8aaeff", border: "1px solid rgba(26,86,255,0.2)" }}>Circle</span>
                </button>
                {/* Shown at the moment of risk — one click from a wallet prompt. */}
                <div style={{ marginTop: "6px", paddingTop: "14px", borderTop: "1px solid var(--bdr)", fontSize: "10px", fontFamily: mono, color: t3, lineHeight: 1.7 }}>
                  By connecting, you agree to our{" "}
                  <a href="/terms" style={{ color: t2, textDecoration: "underline", textUnderlineOffset: "2px" }}>Terms</a>
                  {" "}and{" "}
                  <a href="/privacy" style={{ color: t2, textDecoration: "underline", textUnderlineOffset: "2px" }}>Privacy Policy</a>.
                  <div style={{ marginTop: "8px" }}>
                    ArcLens never asks for your seed phrase, private key, or wallet password, and never requests a token approval or transfer.
                  </div>
                </div>
              </div>
            )}

            {/* Wallets view — EIP-6963 detected wallets */}
            {connectView === "wallets" && (
              <div>
                {walletLoading ? (
                  <div style={{ textAlign: "center", padding: "24px 0", color: t3, fontSize: "12px", fontFamily: mono }}>
                    Detecting wallets…
                  </div>
                ) : detectedWallets.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "24px 0" }}>
                    <div style={{ fontSize: "12px", color: t2, marginBottom: "14px", lineHeight: 1.6 }}>
                      No browser wallets detected.<br />Install Rabby or MetaMask to continue.
                    </div>
                    <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
                      <a href="https://rabby.io" target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: "11px", fontFamily: mono, color: "#8aaeff", textDecoration: "none", padding: "6px 12px", border: "1px solid rgba(26,86,255,0.25)", borderRadius: "6px" }}>
                        Get Rabby
                      </a>
                      <a href="https://metamask.io/download" target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: "11px", fontFamily: mono, color: t2, textDecoration: "none", padding: "6px 12px", border: "1px solid var(--bdr)", borderRadius: "6px" }}>
                        Get MetaMask
                      </a>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {detectedWallets.map(w => (
                      <button key={w.info.uuid} onClick={() => connectEIP6963(w)}
                        style={{ width: "100%", height: "52px", background: "rgba(255,255,255,0.03)", border: "1px solid var(--bdr)", borderRadius: "9px", color: t1, fontSize: "13px", fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: "12px", padding: "0 16px", transition: "border-color .12s, background .12s" }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)"; e.currentTarget.style.background = "rgba(255,255,255,0.06)" }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--bdr)"; e.currentTarget.style.background = "rgba(255,255,255,0.03)" }}>
                        {w.info.icon ? (
                          <img src={w.info.icon} alt={w.info.name} width={28} height={28} style={{ borderRadius: "6px", flexShrink: 0, objectFit: "contain" }} />
                        ) : (
                          <div style={{ width: 28, height: 28, borderRadius: "6px", background: "rgba(255,255,255,0.06)", flexShrink: 0 }} />
                        )}
                        <span style={{ flex: 1, textAlign: "left" }}>{w.info.name}</span>
                        {w.info.rdns === "io.rabby" && (
                          <span style={{ fontSize: "8px", fontFamily: mono, padding: "2px 6px", borderRadius: "4px", background: "rgba(0,184,122,0.12)", color: "#00b87a", border: "1px solid rgba(0,184,122,0.2)" }}>
                            Recommended
                          </span>
                        )}
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={t3} strokeWidth="2" strokeLinecap="round">
                          <path d="M9 18l6-6-6-6"/>
                        </svg>
                      </button>
                    ))}
                  </div>
                )}
                <button onClick={() => setConnectView("choose")}
                  style={{ marginTop: "14px", height: "34px", padding: "0 14px", background: "transparent", border: "1px solid var(--bdr)", borderRadius: "7px", color: t3, fontSize: "12px", cursor: "pointer" }}>
                  ← Back
                </button>
              </div>
            )}


            {/* Email input view */}
            {connectView === "email" && (
              <div>
                <div style={{ fontSize: "11px", color: t2, marginBottom: "12px", lineHeight: 1.6 }}>
                  {isSignInFlow
                    ? "Welcome back. We'll send a fresh code to your inbox."
                    : "Enter your email and we'll send you a verification code to access your wallet."}
                </div>
                <input
                  type="email"
                  value={emailInput}
                  onChange={e => onEmailChange(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && connectCircle()}
                  placeholder="you@example.com"
                  autoFocus
                  style={{ width: "100%", height: "40px", background: "var(--surf2, #0e1224)", border: "1px solid var(--bdr)", borderRadius: "8px", padding: "0 12px", fontSize: "13px", fontFamily: mono, color: t1, outline: "none", marginBottom: "10px" }}
                />
                {emailError && <div style={{ fontSize: "11px", color: "#e03348", marginBottom: "10px" }}>{emailError}</div>}
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={() => { setIsSignInFlow(false); setConnectView("choose") }}
                    style={{ height: "38px", padding: "0 14px", background: "transparent", border: "1px solid var(--bdr)", borderRadius: "8px", color: t3, fontSize: "12px", cursor: "pointer" }}>
                    Back
                  </button>
                  <button onClick={connectCircle} disabled={emailLoading}
                    style={{ flex: 1, height: "38px", background: arc, border: "none", borderRadius: "8px", color: "#fff", fontSize: "13px", fontWeight: 600, cursor: emailLoading ? "not-allowed" : "pointer", opacity: emailLoading ? 0.6 : 1 }}>
                    {emailLoading ? "Sending code…" : isSignInFlow ? "Send sign-in code →" : "Continue →"}
                  </button>
                </div>
              </div>
            )}

            {/* Custom OTP input view */}
            {connectView === "otp" && (
              <div>
                <div style={{ fontSize: "12px", color: t2, lineHeight: 1.6, marginBottom: "8px" }}>
                  We sent a 6-digit code to <span style={{ color: t1, fontWeight: 600 }}>{emailInput}</span>
                </div>
                {/* On screen, not in the email — if it was filtered, nothing we
                    write inside the email will ever be read. */}
                <div style={{ fontSize: "11.5px", color: t3, lineHeight: 1.6, marginBottom: "20px" }}>
                  Not in your inbox after a minute? Check your spam or promotions folder.
                </div>

                <div style={{ display: "flex", gap: "8px", justifyContent: "space-between", marginBottom: "14px" }}>
                  {otpDigits.map((digit, idx) => (
                    <input
                      key={idx}
                      ref={el => { otpRefs.current[idx] = el }}
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={1}
                      value={digit}
                      disabled={otpVerifying}
                      onChange={e => setOtpDigitAt(idx, e.target.value)}
                      onKeyDown={e => handleOtpKeyDown(idx, e)}
                      onPaste={handleOtpPaste}
                      style={{
                        width: "44px",
                        height: "52px",
                        textAlign: "center",
                        fontSize: "22px",
                        fontWeight: 700,
                        fontFamily: mono,
                        color: t1,
                        background: "var(--surf2, #0e1224)",
                        border: `1.5px solid ${otpError ? "rgba(224,51,72,0.6)" : digit ? "rgba(26,86,255,0.5)" : "var(--bdr)"}`,
                        borderRadius: "9px",
                        outline: "none",
                        transition: "border-color .12s, background .12s",
                        caretColor: "#1a56ff",
                        opacity: otpVerifying ? 0.6 : 1,
                      }}
                    />
                  ))}
                </div>

                {otpError && (
                  <div style={{ fontSize: "11px", color: "#e03348", marginBottom: "12px", lineHeight: 1.6 }}>{otpError}</div>
                )}

                {otpVerifying && (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px", fontSize: "11px", color: t3, fontFamily: mono }}>
                    <div style={{ width: "12px", height: "12px", borderRadius: "50%", border: "1.5px solid rgba(26,86,255,0.2)", borderTopColor: "#1a56ff", animation: "circleSpinAnim 0.7s linear infinite" }} />
                    Verifying…
                  </div>
                )}

                {resentToast && (
                  <div style={{ fontSize: "11px", color: "#00b87a", fontFamily: mono, marginBottom: "12px" }}>
                    ✓ A fresh code has been sent
                  </div>
                )}

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "14px", paddingTop: "14px", borderTop: "1px solid var(--bdr)" }}>
                  <div style={{ fontSize: "10px", color: t3, fontFamily: mono }}>
                    {codeSecondsLeft > 0
                      ? `Expires in ${Math.floor(codeSecondsLeft / 60)}:${String(codeSecondsLeft % 60).padStart(2, "0")}`
                      : "Code expired"}
                  </div>
                  <button onClick={resendOTP} disabled={resendSecondsLeft > 0 || otpVerifying}
                    style={{
                      height: "30px",
                      padding: "0 12px",
                      background: "transparent",
                      border: `1px solid ${resendSecondsLeft > 0 ? "var(--bdr)" : "rgba(26,86,255,0.35)"}`,
                      borderRadius: "7px",
                      color: resendSecondsLeft > 0 ? t3 : "#8aaeff",
                      fontSize: "11px",
                      fontFamily: mono,
                      cursor: resendSecondsLeft > 0 || otpVerifying ? "not-allowed" : "pointer",
                      opacity: resendSecondsLeft > 0 || otpVerifying ? 0.55 : 1,
                      transition: "border-color .12s, color .12s",
                    }}>
                    {resendSecondsLeft > 0 ? `Resend in ${resendSecondsLeft}s` : "Resend code"}
                  </button>
                </div>

                <button onClick={() => { setConnectView("email"); setOtpError(""); setOtpDigits(["","","","","",""]) }}
                  style={{ width: "100%", marginTop: "12px", height: "34px", padding: "0 14px", background: "transparent", border: "1px solid var(--bdr)", borderRadius: "7px", color: t3, fontSize: "11px", fontFamily: mono, cursor: "pointer" }}>
                  ← Use a different email
                </button>
              </div>
            )}

            {/* PIN setup view — first-time users only, Circle iframe takes over */}
            {connectView === "pin" && (
              <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
                {otpError ? (
                  <>
                    <div style={{ fontSize: "11px", color: "#e03348", marginBottom: "14px", lineHeight: 1.6 }}>{otpError}</div>
                    <button onClick={() => { setConnectView("email"); setOtpError(""); setOtpDigits(["","","","","",""]) }}
                      style={{ height: "36px", padding: "0 20px", background: "transparent", border: "1px solid var(--bdr)", borderRadius: "8px", color: t2, fontSize: "12px", cursor: "pointer" }}>
                      Start over
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "18px" }}>
                      <div style={{ width: "36px", height: "36px", borderRadius: "50%", border: "2px solid rgba(26,86,255,0.15)", borderTopColor: "#1a56ff", animation: "circleSpinAnim 0.8s linear infinite" }} />
                    </div>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: t1, marginBottom: "6px" }}>
                      {pinPhase === "finalizing" ? "Finalizing your wallet" : "Set up your wallet"}
                    </div>
                    <div style={{ fontSize: "12px", color: t3, lineHeight: 1.6, fontFamily: mono }}>
                      {pinPhase === "finalizing"
                        ? <>Almost there. This usually takes<br />a few seconds.</>
                        : <>A secure window is opening so you can create your<br />PIN. You'll only need to do this once.</>}
                    </div>
                    {pinPhase === "pin" && (
                      <button onClick={cancelCircle}
                        style={{ marginTop: "20px", height: "32px", padding: "0 18px", background: "transparent", border: "1px solid var(--bdr)", borderRadius: "7px", color: t3, fontSize: "11px", cursor: "pointer", fontFamily: mono }}>
                        Cancel
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes shimmer { 0%,100%{opacity:1} 50%{opacity:.35} }
        @keyframes circleSpinAnim { to { transform: rotate(360deg) } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }
        a { color: inherit; }
        @media (max-width: 640px) {
          .hide-sm { display: none !important; }
        }
      `}</style>

      {/* Pervasive AI overlay — floating button + ⌘K + chat panel, on every page. */}
      <ArcLensAI />

      {/* Wallet funds panel — balances + send/receive, opened from the connected chip. */}
      {walletAddr && (
        <WalletPanel
          open={walletPanelOpen}
          onClose={() => setWalletPanelOpen(false)}
          walletAddr={walletAddr}
          walletType={walletType}
          email={typeof window !== "undefined" ? localStorage.getItem("arclens-circle-email") : null}
        />
      )}
    </div>
  )
}
