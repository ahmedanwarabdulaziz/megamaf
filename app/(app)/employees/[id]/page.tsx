import { createClient } from '@/lib/supabase/server'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { togglePageAccess, toggleProjectAccess } from './actions'
import { PasskeyEnrollButton } from './_components/passkey-enroll-button'
import { ToggleList } from './_components/toggle-list'
import { EditEmployeeForm } from './_components/edit-employee-form'
import { EMPLOYEE_PAGES } from '@/lib/page-access'
import { redirect } from 'next/navigation'
import { generateRegistration, verifyAndSaveRegistration } from './passkey-actions'

export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const id = (await params).id

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: employee } = await supabase.from('employees').select('*').eq('id', id).single()
  if (!employee) return <div className="p-4">موظف غير موجود</div>

  const isCurrentUser = employee.auth_user_id === user.id

  const { data: viewer } = await supabase
    .from('employees')
    .select('is_super_admin')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  const isSuperAdmin = !!viewer?.is_super_admin

  const [{ data: pageAccess }, { data: projectAccess }, { data: allProjects }] = await Promise.all([
    supabase.from('employee_page_access').select('page_slug').eq('employee_id', id),
    supabase.from('employee_project_access').select('project_id').eq('employee_id', id),
    supabase.from('projects').select('id, name').order('sort_order'),
  ])

  const grantedPages = pageAccess?.map((p) => p.page_slug) || []
  const grantedProjects = projectAccess?.map((p) => p.project_id) || []
  const projectItems = (allProjects || []).map((p) => ({ key: p.id, name: p.name }))

  return (
    <div className="space-y-6 p-4 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold">تفاصيل الموظف: {employee.full_name}</h1>

      {isCurrentUser && (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle>الأمان وتسجيل الدخول</CardTitle>
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

      {isSuperAdmin ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>تعديل بيانات الموظف</CardTitle>
            </CardHeader>
            <CardContent>
              <EditEmployeeForm employee={employee} />
            </CardContent>
          </Card>

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>صلاحيات الصفحات</CardTitle>
              </CardHeader>
              <CardContent>
                <ToggleList
                  employeeId={id}
                  items={EMPLOYEE_PAGES.map((p) => ({ key: p.slug, name: p.name }))}
                  granted={grantedPages}
                  action={togglePageAccess}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>صلاحيات المشاريع</CardTitle>
              </CardHeader>
              <CardContent>
                <ToggleList
                  employeeId={id}
                  items={projectItems}
                  granted={grantedProjects}
                  action={toggleProjectAccess}
                  emptyText="لا توجد مشاريع بعد"
                />
              </CardContent>
            </Card>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">تعديل البيانات والصلاحيات متاح لمدير النظام فقط.</p>
      )}
    </div>
  )
}
