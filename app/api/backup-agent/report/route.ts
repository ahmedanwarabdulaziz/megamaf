import { NextResponse } from 'next/server'
import { authenticateBackupDevice, cleanText } from '@/lib/backup/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const context = await authenticateBackupDevice(request)
  if (!context) return response({ error: 'Unauthorized' }, 401)

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return response({ error: 'Invalid request' }, 400)
  }

  const jobId = uuid(body.jobId)
  const status = body.status === 'completed' ? 'completed' : body.status === 'failed' ? 'failed' : null
  if (!jobId || !status) return response({ error: 'Invalid job report' }, 400)

  const completedAt = new Date().toISOString()
  const update =
    status === 'completed'
      ? {
          status,
          completed_at: completedAt,
          archive_name: cleanText(body.archiveName, 255),
          archive_path: cleanText(body.archivePath, 1000),
          archive_bytes: safeNonNegativeInteger(body.archiveBytes),
          archive_sha256: sha256(body.archiveSha256),
          source_commit: commit(body.sourceCommit),
          agent_message: cleanText(body.message, 1000),
          error_message: null,
        }
      : {
          status,
          completed_at: completedAt,
          error_message: cleanText(body.error, 2000) ?? 'Backup failed on the assigned computer',
          agent_message: cleanText(body.message, 1000),
        }

  const { data: job, error } = await context.admin
    .from('backup_jobs')
    .update(update)
    .eq('id', jobId)
    .eq('device_id', context.device.id)
    .eq('status', 'running')
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('Backup job report failed', error)
    return response({ error: 'Job report failed' }, 500)
  }
  if (!job) return response({ error: 'Running job not found' }, 409)

  await context.admin
    .from('backup_devices')
    .update({ last_seen_at: completedAt, last_error: status === 'failed' ? update.error_message : null })
    .eq('id', context.device.id)

  return response({ success: true }, 200)
}
function uuid(value: unknown) {
  if (typeof value !== 'string') return null
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null
}

function sha256(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return /^[A-F0-9]{64}$/.test(normalized) ? normalized : null
}

function commit(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return /^[a-f0-9]{40}$/.test(normalized) ? normalized : null
}

function safeNonNegativeInteger(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}
