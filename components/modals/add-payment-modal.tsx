"use client"

import * as React from "react"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import {
  X, Banknote, User, Landmark, AlertCircle, CheckCircle2,
  Clock, TrendingUp, Info,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createPortal } from "react-dom"
import { addAdvancePayment, getEmployeePendingCustodies } from "@/app/(app)/payments/actions"
import { Truck } from "lucide-react"

const PAYMENT_TYPES = [
  { value: "employee_advance", label: "سلفة موظف", icon: User,     color: "text-blue-600 bg-blue-500/10 border-blue-500/20" },
  { value: "vendor_payment",   label: "دفعة مورد", icon: Truck,    color: "text-purple-600 bg-purple-500/10 border-purple-500/20" },
  { value: "direct",          label: "دفعة مباشرة", icon: Banknote, color: "text-amber-600 bg-amber-500/10 border-amber-500/20" },
] as const

type PaymentType = typeof PAYMENT_TYPES[number]["value"]

interface PendingCustodySummary {
  count: number
  total: number
}

function formatAmount(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="bg-blue-600 hover:bg-blue-700 text-white min-w-[110px]">
      {pending ? (
        <span className="flex items-center gap-1.5">
          <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
          جارٍ الحفظ...
        </span>
      ) : (
        <span className="flex items-center gap-1.5">
          <Banknote className="h-3.5 w-3.5" />
          إضافة الدفعة
        </span>
      )}
    </Button>
  )
}

interface Props {
  employees: { id: string; name: string; job_title: string | null }[]
  vendors?: { id: string; name: string; type: string }[]
  bankAccounts: { id: string; account_name: string; bank_name: string }[]
}

