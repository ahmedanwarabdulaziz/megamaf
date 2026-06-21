"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Fingerprint, Loader2 } from "lucide-react"

export function PasskeyLoginButton() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [supported, setSupported] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    // Basic check if WebAuthn is supported by this browser
    if (!window.PublicKeyCredential) {
      setSupported(false)
    }
  }, [])

  async function handlePasskeyLogin() {
    setLoading(true)
    setError(null)

    try {
      // signInWithPasskey() handles the FULL WebAuthn ceremony:
      // 1. Gets challenge from server
      // 2. Triggers navigator.credentials.get() (browser biometric prompt)
      // 3. Verifies credential and returns session
      const { data, error } = await supabase.auth.signInWithPasskey()

      if (error) throw error

      if (navigator.vibrate) navigator.vibrate([50, 100])

      // Force full reload to refresh server-side session
      window.location.href = "/"
    } catch (err: any) {
      console.error("Passkey login failed:", err)
      const msg = err?.message || JSON.stringify(err)

      // User-friendly messages for common errors
      if (msg?.includes("No passkeys") || msg?.includes("no credentials")) {
        setError("لم يتم تسجيل أي بصمة لهذا الحساب. سجّل الدخول بكلمة المرور أولاً ثم سجّل جهازك.")
      } else if (msg?.includes("cancelled") || msg?.includes("abort") || msg?.includes("NotAllowed")) {
        setError("تم إلغاء العملية. اضغط مرة أخرى وأتم التحقق.")
      } else {
        setError(msg || "فشل تسجيل الدخول بالبصمة.")
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

      <Button
        type="button"
        variant="outline"
        className="w-full font-medium"
        onClick={handlePasskeyLogin}
        disabled={loading}
      >
        {loading
          ? <Loader2 className="h-4 w-4 animate-spin ml-2" />
          : <Fingerprint className="h-5 w-5 ml-2 text-primary" />
        }
        تسجيل الدخول بالبصمة / الوجه
      </Button>

      {error && (
        <p className="text-xs text-destructive text-center mt-2 p-2 bg-destructive/10 rounded-md">
          {error}
        </p>
      )}
    </div>
  )
}
