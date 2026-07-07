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
