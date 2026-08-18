import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  cleanText,
  createAgentToken,
  hashBackupSecret,
  normalizePairingCode,
} from '@/lib/backup/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return response({ error: 'Invalid request' }, 400)
  }

  const pairingCode = normalizePairingCode(String(body.code ?? ''))
  const name = cleanText(body.name, 80)
  if (pairingCode.length !== 16 || !name) {
    return response({ error: 'Invalid pairing code or computer name' }, 400)
  }

  const token = createAgentToken()
  const capabilities = sanitizeCapabilities(body.capabilities)
  const admin = createAdminClient()
  const { data: deviceId, error } = await admin.rpc('register_backup_device', {
    p_code_hash: hashBackupSecret(pairingCode),
    p_token_hash: hashBackupSecret(token),
    p_name: name,
    p_hostname: cleanText(body.hostname, 255),
    p_platform: cleanText(body.platform, 255),
    p_agent_version: cleanText(body.agentVersion, 80),
    p_backup_path: cleanText(body.backupPath, 1000),
    p_capabilities: capabilities,
  })

  if (error || !deviceId) {
    if (error && !error.message.includes('invalid_or_expired_pairing')) {
      console.error('Backup device pairing failed', error)
    }
    return response({ error: 'Pairing code is invalid, expired, or already used' }, 409)
  }

  return response({ deviceId, token, pollIntervalSeconds: 60 }, 201)
}
function sanitizeCapabilities(value: unknown) {
  const capabilities = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    database: capabilities.database === true,
    r2: capabilities.r2 === true,
    source: capabilities.source !== false,
  }
}

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}
