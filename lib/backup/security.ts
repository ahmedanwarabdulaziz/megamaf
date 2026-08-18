import { createHash, randomBytes } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const BACKUP_AGENT_VERSION = '1.0.0'
export const PAIRING_TTL_MINUTES = 15

export function hashBackupSecret(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
export function createAgentToken() {
  return randomBytes(32).toString('base64url')
}

export function createPairingCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(16)
  const characters = Array.from(bytes, (byte) => alphabet[byte % alphabet.length])
  return characters.join('').match(/.{1,4}/g)!.join('-')
}

export function normalizePairingCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z2-9]/g, '')
}

export function bearerToken(request: Request) {
  const authorization = request.headers.get('authorization') ?? ''
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() ?? null
}

export function isSameOrigin(request: Request) {
  const origin = request.headers.get('origin')
  if (!origin) return true
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  const protocol = request.headers.get('x-forwarded-proto') ?? 'https'
  if (!host) return false
  try {
    return new URL(origin).origin === `${protocol}://${host}`
  } catch {
    return false
  }
}

export async function getSuperAdminContext() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const admin = createAdminClient()
  const { data: employee } = await admin
    .from('employees')
    .select('id, full_name, is_super_admin, is_active')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (!employee?.is_super_admin || employee.is_active === false) return null
  return { user, employee, admin }
}

export async function authenticateBackupDevice(request: Request) {
  const token = bearerToken(request)
  if (!token || token.length < 32 || token.length > 256) return null

  const admin = createAdminClient()
  const { data: device } = await admin
    .from('backup_devices')
    .select('id, name, status, is_primary')
    .eq('agent_token_hash', hashBackupSecret(token))
    .eq('status', 'active')
    .maybeSingle()

  if (!device) return null
  return { token, device, admin }
}

export function cleanText(value: unknown, maximum: number) {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return cleaned ? cleaned.slice(0, maximum) : null
}
