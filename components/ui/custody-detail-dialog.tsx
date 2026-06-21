"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import {
  X, Package, Calendar, BadgeCheck, Banknote, User, FileText,
} from "lucide-react"
import { Button } from "@/components/ui/button"

export interface CustodyDetailItem {
  id: string
  item: string
  amount: number
  date: string | null
  approved_at: string | null
  notes?: string | null
}

interface Props {
  employeeName: string
  jobTitle?: string | null
  custodies: CustodyDetailItem[]
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

export function CustodyDetailDialog({ employeeName, jobTitle, custodies, trigger }: Props) {
  const [open, setOpen] = React.useState(false)
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => { setMounted(true) }, [])
  React.useEffect(() => {
    if (!open) return
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    window.addEventListener("keydown", fn)
    return () => window.removeEventListener("keydown", fn)
  }, [open])

  const total = custodies.reduce((s, c) => s + c.amount, 0)

  const modal = open && mounted ? createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 fade-in duration-150 max-h-[85vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-5 pb-4 border-b border-border shrink-0 bg-amber-500/5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-amber-500/15 flex items-center justify-center">
              <User className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <h3 className="font-semibold text-base">{employeeName}</h3>
              {jobTitle && (
                <p className="text-xs text-muted-foreground">{jobTitle}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-xs text-muted-foreground">إجمالي العهد</p>
              <p className="font-bold text-amber-600">{formatAmount(total)} <span className="text-xs font-normal">EGP</span></p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full p-1.5 hover:bg-muted transition-colors text-muted-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* View-only badge */}
        <div className="flex items-center gap-2 px-5 py-2 bg-blue-500/5 border-b border-border shrink-0">
          <FileText className="h-3.5 w-3.5 text-blue-500" />
          <p className="text-xs text-blue-600 font-medium">عرض فقط — لتسوية العهد استخدم زر «إضافة دفعة»</p>
        </div>

        {/* Custody list */}
        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-3">
          {custodies.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
              <Package className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">لا توجد عهد معلقة</p>
            </div>
          ) : (
            custodies.map((c, idx) => (
              <div
                key={c.id}
                className="flex items-start gap-3 p-3.5 rounded-xl border border-border bg-muted/30 hover:bg-muted/60 transition-colors"
              >
                {/* Index badge */}
                <span className="flex items-center justify-center h-6 w-6 rounded-full bg-amber-500/15 text-amber-700 text-xs font-bold shrink-0 mt-0.5">
                  {idx + 1}
                </span>

                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{c.item}</p>
                  {c.notes && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{c.notes}</p>
                  )}
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      {formatDate(c.date)}
                    </span>
                    {c.approved_at && (
                      <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                        <BadgeCheck className="h-3 w-3" />
                        اعتُمد: {formatDate(c.approved_at)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <p className="font-bold text-sm">{formatAmount(c.amount)}</p>
                  <p className="text-xs text-muted-foreground">EGP</p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer total */}
        <div className="shrink-0 border-t border-border p-4 bg-muted/20 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Banknote className="h-4 w-4" />
            <span>{custodies.length} بند معلق</span>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">الإجمالي</p>
            <p className="text-lg font-bold text-amber-600">{formatAmount(total)} EGP</p>
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
          <Button variant="outline" size="sm" className="gap-1.5 text-xs">
            <FileText className="h-3.5 w-3.5" />
            عرض التفاصيل
          </Button>
        )}
      </span>
      {modal}
    </>
  )
}
