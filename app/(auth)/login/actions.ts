'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyPin, checkLockout } from '@/lib/auth/pin'
import { rotateSession } from '@/lib/auth/session'
import crypto from 'crypto'
import { logAudit } from '@/lib/audit'
import { headers } from 'next/headers'

export async function login(formData: FormData) {
  const adminClient = createAdminClient()
  const supabase = await createClient()

  const username = formData.get('username') as string
  const pin = formData.get('password') as string
  
  if (!username || !pin) {
    redirect(`/login?message=يرجى إدخال اسم المستخدم والرقم السري`)
  }

  // 1. Find employee
  const { data: employee } = await adminClient
    .from('employees')
    .select('id, auth_user_id, is_active')
    .eq('username', username)
    .limit(1)
    .maybeSingle()

  if (!employee || !employee.auth_user_id) {
    redirect(`/login?message=اسم المستخدم أو الرقم السري غير صحيح`)
  }

  if (employee.is_active === false) {
    redirect(`/login?message=هذا الحساب موقوف. يرجى التواصل مع مدير النظام`)
  }

  // 2. Find secrets
  const { data: secrets } = await adminClient
    .from('employee_secrets')
    .select('pin_hash, locked_until')
    .eq('employee_id', employee.id)
    .single()

  if (!secrets?.pin_hash) {
    redirect(`/login?message=اسم المستخدم أو الرقم السري غير صحيح`)
  }

  const { locked, unlockTime } = await checkLockout(secrets.locked_until)
  if (locked) {
    redirect(`/login?message=الحساب مقفل مؤقتاً. حاول مجدداً بعد ${unlockTime}`)
  }

  // 3. Verify PIN
  const isValid = await verifyPin(employee.id, username, pin, secrets.pin_hash)
  if (!isValid) {
    redirect(`/login?message=اسم المستخدم أو الرقم السري غير صحيح`)
  }

  // 4. PIN is valid — rotate underlying auth password and sign in
  const tempPassword = crypto.randomUUID()
  const { error: updateError } = await adminClient.auth.admin.updateUserById(employee.auth_user_id, {
    password: tempPassword,
  })
  
  if (updateError) {
    redirect(`/login?message=خطأ داخلي في المصادقة. يرجى المحاولة مرة أخرى`)
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: `${username}@megamaf.local`,
    password: tempPassword,
  })

  if (signInError) {
    redirect(`/login?message=فشل تسجيل الدخول. يرجى المحاولة مرة أخرى`)
  }

  // 5. Rotate session ID for single-session enforcement
  const ip = (await headers()).get('x-forwarded-for') || 'unknown'
  const userAgent = (await headers()).get('user-agent') || 'unknown'
  
  const newSessionId = crypto.randomUUID()
  await Promise.all([
    adminClient.from('user_sessions').insert({
      employee_id: employee.id,
      token_hash: newSessionId,
      device: userAgent,
      ip,
    }),
    adminClient.from('employees').update({ active_session_id: newSessionId }).eq('id', employee.id),
  ])
  // Clean up old sessions after establishing new one
  await adminClient.from('user_sessions').delete().eq('employee_id', employee.id).neq('token_hash', newSessionId)

  // 6. Audit
  await adminClient.from('audit_log').insert({
    employee_id: employee.id,
    action: 'login',
    entity_type: 'employee',
    entity_id: employee.id,
    ip,
  })

  revalidatePath('/', 'layout')
  redirect('/')
}

export async function logout() {
  const supabase = await createClient()
  
  const { data: { session } } = await supabase.auth.getSession()
  if (session) {
    const adminClient = createAdminClient()
    const { data: employee } = await adminClient.from('employees').select('id').eq('auth_user_id', session.user.id).single()
    
    if (employee) {
      await logAudit({
        employee_id: employee.id,
        action: 'logout',
        entity_type: 'employee',
        entity_id: employee.id,
        ip: (await headers()).get('x-forwarded-for') || 'unknown'
      })
      // Clear active session
      await Promise.all([
        adminClient.from('employees').update({ active_session_id: null }).eq('id', employee.id),
        adminClient.from('user_sessions').delete().eq('employee_id', employee.id),
      ])
    }
  }

  await supabase.auth.signOut()
  redirect('/login')
}

export async function changePassword(formData: FormData) {
  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({
    password: formData.get('password') as string,
  })
  if (error) {
    console.error('Change password error:', error)
  }
}
