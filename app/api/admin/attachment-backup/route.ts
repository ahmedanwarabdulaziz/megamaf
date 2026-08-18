import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { NextResponse } from 'next/server'
import { getSuperAdminContext, isSameOrigin } from '@/lib/backup/security'
import { createR2Client, R2_BUCKET, R2_BUCKET_TREASURY } from '@/lib/r2'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PAGE_SIZE = 100
const SIGNED_URL_SECONDS = 60 * 60

type BucketAlias = 'general' | 'treasury'

export async function GET(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
  }

  const context = await getSuperAdminContext()
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const alias = validBucketAlias(url.searchParams.get('bucket'))
  const cursor = validCursor(url.searchParams.get('cursor'))
  if (!alias) {
    return NextResponse.json({ error: 'Invalid attachment bucket' }, { status: 400 })
  }
  if (url.searchParams.has('cursor') && !cursor) {
    return NextResponse.json({ error: 'Invalid pagination cursor' }, { status: 400 })
  }

  try {
    const client = createR2Client()
    const bucket = bucketName(alias)
    if (!bucket) {
      return NextResponse.json(
        { error: `The ${alias} attachment bucket is not configured.` },
        { status: 503 },
      )
    }

    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: cursor ?? undefined,
        MaxKeys: PAGE_SIZE,
      }),
    )

    const storedObjects = (response.Contents ?? []).filter(
      (object) =>
        typeof object.Key === 'string' &&
        !object.Key.endsWith('/') &&
        isAttachmentKey(alias, object.Key),
    )

    const objects = await Promise.all(
      storedObjects.map(async (object) => ({
        key: object.Key!,
        bytes: Number(object.Size ?? 0),
        lastModified: object.LastModified?.toISOString() ?? null,
        etag: object.ETag?.replaceAll('"', '') ?? null,
        url: await getSignedUrl(
          client,
          new GetObjectCommand({ Bucket: bucket, Key: object.Key! }),
          { expiresIn: SIGNED_URL_SECONDS },
        ),
      })),
    )

    return NextResponse.json(
      {
        bucket: alias,
        objects,
        nextCursor: response.IsTruncated ? response.NextContinuationToken ?? null : null,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('Attachment backup listing failed', error)
    return NextResponse.json(
      { error: 'تعذر تجهيز ملفات المرفقات للتنزيل.' },
      { status: 500 },
    )
  }
}

function validBucketAlias(value: string | null): BucketAlias | null {
  return value === 'general' || value === 'treasury' ? value : null
}

function validCursor(value: string | null) {
  if (!value) return null
  return value.length <= 2_048 && /^[A-Za-z0-9+/=_-]+$/.test(value) ? value : null
}

function bucketName(alias: BucketAlias) {
  return alias === 'general' ? R2_BUCKET : R2_BUCKET_TREASURY
}

function isAttachmentKey(alias: BucketAlias, key: string) {
  return alias !== 'general' || !key.startsWith('database-backups/')
}
