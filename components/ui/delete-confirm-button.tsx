"use client"

import * as React from "react"
import { Trash2, AlertTriangle, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createPortal } from "react-dom"

interface DeleteConfirmButtonProps {
  action: () => Promise<void>
  itemName?: string
}

export function DeleteConfirmButton({ action, itemName }: DeleteConfirmButtonProps) {
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => { setMounted(true) }, [])

  // Close on Escape
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  async function handleConfirm() {
    setPending(true)
    try {
      await action()
    } finally {
      setPending(false)
      setOpen(false)
    }
  }

  const dialog = open && mounted
    ? createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => !pending && setOpen(false)}
          />

          {/* Dialog */}
          <div className="relative z-10 w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 fade-in duration-150">
            {/* Header */}
            <div className="flex items-start justify-between p-5 pb-0">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                </div>
                <div>
                  <h3 className="font-semibold text-base">تأكيد الحذف</h3>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {itemName ? `"${itemName}"` : "هذا العنصر"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="rounded-full p-1.5 hover:bg-muted transition-colors text-muted-foreground disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 pt-3 pb-2">
              <p className="text-sm text-muted-foreground">
                لا يمكن التراجع عن هذا الإجراء. هل أنت متأكد من الحذف؟
              </p>
            </div>

            {/* Footer */}
            <div className="flex gap-2 p-4 pt-3 justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                إلغاء
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleConfirm}
                disabled={pending}
                className="min-w-[80px]"
              >
                {pending ? (
                  <span className="flex items-center gap-1.5">
                    <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    جارٍ الحذف...
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <Trash2 className="h-3.5 w-3.5" />
                    حذف
                  </span>
                )}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )
    : null

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-destructive hover:bg-destructive/10"
        title="حذف"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>

      {dialog}
    </>
  )
}
