import { NextResponse } from 'next/server'
import {
  createPairingCode,
  getSuperAdminContext,
  hashBackupSecret,
  isSameOrigin,
  PAIRING_TTL_MINUTES,
} from '@/lib/backup/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_MODES = new Set(['database', 'incremental', 'full'])

export async function GET() {
  const context = await getSuperAdminContext()
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [{ data: devices, error: devicesError }, { data: jobs, error: jobsError }] =
    await Promise.all([
      context.admin
        .from('backup_devices')
        .select(
          'id, name, status, is_primary, paired_at, last_seen_at, hostname, platform, agent_version, backup_path, free_disk_bytes, capabilities, last_error, revoked_at, updated_at',
        )
        .order('is_primary', { ascending: false })
        .order('paired_at', { ascending: false }),
      context.admin
        .from('backup_jobs')
        .select(
          'id, device_id, mode, status, requested_at, started_at, completed_at, archive_name, archive_path, archive_bytes, archive_sha256, source_commit, error_message, agent_message',
        )
        .order('requested_at', { ascending: false })
        .limit(30),
    ])

  if (devicesError || jobsError) {
    console.error('Backup administration read failed', devicesError ?? jobsError)
    return NextResponse.json({ error: 'Backup tables are unavailable' }, { status: 500 })
  }

  return NextResponse.json(
    { devices: devices ?? [], jobs: jobs ?? [] },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
  }

  const context = await getSuperAdminContext()
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const action = body.action
  try {
    if (action === 'create_pairing') {
      return await createPairing(context, body)
    }
    if (action === 'create_job') {
      return await createJob(context, body)
    }
    if (action === 'set_primary') {
      return await setPrimary(context, body)
    }
    if (action === 'revoke_device') {
      return await revokeDevice(context, body)
    }
    if (action === 'cancel_job') {
      return await cancelJob(context, body)
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error('Backup administration action failed', error)
    return NextResponse.json({ error: 'The backup request could not be completed' }, { status: 500 })
  }
}

type AdminContext = NonNullable<Awaited<ReturnType<typeof getSuperAdminContext>>>

async function createPairing(context: AdminContext, body: Record<string, unknown>) {
  const requestedName = text(body.name, 80)
  if (!requestedName) {
    return NextResponse.json({ error: 'Computer name is required' }, { status: 400 })
  }

  const code = createPairingCode()
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MINUTES * 60_000).toISOString()

  await context.admin
    .from('backup_device_pairings')
    .delete()
    .eq('created_by', context.employee.id)
    .is('used_at', null)

  const { data, error } = await context.admin
    .from('backup_device_pairings')
    .insert({
      code_hash: hashBackupSecret(code.replaceAll('-', '')),
      requested_name: requestedName,
      created_by: context.employee.id,
      expires_at: expiresAt,
    })
    .select('id')
    .single()

  if (error) throw error
  await audit(context, 'create', 'backup_device_pairing', data.id, {
    requested_name: requestedName,
    expires_at: expiresAt,
  })

  return NextResponse.json({ code, expiresAt, ttlMinutes: PAIRING_TTL_MINUTES })
}

async function createJob(context: AdminContext, body: Record<string, unknown>) {
  const deviceId = uuid(body.deviceId)
  const mode = typeof body.mode === 'string' ? body.mode : ''
  if (!deviceId || !ALLOWED_MODES.has(mode)) {
    return NextResponse.json({ error: 'Invalid device or backup type' }, { status: 400 })
  }

  const { data: device } = await context.admin
    .from('backup_devices')
    .select('id, name, status, capabilities')
    .eq('id', deviceId)
    .maybeSingle()

  if (!device || device.status !== 'active') {
    return NextResponse.json({ error: 'Backup computer is not active' }, { status: 409 })
  }

  const capabilities = (device.capabilities ?? {}) as Record<string, unknown>
  if (capabilities.database !== true) {
    return NextResponse.json({ error: 'Database backup is not configured on this computer' }, { status: 409 })
  }
  if ((mode === 'incremental' || mode === 'full') && capabilities.r2 !== true) {
    return NextResponse.json({ error: 'R2 backup is not configured on this computer' }, { status: 409 })
  }

  const { data: activeJob } = await context.admin
    .from('backup_jobs')
    .select('id, status')
    .eq('device_id', deviceId)
    .in('status', ['queued', 'running'])
    .limit(1)
    .maybeSingle()

  if (activeJob) {
    return NextResponse.json({ error: 'This computer already has a queued or running backup' }, { status: 409 })
  }

  const { data: job, error } = await context.admin
    .from('backup_jobs')
    .insert({ device_id: deviceId, requested_by: context.employee.id, mode })
    .select('id, device_id, mode, status, requested_at')
    .single()
  if (error) throw error

  await audit(context, 'create', 'backup_job', job.id, {
    device_id: deviceId,
    device_name: device.name,
    mode,
  })
  return NextResponse.json({ job })
}

