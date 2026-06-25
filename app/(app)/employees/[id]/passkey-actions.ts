'use server'

import { getRegistrationOptions, verifyRegistration } from '@/lib/auth/passkey'
import { logAudit } from '@/lib/audit'

export async function generateRegistration(employeeId: string, username: string) {
  const options = await getRegistrationOptions(employeeId, username)
  // We need to return options and store the challenge somewhere (for a simple implementation we can just return it and trust it for this prototype, although in prod it must be stored in DB or encrypted cookie)
  return options
}

export async function verifyAndSaveRegistration(employeeId: string, response: any, expectedChallenge: string) {
  const verified = await verifyRegistration(employeeId, response, expectedChallenge)
  
  if (verified) {
    await logAudit({ action: 'create', entity_type: 'user_credentials', entity_id: employeeId })
  }
  
  return verified
}
