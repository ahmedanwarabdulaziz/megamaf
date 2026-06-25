'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import { revalidatePath } from 'next/cache'
import { saveEmployee } from '../actions'

// Only super admins may change another employee's permissions or data.
async function assertSuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('غير مصرح')
  const admin = createAdminClient()
  const { data: me } = await admin
    .from('employees')
    .select('is_super_admin')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (!me?.is_super_admin) throw new Error('غير مصرح: هذه العملية متاحة لمدير النظام فقط')
}

export async function togglePageAccess(employeeId: string, pageSlug: string, isGranted: boolean) {
  await assertSuperAdmin()
  const adminClient = createAdminClient()

  if (isGranted) {
    await adminClient.from('employee_page_access').insert({ employee_id: employeeId, page_slug: pageSlug })
    await logAudit({ action: 'create', entity_type: 'employee_page_access', entity_id: employeeId, after: { page_slug: pageSlug } })
  } else {
    await adminClient.from('employee_page_access').delete().match({ employee_id: employeeId, page_slug: pageSlug })
    await logAudit({ action: 'delete', entity_type: 'employee_page_access', entity_id: employeeId, before: { page_slug: pageSlug } })
  }

  revalidatePath(`/employees/${employeeId}`)
}

export async function toggleProjectAccess(employeeId: string, projectId: string, isGranted: boolean) {
  await assertSuperAdmin()
  const adminClient = createAdminClient()

  if (isGranted) {
    await adminClient.from('employee_project_access').insert({ employee_id: employeeId, project_id: projectId })
    await logAudit({ action: 'create', entity_type: 'employee_project_access', entity_id: employeeId, after: { project_id: projectId } })
  } else {
    await adminClient.from('employee_project_access').delete().match({ employee_id: employeeId, project_id: projectId })
    await logAudit({ action: 'delete', entity_type: 'employee_project_access', entity_id: employeeId, before: { project_id: projectId } })
  }

  revalidatePath(`/employees/${employeeId}`)
}

// Wrapper so the edit form can use useActionState(prevState, formData).
// saveEmployee handles the update path when an `id` is present.
export async function updateEmployeeAction(_prev: any, formData: FormData) {
  await assertSuperAdmin()
  const res = await saveEmployee(formData)
  const id = formData.get('id') as string
  if (id) revalidatePath(`/employees/${id}`)
  return res
}
