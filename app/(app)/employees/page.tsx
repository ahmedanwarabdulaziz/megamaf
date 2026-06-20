import { createClient } from "@/lib/supabase/server"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Plus, UserCheck, Pencil, Trash2, Phone, Mail, Briefcase,
  Banknote, Calendar, ShieldCheck, FolderKanban, KeyRound, LayoutGrid,
  CheckCircle2, AlertCircle,
} from "lucide-react"
import Link from "next/link"
import { AddEmployeeModal } from "@/components/modals/add-employee-modal"
import { EditEmployeeModal } from "@/components/modals/edit-employee-modal"
import { SetCredentialsModal } from "@/components/modals/set-credentials-modal"
import { SetPageAccessModal } from "@/components/modals/set-page-access-modal"
import { deleteEmployee } from "./actions"

function formatDate(dateStr: string | null) {
  if (!dateStr) return null
  return new Date(dateStr).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" })
}

export default async function EmployeesPage() {
  const supabase = await createClient()

  const [
    { data: employees },
    { data: projects },
    { data: employeeProjectAccess },
    { data: employeePageAccess },
  ] = await Promise.all([
    supabase.from("employees").select("*").order("name", { ascending: true }),
    supabase.from("projects").select("id, name").order("name", { ascending: true }),
    supabase.from("employee_project_access").select("employee_id, project_id"),
    supabase.from("employee_page_access").select("employee_id, page_slug"),
  ])

  const safeEmployees = employees || []
  const safeProjects = projects || []
  const safeProjectAccess = employeeProjectAccess || []
  const safePageAccess = employeePageAccess || []

  const activeCount = safeEmployees.filter(e => e.status === "active").length
  const inactiveCount = safeEmployees.filter(e => e.status === "inactive").length
  const superAdminCount = safeEmployees.filter(e => e.is_super_admin).length
  const totalSalaries = safeEmployees
    .filter(e => e.status === "active" && e.salary)
    .reduce((sum, e) => sum + Number(e.salary), 0)

  const projectMap = Object.fromEntries(safeProjects.map(p => [p.id, p.name]))

  const PAGE_LABELS: Record<string, string> = {
    accounts: "الحسابات",
    finance: "الشهادات",
    vendors: "الموردون",
    projects: "المشروعات",
    employees: "الموظفون",
  }

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      {/* Header */}
      <div className="static md:sticky md:top-0 z-20 bg-background/95 backdrop-blur-md pb-4 border-b border-border -mx-4 px-4 -mt-4 pt-4 md:-mx-6 md:px-6 md:-mt-6 md:pt-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">الموظفون</h1>
          <p className="text-muted-foreground mt-2">إدارة موظفي الشركة، بيانات الدخول، وصلاحيات الصفحات.</p>
        </div>
        <Link href="?modal=add-employee" scroll={false}>
          <Button variant="default">
            <Plus className="mr-2 h-4 w-4" />
            إضافة موظف
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">الإجمالي</p>
            <p className="text-3xl font-bold">{safeEmployees.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">نشطون</p>
            <p className="text-3xl font-bold text-green-600">{activeCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">غير نشطين</p>
            <p className="text-3xl font-bold text-muted-foreground">{inactiveCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">سوبر أدمن</p>
            <p className="text-3xl font-bold text-amber-500">{superAdminCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Total Salaries */}
      {totalSalaries > 0 && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-4 flex items-center gap-3">
            <Banknote className="h-5 w-5 text-primary" />
            <span className="font-semibold text-primary">إجمالي الرواتب الشهرية (النشطون):</span>
            <span className="font-bold text-lg dir-ltr">
              {totalSalaries.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP
            </span>
          </CardContent>
        </Card>
      )}

      {/* Employees List */}
      {safeEmployees.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center border-dashed">
          <UserCheck className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-medium">لا يوجد موظفون بعد</h3>
          <p className="text-muted-foreground mt-2 max-w-sm">
            قم بإضافة أول موظف للشركة لبدء إدارة بياناتهم وصلاحياتهم.
          </p>
          <Link href="?modal=add-employee" scroll={false} className="mt-6">
            <Button>إضافة موظف جديد</Button>
          </Link>
        </Card>
      ) : (
        <div className="grid gap-4">
          {safeEmployees.map(employee => {
            const accessibleProjectNames = safeProjectAccess
              .filter(a => a.employee_id === employee.id)
              .map(a => projectMap[a.project_id])
              .filter(Boolean)

            const accessiblePageSlugs = safePageAccess
              .filter(a => a.employee_id === employee.id)
              .map(a => a.page_slug)

            const hasAccount = !!employee.auth_user_id

            return (
              <Card key={employee.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    {/* Avatar */}
                    <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 font-bold text-sm ${employee.is_super_admin ? "bg-amber-500/15 text-amber-600" : "bg-primary/10 text-primary"}`}>
                      {employee.name.charAt(0)}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      {/* Name + badges */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-base">{employee.name}</h3>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${employee.status === "active" ? "bg-green-500/10 text-green-600 border-green-500/20" : "bg-muted text-muted-foreground border-border"}`}>
                          {employee.status === "active" ? "نشط" : "غير نشط"}
                        </span>
                        {employee.is_super_admin && (
                          <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border bg-amber-500/10 text-amber-600 border-amber-500/20">
                            <ShieldCheck className="h-3 w-3" /> سوبر أدمن
                          </span>
                        )}
                        {/* Account status */}
                        {hasAccount ? (
                          <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border bg-blue-500/10 text-blue-600 border-blue-500/20">
                            <CheckCircle2 className="h-3 w-3" /> @{employee.username}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border bg-muted text-muted-foreground border-border">
                            <AlertCircle className="h-3 w-3" /> بدون حساب
                          </span>
                        )}
                      </div>

                      {/* Details */}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
                        {employee.job_title && (
                          <span className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Briefcase className="h-3.5 w-3.5" /> {employee.job_title}
                          </span>
                        )}
                        {employee.phone && (
                          <span className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Phone className="h-3.5 w-3.5" /> {employee.phone}
                          </span>
                        )}
                        {employee.email && (
                          <span className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Mail className="h-3.5 w-3.5" /> {employee.email}
                          </span>
                        )}
                        {employee.salary && (
                          <span className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Banknote className="h-3.5 w-3.5" /> {Number(employee.salary).toLocaleString("en-US")} EGP/شهر
                          </span>
                        )}
                        {employee.hire_date && (
                          <span className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Calendar className="h-3.5 w-3.5" /> {formatDate(employee.hire_date)}
                          </span>
                        )}
                      </div>

                      {/* Project access */}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {employee.is_super_admin ? (
                          <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/20">
                            <FolderKanban className="h-3 w-3" /> وصول كامل للمشروعات
                          </span>
                        ) : accessibleProjectNames.length > 0 ? (
                          accessibleProjectNames.map(name => (
                            <span key={name} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                              <FolderKanban className="h-3 w-3" /> {name}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground italic">لا توجد صلاحية وصول لأي مشروع</span>
                        )}
                      </div>

                      {/* Page access */}
                      {!employee.is_super_admin && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {accessiblePageSlugs.length > 0 ? (
                            accessiblePageSlugs.map(slug => (
                              <span key={slug} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground border border-border">
                                <LayoutGrid className="h-3 w-3" /> {PAGE_LABELS[slug] || slug}
                              </span>
                            ))
                          ) : (
                            hasAccount && (
                              <span className="text-xs text-muted-foreground italic">لا توجد صلاحية وصول لأي صفحة</span>
                            )
                          )}
                        </div>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-col gap-1 shrink-0">
                      {/* Edit employee */}
                      <Link href={`?modal=edit-employee&edit_employee=${employee.id}`} scroll={false}>
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="تعديل بيانات الموظف">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </Link>
                      {/* Set credentials */}
                      <Link href={`?modal=set-credentials&set_credentials=${employee.id}`} scroll={false}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-8 w-8 ${hasAccount ? "text-blue-600 hover:bg-blue-500/10" : "text-muted-foreground"}`}
                          title={hasAccount ? "إعادة تعيين كلمة المرور" : "إنشاء بيانات دخول"}
                        >
                          <KeyRound className="h-4 w-4" />
                        </Button>
                      </Link>
                      {/* Page access */}
                      <Link href={`?modal=set-page-access&set_page_access=${employee.id}`} scroll={false}>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" title="إدارة صلاحيات الصفحات">
                          <LayoutGrid className="h-4 w-4" />
                        </Button>
                      </Link>
                      {/* Delete */}
                      <form action={async () => { "use server"; await deleteEmployee(employee.id) }}>
                        <Button type="submit" variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" title="حذف الموظف">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </form>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Modals */}
      <AddEmployeeModal projects={safeProjects} />
      <EditEmployeeModal employees={safeEmployees} projects={safeProjects} employeeProjectAccess={safeProjectAccess} />
      <SetCredentialsModal employees={safeEmployees} />
      <SetPageAccessModal employees={safeEmployees} employeePageAccess={safePageAccess} />
    </div>
  )
}
