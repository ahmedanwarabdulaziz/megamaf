import { NextRequest, NextResponse } from 'next/server';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { createR2Client, R2_BUCKET_TREASURY } from '@/lib/r2';
import { createClient } from '@/lib/supabase/server';
import { validateAttachmentUpload } from '@/lib/upload-validation';

/** Uploads treasury payment attachments to their own R2 bucket (see lib/r2.ts). */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const formData = await req.formData();
    const file = formData.get('file');
    const key = formData.get('key');

    if (!(file instanceof File) || typeof key !== 'string') {
      return NextResponse.json({ error: 'Missing file or key' }, { status: 400 });
    }

    const validationError = validateAttachmentUpload(file, key);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const r2 = createR2Client();
    await r2.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET_TREASURY,
        Key: key,
        Body: buffer,
        ContentType: file.type,
      })
    );

    return NextResponse.json({ success: true, key });
  } catch (e: unknown) {
    console.error('R2 treasury upload error:', e);
    const message = e instanceof Error ? e.message : 'Upload failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
