"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Fingerprint, Loader2 } from "lucide-react"

export function PasskeyLoginButton({
  generateOptions,
  verifyLogin,
}: {
  generateOptions: () => Promise<any>
  verifyLogin: (resp: any, challenge: string) => Promise<any>
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [supported, setSupported] = useState(true)

  useEffect(() => {
    if (!window.PublicKeyCredential) setSupported(false)
  }, [])

  async function handlePasskeyLogin() {
    setLoading(true)
    setError(null)

    try {
      const { startAuthentication } = await import("@simplewebauthn/browser")
      const options = await generateOptions()
      const authResp = await startAuthentication({ optionsJSON: options })
      const result = await verifyLogin(authResp, options.challenge)

      if (result.success) {
        if (navigator.vibrate) navigator.vibrate([50, 100])
        window.location.href = "/"
      } else {
        throw new Error(result.error || "Verification failed")
      }
    } catch (err: any) {
      console.error("Passkey login failed:", err)
      const msg = err?.message || JSON.stringify(err)
      if (msg?.includes("No passkeys") || msg?.includes("no credentials")) {
        setError("لم يتم تسجيل أي بصمة لهذا الحساب. سجّل الدخول بكلمة المرور أولاً ثم سجّل جهازك.")
      } else if (err.name === "NotAllowedError" || msg?.includes("cancelled") || msg?.includes("abort")) {
        setError("تم إلغاء العملية. اضغط مرة أخرى وأتم التحقق.")
      } else {
        setError("فشل تسجيل الدخول بالبصمة.")
      }
      if (navigator.vibrate) navigator.vibrate([200, 50, 200])
    } finally {
      setLoading(false)
    }
  }

  if (!supported) return null

  return (
    <div className="flex flex-col gap-2 w-full mt-2">
      <div className="relative my-4">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">أو</span>
        </div>
      </div>
      <Button type="button" variant="outline" className="w-full font-medium" onClick={handlePasskeyLogin} disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Fingerprint className="h-5 w-5 ml-2 text-primary" />}
        تسجيل الدخول بالبصمة / الوجه
      </Button>
      {error && <p className="text-xs text-destructive text-center mt-2 p-2 bg-destructive/10 rounded-md">{error}</p>}
    </div>
  )
}
