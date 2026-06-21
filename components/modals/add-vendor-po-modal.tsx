"use client"

import * as React from "react"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useSearchParams } from "next/navigation"
import { addVendorPO } from "@/app/(app)/vendors/actions"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جاري الحفظ..." : "حفظ المطالبة"}
    </Button>
  )
}

export function AddVendorPOModal({
  vendors,
  projects,
  vendorProjectAccess
}: {
  vendors: any[]
  projects: { id: string; name: string }[]
  vendorProjectAccess: { vendor_id: string; project_id: string }[]
}) {
  const [state, formAction] = useActionState(addVendorPO as any, { error: "", success: false })
  const searchParams = useSearchParams()
  const vendorId = searchParams.get("vendor_id")
  const formRef = React.useRef<HTMLFormElement>(null)

  React.useEffect(() => {
    if (state?.success) {
      const url = new URL(window.location.href)
      url.searchParams.delete("modal")
      url.searchParams.delete("vendor_id")
      window.history.pushState({}, "", url)
      formRef.current?.reset()
    }
  }, [state])

  // Optional: Auto-select vendor if passed in URL
  const selectedVendor = vendors.find(v => v.id === vendorId)
  
  // Projects the selected vendor has access to
  const availableProjectIds = selectedVendor
    ? vendorProjectAccess.filter(a => a.vendor_id === selectedVendor.id).map(a => a.project_id)
    : projects.map(p => p.id)
    
  const availableProjects = projects.filter(p => availableProjectIds.includes(p.id))

  return (
    <Modal name="add-vendor-po" title="إضافة فاتورة / مطالبة (PO)" description="سجل قيمة المطالبة أو الفاتورة المستحقة للمورد.">
      <form action={formAction} ref={formRef} className="flex flex-col gap-4 mt-4">
        
        {selectedVendor ? (
          <input type="hidden" name="vendor_id" value={selectedVendor.id} />
        ) : (
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="po-vendor">المورد / المقاول</label>
            <select id="po-vendor" name="vendor_id" required
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="">اختر المورد...</option>
              {vendors.map(v => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="po-project">المشروع الخاص بالمطالبة</label>
          <select id="po-project" name="project_id" required
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <option value="">اختر المشروع...</option>
            {availableProjects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {availableProjects.length === 0 && (
            <p className="text-xs text-amber-600 mt-1">هذا المورد غير مرتبط بأي مشروع حالياً.</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="po-amount">قيمة المطالبة (EGP)</label>
          <Input id="po-amount" name="amount" type="number" step="0.01" inputMode="decimal" required placeholder="0.00" />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="po-desc">البيان / الوصف</label>
          <Input id="po-desc" name="description" required placeholder="مثال: فاتورة توريد أسمنت" />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="po-date">تاريخ المطالبة</label>
          <Input id="po-date" name="po_date" type="date" required defaultValue={new Date().toISOString().split("T")[0]} />
        </div>

        {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

        <div className="flex justify-end gap-2 mt-2">
          <SubmitButton />
        </div>
      </form>
    </Modal>
  )
}