async function setPrimary(context: AdminContext, body: Record<string, unknown>) {
  const deviceId = uuid(body.deviceId)
  if (!deviceId) return NextResponse.json({ error: 'Invalid device' }, { status: 400 })

  const { data: device } = await context.admin
    .from('backup_devices')
    .select('id, name, status')
    .eq('id', deviceId)
    .maybeSingle()
  if (!device || device.status !== 'active') {
    return NextResponse.json({ error: 'Backup computer is not active' }, { status: 409 })
  }

  const { error: clearError } = await context.admin
    .from('backup_devices')
    .update({ is_primary: false })
    .eq('is_primary', true)
  if (clearError) throw clearError

  const { error } = await context.admin
    .from('backup_devices')
    .update({ is_primary: true })
    .eq('id', deviceId)
  if (error) throw error

  await audit(context, 'update', 'backup_device', deviceId, { is_primary: true })
  return NextResponse.json({ success: true })
}

async function revokeDevice(context: AdminContext, body: Record<string, unknown>) {
  const deviceId = uuid(body.deviceId)
  if (!deviceId) return NextResponse.json({ error: 'Invalid device' }, { status: 400 })

  const { data: device } = await context.admin
    .from('backup_devices')
    .select('id, name, is_primary, status')
    .eq('id', deviceId)
    .maybeSingle()
  if (!device) return NextResponse.json({ error: 'Device not found' }, { status: 404 })

  const now = new Date().toISOString()
  const { error } = await context.admin
    .from('backup_devices')
    .update({ status: 'revoked', is_primary: false, revoked_at: now })
    .eq('id', deviceId)
  if (error) throw error

  await context.admin
    .from('backup_jobs')
    .update({ status: 'cancelled', completed_at: now, agent_message: 'Device access was revoked' })
    .eq('device_id', deviceId)
    .eq('status', 'queued')

  if (device.is_primary) {
    const { data: replacement } = await context.admin
      .from('backup_devices')
      .select('id')
      .eq('status', 'active')
      .order('last_seen_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()
    if (replacement) {
      await context.admin.from('backup_devices').update({ is_primary: true }).eq('id', replacement.id)
    }
  }

  await audit(context, 'delete', 'backup_device', deviceId, { name: device.name, revoked_at: now })
  return NextResponse.json({ success: true })
}

async function cancelJob(context: AdminContext, body: Record<string, unknown>) {
  const jobId = uuid(body.jobId)
  if (!jobId) return NextResponse.json({ error: 'Invalid backup job' }, { status: 400 })
  const now = new Date().toISOString()
  const { data: job, error } = await context.admin
    .from('backup_jobs')
    .update({ status: 'cancelled', completed_at: now })
    .eq('id', jobId)
    .eq('status', 'queued')
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!job) return NextResponse.json({ error: 'Only queued jobs can be cancelled' }, { status: 409 })
  await audit(context, 'update', 'backup_job', jobId, { status: 'cancelled' })
  return NextResponse.json({ success: true })
}

async function audit(
  context: AdminContext,
  action: 'create' | 'update' | 'delete',
  entityType: string,
  entityId: string,
  after: Record<string, unknown>,
) {
  const { error } = await context.admin.from('audit_log').insert({
    employee_id: context.employee.id,
    action,
    entity_type: entityType,
    entity_id: entityId,
    after,
  })
  if (error) console.error('Backup audit insertion failed', error)
}

function text(value: unknown, maximum: number) {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return cleaned ? cleaned.slice(0, maximum) : null
}

function uuid(value: unknown) {
  if (typeof value !== 'string') return null
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null
}
