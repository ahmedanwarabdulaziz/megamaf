"use client"

import { useState } from "react"
import { X } from "lucide-react"
import { formatMoney } from "@/lib/money"

export interface PaymentRecord {
  id: string
  document_type: string
  document_date: string
  description: string
  amount_paid: number
}

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  invoice: "فاتورة",
  claim: "مستخلص",
  retention_release: "إفراج ضمان",
  payment: "دفعة نقدية",
  receipt: "تحصيل دفعة",
  opening_balance: "رصيد قبل النظام",
}

export function CollectedPaymentsTrigger({
  partyName,
  total,
  records,
  className,
  children,
}: {
  partyName: string
  total: number
  records: PaymentRecord[]
  className?: string
  children: React.ReactNode
}) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)} className={className}>
        {children}
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center pb-16 sm:pb-0">
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setIsOpen(false)} />
          <div className="relative z-[70] w-full sm:max-w-lg bg-card rounded-t-2xl sm:rounded-xl border-t-4 sm:border-2 border-primary shadow-2xl animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-0 sm:zoom-in-95 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between bg-primary text-primary-foreground p-4 sm:px-6 shrink-0">
              <div>
                <h2 className="text-lg font-semibold">سجل المحصّل فعلياً</h2>
                <p className="text-sm text-primary-foreground/80 mt-0.5">{partyName}</p>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-full p-2 hover:bg-primary-foreground/20 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1">
              {records.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">لا توجد دفعات مسجلة</div>
              ) : (
                <div className="divide-y divide-border">
                  {records.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{r.description}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-muted-foreground">{r.document_date}</span>
                          <span className="text-xs bg-muted text-muted-foreground rounded px-1.5 py-0.5">
                            {DOCUMENT_TYPE_LABELS[r.document_type] || r.document_type}
                          </span>
                        </div>
                      </div>
                      <span className="text-sm font-semibold text-green-700 dark:text-green-400 shrink-0">
                        {formatMoney(r.amount_paid)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-4 sm:px-6 py-3 border-t bg-muted/30 flex justify-between items-center shrink-0">
              <span className="text-sm font-medium text-muted-foreground">الإجمالي</span>
              <span className="text-base font-bold text-green-700 dark:text-green-400">{formatMoney(total)}</span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
