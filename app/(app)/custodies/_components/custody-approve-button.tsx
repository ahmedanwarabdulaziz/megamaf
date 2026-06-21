"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { BadgeCheck, ShieldAlert, Loader2 } from "lucide-react"
import { approveCustody, unapproveCustody } from "@/app/(app)/custodies/actions"

interface Props {
  custodyId: string
  mode: "approve" | "unapprove"
  onDone?: () => void
}

export function CustodyApproveButton({ custodyId, mode, onDone }: Props) {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const router = useRouter()

  async function handleClick() {
    setPending(true)
    setError(null)
    try {
      const result = mode === "approve"
        ? await approveCustody(custodyId)
        : await unapproveCustody(custodyId)
      if (result?.error) {
        setError(result.error)
      } else {
        onDone?.()
        router.refresh()
      }
    } catch (e: any) {
      setError(e?.message || "حدث خطأ غير متوقع")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="w-full">
      <Button
        type="button"
        variant="ghost"
        disabled={pending}
        onClick={handleClick}
        className={`w-full justify-start h-9 px-2 ${
          mode === "approve"
            ? "text-green-600 hover:text-green-700 hover:bg-green-500/10"
            : "text-amber-600 hover:text-amber-700 hover:bg-amber-500/10"
        }`}
      >
        {pending ? (
          <Loader2 className="h-4 w-4 ml-2 animate-spin" />
        ) : mode === "approve" ? (
          <BadgeCheck className="h-4 w-4 ml-2" />
        ) : (
          <ShieldAlert className="h-4 w-4 ml-2" />
        )}
        {mode === "approve" ? "اعتماد العهدة" : "إلغاء الاعتماد"}
      </Button>
      {error && (
        <p className="text-xs text-destructive px-2 py-1">{error}</p>
      )}
    </div>
  )
}
