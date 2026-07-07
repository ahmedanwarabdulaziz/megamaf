"use server"

import { PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { createR2Client, R2_BUCKET } from "@/lib/r2"

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
