'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import { hashPin } from '@/lib/auth/pin'
import { revalidatePath } from 'next/cache'
import crypto from 'crypto'
import { headers } from 'next/headers'

export async function saveEmployee(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const adminClient = createAdminClient()

  // Only super admins may create or edit employees.
  const { data: me } = await adminClient
    .from('employees')
    .select('is_super_admin')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (!me?.is_super_admin) {
    return { error: 'غير مصرح: هذه العملية متاحة لمدير النظام فقط' }
  }
  
  const id = formData.get('id') as string | null
  const full_name = formData.get('full_name') as string
  const username = formData.get('username') as string
  const role = formData.get('role') as string || 'standard'
  const is_active = formData.get('is_active') === 'true'
  const can_approve = formData.get('can_approve') === 'true'
  const is_super_admin = formData.get('is_super_admin') === 'true'
  const has_custody_access = formData.get('has_custody_access') === 'true'
  const pin = formData.get('pin') as string
  
  try {
    const ip = (await headers()).get('x-forwarded-for') || 'unknown'

    if (!id) {
      // Check if username exists in employees table first (better UX than waiting for auth error)
      const { data: existing } = await adminClient.from('employees').select('id').eq('username', username).maybeSingle()
      if (existing) {
        return { error: 'اسم المستخدم مستخدم بالفعل. الرجاء اختيار اسم آخر.' }
      }

      let authUserId: string;

      // Create new auth user
      const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
        email: `${username}@megamaf.local`,
        password: crypto.randomUUID(),
        email_confirm: true
      })
      
      if (authError) {
        if (authError.message.includes('already been registered')) {
          // Orphaned auth user exists because it's not in the employees table
          const { data: usersData } = await adminClient.auth.admin.listUsers()
          const orphaned = usersData.users.find(u => u.email === `${username}@megamaf.local`)
          if (orphaned) {
            authUserId = orphaned.id
          } else {
            return { error: 'اسم المستخدم مستخدم بالفعل. الرجاء اختيار اسم آخر.' }
          }
        } else {
          return { error: authError.message }
        }
      } else {
        authUserId = authUser.user.id
      }
      
      const pin_hash = pin ? await hashPin(pin) : null
      
      const { data: emp, error } = await adminClient.from('employees').insert({
        full_name,
        username,
        role,
        is_active,
        can_approve,
        is_super_admin,
        has_custody_access,
        auth_user_id: authUserId
      }).select().single()
      
      if (error) return { error: error.message }
      
      // Create secret record
      const { error: secretError } = await adminClient.from('employee_secrets').insert({
        employee_id: emp.id,
        pin_hash
      })
      if (secretError) return { error: secretError.message }

      // Assign projects
      const project_ids_str = formData.get('project_ids') as string;
      if (project_ids_str) {
        const project_ids = project_ids_str.split(',');
        if (project_ids.length > 0) {
          await adminClient.from('employee_project_access').insert(
            project_ids.map(pid => ({ employee_id: emp.id, project_id: pid }))
          );
        }
      }
      
      // Get current employee ID for audit
      const { data: currentEmp } = await adminClient.from('employees').select('id').eq('auth_user_id', user.id).maybeSingle()
      
      await logAudit({ 
        employee_id: currentEmp?.id,
        action: 'create', 
        entity_type: 'employee', 
        entity_id: emp.id, 
        after: emp,
        ip 
      })
    } else {
      // Update
      const payload: any = { full_name, username, role, is_active, can_approve, is_super_admin, has_custody_access }
      if (pin) {
        const pin_hash = await hashPin(pin)
        await adminClient.from('employee_secrets')
          .update({ pin_hash })
          .eq('employee_id', id)
      }
      
      const { data: oldEmp } = await adminClient.from('employees').select('*').eq('id', id).maybeSingle()
      const { error } = await adminClient.from('employees').update(payload).eq('id', id)
      if (error) return { error: error.message }
      
      const { data: currentEmp } = await adminClient.from('employees').select('id').eq('auth_user_id', user.id).maybeSingle()
      
      await logAudit({ 
        employee_id: currentEmp?.id,
        action: 'update', 
        entity_type: 'employee', 
        entity_id: id, 
        before: oldEmp, 
        after: payload,
        ip 
      })
    }
    
    revalidatePath('/employees')
    return { success: true }
  } catch (e: any) {
    return { error: e.message || JSON.stringify(e) }
  }
}
