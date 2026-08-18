import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { unstable_cache } from 'next/cache'
import { NextResponse } from 'next/server'
import { createR2Client, R2_BUCKET } from '@/lib/r2'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const REPOSITORY =
  process.env.GITHUB_BACKUP_REPOSITORY || 'ahmedanwarabdulaziz/megamaf'
const WORKFLOW = 'backup-database.yml'
const LATEST_MANIFEST_KEY = 'database-backups/latest.json'
const MAX_BACKUP_AGE_MS = 30 * 60 * 60 * 1_000

type ScheduledRun = {
  id: number
  status: string | null
  conclusion: string | null
  createdAt: string | null
  updatedAt: string | null
}

type BackupManifest = {
  uploadedAt?: unknown
  archive?: {
    key?: unknown
    bytes?: unknown
    sha256?: unknown
  }
}

const getCachedBackupHealth = unstable_cache(
  checkBackupHealth,
  ['production-backup-health-v1'],
  { revalidate: 5 * 60 },
)

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const health = await getCachedBackupHealth()
  return NextResponse.json(health, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

async function checkBackupHealth() {
  const checkedAt = new Date().toISOString()

  try {
    const runs = await listScheduledRuns()
    if (runs.length === 0) {
      return unhealthy(
        checkedAt,
        'لم تُسجل نسخة احتياطية تلقائية بعد. اتصل بالمطور.',
        null,
        null,
      )
    }

    const latestRun = runs[0]
    const completedRun =
      latestRun.status === 'completed'
        ? latestRun
        : runs.find((run) => run.status === 'completed')

    if (!completedRun || completedRun.conclusion !== 'success') {
      return unhealthy(
        checkedAt,
        'النسخ الاحتياطي التلقائي لا يعمل. اتصل بالمطور.',
        latestRun.updatedAt ?? latestRun.createdAt,
        null,
      )
    }

    const completedAt = parseDate(completedRun.updatedAt)
    if (!completedAt || Date.now() - completedAt.getTime() > MAX_BACKUP_AGE_MS) {
      return unhealthy(
        checkedAt,
        'لم تصل نسخة احتياطية تلقائية حديثة. اتصل بالمطور.',
        completedRun.updatedAt,
        null,
      )
    }

    const manifest = await readLatestManifest()
    const uploadedAt = parseDate(stringValue(manifest.uploadedAt))
    const runStartedAt = parseDate(completedRun.createdAt)
    const archiveKey = stringValue(manifest.archive?.key)
    const expectedBytes = numberValue(manifest.archive?.bytes)
    const expectedSha256 = stringValue(manifest.archive?.sha256)

    if (
      !uploadedAt ||
      !runStartedAt ||
      uploadedAt < runStartedAt ||
      !archiveKey ||
      !validArchiveKey(archiveKey) ||
      expectedBytes === null ||
      !expectedSha256
    ) {
      return unhealthy(
        checkedAt,
        'آخر نسخة تلقائية لم تصل إلى التخزين بصورة صحيحة. اتصل بالمطور.',
        completedRun.updatedAt,
        uploadedAt?.toISOString() ?? null,
      )
    }

    const client = createR2Client()
    const stored = await client.send(
      new HeadObjectCommand({ Bucket: backupBucket(), Key: archiveKey }),
    )
    const archiveVerified =
      Number(stored.ContentLength) === expectedBytes &&
      stored.Metadata?.sha256 === expectedSha256

    if (!archiveVerified) {
      return unhealthy(
        checkedAt,
        'ملف النسخة الاحتياطية في R2 غير مكتمل. اتصل بالمطور.',
        completedRun.updatedAt,
        uploadedAt.toISOString(),
      )
    }

    const runInProgress = latestRun.status !== 'completed'
    return {
      status: 'healthy' as const,
      message: runInProgress
        ? 'آخر نسخة تلقائية محفوظة بنجاح، والنسخة الجديدة قيد التنفيذ.'
        : 'آخر نسخة تلقائية محفوظة بنجاح في R2.',
      checkedAt,
      lastScheduledAt: completedRun.updatedAt,
      lastUploadedAt: uploadedAt.toISOString(),
      runInProgress,
    }
  } catch (error) {
    console.error('Backup health check failed', error)
    return unhealthy(
      checkedAt,
      'تعذر التحقق من النسخ الاحتياطي. اتصل بالمطور.',
      null,
      null,
    )
  }
}

async function listScheduledRuns(): Promise<ScheduledRun[]> {
  const path =
    `/repos/${REPOSITORY}/actions/workflows/${WORKFLOW}/runs?event=schedule&per_page=5`
  let response = await githubRequest(path, true)
  if (response.status === 401 || response.status === 403) {
    response = await githubRequest(path, false)
  }
  if (!response.ok) {
    throw new Error(`GitHub backup health request failed (${response.status}).`)
  }
  const payload = (await response.json()) as {
    workflow_runs?: Array<Record<string, unknown>>
  }
  return (payload.workflow_runs ?? []).map((run) => ({
    id: Number(run.id),
    status: stringValue(run.status),
    conclusion: stringValue(run.conclusion),
    createdAt: stringValue(run.run_started_at) ?? stringValue(run.created_at),
    updatedAt: stringValue(run.updated_at),
  }))
}

function githubRequest(path: string, useToken: boolean) {
  const token = process.env.GITHUB_ACTIONS_TOKEN
  return fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(useToken && token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })
}

async function readLatestManifest(): Promise<BackupManifest> {
  const client = createR2Client()
  const response = await client.send(
    new GetObjectCommand({
      Bucket: backupBucket(),
      Key: LATEST_MANIFEST_KEY,
    }),
  )
  if (!response.Body) throw new Error('R2 backup manifest is empty.')
  return JSON.parse(await response.Body.transformToString()) as BackupManifest
}

function backupBucket() {
  return process.env.R2_BACKUP_BUCKET_NAME || R2_BUCKET
}

function validArchiveKey(value: string) {
  return /^database-backups[/]megamaf-database-[0-9]{8}T[0-9]{6}Z[.]tar[.]gz$/.test(
    value,
  )
}

function parseDate(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : null
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null
}

function unhealthy(
  checkedAt: string,
  message: string,
  lastScheduledAt: string | null,
  lastUploadedAt: string | null,
) {
  return {
    status: 'unhealthy' as const,
    message,
    checkedAt,
    lastScheduledAt,
    lastUploadedAt,
    runInProgress: false,
  }
}
