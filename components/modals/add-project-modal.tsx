"use client"

import * as React from "react"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { addProject } from "@/app/(app)/projects/actions"
import { Building2 } from "lucide-react"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جاري الحفظ..." : "إضافة مشروع"}
    </Button>
  )
}

export function AddProjectModal() {
  const [state, formAction] = useActionState(addProject as any, { error: "", success: false })
  const formRef = React.useRef<HTMLFormElement>(null)
  const [isCompanyBranch, setIsCompanyBranch] = React.useState(false)

  React.useEffect(() => {
    if (state?.success) {
      const url = new URL(window.location.href)
      url.searchParams.delete("modal")
      window.history.pushState({}, "", url)
      formRef.current?.reset()
      setIsCompanyBranch(false)
    }
  }, [state])

  return (
    <Modal name="add-project" title="إضافة مشروع" description="أدخل تفاصيل المشروع الجديد أو الفرع.">
      <form action={formAction} ref={formRef} className="flex flex-col gap-4 mt-4">

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="ap-name">اسم المشروع / الفرع</label>
          <Input id="ap-name" name="name" placeholder="مثال: مشروع البناء الجديد" required />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="ap-description">الوصف (اختياري)</label>
          <Input id="ap-description" name="description" placeholder="تفاصيل إضافية عن المشروع..." />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="ap-start-date">تاريخ البدء</label>
            <Input id="ap-start-date" name="start_date" type="date" />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="ap-end-date">تاريخ الانتهاء</label>
            <Input id="ap-end-date" name="end_date" type="date" />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="ap-budget">الميزانية المقدرة</label>
          <Input id="ap-budget" name="budget" type="number" step="0.01" inputMode="decimal" placeholder="0.00" />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="ap-status">الحالة</label>
          <select id="ap-status" name="status" defaultValue="active"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <option value="active">نشط</option>
            <option value="on_hold">قيد الانتظار</option>
            <option value="completed">مكتمل</option>
            <option value="cancelled">ملغى</option>
          </select>
        </div>

        {/* Company Branch Toggle */}
        <div className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${isCompanyBranch ? "bg-primary/10 border-primary/30" : "bg-muted/40 border-border"}`}>
          <input type="checkbox" id="ap-branch" name="is_company_branch"
            checked={isCompanyBranch} onChange={e => setIsCompanyBranch(e.target.checked)}
            className="h-4 w-4 accent-primary" />
          <div className="flex items-center gap-2">
            <Building2 className={`h-4 w-4 ${isCompanyBranch ? "text-primary" : "text-muted-foreground"}`} />
            <label htmlFor="ap-branch" className="text-sm font-medium cursor-pointer">
              هذا السجل يمثل فرعاً للشركة وليس مشروعاً مستقلاً
            </label>
          </div>
        </div>

        {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

        <div className="flex justify-end gap-2 mt-2">
          <SubmitButton />
        </div>
      </form>
    </Modal>
  )
}
