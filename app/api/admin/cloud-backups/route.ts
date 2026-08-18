import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { NextResponse } from 'next/server'
import {
  getSuperAdminContext,
  isSameOrigin,
} from '@/lib/backup/security'
import { createR2Client, R2_BUCKET } from '@/lib/r2'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const REPOSITORY =
  process.env.GITHUB_BACKUP_REPOSITORY || 'ahmedanwarabdulaziz/megamaf'
const WORKFLOW = 'backup-database.yml'
const BRANCH = process.env.GITHUB_BACKUP_BRANCH || 'main'
const BACKUP_PREFIX = 'database-backups/'

type WorkflowRunSummary = {
  id: number
  event: string | null
  status: string | null
  conclusion: string | null
  createdAt: string | null
  updatedAt: string | null
  url: string | null
  runNumber: number
}

export async function GET() {
  const context = await getSuperAdminContext()
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [runsResult, backupsResult] = await Promise.allSettled([
    listWorkflowRuns(),
    listStoredBackups(),
  ])

  return NextResponse.json(
    {
      runs: runsResult.status === 'fulfilled' ? runsResult.value : [],
      backups: backupsResult.status === 'fulfilled' ? backupsResult.value : [],
      warnings: [
        runsResult.status === 'rejected'
          ? safeError(runsResult.reason, 'تعذر قراءة حالة GitHub Actions.')
          : null,
        backupsResult.status === 'rejected'
          ? safeError(backupsResult.reason, 'تعذر قراءة ملفات النسخ الاحتياطي.')
          : null,
      ].filter(Boolean),
    },
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

  try {
    if (body.action === 'trigger') {
      const runs = await listWorkflowRuns()
      const active = runs.find((run) => run.status !== 'completed')
      if (active) {
        return NextResponse.json(
          { error: 'يوجد نسخ احتياطي قيد التنفيذ بالفعل.' },
          { status: 409 },
        )
      }
      await githubRequest(
        `/repos/${REPOSITORY}/actions/workflows/${WORKFLOW}/dispatches`,
        {
          method: 'POST',
          body: JSON.stringify({ ref: BRANCH }),
        },
      )
      await context.admin.from('audit_log').insert({
        employee_id: context.employee.id,
        action: 'create',
        entity_type: 'cloud_database_backup',
        after: { repository: REPOSITORY, workflow: WORKFLOW, ref: BRANCH },
      })
      return NextResponse.json({ success: true }, { status: 202 })
    }

    if (body.action === 'download') {
      const key = validBackupKey(body.key)
      if (!key) {
        return NextResponse.json({ error: 'Invalid backup file' }, { status: 400 })
      }
      const client = createR2Client()
      const bucket = backupBucket()
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentDisposition: `attachment; filename="${key.split('/').at(-1)}"`,
        }),
        { expiresIn: 120 },
      )
      await context.admin.from('audit_log').insert({
        employee_id: context.employee.id,
        action: 'create',
        entity_type: 'cloud_database_backup',
        after: { key },
      })
      return NextResponse.json({ url })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error('Cloud backup action failed', error)
    return NextResponse.json(
      { error: safeError(error, 'تعذر تنفيذ طلب النسخ الاحتياطي.') },
      { status: 500 },
    )
  }
}

async function listWorkflowRuns(): Promise<WorkflowRunSummary[]> {
  const payload = (await githubRequest(
    `/repos/${REPOSITORY}/actions/workflows/${WORKFLOW}/runs?per_page=10`,
  )) as { workflow_runs?: Array<Record<string, unknown>> }
  const runs = Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : []
  return runs.map((run: Record<string, unknown>) => ({
    id: Number(run.id),
    event: stringValue(run.event),
    status: stringValue(run.status),
    conclusion: stringValue(run.conclusion),
    createdAt: stringValue(run.created_at),
    updatedAt: stringValue(run.updated_at),
    url: stringValue(run.html_url),
    runNumber: Number(run.run_number),
  }))
}

async function listStoredBackups() {
  const client = createR2Client()
  const response = await client.send(
    new ListObjectsV2Command({
      Bucket: backupBucket(),
      Prefix: BACKUP_PREFIX,
      MaxKeys: 250,
    }),
  )
  return (response.Contents ?? [])
    .filter(
      (object) =>
        typeof object.Key === 'string' &&
        validBackupKey(object.Key) !== null,
    )
    .sort(
      (left, right) =>
        (right.LastModified?.getTime() ?? 0) -
        (left.LastModified?.getTime() ?? 0),
    )
    .slice(0, 60)
    .map((object) => ({
      key: object.Key!,
      name: object.Key!.split('/').at(-1)!,
      bytes: Number(object.Size ?? 0),
      createdAt: object.LastModified?.toISOString() ?? null,
    }))
}

async function githubRequest(path: string, init: RequestInit = {}) {
  const token = process.env.GITHUB_ACTIONS_TOKEN
  if (!token) throw new Error('GITHUB_ACTIONS_TOKEN is not configured.')
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...init.headers,
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  })
  if (response.status === 204) return null
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(
      `GitHub API request failed (${response.status}): ${
        typeof payload?.message === 'string' ? payload.message : 'unknown error'
      }`,
    )
  }
  return payload
}

function backupBucket() {
  return process.env.R2_BACKUP_BUCKET_NAME || R2_BUCKET
}

function validBackupKey(value: unknown) {
  if (typeof value !== 'string') return null
  return /^database-backups\/megamaf-database-\d{8}T\d{6}Z\.tar\.gz$/.test(value)
    ? value
    : null
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : null
}

function safeError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback
  return error.message
    .replace(/gh[opsu]_[A-Za-z0-9_]+/g, '[secret]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, 300)
}
