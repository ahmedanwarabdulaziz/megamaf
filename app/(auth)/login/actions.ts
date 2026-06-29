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
    redirect(`/login?message=Missing username or PIN`)
  }

  // 1. Find employee
  const { data: employee, error: empError } = await adminClient
    .from('employees')
    .select('id, auth_user_id')
    .eq('username', username)
    .limit(1)
    .maybeSingle()

  console.log('[LOGIN] Step 1 - employee lookup:', { found: !!employee, error: empError?.message })

  if (!employee) {
    redirect(`/login?message=DEBUG: No employee found for username "${username}"`)
  }
  if (!employee.auth_user_id) {
    redirect(`/login?message=DEBUG: Employee found but missing auth_user_id`)
  }

  // 2. Find secrets
  const { data: secrets, error: secError } = await adminClient
    .from('employee_secrets')
    .select('pin_hash, locked_until')
    .eq('employee_id', employee.id)
    .single()

  console.log('[LOGIN] Step 2 - secrets lookup:', { found: !!secrets, hasPinHash: !!secrets?.pin_hash, error: secError?.message })

  if (!secrets) {
    redirect(`/login?message=DEBUG: No secrets row found for employee_id ${employee.id}`)
  }
  if (!secrets.pin_hash) {
    redirect(`/login?message=DEBUG: Secrets found but pin_hash is empty`)
  }

  const { locked, unlockTime } = await checkLockout(secrets.locked_until)
  if (locked) {
    redirect(`/login?message=Account locked. Try again after ${unlockTime}`)
  }

  // 3. Verify PIN
  const isValid = await verifyPin(employee.id, username, pin, secrets.pin_hash)
  console.log('[LOGIN] Step 3 - PIN verify result:', isValid)
  if (!isValid) {
    redirect(`/login?message=DEBUG: PIN did not match hash (hash starts with: ${secrets.pin_hash.substring(0, 7)})`)
  }

  // 4. PIN is valid. Log in to Supabase by rotating their underlying auth password
  const tempPassword = crypto.randomUUID()
  
  console.log(`[LOGIN] Updating Auth password for user ${employee.auth_user_id}`)
  const { error: updateError } = await adminClient.auth.admin.updateUserById(employee.auth_user_id, {
    password: tempPassword
  })
  
  if (updateError) {
    console.error('[LOGIN] Failed to update underlying auth password', updateError)
    redirect(`/login?message=Internal auth error: ${updateError.message}`)
  }

  console.log(`[LOGIN] Signing in with Supabase Auth...`)
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: `${username}@megamaf.local`,
    password: tempPassword,
  })

  if (signInError) {
    console.error('[LOGIN] Failed to sign in via Supabase Auth', signInError)
    redirect(`/login?message=Login failed: ${signInError.message}`)
  }
  
  console.log(`[LOGIN] Success! Rotating session...`)

  // 5. Rotate session ID for single-session enforcement
  const ip = (await headers()).get('x-forwarded-for') || 'unknown'
  const userAgent = (await headers()).get('user-agent') || 'unknown'
  
  const newSessionId = crypto.randomUUID();
  await adminClient.from('user_sessions').insert({
    employee_id: employee.id,
    token_hash: newSessionId,
    device: userAgent,
    ip,
  });
  await adminClient.from('employees').update({ active_session_id: newSessionId }).eq('id', employee.id);
  await adminClient.from('user_sessions').delete().eq('employee_id', employee.id).neq('token_hash', newSessionId);

  // 6. Audit
  await adminClient.from('audit_log').insert({
    employee_id: employee.id,
    action: 'login',
    entity_type: 'employee',
    entity_id: employee.id,
    ip
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
      await adminClient.from('employees').update({ active_session_id: null }).eq('id', employee.id)
      await adminClient.from('user_sessions').delete().eq('employee_id', employee.id)
    }
  }

  await supabase.auth.signOut()
  redirect('/login')
}
