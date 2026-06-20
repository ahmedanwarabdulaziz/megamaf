"use client"

import * as React from "react"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { addEmployee } from "@/app/(app)/employees/actions"
import { ShieldCheck, Package, BadgeCheck } from "lucide-react"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جاري الحفظ..." : "إضافة موظف"}
    </Button>
  )
}

export function AddEmployeeModal({ projects }: { projects: { id: string; name: string }[] }) {
  const [state, formAction] = useActionState(addEmployee as any, { error: "", success: false })
  const formRef = React.useRef<HTMLFormElement>(null)
  const [isSuperAdmin, setIsSuperAdmin] = React.useState(false)
  const [canHaveCustody, setCanHaveCustody] = React.useState(false)
  const [canApproveCustodies, setCanApproveCustodies] = React.useState(false)

  React.useEffect(() => {
    if (state?.success) {
      const url = new URL(window.location.href)
      url.searchParams.delete("modal")
      window.history.pushState({}, "", url)
      formRef.current?.reset()
      setIsSuperAdmin(false)
      setCanHaveCustody(false)
      setCanApproveCustodies(false)
    }
  }, [state])

  return (
    <Modal name="add-employee" title="إضافة موظف" description="أدخل تفاصيل الموظف الجديد.">
      <form action={formAction} ref={formRef} className="flex flex-col gap-4 mt-4">

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="ae-name">الاسم الكامل</label>
          <Input id="ae-name" name="name" placeholder="مثال: أحمد محمد علي" required />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="ae-job">المسمى الوظيفي</label>
          <Input id="ae-job" name="job_title" placeholder="مثال: مهندس مدني" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="ae-phone">رقم الهاتف</label>
            <Input id="ae-phone" name="phone" placeholder="01xxxxxxxxx" inputMode="tel" />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="ae-email">البريد الإلكتروني</label>
            <Input id="ae-email" name="email" type="email" placeholder="example@mail.com" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="ae-salary">الراتب (شهري)</label>
            <Input id="ae-salary" name="salary" type="number" step="0.01" inputMode="decimal" placeholder="0.00" />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="ae-hire">تاريخ التعيين</label>
            <Input id="ae-hire" name="hire_date" type="date" />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="ae-status">الحالة</label>
          <select id="ae-status" name="status" defaultValue="active"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <option value="active">نشط</option>
            <option value="inactive">غير نشط</option>
          </select>
        </div>

        {/* Super Admin Toggle */}
        <div className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${isSuperAdmin ? "bg-amber-500/10 border-amber-500/30" : "bg-muted/40 border-border"}`}>
          <input type="checkbox" id="ae-super-admin" name="is_super_admin"
            checked={isSuperAdmin} onChange={e => setIsSuperAdmin(e.target.checked)}
            className="h-4 w-4 accent-amber-500" />
          <div className="flex items-center gap-2">
            <ShieldCheck className={`h-4 w-4 ${isSuperAdmin ? "text-amber-500" : "text-muted-foreground"}`} />
            <label htmlFor="ae-super-admin" className="text-sm font-medium cursor-pointer">
              سوبر أدمن — صلاحية الوصول لجميع المشروعات
            </label>
          </div>
        </div>

        {/* Can Have Custody Toggle */}
        <div className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${canHaveCustody ? "bg-blue-500/10 border-blue-500/30" : "bg-muted/40 border-border"}`}>
          <input type="checkbox" id="ae-custody" name="can_have_custody"
            checked={canHaveCustody} onChange={e => setCanHaveCustody(e.target.checked)}
            className="h-4 w-4 accent-blue-500" />
          <div className="flex items-center gap-2">
            <Package className={`h-4 w-4 ${canHaveCustody ? "text-blue-500" : "text-muted-foreground"}`} />
            <label htmlFor="ae-custody" className="text-sm font-medium cursor-pointer">
              مسموح له بالعهد — يمكنه استلام وتسجيل عهد
            </label>
          </div>
        </div>

        {/* Can Approve Custodies Toggle */}
        <div className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${canApproveCustodies ? "bg-violet-500/10 border-violet-500/30" : "bg-muted/40 border-border"}`}>
          <input type="checkbox" id="ae-approve" name="can_approve_custodies"
            checked={canApproveCustodies} onChange={e => setCanApproveCustodies(e.target.checked)}
            className="h-4 w-4 accent-violet-500" />
          <div className="flex items-center gap-2">
            <BadgeCheck className={`h-4 w-4 ${canApproveCustodies ? "text-violet-500" : "text-muted-foreground"}`} />
            <label htmlFor="ae-approve" className="text-sm font-medium cursor-pointer">
              مُعتمِد العهد — يمكنه اعتماد وإلغاء اعتماد العهد
            </label>
          </div>
        </div>

        {/* Project Access */}
        {!isSuperAdmin && projects.length > 0 && (
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">المشروعات المسموح بالوصول إليها</label>
            <div className="rounded-lg border border-input bg-background p-3 flex flex-col gap-2 max-h-48 overflow-y-auto">
              {projects.map(project => (
                <label key={project.id} className="flex items-center gap-2 text-sm cursor-pointer hover:text-foreground text-muted-foreground">
                  <input type="checkbox" name="project_ids" value={project.id} className="h-4 w-4 accent-primary" />
                  {project.name}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">اترك فارغاً إذا لم يكن للموظف صلاحية الوصول لأي مشروع بعد.</p>
          </div>
        )}

        {!isSuperAdmin && projects.length === 0 && (
          <p className="text-sm text-muted-foreground bg-muted/40 p-3 rounded-lg">
            لا توجد مشروعات بعد. أضف مشروعات أولاً لتتمكن من تحديد الوصول.
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
