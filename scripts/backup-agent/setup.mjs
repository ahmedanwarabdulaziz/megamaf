import { access, constants, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import {
  ensureDir,
  parseArgs,
  writeJsonAtomic,
} from '../backup/common.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '..', '..')
const args = parseArgs(process.argv.slice(2))
const envFile = path.resolve(repositoryRoot, String(args.env ?? '.env.local'))
dotenv.config({ path: envFile, quiet: true })

const appUrl = normalizeUrl(
  String(args.url ?? process.env.MEGAMAF_AGENT_APP_URL ?? ''),
)
const code = String(
  args.code ?? process.env.MEGAMAF_AGENT_PAIRING_CODE ?? '',
).trim()
const name = String(
  args.name ?? process.env.MEGAMAF_AGENT_DEVICE_NAME ?? os.hostname(),
).trim()
const backupPath = path.resolve(
  String(
    args.output ??
      process.env.BACKUP_OUTPUT_DIR ??
      path.join(os.homedir(), 'Documents', 'MegaMaf Backups'),
  ),
)
const configFile = path.resolve(
  String(
    args.config ??
      process.env.BACKUP_AGENT_CONFIG ??
      path.join(repositoryRoot, '.backup-state', 'agent.json'),
  ),
)

if (!appUrl) throw new Error('The MegaMaf application URL is required.')
if (!code) throw new Error('The one-time pairing code is required.')
if (!name || name.length > 80) throw new Error('The computer name must be 1-80 characters.')

await assertWritableDirectory(backupPath)
const capabilities = detectCapabilities()

const response = await fetch(`${appUrl}/api/backup-agent/pair`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    code,
    name,
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    agentVersion: '1.0.0',
    backupPath,
    capabilities,
  }),
  signal: AbortSignal.timeout(30_000),
})
const payload = await response.json().catch(() => ({}))
if (!response.ok || !payload.deviceId || !payload.token) {
  throw new Error(payload.error ?? `Pairing failed with HTTP ${response.status}.`)
}
await writeJsonAtomic(configFile, {
  version: 1,
  appUrl,
  deviceId: payload.deviceId,
  token: payload.token,
  deviceName: name,
  backupPath,
  envFile,
  pairedAt: new Date().toISOString(),
})

process.stdout.write(
  [
    '',
    'MegaMaf backup computer paired successfully.',
    `Computer: ${name}`,
    `Backup folder: ${backupPath}`,
    `Database backup configured: ${capabilities.database ? 'yes' : 'no'}`,
    `R2 backup configured: ${capabilities.r2 ? 'yes' : 'no'}`,
    'The device token was stored locally and was not printed.',
    '',
  ].join('\n'),
)

function normalizeUrl(value) {
  if (!value) return ''
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Application URL must use HTTP or HTTPS.')
  return url.origin
}

function detectCapabilities() {
  const database = Boolean(
    process.env.SUPABASE_DB_URL ||
      (process.env.BACKUP_DB_HOST &&
        process.env.BACKUP_DB_USER &&
        (process.env.SUPABASE_DB_PASSWORD || process.env.BACKUP_DB_PASSWORD)),
  )
  const r2 = Boolean(
    process.env.R2_ENDPOINT &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      (process.env.R2_BUCKET_NAME || process.env.R2_BUCKET_NAME_TREASURY),
  )
  return { database, r2, source: true }
}

async function assertWritableDirectory(directory) {
  await ensureDir(directory)
  await access(directory, constants.R_OK | constants.W_OK)
  const probe = path.join(directory, `.megamaf-write-test-${process.pid}`)
  await writeFile(probe, 'ok', { encoding: 'utf8', mode: 0o600 })
  await unlink(probe)
}
