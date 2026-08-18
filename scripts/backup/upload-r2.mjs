import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import {
  loadJson,
  parseArgs,
  sha256File,
  writeJsonAtomic,
} from './common.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '..', '..')
const args = parseArgs(process.argv.slice(2))
dotenv.config({
  path: path.resolve(repositoryRoot, String(args.env ?? '.env.local')),
  quiet: true,
})

const endpoint = required('R2_ENDPOINT')
const accessKeyId = required('R2_ACCESS_KEY_ID')
const secretAccessKey = required('R2_SECRET_ACCESS_KEY')
const bucket = process.env.R2_BACKUP_BUCKET_NAME || required('R2_BUCKET_NAME')
const prefix = normalizePrefix(process.env.R2_DATABASE_BACKUP_PREFIX || 'database-backups')
const resultFile = path.resolve(
  String(
    args.result ??
      path.join(
        process.env.BACKUP_OUTPUT_DIR ??
          path.resolve(repositoryRoot, '..', 'production-backups'),
        'latest-result.json',
      ),
  ),
)
const backupResult = await loadJson(resultFile)
if (!backupResult?.archive || !backupResult?.sha256 || !backupResult?.runId) {
  throw new Error(`No verified backup result was found at ${resultFile}`)
}

const archivePath = path.resolve(backupResult.archive)
const checksumPath = path.resolve(
  backupResult.checksumFile ?? `${archivePath}.sha256`,
)
const archiveDetails = await stat(archivePath)
const actualSha256 = await sha256File(archivePath)
if (actualSha256 !== backupResult.sha256) {
  throw new Error('Backup SHA-256 verification failed before R2 upload.')
}

const client = new S3Client({
  region: 'auto',
  endpoint,
  credentials: { accessKeyId, secretAccessKey },
})
const archiveName = path.basename(archivePath)
const archiveKey = `${prefix}/${archiveName}`
const checksumKey = `${archiveKey}.sha256`
const manifestKey = `${prefix}/manifests/${backupResult.runId}.json`

await uploadFile({
  client,
  bucket,
  key: archiveKey,
  file: archivePath,
  contentType: 'application/gzip',
  sha256: actualSha256,
})
await uploadFile({
  client,
  bucket,
  key: checksumKey,
  file: checksumPath,
  contentType: 'text/plain; charset=utf-8',
  sha256: await sha256File(checksumPath),
})

const manifest = {
  version: 1,
  runId: backupResult.runId,
  mode: backupResult.effectiveMode ?? backupResult.mode,
  uploadedAt: new Date().toISOString(),
  archive: {
    name: archiveName,
    key: archiveKey,
    bytes: archiveDetails.size,
    sha256: actualSha256,
  },
  checksumKey,
}
await putJson(client, bucket, manifestKey, manifest)
await putJson(client, bucket, `${prefix}/latest.json`, manifest)

const uploadResultFile = path.join(path.dirname(resultFile), 'latest-r2-upload.json')
await writeJsonAtomic(uploadResultFile, manifest)
process.stdout.write(
  `${JSON.stringify(
    {
      runId: manifest.runId,
      archiveName,
      archiveBytes: archiveDetails.size,
      archiveSha256: actualSha256,
      bucket,
      key: archiveKey,
    },
    null,
    2,
  )}\n`,
)

async function uploadFile({ client, bucket, key, file, contentType, sha256 }) {
  const details = await stat(file)
  const existing = await client
    .send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    .catch((error) => {
      if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') return null
      throw error
    })
  if (
    existing &&
    Number(existing.ContentLength) === details.size &&
    existing.Metadata?.sha256 === sha256
  ) {
    return
  }
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(file),
      ContentLength: details.size,
      ContentType: contentType,
      Metadata: {
        sha256,
        'backup-kind': 'megamaf-database',
      },
    }),
  )
  const uploaded = await client.send(
    new HeadObjectCommand({ Bucket: bucket, Key: key }),
  )
  if (
    Number(uploaded.ContentLength) !== details.size ||
    uploaded.Metadata?.sha256 !== sha256
  ) {
    throw new Error(`R2 upload verification failed for ${key}`)
  }
}

async function putJson(client, bucket, key, value) {
  const body = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentLength: body.length,
      ContentType: 'application/json; charset=utf-8',
    }),
  )
}

function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required for R2 backup upload.`)
  return value
}

function normalizePrefix(value) {
  const normalized = String(value).replace(/^\/+|\/+$/g, '')
  if (!normalized || !/^[a-zA-Z0-9/_-]+$/.test(normalized)) {
    throw new Error('R2_DATABASE_BACKUP_PREFIX is invalid.')
  }
  return normalized
}