export function AddPaymentModal({ employees, vendors = [], bankAccounts }: Props) {
  const [open, setOpen]           = React.useState(false)
  const [mounted, setMounted]     = React.useState(false)
  const [paymentType, setPaymentType] = React.useState<PaymentType>("employee_advance")
  const [selectedEmployee, setSelectedEmployee] = React.useState("")
  const [selectedVendor, setSelectedVendor] = React.useState("")
  const [payAmount, setPayAmount] = React.useState<number>(0)
  const [custodySummary, setCustodySummary] = React.useState<PendingCustodySummary | null>(null)
  const [loadingCustody, setLoadingCustody] = React.useState(false)
  const formRef = React.useRef<HTMLFormElement>(null)

  const today = new Date().toISOString().split("T")[0]

  React.useEffect(() => { setMounted(true) }, [])
  React.useEffect(() => {
    if (!open) return
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    window.addEventListener("keydown", fn)
    return () => window.removeEventListener("keydown", fn)
  }, [open])

  // Fetch pending custody summary when employee changes (employee_advance only)
  React.useEffect(() => {
    if (paymentType !== "employee_advance" || !selectedEmployee) {
      setCustodySummary(null)
      return
    }
    let cancelled = false
    setLoadingCustody(true)
    getEmployeePendingCustodies(selectedEmployee).then(({ data, total }) => {
      if (!cancelled) {
        setCustodySummary({ count: data.length, total })
        setLoadingCustody(false)
      }
    })
    return () => { cancelled = true }
  }, [selectedEmployee, paymentType])

  async function handleAction(_: any, formData: FormData) {
    const type = formData.get("payment_type") as PaymentType
    const result = await addAdvancePayment({
      payment_type: type,
      employee_id: formData.get("employee_id") as string || undefined,
      vendor_id: formData.get("vendor_id") as string || undefined,
      bank_account_id: formData.get("bank_account_id") as string,
      description: formData.get("description") as string,
      amount: Number(formData.get("amount")),
      payment_date: formData.get("payment_date") as string,
      notes: formData.get("notes") as string || undefined,
    })
    return result
  }

  const [state, formAction] = useActionState(handleAction as any, { error: "", success: false })

  React.useEffect(() => {
    if ((state as any)?.success) {
      setTimeout(() => {
        setOpen(false)
        formRef.current?.reset()
        setPaymentType("employee_advance")
        setSelectedEmployee("")
        setPayAmount(0)
        setCustodySummary(null)
      }, 800)
    }
  }, [(state as any)?.success])

  // Settlement preview computation
  const settlementPreview = React.useMemo(() => {
    if (!custodySummary || paymentType !== "employee_advance" || payAmount <= 0) return null
    const { total, count } = custodySummary
    if (count === 0) return { type: "no_custody" as const }
    if (payAmount >= total) {
      const surplus = payAmount - total
      return { type: "full" as const, surplus }
    }
    return { type: "partial" as const, remaining: total - payAmount }
  }, [custodySummary, payAmount, paymentType])

  function handleClose() {
    setOpen(false)
    setSelectedEmployee("")
    setPayAmount(0)
    setCustodySummary(null)
  }

  const modal = open && mounted ? createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative z-10 w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 fade-in duration-150 max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-5 pb-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center">
              <Banknote className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-base">إضافة دفعة جديدة</h3>
              <p className="text-sm text-muted-foreground">سلفة موظف أو دفعة مباشرة</p>
            </div>
          </div>
          <button type="button" onClick={handleClose}
            className="rounded-full p-1.5 hover:bg-muted transition-colors text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1">
          <form ref={formRef} action={formAction} className="p-5 flex flex-col gap-4">

            {/* Payment type selector */}
            <div>
              <label className="text-sm font-medium block mb-2">نوع الدفعة</label>
              <div className="grid grid-cols-2 gap-2">
                {PAYMENT_TYPES.map(pt => {
                  const Icon = pt.icon
                  const active = paymentType === pt.value
                  return (
                    <button key={pt.value} type="button"
                      onClick={() => { setPaymentType(pt.value); setSelectedEmployee(""); setCustodySummary(null) }}
                      className={`flex flex-col items-center gap-2 p-3 rounded-xl border text-xs font-medium transition-all ${
                        active ? pt.color + " border-current" : "border-border hover:bg-muted text-muted-foreground"
                      }`}>
                      <Icon className="h-4 w-4" />
                      {pt.label}
                    </button>
                  )
                })}
              </div>
              <input type="hidden" name="payment_type" value={paymentType} />
            </div>

            {/* Employee picker */}
            {paymentType === "employee_advance" && (
              <div>
                <label className="text-sm font-medium flex items-center gap-1.5 mb-1.5">
                  <User className="h-4 w-4 text-muted-foreground" /> الموظف
                </label>
                <select
                  name="employee_id"
                  required
                  value={selectedEmployee}
                  onChange={e => setSelectedEmployee(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">— اختر الموظف —</option>
                  {employees.map(e => (
                    <option key={e.id} value={e.id}>{e.name}{e.job_title ? ` — ${e.job_title}` : ""}</option>
                  ))}
                </select>

                {/* Pending custody summary */}
                {selectedEmployee && (
                  <div className="mt-2">
                    {loadingCustody ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground p-2.5 rounded-lg border border-border bg-muted/30">
                        <span className="h-3 w-3 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin shrink-0" />
                        جارٍ تحميل العهد المعلقة...
                      </div>
                    ) : custodySummary && custodySummary.count > 0 ? (
                      <div className="flex items-center gap-2 text-xs p-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5">
                        <Clock className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                        <span className="text-muted-foreground">العهد المعلقة المعتمدة:</span>
                        <span className="font-bold text-amber-700">{formatAmount(custodySummary.total)} EGP</span>
                        <span className="text-muted-foreground/70">({custodySummary.count} بند)</span>
                      </div>
                    ) : custodySummary && custodySummary.count === 0 ? (
                      <div className="flex items-center gap-2 text-xs p-2.5 rounded-lg border border-green-500/20 bg-green-500/5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                        <span className="text-green-700">لا توجد عهد معلقة لهذا الموظف</span>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            )}

            {/* Vendor picker */}
            {paymentType === "vendor_payment" && (
              <div>
                <label className="text-sm font-medium flex items-center gap-1.5 mb-1.5">
                  <Truck className="h-4 w-4 text-muted-foreground" /> المورد / المقاول
                </label>
                <select
                  name="vendor_id"
                  required
                  value={selectedVendor}
                  onChange={e => setSelectedVendor(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">— اختر المورد —</option>
                  {vendors.map(v => (
                    <option key={v.id} value={v.id}>{v.name} ({v.type === "supplier" ? "مورد" : v.type === "contractor" ? "مقاول" : "مورد ومقاول"})</option>
                  ))}
                </select>
              </div>
            )}

            {/* Description */}
            <div>
              <label className="text-sm font-medium block mb-1.5">وصف الدفعة</label>
              <Input name="description" required placeholder="مثال: دفعة مقدمة" />
            </div>

            {/* Amount + Date row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium block mb-1.5">المبلغ (EGP)</label>
                <Input
                  name="amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder="0.00"
                  value={payAmount || ""}
                  onChange={e => setPayAmount(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">تاريخ الدفع</label>
                <Input name="payment_date" type="date" required defaultValue={today} max={today} />
              </div>
            </div>

            {/* Settlement preview badge */}
            {settlementPreview && (
              <div className={`flex items-start gap-2 text-xs p-3 rounded-lg border ${
                settlementPreview.type === "full"
                  ? settlementPreview.surplus > 0
                    ? "border-blue-500/30 bg-blue-500/5"
                    : "border-green-500/30 bg-green-500/5"
                  : settlementPreview.type === "partial"
                    ? "border-amber-500/30 bg-amber-500/5"
                    : "border-border bg-muted/30"
              }`}>
                {settlementPreview.type === "full" && settlementPreview.surplus === 0 && (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0 mt-0.5" />
                    <span className="text-green-700 font-medium">سيتم تسوية جميع العهد المعلقة بالكامل ✓</span>
                  </>
                )}
                {settlementPreview.type === "full" && settlementPreview.surplus > 0 && (
                  <>
                    <TrendingUp className="h-3.5 w-3.5 text-blue-600 shrink-0 mt-0.5" />
                    <span className="text-blue-700">
                      سيتم تسوية جميع العهد ✓ · رصيد إضافي:{" "}
                      <span className="font-bold">{formatAmount(settlementPreview.surplus)} EGP</span>{" "}
                      سيُسجَّل كسلفة مستقبلية
                    </span>
                  </>
                )}
                {settlementPreview.type === "partial" && (
                  <>
                    <Info className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                    <span className="text-amber-700">
                      سيتم تسوية العهد القديمة جزئياً · متبقٍ:{" "}
                      <span className="font-bold">{formatAmount(settlementPreview.remaining)} EGP</span>{" "}
                      عهد لم تُسوَّ بعد
                    </span>
                  </>
                )}
                {settlementPreview.type === "no_custody" && (
                  <>
                    <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <span className="text-muted-foreground">ستُسجَّل كسلفة (لا توجد عهد معلقة)</span>
                  </>
                )}
              </div>
            )}

            {/* Bank account */}
            <div>
              <label className="text-sm font-medium flex items-center gap-1.5 mb-1.5">
                <Landmark className="h-4 w-4 text-muted-foreground" /> الحساب البنكي
              </label>
              {bankAccounts.length === 0 ? (
                <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">لا توجد حسابات بنكية</p>
              ) : (
                <select name="bank_account_id" required
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <option value="">— اختر الحساب —</option>
                  {bankAccounts.map(a => (
                    <option key={a.id} value={a.id}>{a.bank_name} — {a.account_name}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Notes */}
            <div>
              <label className="text-sm font-medium block mb-1.5">ملاحظات (اختياري)</label>
              <textarea name="notes" rows={2} placeholder="أي تفاصيل إضافية..."
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none" />
            </div>

            {/* Error / Success */}
            {(state as any)?.error && (
              <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />{(state as any).error}
              </div>
            )}
            {(state as any)?.success && (
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-500/10 p-3 rounded-md">
                <CheckCircle2 className="h-4 w-4" /> تمت إضافة الدفعة بنجاح ✓
              </div>
            )}

            {/* Footer */}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" size="sm" onClick={handleClose}>إلغاء</Button>
              <SubmitButton />
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body,
  ) : null

  return (
    <>
      <Button onClick={() => setOpen(true)} className="gap-2">
        <Banknote className="h-4 w-4" />
        إضافة دفعة
      </Button>
      {modal}
    </>
  )
}
