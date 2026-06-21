import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { unstable_cache } from "next/cache"

/**
 * Cloudflare R2 client (S3-compatible).
 * Uses server-only environment variables — never expose to the client.
 */
export function createR2Client() {
  return new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
}

export const R2_BUCKET = process.env.R2_BUCKET_NAME!

/**
 * Get a signed R2 URL for a file path — cached for 55 minutes.
 *
 * WHY: Generating signed URLs requires an outbound network call to Cloudflare R2
 * for every file on every page load. Since each signed URL is valid for 3600s (1h),
 * caching them for 55min eliminates redundant external calls on repeated page visits.
 *
 * The cache is keyed by file path, so different files get independent cache entries.
 */
export const getCachedSignedUrl = unstable_cache(
  async (filePath: string): Promise<string | null> => {
    try {
      const r2 = createR2Client()
      return await getSignedUrl(
        r2,
        new GetObjectCommand({ Bucket: R2_BUCKET, Key: filePath }),
        { expiresIn: 3600 }
      )
    } catch {
      return null
    }
  },
  ["r2-signed-url"],
  {
    revalidate: 55 * 60, // 55 minutes — safely within the 1-hour URL expiry
    tags: ["r2-signed-url"],
  }
)

/**
 * Batch-fetch signed URLs for multiple file paths in parallel.
 * Returns a Record<filePath, signedUrl> map. Missing/errored entries are omitted.
 */
export async function getBatchSignedUrls(filePaths: string[]): Promise<Record<string, string>> {
  if (filePaths.length === 0) return {}

  const entries = await Promise.all(
    filePaths.map(async (path) => {
      const url = await getCachedSignedUrl(path)
      return url ? [path, url] as const : null
    })
  )

  return Object.fromEntries(entries.filter(Boolean) as [string, string][])
}
