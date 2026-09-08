"use client"
import { useEffect, useState, useRef } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { circleSignMessage } from "@/lib/circleSign"

interface Project {
  name: string
  slug: string
  logo_url: string | null
  category: string
  tagline: string
  owner_wallet: string | null
}

function imgSrc(url: string | null) {
  if (!url) return null
  if (/\.blob\.vercel-storage\.com\//i.test(url)) return url
  return `/api/image-proxy?url=${encodeURIComponent(url)}`
}

function shortAddr(addr: string) {
  return addr.slice(0, 6) + "..." + addr.slice(-4)
}

export default function ActivatePage() {
  const { slug }     = useParams<{ slug: string }>()
  const searchParams = useSearchParams()
  const router       = useRouter()
  const token        = searchParams.get("token")

  const [project, setProject]         = useState<Project | null>(null)
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState("")
  const [step, setStep]               = useState<"connect"|"sign"|"linking"|"done">("connect")
  const [wallet, setWallet]           = useState<string | null>(null)
  const [actionError, setActionError] = useState("")
  const [imgErr, setImgErr]           = useState(false)
  const [mounted, setMounted]         = useState(false)
  const [emailInput, setEmailInput]   = useState("")
  const [otpCode, setOtpCode]         = useState("")
  const [circleStage, setCircleStage] = useState<"email" | "code">("email")
  const [circleLoading, setCircleLoading] = useState(false)
  const sdkRef = useRef<any>(null)

  const mono = "'DM Mono', monospace"
  const t1   = "#e8ecff"
  const t2   = "#6b7da8"
  const t3   = "#2e3a5c"
  const bdr  = "rgba(255,255,255,0.06)"
  const surf = "#080c1a"
  const blue = "#1a56ff"

  useEffect(() => {
    setMounted(true)
    // Pre-warm Circle SDK iframe so PIN modal opens instantly
    if (!process.env.NEXT_PUBLIC_CIRCLE_APP_ID) return
    const t = setTimeout(() => {
      if (document.getElementById("circleWarmupFrame")) return
      const frame = document.createElement("iframe")
      frame.src = `https://pw-auth.circle.com/?origin=${encodeURIComponent(window.location.origin)}`
      frame.style.cssText = "position:fixed;width:0;height:0;border:0;pointer-events:none;visibility:hidden;top:0;left:0"
      frame.id = "circleWarmupFrame"
      frame.onload = () => frame.remove()
      document.body.appendChild(frame)
    }, 3000)
    return () => { clearTimeout(t); document.getElementById("circleWarmupFrame")?.remove() }
  }, [])

  useEffect(() => {
    if (!mounted || !token) return
    async function load() {
      try {
        const res  = await fetch(`/api/claim?slug=${slug}&token=${token}`)
        const data = await res.json()
        if (!res.ok) { setError(data.error || "Invalid or expired link"); setLoading(false); return }
        if (data.project.owner_wallet) { router.replace(`/dashboard/${slug}`); return }
        setProject(data.project)

        // Local storage suggests an address; the signed cookie confirms it.
        const session = await fetch("/api/auth/session", { credentials: "include" }).then(r => r.json()).catch(() => null)
        const savedType = localStorage.getItem("arclens-wallet-type")
        const savedAddr = localStorage.getItem("arclens-wallet")
        if (savedType === "circle" && savedAddr) {
          if (session?.signedIn && session.address?.toLowerCase() === savedAddr.toLowerCase()) {
            setWallet(savedAddr)
            setStep("linking")
            await linkWallet(savedAddr.toLowerCase(), { type: "circle" })
            return
          }
          setEmailInput(localStorage.getItem("arclens-circle-email") || "")
          setStep("connect")
        } else {
          try {
            if ((window as any).ethereum) {
              const accounts = await (window as any).ethereum.request({ method: "eth_accounts" })
              if (accounts?.[0]) {
                const addr = String(accounts[0]).toLowerCase()
                setWallet(addr)
                if (session?.signedIn && session.address?.toLowerCase() === addr) {
                  setStep("linking")
                  await linkWallet(addr, { type: "wallet" })
                  return
                }
                setStep("sign")
              }
            }
          } catch { }
        }
      } catch { setError("Failed to verify link") }
      finally { setLoading(false) }
    }
    load()
  }, [mounted, slug, token])

  async function connectWallet() {
    setActionError("")
    try {
      if (!(window as any).ethereum) {
        setActionError("No browser wallet detected. Use MetaMask, Rabby, or connect with email below.")
        return
      }
      const accounts = await (window as any).ethereum.request({ method: "eth_requestAccounts" })
      const addr = accounts?.[0]
      if (!addr) { setActionError("No account selected."); return }
      setWallet(addr)
      setStep("sign")
    } catch (e: any) {
      if (e?.code === 4001) setActionError("Connection rejected. Try again.")
      else setActionError("Wallet connection failed. Try again.")
    }
  }

  async function connectWithCircle() {
    if (!emailInput.includes("@")) { setActionError("Enter a valid email address"); return }
    setActionError("")
    setCircleLoading(true)
    try {
      if (circleStage === "email") {
        const sendRes = await fetch("/api/auth/otp/send", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: emailInput }),
        })
        const sent = await sendRes.json()
        if (!sendRes.ok) { setActionError(sent.error || "Failed to send verification code"); setCircleLoading(false); return }
        setCircleStage("code")
        setCircleLoading(false)
        return
      }

      const code = otpCode.replace(/\D/g, "")
      if (!/^\d{6}$/.test(code)) { setActionError("Enter the 6-digit code from your email"); setCircleLoading(false); return }
      const sessionRes = await fetch("/api/auth/otp/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailInput, code }),
      })
      const session = await sessionRes.json()
      if (!sessionRes.ok) { setActionError(session.error || "Verification failed"); setCircleLoading(false); return }

      const { userToken, encryptionKey, challengeId, address: resolvedAddr, needsPinSetup } = session
      if (resolvedAddr && !needsPinSetup) {
        const addr = String(resolvedAddr).toLowerCase()
        localStorage.setItem("arclens-wallet-type", "circle")
        localStorage.setItem("arclens-circle-email", emailInput)
        localStorage.setItem("arclens-wallet", addr)
        setWallet(addr)
        setStep("linking")
        await linkWallet(addr, { type: "circle", email: emailInput })
        return
      }

      const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID!
      const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk")

      async function runSDK(): Promise<void> {
        if ((window as any).__CIRCLE_SDK_MOCK__) return
        const prev = (W3SSdk as any).instance
        if (prev) { try { prev.unSubscribeMessage() } catch {} }
        ;(W3SSdk as any).instance = null
        document.getElementById("circleWarmupFrame")?.remove()
        document.getElementById("sdkIframe")?.remove()
        const sdk = new W3SSdk()
        sdkRef.current = sdk
        sdk.setAppSettings({ appId })
        sdk.setAuthentication({ userToken, encryptionKey })
        return new Promise((resolve, reject) => {
          sdk.execute(challengeId, (err: any) => {
            sdkRef.current = null
            if (err) reject(err)
            else resolve()
          })
        })
      }

      try {
        try { await runSDK() }
        catch (e: any) {
          if (e?.code !== 155706) throw e
          await runSDK()
        }
      } catch (e: any) {
        setActionError(e?.code === 155706
          ? "Circle window failed to open. Check that this site is allowed in your browser."
          : (e?.message || "Setup failed. Try again."))
        setCircleLoading(false)
        return
      }

      // PIN completion = proof of ownership — get address and link directly
      let addr = resolvedAddr
      if (!addr) {
        const walletRes = await fetch("/api/auth/circle/wallet", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: emailInput }),
        })
        const walletData = await walletRes.json()
        if (!walletRes.ok || !walletData.address) {
          setActionError(walletData.error || "Wallet not ready. Try again.")
          setCircleLoading(false)
          return
        }
        addr = walletData.address
      }

      localStorage.setItem("arclens-wallet-type", "circle")
      localStorage.setItem("arclens-circle-email", emailInput)
      localStorage.setItem("arclens-wallet", addr.toLowerCase())

      setWallet(addr)
      setStep("linking")
      // Circle path: backend verifies emailInput owns this wallet via circle_wallet_users
      await linkWallet(addr.toLowerCase(), { type: "circle", email: emailInput })
    } catch {
      setActionError("Something went wrong. Try again.")
      setStep("connect")
      setCircleLoading(false)
    }
  }

  // Must mirror the format in /api/claim PUT — both sides build the SAME string,
  // backend recovers the signer and confirms it matches the claimed wallet.
  function buildActivationMessage(projectName: string, addr: string, ts: number): string {
    return `ArcLens Founder Dashboard Activation\nProject: ${projectName}\nWallet: ${addr}\nTimestamp: ${ts}`
  }

  async function linkWallet(addr: string, auth: any) {
    const res  = await fetch("/api/claim", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, slug, wallet: addr, auth }),
    })
    const data = await res.json()
    if (!res.ok) {
      setActionError(data.error || "Failed to activate. Try again.")
      setStep("connect")
      setCircleLoading(false)
      return
    }
    setStep("done")
    // The secure session is ready, so the one-time claim token leaves the URL.
    setTimeout(() => router.replace(`/dashboard/${slug}`), 2000)
  }

  async function signAndActivate() {
    if (!wallet || !project?.name) return
    setActionError("")
    setStep("linking")
    try {
      const walletType  = localStorage.getItem("arclens-wallet-type")
      const circleEmail = localStorage.getItem("arclens-circle-email")
      const timestamp   = Date.now()
      const addr        = wallet.toLowerCase()
      const message     = buildActivationMessage(project.name, addr, timestamp)

      // Circle UCW: PIN entry in iframe proves wallet ownership client-side;
      // backend trust comes from email→wallet mapping in circle_wallet_users.
      if (walletType === "circle" && circleEmail) {
        const sig = await circleSignMessage(circleEmail, message)
        if (!sig) { setActionError("Signature cancelled. Try again."); setStep("sign"); return }
        await linkWallet(addr, { type: "circle", email: circleEmail })
        return
      }

      // Browser wallet: personal_sign returns a real ECDSA signature
      if (!(window as any).ethereum) {
        setActionError("No wallet detected.")
        setStep("sign")
        return
      }
      const signature: string = await (window as any).ethereum.request({
        method: "personal_sign",
        params: [message, addr],
      })
      if (!signature) { setActionError("Signature cancelled. Try again."); setStep("sign"); return }

      await linkWallet(addr, { type: "wallet", signature, timestamp })
    } catch (e: any) {
      if (e?.code === 4001) setActionError("Signature rejected. Try again.")
      else setActionError(e?.message || "Something went wrong. Try again.")
      setStep("sign")
    }
  }

  if (!mounted) return <div style={{ minHeight: "100vh", background: "#05070f" }} />

  if (!token) return (
    <div style={{ minHeight: "100vh", background: surf, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center", color: t2, fontFamily: mono, fontSize: 13 }}>Invalid activation link.</div>
    </div>
  )

  if (loading) return (
    <div style={{ minHeight: "100vh", background: surf, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontFamily: mono, fontSize: 11, color: t3, letterSpacing: "0.08em" }}>Verifying link...</div>
    </div>
  )

  if (error) return (
    <div style={{ minHeight: "100vh", background: surf, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
      <div style={{ textAlign: "center", maxWidth: 400 }}>
        <div style={{ fontSize: 32, marginBottom: 16 }}>⚠</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: t1, marginBottom: 8 }}>Link expired or invalid</div>
        <div style={{ fontSize: 13, color: t2, lineHeight: 1.7, marginBottom: 24 }}>{error}</div>
        <button onClick={() => router.push("/ecosystem")}
          style={{ height: 40, padding: "0 24px", background: "transparent", color: t2, border: "1px solid " + bdr, borderRadius: 9, fontSize: 13, cursor: "pointer", fontFamily: mono }}>
          Back to Ecosystem
        </button>
      </div>
    </div>
  )

  const color   = blue
  const proxied = imgSrc(project?.logo_url || null)
  const isCircleUser = localStorage.getItem("arclens-wallet-type") === "circle"

  return (
    <div style={{ minHeight: "100vh", background: surf, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
      <div style={{ width: "100%", maxWidth: 420 }}>

        {/* Wordmark */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: t1 }}>Arc</span>
          <span style={{ fontSize: 20, fontWeight: 700, color: blue }}>Lens</span>
        </div>

        {/* Card */}
        <div style={{ background: "#0c1122", border: "1px solid rgba(26,86,255,0.2)", borderRadius: 16, overflow: "hidden", position: "relative" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, #1a56ff, #4070ff 40%, transparent)" }} />

          {/* Project identity */}
          <div style={{ padding: "28px 28px 20px", borderBottom: "1px solid " + bdr, display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, overflow: "hidden", background: color + "18", border: "1px solid " + color + "28", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, fontFamily: mono, color, flexShrink: 0 }}>
              {proxied && !imgErr
                ? <img src={proxied} alt={project?.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={() => setImgErr(true)} />
                : project?.name?.[0]
              }
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: t1, marginBottom: 4 }}>{project?.name}</div>
              <span style={{ fontSize: 9, fontFamily: mono, padding: "2px 8px", borderRadius: 99, background: color + "14", color, border: "1px solid " + color + "28" }}>{project?.category}</span>
            </div>
          </div>

          {step === "done" ? (
            <div style={{ padding: "48px 32px", textAlign: "center" }}>
              <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(0,184,122,0.12)", border: "1px solid rgba(0,184,122,0.3)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", fontSize: 22, color: "#00b87a" }}>✓</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: t1, marginBottom: 8 }}>Dashboard activated</div>
              <div style={{ fontSize: 12, color: t2, fontFamily: mono }}>Taking you there now...</div>
            </div>
          ) : (
            <div style={{ padding: "28px" }}>

              {step === "connect" && (
                <>
                  <div style={{ fontSize: 17, fontWeight: 700, color: t1, marginBottom: 8, letterSpacing: "-0.02em" }}>Activate your dashboard</div>
                  <div style={{ fontSize: 13, color: t2, lineHeight: 1.75, marginBottom: 24 }}>
                    Connect your wallet to link it to <strong style={{ color: t1 }}>{project?.name}</strong>. You'll use it to log in directly from now on.
                  </div>

                  {/* Browser wallet */}
                  <button onClick={connectWallet}
                    style={{ width: "100%", height: 46, background: "rgba(255,255,255,0.04)", color: t1, fontSize: 14, fontWeight: 600, border: "1px solid " + bdr, borderRadius: 10, cursor: "pointer", fontFamily: "'Geist', sans-serif", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M16 12h.01"/></svg>
                    Connect Browser Wallet
                  </button>

                  {/* Divider */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                    <div style={{ flex: 1, height: 1, background: bdr }} />
                    <span style={{ fontSize: 10, fontFamily: mono, color: t3 }}>or</span>
                    <div style={{ flex: 1, height: 1, background: bdr }} />
                  </div>

                  {/* Circle email option */}
                  <div style={{ fontSize: 11, fontFamily: mono, color: t3, marginBottom: 8 }}>
                    {circleStage === "email" ? "Continue with email wallet" : `Code sent to ${emailInput}`}
                  </div>
                  <input
                    type={circleStage === "email" ? "email" : "text"}
                    inputMode={circleStage === "code" ? "numeric" : undefined}
                    autoComplete={circleStage === "code" ? "one-time-code" : "email"}
                    maxLength={circleStage === "code" ? 6 : undefined}
                    value={circleStage === "email" ? emailInput : otpCode}
                    onChange={e => circleStage === "email" ? setEmailInput(e.target.value) : setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    onKeyDown={e => e.key === "Enter" && !circleLoading && connectWithCircle()}
                    placeholder={circleStage === "email" ? "you@example.com" : "000000"}
                    disabled={circleLoading}
                    style={{ width: "100%", height: 40, background: "rgba(255,255,255,0.03)", border: "1px solid " + bdr, borderRadius: 8, padding: "0 12px", fontSize: 13, fontFamily: mono, color: t1, outline: "none", marginBottom: 10, boxSizing: "border-box" }}
                  />
                  <button onClick={connectWithCircle} disabled={circleLoading}
                    style={{ width: "100%", height: 46, background: blue, color: "#fff", fontSize: 14, fontWeight: 600, border: "none", borderRadius: 10, cursor: circleLoading ? "not-allowed" : "pointer", opacity: circleLoading ? 0.7 : 1, fontFamily: "'Geist', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                    {circleLoading ? (
                      <>
                        <div style={{ width: 16, height: 16, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.25)", borderTopColor: "#fff", animation: "activateSpin 0.8s linear infinite" }} />
                        {circleStage === "email" ? "Sending code…" : "Verifying…"}
                      </>
                    ) : circleStage === "email" ? "Send verification code →" : "Verify & continue →"}
                  </button>
                  {circleStage === "code" && !circleLoading && (
                    <button type="button" onClick={() => { setCircleStage("email"); setOtpCode(""); setActionError("") }}
                      style={{ width: "100%", marginTop: 10, border: 0, background: "transparent", color: t2, fontFamily: mono, fontSize: 11, cursor: "pointer" }}>
                      Use a different email
                    </button>
                  )}
                </>
              )}

              {step === "sign" && (
                <>
                  <div style={{ fontSize: 17, fontWeight: 700, color: t1, marginBottom: 8, letterSpacing: "-0.02em" }}>Verify wallet ownership</div>
                  <div style={{ fontSize: 13, color: t2, lineHeight: 1.75, marginBottom: 16 }}>
                    {isCircleUser
                      ? "Enter your PIN to confirm you own this wallet and activate the dashboard."
                      : <>Sign a message to confirm you own this wallet. This is <strong style={{ color: t1 }}>not a transaction</strong> — no gas, nothing moves on-chain.</>
                    }
                  </div>

                  {/* Wallet address pill */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "rgba(26,86,255,0.06)", border: "1px solid rgba(26,86,255,0.15)", borderRadius: 9, marginBottom: 24 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#00b87a", flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontFamily: mono, color: t1 }}>{wallet ? shortAddr(wallet) : ""}</span>
                    <span style={{ fontSize: 11, fontFamily: mono, color: t3, marginLeft: "auto" }}>{isCircleUser ? "circle wallet" : "connected"}</span>
                  </div>

                  {!isCircleUser && (
                    <div style={{ padding: "12px 14px", background: "rgba(255,255,255,0.02)", border: "1px solid " + bdr, borderRadius: 9, marginBottom: 24, fontFamily: mono, fontSize: 11, color: t3, lineHeight: 1.9, whiteSpace: "pre-wrap" }}>
                      {`ArcLens — Founder Dashboard Activation\n\nProject: ${project?.name}\nWallet:  ${wallet ? shortAddr(wallet) : ""}\n\nThis signature verifies you own this wallet.\nNo transaction will be submitted and no funds\nwill move.`}
                    </div>
                  )}
                </>
              )}

              {step === "linking" && (
                <div style={{ padding: "32px 0", textAlign: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", border: "2px solid rgba(26,86,255,0.2)", borderTopColor: blue, animation: "activateSpin 0.8s linear infinite" }} />
                  </div>
                  <div style={{ fontSize: 13, color: t2, fontFamily: mono }}>Activating your dashboard...</div>
                </div>
              )}

              {actionError && (
                <div style={{ padding: "10px 14px", background: "rgba(224,51,72,0.08)", border: "1px solid rgba(224,51,72,0.2)", borderRadius: 8, fontSize: 12, color: "#e03348", marginBottom: 16, fontFamily: mono }}>
                  {actionError}
                </div>
              )}

              {step === "sign" && (
                <button onClick={signAndActivate}
                  style={{ width: "100%", height: 46, background: blue, color: "#fff", fontSize: 14, fontWeight: 600, border: "none", borderRadius: 10, cursor: "pointer", fontFamily: "'Geist', sans-serif" }}>
                  {isCircleUser ? "Verify with PIN & Activate" : "Sign & Activate Dashboard"}
                </button>
              )}

              {(step === "connect" || step === "sign") && (
                <div style={{ fontSize: 11, color: t3, textAlign: "center", fontFamily: mono, lineHeight: 1.7, marginTop: 14 }}>
                  MetaMask · Rabby · Circle Email Wallet
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ textAlign: "center", marginTop: 24, fontSize: 11, color: t3, fontFamily: mono }}>
          ArcLens · arclenz.xyz
        </div>
      </div>

      <style>{`@keyframes activateSpin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
