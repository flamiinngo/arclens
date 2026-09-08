"use client"

const APP_ID = process.env.NEXT_PUBLIC_CIRCLE_APP_ID!

async function runSDKChallenge(userToken: string, encryptionKey: string, challengeId: string): Promise<void> {
  if ((window as any).__CIRCLE_SDK_MOCK__) return
  const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk")
  // Remove stale message listener before resetting the singleton (see ArcLayout connectCircle)
  const prevSdk = (W3SSdk as any).instance
  if (prevSdk) { try { prevSdk.unSubscribeMessage() } catch {} }
  ;(W3SSdk as any).instance = null
  document.getElementById("sdkIframe")?.remove()
  const sdk = new W3SSdk()
  sdk.setAppSettings({ appId: APP_ID })
  // Brand the PIN popup to match ArcLens (dark glass + Arc blue) instead of
  // Circle's default white modal.
  try {
    sdk.setThemeColor({
      backdrop: "#04060d", backdropOpacity: 0.66, divider: "rgba(255,255,255,0.08)",
      bg: "#0b0e16", success: "#00c896", error: "#ff5a6e",
      textMain: "#eef1f8", textAuxiliary: "#8b93a7", textSummary: "#8b93a7",
      textSummaryHighlight: "#eef1f8", textPlaceholder: "#565e72",
      textDetailToggle: "#6691ff", textInteractive: "#6691ff",
      interactiveBg: "rgba(59,107,255,0.12)",
      pinDotBase: "rgba(255,255,255,0.18)", pinDotBaseBorder: "rgba(255,255,255,0.28)",
      pinDotActivated: "#3b6bff", enteredPinText: "#eef1f8",
      inputText: "#eef1f8", inputBg: "#0e121d", inputBorderFocused: "#3b6bff",
      inputBorderFocusedError: "#ff5a6e", inputBgDisabled: "#0b0e16",
      dropdownBg: "#0e121d",
      mainBtnText: "#ffffff", mainBtnTextOnHover: "#ffffff", mainBtnTextDisabled: "#8b93a7",
      mainBtnBg: "#3b6bff", mainBtnBgOnHover: "#5b84ff", mainBtnBgDisabled: "rgba(59,107,255,0.3)",
      secondBtnText: "#eef1f8", secondBtnTextOnHover: "#eef1f8",
      secondBtnBorder: "rgba(255,255,255,0.12)", secondBtnBorderOnHover: "rgba(255,255,255,0.22)",
      secondBtnBgOnHover: "rgba(255,255,255,0.05)",
      tooltipBg: "#0e121d", tooltipText: "#eef1f8",
    } as any)
  } catch {}
  sdk.setAuthentication({ userToken, encryptionKey })
  return new Promise((resolve, reject) => {
    sdk.execute(challengeId, (error: any) => {
      if (error) reject(new Error(
        error.code === 155706
          ? "Circle wallet window failed to open. Check that this site is allowed in your browser."
          : (error.message || "Circle challenge failed")
      ))
      else resolve()
    })
  })
}

// Sign a plain-text message (personal_sign equivalent).
// Returns a truthy string on success — the signature is verified via PIN completion, not bytes.
export async function circleSignMessage(email: string, message: string): Promise<string> {
  const res  = await fetch("/api/auth/circle/sign/message", {
    method:  "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ email, message }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || "Failed to create signing challenge")

  await runSDKChallenge(data.userToken, data.encryptionKey, data.challengeId)
  return "circle-ucw-signed"
}

// Execute a contract call (eth_sendTransaction equivalent).
// Returns the on-chain txHash once Circle broadcasts the transaction.
export async function circleSendTransaction(
  email: string,
  contractAddress: string,
  abiFunctionSignature: string,
  abiParameters: string[],
): Promise<string> {
  const res  = await fetch("/api/auth/circle/sign/transaction", {
    method:  "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ email, contractAddress, abiFunctionSignature, abiParameters }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || "Failed to create transaction challenge")

  await runSDKChallenge(data.userToken, data.encryptionKey, data.challengeId)

  // Give Circle 2 seconds to index, then fetch the txHash
  await new Promise(r => setTimeout(r, 2000))
  const txRes  = await fetch("/api/auth/circle/tx/latest", {
    method:  "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ email }),
  })
  const txData = await txRes.json()
  if (!txRes.ok) throw new Error(txData.error || "Transaction not confirmed")
  return txData.txHash
}
