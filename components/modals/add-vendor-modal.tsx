"use client"

import * as React from "react"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { addVendor } from "@/app/(app)/vendors/actions"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جاري الحفظ..." : "إضافة مورد / مقاول"}
    </Button>
  )
}

export function AddVendorModal({ projects }: { projects: { id: string; name: string }[] }) {
  const [state, formAction] = useActionState(addVendor as any, { error: "", success: false })
  const formRef = React.useRef<HTMLFormElement>(null)

  React.useEffect(() => {
    if (state?.success) {
      const url = new URL(window.location.href)
      url.searchParams.delete("modal")
      window.history.pushState({}, "", url)
      formRef.current?.reset()
    }
  }, [state])

  return (
    <Modal name="add-vendor" title="إضافة مورد / مقاول" description="أدخل بيانات المورد أو المقاول الجديد.">
      <form action={formAction} ref={formRef} className="flex flex-col gap-4 mt-4">

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="av-name">الاسم</label>
          <Input id="av-name" name="name" placeholder="اسم الشركة أو الشخص" required />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="av-type">النوع</label>
            <select id="av-type" name="type" defaultValue="both"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="supplier">مورد</option>
              <option value="contractor">مقاول</option>
              <option value="both">مورد ومقاول</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="av-tax">الرقم الضريبي</label>
            <Input id="av-tax" name="tax_number" placeholder="اختياري" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="av-phone">رقم الهاتف</label>
            <Input id="av-phone" name="phone" placeholder="01xxxxxxxxx" inputMode="tel" />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="av-email">البريد الإلكتروني</label>
            <Input id="av-email" name="email" type="email" placeholder="example@mail.com" />
          </div>
        </div>

        {/* Project Access */}
        {projects.length > 0 && (
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">المشروعات المرتبطة</label>
            <div className="rounded-lg border border-input bg-background p-3 flex flex-col gap-2 max-h-48 overflow-y-auto">
              {projects.map(project => (
                <label key={project.id} className="flex items-center gap-2 text-sm cursor-pointer hover:text-foreground text-muted-foreground">
                  <input type="checkbox" name="project_ids" value={project.id} className="h-4 w-4 accent-primary" />
                  {project.name}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">اختر المشروعات التي يعمل بها هذا المورد.</p>
          </div>
        )}

        {projects.length === 0 && (
          <p className="text-sm text-muted-foreground bg-muted/40 p-3 rounded-lg">
            لا توجد مشروعات بعد.
          </p>
        )}

        {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

        <div className="flex justify-end gap-2 mt-2">
          <SubmitButton />
        </div>
      </form>
    </Modal>
  )
}
