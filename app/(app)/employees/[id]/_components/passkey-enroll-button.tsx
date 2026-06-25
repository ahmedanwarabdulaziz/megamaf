"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Fingerprint, Loader2 } from "lucide-react"

export function PasskeyEnrollButton({ 
  employeeId, 
  username,
  generateOptions,
  verifyRegistration
}: { 
  employeeId: string, 
  username: string,
  generateOptions: (id: string, username: string) => Promise<any>,
  verifyRegistration: (resp: any, expectedChallenge: string, id: string) => Promise<any>
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [supported, setSupported] = useState(true)

  useEffect(() => {
    if (!window.PublicKeyCredential) setSupported(false)
  }, [])

  async function handleEnroll() {
    setLoading(true)
    setError(null)
    setSuccess(false)

    try {
      const { startRegistration } = await import("@simplewebauthn/browser")
      const options = await generateOptions(employeeId, username)
      const attResp = await startRegistration({ optionsJSON: options })
      const verification = await verifyRegistration(attResp, options.challenge, employeeId)

      if (verification.success) {
        setSuccess(true)
        if (navigator.vibrate) navigator.vibrate([100, 50, 100])
      } else {
        throw new Error(verification.error || "Verification failed")
      }
    } catch (err: any) {
      console.error("Passkey enrollment error:", err)
      if (err.name === 'NotAllowedError') {
        setError("تم إلغاء العملية أو لم يتم منح الصلاحية.")
      } else {
        setError("حدث خطأ أثناء تسجيل البصمة.")
      }
      if (navigator.vibrate) navigator.vibrate([200, 50, 200])
    } finally {
      setLoading(false)
    }
  }

  if (!supported) {
    return <p className="text-sm text-destructive mt-2">متصفحك أو جهازك لا يدعم تسجيل الدخول بالبصمة.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" onClick={handleEnroll} disabled={loading} variant="outline" className="w-full sm:w-auto">
        {loading ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Fingerprint className="h-4 w-4 ml-2" />}
        تسجيل بصمة / جهاز جديد
      </Button>
      {error && <p className="text-sm text-destructive mt-2">{error}</p>}
      {success && <p className="text-sm text-green-600 mt-2 font-medium">تم تسجيل البصمة بنجاح! يمكنك الآن تسجيل الدخول بها.</p>}
    </div>
  )
}
