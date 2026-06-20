import { S3Client } from "@aws-sdk/client-s3"

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
