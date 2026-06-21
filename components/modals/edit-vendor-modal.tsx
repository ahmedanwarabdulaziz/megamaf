"use client"

import * as React from "react"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useSearchParams } from "next/navigation"
import { editVendor } from "@/app/(app)/vendors/actions"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جاري الحفظ..." : "حفظ التعديلات"}
    </Button>
  )
}

export function EditVendorModal({
  vendors,
  projects,
  vendorProjectAccess
}: {
  vendors: any[]
  projects: { id: string; name: string }[]
  vendorProjectAccess: { vendor_id: string; project_id: string }[]
}) {
  const [state, formAction] = useActionState(editVendor as any, { error: "", success: false })
  const searchParams = useSearchParams()
  const editId = searchParams.get("edit_vendor")
  const vendor = vendors.find(v => v.id === editId)

  React.useEffect(() => {
    if (state?.success) {
      const url = new URL(window.location.href)
      url.searchParams.delete("modal")
      url.searchParams.delete("edit_vendor")
      window.history.pushState({}, "", url)
    }
  }, [state])

  if (!vendor) return null

  const selectedProjectIds = vendorProjectAccess
    .filter(a => a.vendor_id === vendor.id)
    .map(a => a.project_id)

  return (
    <Modal name="edit-vendor" title="تعديل المورد / المقاول" description="تعديل بيانات المورد وتحديث المشروعات المرتبطة به.">
      <form action={formAction} className="flex flex-col gap-4 mt-4">
        <input type="hidden" name="id" value={vendor.id} />

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="ev-name">الاسم</label>
          <Input id="ev-name" name="name" defaultValue={vendor.name} required />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="ev-type">النوع</label>
            <select id="ev-type" name="type" defaultValue={vendor.type}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="supplier">مورد</option>
              <option value="contractor">مقاول</option>
              <option value="both">مورد ومقاول</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="ev-tax">الرقم الضريبي</label>
            <Input id="ev-tax" name="tax_number" defaultValue={vendor.tax_number || ""} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="ev-phone">رقم الهاتف</label>
            <Input id="ev-phone" name="phone" defaultValue={vendor.phone || ""} inputMode="tel" />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="ev-email">البريد الإلكتروني</label>
            <Input id="ev-email" name="email" type="email" defaultValue={vendor.email || ""} />
          </div>
        </div>

        {/* Project Access */}
        {projects.length > 0 && (
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">المشروعات المرتبطة</label>
            <div className="rounded-lg border border-input bg-background p-3 flex flex-col gap-2 max-h-48 overflow-y-auto">
              {projects.map(project => (
                <label key={project.id} className="flex items-center gap-2 text-sm cursor-pointer hover:text-foreground text-muted-foreground">
                  <input
                    type="checkbox"
                    name="project_ids"
                    value={project.id}
                    defaultChecked={selectedProjectIds.includes(project.id)}
                    className="h-4 w-4 accent-primary"
                  />
                  {project.name}
                </label>
              ))}
            </div>
          </div>
        )}

        {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

        <div className="flex justify-end gap-2 mt-2">
          <SubmitButton />
        </div>
      </form>
    </Modal>
  )
}
