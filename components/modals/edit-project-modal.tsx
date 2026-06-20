"use client"

import * as React from "react"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { editProject } from "@/app/(app)/projects/actions"
import { useSearchParams } from "next/navigation"
import { Building2 } from "lucide-react"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جاري الحفظ..." : "حفظ التعديلات"}
    </Button>
  )
}

export function EditProjectModal({ projects }: { projects: any[] }) {
  const [state, formAction] = useActionState(editProject as any, { error: "", success: false })
  const searchParams = useSearchParams()
  const editId = searchParams.get("edit_project")
  const projectToEdit = React.useMemo(() => projects.find(p => p.id === editId), [projects, editId])

  const [isCompanyBranch, setIsCompanyBranch] = React.useState(false)

  React.useEffect(() => {
    if (projectToEdit) {
      setIsCompanyBranch(!!projectToEdit.is_company_branch)
    }
  }, [projectToEdit])

  React.useEffect(() => {
    if (state?.success) {
      const url = new URL(window.location.href)
      url.searchParams.delete("modal")
      url.searchParams.delete("edit_project")
      window.history.pushState({}, "", url)
    }
  }, [state])

  if (!projectToEdit) return null

  return (
    <Modal name="edit-project" title="تعديل المشروع" description="قم بتحديث بيانات المشروع أو الفرع المختار.">
      <form action={formAction} className="flex flex-col gap-4 mt-4">
        <input type="hidden" name="id" value={projectToEdit.id} />

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="ep-name">اسم المشروع / الفرع</label>
          <Input id="ep-name" name="name" defaultValue={projectToEdit.name} required />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="ep-code">كود المشروع (اتركه فارغاً لعدم التغيير)</label>
          <Input id="ep-code" name="code" defaultValue={projectToEdit.code} />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="ep-description">الوصف (اختياري)</label>
          <Input id="ep-description" name="description" defaultValue={projectToEdit.description || ""} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="ep-start-date">تاريخ البدء</label>
            <Input id="ep-start-date" name="start_date" type="date" defaultValue={projectToEdit.start_date || ""} />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="ep-end-date">تاريخ الانتهاء</label>
            <Input id="ep-end-date" name="end_date" type="date" defaultValue={projectToEdit.end_date || ""} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="ep-budget">الميزانية المقدرة</label>
          <Input id="ep-budget" name="budget" type="number" step="0.01" inputMode="decimal" defaultValue={projectToEdit.budget || ""} />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="ep-status">الحالة</label>
          <select id="ep-status" name="status" defaultValue={projectToEdit.status || "active"}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <option value="active">نشط</option>
            <option value="on_hold">قيد الانتظار</option>
            <option value="completed">مكتمل</option>
            <option value="cancelled">ملغى</option>
          </select>
        </div>

        {/* Company Branch Toggle */}
        <div className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${isCompanyBranch ? "bg-primary/10 border-primary/30" : "bg-muted/40 border-border"}`}>
          <input type="checkbox" id="ep-branch" name="is_company_branch"
            checked={isCompanyBranch} onChange={e => setIsCompanyBranch(e.target.checked)}
            className="h-4 w-4 accent-primary" />
          <div className="flex items-center gap-2">
            <Building2 className={`h-4 w-4 ${isCompanyBranch ? "text-primary" : "text-muted-foreground"}`} />
            <label htmlFor="ep-branch" className="text-sm font-medium cursor-pointer">
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
