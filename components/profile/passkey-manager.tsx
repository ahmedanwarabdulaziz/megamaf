"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Fingerprint, Loader2, Trash2 } from "lucide-react"

export function PasskeyManager() {
  const [passkeys, setPasskeys] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [enrolling, setEnrolling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    fetchPasskeys()
  }, [])

  async function fetchPasskeys() {
    setLoading(true)
    setError(null)
    try {
      const { data, error } = await supabase.auth.passkey.list()
      if (error) throw error
      setPasskeys(data || [])
    } catch (err: any) {
      console.error("Error fetching passkeys:", err)
      // Don't show error on load — passkeys may just not be enrolled yet
    } finally {
      setLoading(false)
    }
  }

  async function handleEnrollPasskey() {
    setEnrolling(true)
    setError(null)
    setSuccess(false)
    try {
      // registerPasskey() handles the FULL WebAuthn ceremony:
      // 1. Gets challenge from server
      // 2. Triggers navigator.credentials.create() (browser biometric prompt)
      // 3. Verifies credential with server
      const { data, error } = await supabase.auth.registerPasskey()
      if (error) throw error

      if (navigator.vibrate) navigator.vibrate(100)
      setSuccess(true)
      await fetchPasskeys()
    } catch (err: any) {
      console.error("Passkey enrollment failed:", err)
      // Show the real error — never suppress it
      const msg = err?.message || JSON.stringify(err) || "فشل تسجيل البصمة"
      setError(msg)
    } finally {
      setEnrolling(false)
    }
  }

  async function handleDeletePasskey(id: string) {
    if (!confirm("هل أنت متأكد من حذف هذه البصمة؟")) return

    setLoading(true)
    setError(null)
    try {
      const { error } = await supabase.auth.passkey.delete({ passkeyId: id })
      if (error) throw error

      if (navigator.vibrate) navigator.vibrate([50, 50])
      await fetchPasskeys()
    } catch (err: any) {
      console.error("Error deleting passkey:", err)
      setError(err.message || "Failed to delete passkey")
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">تفعيل الدخول بالبصمة / الوجه</h4>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleEnrollPasskey}
          disabled={enrolling}
        >
          {enrolling
            ? <Loader2 className="h-4 w-4 animate-spin ml-2" />
            : <Fingerprint className="h-4 w-4 ml-2" />
          }
          تسجيل جهاز جديد
        </Button>
      </div>

      {error && (
        <p className="text-xs text-destructive p-2 bg-destructive/10 rounded-md">
          ❌ {error}
        </p>
      )}

      {success && (
        <p className="text-xs text-green-600 p-2 bg-green-50 rounded-md">
          ✅ تم تسجيل البصمة بنجاح! يمكنك الآن تسجيل الدخول بدون كلمة مرور.
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center p-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : passkeys.length === 0 ? (
        <p className="text-sm text-muted-foreground bg-muted/50 p-4 rounded-md text-center">
          لا يوجد أجهزة مسجلة حتى الآن. يمكنك تسجيل هذا الجهاز لتسجيل الدخول السريع لاحقاً.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {passkeys.map(key => (
            <div key={key.id} className="flex items-center justify-between p-3 rounded-md border border-border bg-card">
              <div className="flex flex-col">
                <span className="text-sm font-medium">🔐 جهاز مسجل ({key.name || "Passkey"})</span>
                <span className="text-xs text-muted-foreground">
                  تم التسجيل في: {new Date(key.created_at).toLocaleDateString("ar-EG")}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-destructive hover:bg-destructive/10"
                onClick={() => handleDeletePasskey(key.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
