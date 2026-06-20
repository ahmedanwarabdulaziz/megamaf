"use client"

import * as React from "react"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { editEmployee } from "@/app/(app)/employees/actions"
import { ShieldCheck, Package, BadgeCheck } from "lucide-react"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جاري الحفظ..." : "حفظ التغييرات"}
    </Button>
  )
}

export function EditEmployeeModal({
  employees,
  projects,
  employeeProjectAccess,
}: {
  employees: any[]
  projects: { id: string; name: string }[]
  employeeProjectAccess: { employee_id: string; project_id: string }[]
}) {
  const [state, formAction] = useActionState(editEmployee as any, { error: "", success: false })
  const formRef = React.useRef<HTMLFormElement>(null)
  const [selectedEmployee, setSelectedEmployee] = React.useState<any>(null)
  const [isSuperAdmin, setIsSuperAdmin] = React.useState(false)
  const [canHaveCustody, setCanHaveCustody] = React.useState(false)
  const [canApproveCustodies, setCanApproveCustodies] = React.useState(false)
  const lastEmpIdRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const empId = params.get("edit_employee")
    if (empId && empId !== lastEmpIdRef.current) {
      lastEmpIdRef.current = empId
      const found = employees.find(e => e.id === empId)
      setSelectedEmployee(found || null)
      setIsSuperAdmin(found?.is_super_admin || false)
      setCanHaveCustody(found?.can_have_custody || false)
      setCanApproveCustodies(found?.can_approve_custodies || false)
    } else if (!empId) {
      lastEmpIdRef.current = null
    }
  })

  React.useEffect(() => {
    if (state?.success) {
      const url = new URL(window.location.href)
      url.searchParams.delete("modal")
      url.searchParams.delete("edit_employee")
      window.history.pushState({}, "", url)
      formRef.current?.reset()
    }
  }, [state])

  const allowedProjectIds = React.useMemo(() => {
    if (!selectedEmployee) return new Set<string>()
    return new Set(
      employeeProjectAccess
        .filter(a => a.employee_id === selectedEmployee.id)
        .map(a => a.project_id)
    )
  }, [selectedEmployee, employeeProjectAccess])

  return (
    <Modal name="edit-employee" title="تعديل موظف" description="قم بتعديل تفاصيل الموظف.">
      <form action={formAction} ref={formRef} className="flex flex-col gap-4 mt-4">
        <input type="hidden" name="id" value={selectedEmployee?.id || ""} />

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="ee-name">الاسم الكامل</label>
          <Input id="ee-name" name="name" defaultValue={selectedEmployee?.name || ""} required />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="ee-job">المسمى الوظيفي</label>
          <Input id="ee-job" name="job_title" defaultValue={selectedEmployee?.job_title || ""} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="ee-phone">رقم الهاتف</label>
            <Input id="ee-phone" name="phone" defaultValue={selectedEmployee?.phone || ""} inputMode="tel" />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="ee-email">البريد الإلكتروني</label>
            <Input id="ee-email" name="email" type="email" defaultValue={selectedEmployee?.email || ""} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="ee-salary">الراتب (شهري)</label>
            <Input id="ee-salary" name="salary" type="number" step="0.01" inputMode="decimal" defaultValue={selectedEmployee?.salary ?? ""} />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="ee-hire">تاريخ التعيين</label>
            <Input id="ee-hire" name="hire_date" type="date" defaultValue={selectedEmployee?.hire_date || ""} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="ee-status">الحالة</label>
          <select id="ee-status" name="status"
            defaultValue={selectedEmployee?.status || "active"}
            key={selectedEmployee?.id + "-status"}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <option value="active">نشط</option>
            <option value="inactive">غير نشط</option>
          </select>
        </div>

        {/* Super Admin Toggle */}
        <div className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${isSuperAdmin ? "bg-amber-500/10 border-amber-500/30" : "bg-muted/40 border-border"}`}>
          <input type="checkbox" id="ee-super-admin" name="is_super_admin"
            checked={isSuperAdmin} onChange={e => setIsSuperAdmin(e.target.checked)}
            className="h-4 w-4 accent-amber-500" />
          <div className="flex items-center gap-2">
            <ShieldCheck className={`h-4 w-4 ${isSuperAdmin ? "text-amber-500" : "text-muted-foreground"}`} />
            <label htmlFor="ee-super-admin" className="text-sm font-medium cursor-pointer">
              سوبر أدمن — صلاحية الوصول لجميع المشروعات
            </label>
          </div>
        </div>

        {/* Can Have Custody Toggle */}
        <div className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${canHaveCustody ? "bg-blue-500/10 border-blue-500/30" : "bg-muted/40 border-border"}`}>
          <input type="checkbox" id="ee-custody" name="can_have_custody"
            checked={canHaveCustody} onChange={e => setCanHaveCustody(e.target.checked)}
            className="h-4 w-4 accent-blue-500" />
          <div className="flex items-center gap-2">
            <Package className={`h-4 w-4 ${canHaveCustody ? "text-blue-500" : "text-muted-foreground"}`} />
            <label htmlFor="ee-custody" className="text-sm font-medium cursor-pointer">
              مسموح له بالعهد — يمكنه استلام وتسجيل عهد
            </label>
          </div>
        </div>

        {/* Can Approve Custodies Toggle */}
        <div className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${canApproveCustodies ? "bg-violet-500/10 border-violet-500/30" : "bg-muted/40 border-border"}`}>
          <input type="checkbox" id="ee-approve" name="can_approve_custodies"
            checked={canApproveCustodies} onChange={e => setCanApproveCustodies(e.target.checked)}
            className="h-4 w-4 accent-violet-500" />
          <div className="flex items-center gap-2">
            <BadgeCheck className={`h-4 w-4 ${canApproveCustodies ? "text-violet-500" : "text-muted-foreground"}`} />
            <label htmlFor="ee-approve" className="text-sm font-medium cursor-pointer">
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
                  <input type="checkbox" name="project_ids" value={project.id}
                    defaultChecked={allowedProjectIds.has(project.id)}
                    key={`${selectedEmployee?.id}-${project.id}`}
                    className="h-4 w-4 accent-primary" />
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
