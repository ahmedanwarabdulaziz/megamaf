"use server"

import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { createR2Client, R2_BUCKET, getBatchSignedUrls, getBatchSignedUrlsTreasury } from "@/lib/r2"

export async function getUploadUrl(fileName: string, contentType: string) {
  try {
    const r2 = createR2Client()
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: fileName,
      ContentType: contentType,
    })
    
    // URL expires in 15 minutes
    const signedUrl = await getSignedUrl(r2, command, { expiresIn: 900 })
    return { url: signedUrl }
  } catch (error) {
    console.error("Error generating signed upload URL:", error)
    return { error: "Failed to generate upload URL" }
  }
}

/**
 * Generate a signed URL for downloading/viewing a file from R2.
 * URL is valid for 1 hour.
 */
export async function getDownloadUrl(r2Key: string): Promise<{ url?: string; error?: string }> {
  try {
    const r2 = createR2Client()
    const url = await getSignedUrl(
      r2,
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: r2Key }),
      { expiresIn: 3600 }
    )
    return { url }
  } catch (e: any) {
    console.error("Error generating signed download URL:", e)
    return { error: "Failed to generate download URL" }
  }
}

/**
 * Batch-fetch signed download URLs for multiple files at once (cached — see
 * getBatchSignedUrls in lib/r2.ts). Client components can't import lib/r2.ts
 * directly (server-only env vars), so this action exposes it to them.
 */
export async function getDownloadUrls(r2Keys: string[]): Promise<Record<string, string>> {
  return getBatchSignedUrls(r2Keys)
}

/** Same as getDownloadUrls, but for files in the treasury payments bucket. */
export async function getTreasuryDownloadUrls(r2Keys: string[]): Promise<Record<string, string>> {
  return getBatchSignedUrlsTreasury(r2Keys)
}

/**
 * Upload a file to R2 directly from the server (avoids CORS issues).
 * Use this from server actions or server components.
 */
export async function uploadFileToR2(file: File, key: string): Promise<{ error?: string }> {
  try {
    const r2 = createR2Client()
    const buffer = Buffer.from(await file.arrayBuffer())
    await r2.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: file.type,
      })
    )
    return {}
  } catch (e: any) {
    console.error("R2 upload error:", e)
    return { error: e.message || "Upload failed" }
  }
}
