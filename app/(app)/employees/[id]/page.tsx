import { createClient } from '@/lib/supabase/server'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { togglePageAccess, toggleProjectAccess } from './actions'
import { PasskeyEnrollButton } from './_components/passkey-enroll-button'
import { ToggleList } from './_components/toggle-list'
import { EditEmployeeForm } from './_components/edit-employee-form'
import { EMPLOYEE_PAGES } from '@/lib/page-access'
import { redirect } from 'next/navigation'
import { generateRegistration, verifyAndSaveRegistration } from './passkey-actions'
import { requirePageAccess } from '@/lib/require-page-access'
import {
  ShieldCheck, ShieldOff, CheckCircle2, XCircle, BadgeCheck,
  Wallet, Users, Settings, FolderKanban, Landmark, Package,
  Briefcase, ClipboardList, FileText, Building2, Lock, Unlock,
  Star, UserCheck, UserX,
} from 'lucide-react'

// ── Visual flag badge ──────────────────────────────────────────────────────────
function FlagBadge({
  label,
  active,
  icon: Icon,
  activeClass = 'bg-emerald-50 border-emerald-300 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-700 dark:text-emerald-400',
  inactiveClass = 'bg-muted/40 border-muted-foreground/20 text-muted-foreground',
}: {
  label: string
  active: boolean
  icon: React.ElementType
  activeClass?: string
  inactiveClass?: string
}) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
        active ? activeClass : inactiveClass
      }`}
    >
      {active ? (
        <CheckCircle2 className="w-4 h-4 shrink-0" />
      ) : (
        <XCircle className="w-4 h-4 shrink-0 opacity-50" />
      )}
      <Icon className="w-4 h-4 shrink-0" />
      <span>{label}</span>
    </div>
  )
}

// ── Page slug → icon map ───────────────────────────────────────────────────────
const PAGE_ICONS: Record<string, React.ElementType> = {
  projects: FolderKanban,
  banks: Landmark,
  deposits: Wallet,
  'treasury/custody': Building2,
  expenses: Briefcase,
  vendors: Users,
  claims: ClipboardList,
  inventory: Package,
  employees: UserCheck,
  settings: Settings,
}

export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const id = (await params).id

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: employee } = await supabase
    .from('employees')
    .select('*')
    .eq('id', id)
    .single()
  if (!employee) return <div className="p-4 text-muted-foreground">موظف غير موجود</div>

  const isCurrentUser = employee.auth_user_id === user.id

  const { data: viewer } = await supabase
    .from('employees')
    .select('is_super_admin')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  const isSuperAdmin = !!viewer?.is_super_admin

  // Non-super-admins can only view their own profile
  if (!isSuperAdmin && !isCurrentUser) redirect('/?access_denied=1')

  const [{ data: pageAccess }, { data: projectAccess }, { data: allProjects }] = await Promise.all([
    supabase.from('employee_page_access').select('page_slug').eq('employee_id', id),
    supabase.from('employee_project_access').select('project_id').eq('employee_id', id),
    supabase.from('projects').select('id, name').order('sort_order'),
  ])

  const grantedPages = pageAccess?.map((p) => p.page_slug) || []
  const grantedProjects = projectAccess?.map((p) => p.project_id) || []
  const projectItems = (allProjects || []).map((p) => ({ key: p.id, name: p.name }))
  const grantedProjectNames = projectItems.filter(p => grantedProjects.includes(p.key)).map(p => p.name)

  return (
    <div className="space-y-6 p-4 max-w-4xl mx-auto">
      {/* ── Header ── */}
      <div className="flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold truncate">{employee.full_name}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            اسم المستخدم: <span className="font-mono font-medium text-foreground">{employee.username}</span>
          </p>
        </div>
        {/* Active status pill */}
        <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${
          employee.is_active
            ? 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-700'
            : 'bg-destructive/10 text-destructive border-destructive/30'
        }`}>
          {employee.is_active ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
          {employee.is_active ? 'حساب نشط' : 'حساب موقوف'}
        </span>
      </div>

      {/* ── Passkey (own profile) ── */}
      {isCurrentUser && (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="w-4 h-4 text-primary" />
              الأمان وتسجيل الدخول
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              يمكنك ربط جهازك الحالي (بصمة الوجه أو الإصبع) لتسجيل الدخول السريع لاحقاً بدون كلمة مرور.
            </p>
            <PasskeyEnrollButton
              employeeId={employee.id}
              username={employee.username}
              generateOptions={generateRegistration}
              verifyRegistration={verifyAndSaveRegistration}
            />
          </CardContent>
        </Card>
      )}

      {/* ── Permissions Overview (visible to everyone who can see this page) ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BadgeCheck className="w-4 h-4 text-primary" />
            الصلاحيات الحالية
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">

          {/* System flags */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              صلاحيات النظام
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <FlagBadge
                label="مدير نظام — صلاحيات كاملة"
                active={!!employee.is_super_admin}
                icon={Star}
                activeClass="bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-950/30 dark:border-amber-700 dark:text-amber-400"
              />
              <FlagBadge
                label="يمكنه اعتماد الطلبات"
                active={!!employee.can_approve}
                icon={BadgeCheck}
              />
              <FlagBadge
                label="صلاحية استلام عهدة وتسجيل مصروفات"
                active={!!employee.has_custody_access}
                icon={Wallet}
                activeClass="bg-blue-50 border-blue-300 text-blue-700 dark:bg-blue-950/30 dark:border-blue-700 dark:text-blue-400"
              />
              <FlagBadge
                label={employee.role === 'owner' ? 'المالك / المدير العام' : 'موظف (standard)'}
                active={employee.role === 'owner'}
                icon={employee.role === 'owner' ? UserCheck : UserX}
              />
            </div>
          </div>

          {/* Page access */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              صلاحيات الصفحات
              {employee.is_super_admin && (
                <span className="mr-2 normal-case text-amber-600 font-normal">(مدير النظام — وصول كامل تلقائياً)</span>
              )}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {EMPLOYEE_PAGES.map((page) => {
                const Icon = PAGE_ICONS[page.slug] || Settings
                const hasAccess = employee.is_super_admin || grantedPages.includes(page.slug)
                return (
                  <FlagBadge
                    key={page.slug}
                    label={page.name}
                    active={hasAccess}
                    icon={Icon}
                  />
                )
              })}
            </div>
          </div>

          {/* Project access */}
          {!employee.is_super_admin && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                المشاريع المصرح بها
              </p>
              {grantedProjectNames.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">لم يُخصَّص أي مشروع لهذا الموظف.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {grantedProjectNames.map((name) => (
                    <span
                      key={name}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20"
                    >
                      <FolderKanban className="w-3 h-3" />
                      {name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          {employee.is_super_admin && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">المشاريع المصرح بها</p>
              <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">مدير النظام — وصول تلقائي لجميع المشاريع</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Edit section (super-admin only) ── */}
      {isSuperAdmin ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">تعديل بيانات الموظف</CardTitle>
            </CardHeader>
            <CardContent>
              <EditEmployeeForm employee={employee} />
            </CardContent>
          </Card>

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Settings className="w-4 h-4 text-primary" />
                  صلاحيات الصفحات
                </CardTitle>
              </CardHeader>
              <CardContent>
                {employee.is_super_admin ? (
                  <p className="text-sm text-amber-600 dark:text-amber-400 font-medium py-2">
                    مدير النظام — له وصول كامل لجميع الصفحات تلقائياً. لا حاجة لتفعيل الصلاحيات يدوياً.
                  </p>
                ) : (
                  <ToggleList
                    employeeId={id}
                    items={EMPLOYEE_PAGES.map((p) => ({ key: p.slug, name: p.name }))}
                    granted={grantedPages}
                    action={togglePageAccess}
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FolderKanban className="w-4 h-4 text-primary" />
                  صلاحيات المشاريع
                </CardTitle>
              </CardHeader>
              <CardContent>
                {employee.is_super_admin ? (
                  <p className="text-sm text-amber-600 dark:text-amber-400 font-medium py-2">
                    مدير النظام — له وصول تلقائي لجميع المشاريع.
                  </p>
                ) : (
                  <ToggleList
                    employeeId={id}
                    items={projectItems}
                    granted={grantedProjects}
                    action={toggleProjectAccess}
                    emptyText="لا توجد مشاريع بعد"
                  />
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground border rounded-lg p-4 bg-muted/30">
          تعديل البيانات والصلاحيات متاح لمدير النظام فقط.
        </p>
      )}
    </div>
  )
}
