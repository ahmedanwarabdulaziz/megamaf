import { stat, statfs, unlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import {
  acquireLock,
  commandOutput,
  isFile,
  loadJson,
  parseArgs,
  runCommand,
  writeJsonAtomic,
} from '../backup/common.mjs'

const AGENT_VERSION = '1.0.0'
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '..', '..')
const args = parseArgs(process.argv.slice(2))
const configFile = path.resolve(
  String(
    args.config ??
      process.env.BACKUP_AGENT_CONFIG ??
      path.join(repositoryRoot, '.backup-state', 'agent.json'),
  ),
)
const pendingReportFile = path.join(path.dirname(configFile), 'pending-report.json')
const agentLockFile = path.join(path.dirname(configFile), 'agent.lock')

await removeStaleLock(agentLockFile, 12 * 60 * 60_000)
let releaseLock
try {
  releaseLock = await acquireLock(agentLockFile)
} catch (error) {
  if (String(error?.message ?? '').includes('Another backup is already running')) {
    process.stdout.write('MegaMaf backup agent is already running.\n')
    process.exit(0)
  }
  throw error
}

try {
  const config = await loadJson(configFile)
  validateConfig(config)
  dotenv.config({ path: config.envFile, quiet: true })

  const pendingReport = await loadJson(pendingReportFile, null)
  if (pendingReport) {
    await sendReport(config, pendingReport)
    await unlink(pendingReportFile).catch(() => {})
  }

  const heartbeat = await deviceMetadata(config)
  const poll = await agentRequest(config, '/api/backup-agent/poll', heartbeat)
  if (!poll.job) {
    process.stdout.write(`No queued backup jobs at ${new Date().toISOString()}.\n`)
  } else {
  const job = poll.job
  if (!['database', 'incremental', 'full'].includes(job.mode)) {
    throw new Error(`Server returned unsupported backup mode: ${job.mode}`)
  }

  process.stdout.write(`Starting ${job.mode} backup job ${job.id}.\n`)
  const sourceRef = await refreshSourceReference()
  await removeStaleLock(path.join(config.backupPath, '.backup-state', 'backup.lock'), 12 * 60 * 60_000)

  let report
  try {
    await runCommand(
      process.execPath,
      [
        path.join(repositoryRoot, 'scripts', 'backup', 'run-backup.mjs'),
        '--mode',
        job.mode,
        '--env',
        config.envFile,
        '--output',
        config.backupPath,
      ],
      {
        cwd: repositoryRoot,
        env: { ...process.env, BACKUP_SOURCE_REF: sourceRef },
        label: `MegaMaf ${job.mode} backup`,
      },
    )

    const result = await loadJson(path.join(config.backupPath, 'latest-result.json'))
    const manifest = result?.manifest ? await loadJson(result.manifest, {}) : {}
    if (!result?.archive || !(await isFile(result.archive))) {
      throw new Error('The backup engine did not produce a verified archive.')
    }
    report = {
      jobId: job.id,
      status: 'completed',
      archiveName: path.basename(result.archive),
      archivePath: result.archive,
      archiveBytes: result.bytes,
      archiveSha256: result.sha256,
      sourceCommit: manifest.repositoryCommit ?? null,
      message: `Backup verified locally by agent ${AGENT_VERSION}`,
    }
  } catch (error) {
    report = {
      jobId: job.id,
      status: 'failed',
      error: safeError(error),
      message: `Backup failed on ${os.hostname()}`,
    }
  }

  await writeJsonAtomic(pendingReportFile, report)
  await sendReport(config, report)
  await unlink(pendingReportFile).catch(() => {})
  if (report.status === 'failed') process.exitCode = 1
  }
} finally {
  await releaseLock()
}

async function agentRequest(config, endpoint, body) {
  const response = await fetch(`${config.appUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error ?? `Agent request failed with HTTP ${response.status}.`)
  return payload
}

async function sendReport(config, report) {
  await agentRequest(config, '/api/backup-agent/report', report)
}

async function deviceMetadata(config) {
  let freeDiskBytes = null
  try {
    const details = await statfs(config.backupPath, { bigint: true })
    const bytes = details.bavail * details.bsize
    freeDiskBytes = bytes <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(bytes) : Number.MAX_SAFE_INTEGER
  } catch {
    // The server will retain the previous disk reading.
  }
  return {
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    agentVersion: AGENT_VERSION,
    backupPath: config.backupPath,
    freeDiskBytes,
    capabilities: detectCapabilities(),
  }
}

function detectCapabilities() {
  return {
    database: Boolean(
      process.env.SUPABASE_DB_URL ||
        (process.env.BACKUP_DB_HOST &&
          process.env.BACKUP_DB_USER &&
          (process.env.SUPABASE_DB_PASSWORD || process.env.BACKUP_DB_PASSWORD)),
    ),
    r2: Boolean(
      process.env.R2_ENDPOINT &&
        process.env.R2_ACCESS_KEY_ID &&
        process.env.R2_SECRET_ACCESS_KEY &&
        (process.env.R2_BUCKET_NAME || process.env.R2_BUCKET_NAME_TREASURY),
    ),
    source: true,
  }
}

async function refreshSourceReference() {
  try {
    await runCommand('git', ['fetch', 'origin', 'main', '--prune'], {
      cwd: repositoryRoot,
      quiet: true,
      capture: true,
      label: 'GitHub source refresh',
    })
    await commandOutput('git', ['rev-parse', 'origin/main'], {
      cwd: repositoryRoot,
      label: 'GitHub source verification',
    })
    return 'origin/main'
  } catch (error) {
    process.stderr.write(`Warning: ${safeError(error)} Using the local HEAD source instead.\n`)
    return 'HEAD'
  }
}

async function removeStaleLock(file, maximumAgeMs) {
  try {
    const details = await stat(file)
    if (Date.now() - details.mtimeMs > maximumAgeMs) await unlink(file)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

function validateConfig(config) {
  if (!config?.appUrl || !config?.token || !config?.deviceId || !config?.backupPath || !config?.envFile) {
    throw new Error('Backup agent is not paired. Run npm run backup:agent:setup first.')
  }
}

function safeError(error) {
  const value = error instanceof Error ? error.message : String(error)
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 1800)
}
