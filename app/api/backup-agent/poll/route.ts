import { NextResponse } from 'next/server'
import { authenticateBackupDevice, cleanText } from '@/lib/backup/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const context = await authenticateBackupDevice(request)
  if (!context) return response({ error: 'Unauthorized' }, 401)

  let body: Record<string, unknown> = {}
  try {
    body = await request.json()
  } catch {
    // A heartbeat may omit its optional metadata.
  }

  const capabilities = sanitizeCapabilities(body.capabilities)
  const freeDiskBytes = safeNonNegativeInteger(body.freeDiskBytes)
  const { error: heartbeatError } = await context.admin
    .from('backup_devices')
    .update({
      last_seen_at: new Date().toISOString(),
      hostname: cleanText(body.hostname, 255),
      platform: cleanText(body.platform, 255),
      agent_version: cleanText(body.agentVersion, 80),
      backup_path: cleanText(body.backupPath, 1000),
      free_disk_bytes: freeDiskBytes,
      capabilities,
      last_error: null,
    })
    .eq('id', context.device.id)

  if (heartbeatError) {
    console.error('Backup device heartbeat failed', heartbeatError)
    return response({ error: 'Heartbeat failed' }, 500)
  }

  // A PC can lose power after claiming a job. Do not leave that device blocked
  // forever; a pending completion report is retried by the agent before polling,
  // and any remaining 12-hour-old run is safely marked failed for admin review.
  const staleBefore = new Date(Date.now() - 12 * 60 * 60_000).toISOString()
  await context.admin
    .from('backup_jobs')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: 'Backup computer stopped reporting this job for more than 12 hours',
    })
    .eq('device_id', context.device.id)
    .eq('status', 'running')
    .lt('started_at', staleBefore)

  const { data: jobs, error } = await context.admin.rpc('claim_backup_job', {
    p_device_id: context.device.id,
  })
  if (error) {
    console.error('Backup job claim failed', error)
    return response({ error: 'Job polling failed' }, 500)
  }

  const job = Array.isArray(jobs) ? jobs[0] ?? null : jobs ?? null
  return response(
    {
      job: job
        ? {
            id: job.id,
            mode: job.mode,
            requestedAt: job.requested_at,
          }
        : null,
      serverTime: new Date().toISOString(),
    },
    200,
  )
}

function sanitizeCapabilities(value: unknown) {
  const capabilities = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    database: capabilities.database === true,
    r2: capabilities.r2 === true,
    source: capabilities.source !== false,
  }
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
