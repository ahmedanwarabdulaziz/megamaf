"use client"

import * as React from "react"
import { Banknote, X, Landmark, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createPortal } from "react-dom"
import { payCustody } from "@/app/(app)/custodies/actions"

interface Props {
  custodyId: string
  custodyItem: string
  custodyAmount: number
  employeeName: string
  bankAccounts: { id: string; account_name: string; bank_name: string }[]
}

export function PayCustodyButton({ custodyId, custodyItem, custodyAmount, employeeName, bankAccounts }: Props) {
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [selectedBank, setSelectedBank] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => { setMounted(true) }, [])
  React.useEffect(() => {
    if (!open) return
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    window.addEventListener("keydown", fn)
    return () => window.removeEventListener("keydown", fn)
  }, [open])

  function handleOpen() {
    setSelectedBank(bankAccounts[0]?.id ?? "")
    setError(null)
    setOpen(true)
  }

  async function handlePay() {
    if (!selectedBank) { setError("يجب اختيار حساب بنكي"); return }
    setPending(true); setError(null)
    try {
      const result = await payCustody(custodyId, selectedBank)
      if (result?.error) { setError(result.error); return }
      setOpen(false)
    } catch (e: any) {
      setError(e?.message ?? "حدث خطأ غير متوقع")
    } finally {
      setPending(false)
    }
  }

  const dialog = open && mounted ? createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !pending && setOpen(false)} />
      <div className="relative z-10 w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 fade-in duration-150">

        {/* Header */}
        <div className="flex items-start justify-between p-5 pb-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
              <Banknote className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-base">صرف العهدة</h3>
              <p className="text-sm text-muted-foreground mt-0.5">{employeeName}</p>
            </div>
          </div>
          <button type="button" onClick={() => setOpen(false)} disabled={pending}
            className="rounded-full p-1.5 hover:bg-muted transition-colors text-muted-foreground disabled:opacity-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Item + Amount */}
        <div className="mx-5 mb-3 p-3 rounded-lg bg-muted/40 border border-border">
          <p className="text-sm font-medium truncate">{custodyItem}</p>
          <p className="text-xl font-bold text-blue-600 mt-1">
            {custodyAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            <span className="text-sm font-normal text-muted-foreground ml-1">EGP</span>
          </p>
        </div>

        {/* Bank selector */}
        <div className="px-5 pb-3">
          <label className="text-sm font-medium flex items-center gap-1.5 mb-2">
            <Landmark className="h-4 w-4 text-muted-foreground" />
            اختر الحساب البنكي للصرف
          </label>
          {bankAccounts.length === 0 ? (
            <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
              لا توجد حسابات بنكية. أضف حساباً أولاً.
            </p>
          ) : (
            <select value={selectedBank} onChange={e => setSelectedBank(e.target.value)} disabled={pending}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {bankAccounts.map(a => (
                <option key={a.id} value={a.id}>{a.bank_name} — {a.account_name}</option>
              ))}
            </select>
          )}
        </div>

        {error && (
          <div className="mx-5 mb-3 flex items-start gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />{error}
          </div>
        )}

        <div className="flex gap-2 p-4 pt-2 justify-end">
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>إلغاء</Button>
          <Button type="button" size="sm" onClick={handlePay}
            disabled={pending || bankAccounts.length === 0}
            className="bg-blue-600 hover:bg-blue-700 text-white min-w-[90px]">
            {pending ? (
              <span className="flex items-center gap-1.5">
                <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                جارٍ الصرف...
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Banknote className="h-3.5 w-3.5" />
                صرف الآن
              </span>
            )}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  ) : null

  return (
    <>
      <Button type="button" onClick={handleOpen}
        className="bg-blue-600 hover:bg-blue-700 text-white h-9 px-4 text-sm gap-2">
        <Banknote className="h-4 w-4" />
        صرف
      </Button>
      {dialog}
    </>
  )
}
