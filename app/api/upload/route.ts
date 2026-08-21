import { NextRequest, NextResponse } from 'next/server';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { createR2Client, R2_BUCKET } from '@/lib/r2';
import { validateAttachmentUpload } from '@/lib/upload-validation';
import { getProfile } from '@/lib/supabase/get-profile';
import { canUploadAttachment, createAttachmentKey } from '@/lib/attachment-security';

export async function POST(req: NextRequest) {
  try {
    const { user, profile } = await getProfile();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!profile || profile.is_active === false) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const formData = await req.formData();
    const file = formData.get('file');
    const purpose = formData.get('purpose');

    if (!(file instanceof File) || typeof purpose !== 'string') {
      return NextResponse.json({ error: 'Missing file or purpose' }, { status: 400 });
    }

    if (!canUploadAttachment(profile, purpose, 'general')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const validationError = validateAttachmentUpload(file);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const key = createAttachmentKey(file);
    if (!key) return NextResponse.json({ error: 'Invalid attachment type' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());

    const r2 = createR2Client();
    await r2.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: file.type,
      })
    );

    return NextResponse.json({ success: true, key }, { status: 201 });
  } catch (e: unknown) {
    console.error('R2 upload error:', e);
    const message = e instanceof Error ? e.message : 'Upload failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
