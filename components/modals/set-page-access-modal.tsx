"use client"

import * as React from "react"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { updateEmployeePageAccess } from "@/app/(app)/employees/actions"
import { LayoutGrid, ShieldCheck } from "lucide-react"

const ALL_PAGES = [
  { slug: "accounts", label: "الحسابات البنكية", description: "عرض وإدارة الحسابات البنكية" },
  { slug: "finance", label: "الشهادات والودائع", description: "عرض وإدارة الشهادات المالية" },
  { slug: "vendors", label: "الموردون والمقاولون", description: "عرض وإدارة الموردين والمقاولين" },
  { slug: "projects", label: "المشروعات", description: "عرض وإدارة مشروعات الشركة" },
  { slug: "employees", label: "الموظفون", description: "عرض وإدارة بيانات الموظفين" },
  { slug: "custodies", label: "العهد", description: "عرض وإدارة عهد الموظفين" },
]

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جاري الحفظ..." : "حفظ الصلاحيات"}
    </Button>
  )
}

export function SetPageAccessModal({
  employees,
  employeePageAccess,
}: {
  employees: any[]
  employeePageAccess: { employee_id: string; page_slug: string }[]
}) {
  const [state, formAction] = useActionState(updateEmployeePageAccess as any, { error: "", success: false })
  const formRef = React.useRef<HTMLFormElement>(null)
  const [selectedEmployee, setSelectedEmployee] = React.useState<any>(null)

  const lastEmpIdRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const empId = params.get("set_page_access")
    if (empId && empId !== lastEmpIdRef.current) {
      lastEmpIdRef.current = empId
      const found = employees.find(e => e.id === empId)
      setSelectedEmployee(found || null)
    } else if (!empId) {
      lastEmpIdRef.current = null
    }
  })

  React.useEffect(() => {
    if (state?.success) {
      const url = new URL(window.location.href)
      url.searchParams.delete("modal")
      url.searchParams.delete("set_page_access")
      window.history.pushState({}, "", url)
    }
  }, [state])

  const currentSlugs = React.useMemo(() => {
    if (!selectedEmployee) return new Set<string>()
    return new Set(
      employeePageAccess
        .filter(a => a.employee_id === selectedEmployee.id)
        .map(a => a.page_slug)
    )
  }, [selectedEmployee, employeePageAccess])

  const isSuperAdmin = selectedEmployee?.is_super_admin

  return (
    <Modal
      name="set-page-access"
      title="صلاحيات الصفحات"
      description={`تحديد الصفحات التي يمكن لـ ${selectedEmployee?.name || "الموظف"} الوصول إليها.`}
    >
      <form action={formAction} ref={formRef} className="flex flex-col gap-4 mt-4">
        <input type="hidden" name="employee_id" value={selectedEmployee?.id || ""} />

        {/* Employee info */}
        {selectedEmployee && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 border border-border">
            <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-sm shrink-0">
              {selectedEmployee.name?.charAt(0)}
            </div>
            <div>
              <p className="font-medium text-sm">{selectedEmployee.name}</p>
              <p className="text-xs text-muted-foreground">{selectedEmployee.job_title || "موظف"}</p>
            </div>
          </div>
        )}

        {/* Super admin note */}
        {isSuperAdmin ? (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-700">
            <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
            <span>هذا الموظف سوبر أدمن — يملك صلاحية الوصول لجميع الصفحات تلقائياً. لا حاجة لتحديد صفحات.</span>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm font-medium">
              <LayoutGrid className="h-4 w-4" />
              الصفحات المتاحة
            </div>

            <div className="flex flex-col gap-2">
              {ALL_PAGES.map(page => (
                <label
                  key={page.slug}
                  className="flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-muted/30 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    name="page_slugs"
                    value={page.slug}
                    defaultChecked={currentSlugs.has(page.slug)}
                    key={`${selectedEmployee?.id}-${page.slug}`}
                    className="h-4 w-4 mt-0.5 accent-primary"
                  />
                  <div>
                    <p className="text-sm font-medium">{page.label}</p>
                    <p className="text-xs text-muted-foreground">{page.description}</p>
                  </div>
                </label>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              الصفحات غير المحددة لن تظهر في قائمة التنقل الخاصة بالموظف.
            </p>
          </>
        )}

        {state?.error && (
          <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{state.error}</p>
        )}

        {!isSuperAdmin && (
          <div className="flex justify-end gap-2 mt-2">
            <SubmitButton />
          </div>
        )}
      </form>
    </Modal>
  )
}
