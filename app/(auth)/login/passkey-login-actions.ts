'use server'

import { getAuthenticationOptions, verifyAuthentication } from '@/lib/auth/passkey'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { rotateSession } from '@/lib/auth/session'
import crypto from 'crypto'
import { logAudit } from '@/lib/audit'
import { headers } from 'next/headers'

export async function generateAuthOptions() {
  const options = await getAuthenticationOptions()
  return options
}

export async function verifyAndLogin(response: any, expectedChallenge: string) {
  const adminClient = createAdminClient()
  
  // The response contains the credential id
  const credentialId = response.id
  
  // Look up the employee_id from user_credentials
  const { data: credential } = await adminClient.from('user_credentials').select('employee_id').eq('credential_id', credentialId).single()
  
  if (!credential) {
    return { success: false, error: 'Credential not found' }
  }

  const employeeId = credential.employee_id
  
  // Verify with simplewebauthn
  const verified = await verifyAuthentication(response, expectedChallenge, credentialId)
  
  if (!verified) {
    return { success: false, error: 'Verification failed' }
  }
  
  // Success! Log the user in
  const { data: employee } = await adminClient.from('employees').select('id, auth_user_id, username').eq('id', employeeId).single()
  
  if (!employee) return { success: false, error: 'Employee not found' }
  
  // Rotate auth password for Supabase login
  const tempPassword = crypto.randomUUID()
  await adminClient.auth.admin.updateUserById(employee.auth_user_id, {
    password: tempPassword
  })
  
  const supabase = await createClient()
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: `${employee.username}@megamaf.local`,
    password: tempPassword,
  })
  
  if (signInError) {
    return { success: false, error: signInError.message }
  }
  
  const ip = (await headers()).get('x-forwarded-for') || 'unknown'
  const userAgent = (await headers()).get('user-agent') || 'unknown'
  await rotateSession(employee.id, userAgent, ip)
  
  await logAudit({
    employee_id: employee.id,
    action: 'login',
    entity_type: 'employee',
    entity_id: employee.id,
    ip
  })
  
  return { success: true }
}
