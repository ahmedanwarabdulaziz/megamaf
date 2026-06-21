"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import {
  X, Calendar, BadgeCheck, Banknote, User, Landmark, ArrowRight, CheckCircle2, FileText
} from "lucide-react"
import { Button } from "@/components/ui/button"

interface Props {
  custody: any
  employee: any
  bankAccount: any
  settlingExpense: any
  isAdvanceSettled: boolean
  trigger?: React.ReactNode
}

function formatDate(d: string | null) {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("ar-EG", {
    year: "numeric", month: "short", day: "numeric",
  })
}
function formatAmount(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const TYPE_LABEL: Record<string, string> = {
  custody:          "عهدة",
  employee_advance: "سلفة موظف",
  direct:           "دفعة مباشرة",
}

export function PaidCustodyDetailDialog({
  custody, employee, bankAccount, settlingExpense, isAdvanceSettled, trigger
}: Props) {
  const [open, setOpen] = React.useState(false)
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => { setMounted(true) }, [])
  React.useEffect(() => {
    if (!open) return
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    window.addEventListener("keydown", fn)
    return () => window.removeEventListener("keydown", fn)
  }, [open])

  const modal = open && mounted ? createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />
      <div className="relative z-10 w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 fade-in duration-150 flex flex-col">
        
        {/* Header */}
        <div className="flex items-center justify-between p-5 pb-4 border-b border-border bg-green-500/5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-green-500/15 flex items-center justify-center">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <h3 className="font-semibold text-base">تفاصيل العهدة المصروفة</h3>
              <p className="text-xs text-muted-foreground">{custody.item}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-full p-1.5 hover:bg-muted transition-colors text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Details Body */}
        <div className="p-5 flex flex-col gap-5">
          
          <div className="flex flex-col items-center justify-center py-2">
            <p className="text-sm text-muted-foreground mb-1">المبلغ المصروف</p>
            <p className="text-3xl font-bold text-green-700">{formatAmount(Number(custody.amount))} <span className="text-base font-normal text-muted-foreground">EGP</span></p>
          </div>

          <div className="grid gap-3 text-sm">
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/40 border border-border">
              <div className="flex items-center gap-2 text-muted-foreground">
                <User className="h-4 w-4" />
                <span>الموظف</span>
              </div>
              <span className="font-medium">{employee?.name ?? "—"}</span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/40 border border-border">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="h-4 w-4" />
                <span>تاريخ العهدة</span>
              </div>
              <span className="font-medium">{formatDate(custody.date)}</span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-lg bg-green-500/5 border border-green-500/20">
              <div className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="h-4 w-4" />
                <span>تاريخ الصرف</span>
              </div>
              <span className="font-medium text-green-700">{formatDate(custody.funded_at)}</span>
            </div>
          </div>

          {/* Payment reference block */}
          <div className="flex flex-col gap-2 p-3.5 rounded-xl bg-muted/50 border border-border">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase">
              <Banknote className="h-3.5 w-3.5" /> مرجع الدفع
            </div>
            
            <div className="text-sm text-foreground">
              {isAdvanceSettled && settlingExpense ? (
                <div className="flex flex-col gap-1.5 mt-1">
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-700 border border-blue-500/20 text-xs font-medium">
                      سُويت بسلفة
                    </span>
                    <span>{TYPE_LABEL[settlingExpense.payment_type] ?? "دفعة"}: {settlingExpense.description}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                    <Landmark className="h-3.5 w-3.5" />
                    {settlingExpense.bank_accounts?.banks?.name} — {settlingExpense.bank_accounts?.account_name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    إجمالي السلفة: {formatAmount(Number(settlingExpense.amount))} EGP · {formatDate(settlingExpense.expense_date)}
                  </div>
                </div>
              ) : bankAccount ? (
                <div className="flex flex-col gap-1.5 mt-1">
                  <span className="font-medium">صرف مباشر</span>
                  <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                    <Landmark className="h-3.5 w-3.5" />
                    {bankAccount.banks?.name} — {bankAccount.account_name}
                  </div>
                </div>
              ) : (
                <span className="mt-1">تم الصرف</span>
              )}
            </div>
          </div>

        </div>

      </div>
    </div>,
    document.body,
  ) : null

  return (
    <>
      <span onClick={() => setOpen(true)} className="contents cursor-pointer">
        {trigger ?? (
          <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8">
            <FileText className="h-3.5 w-3.5" />
            التفاصيل
          </Button>
        )}
      </span>
      {modal}
    </>
  )
}
