import type { AttachmentPurpose } from '@/lib/attachment-security';

/** Upload through the authenticated server route; the server creates the R2 key. */
export async function uploadFile(
  file: File,
  purpose: Exclude<AttachmentPurpose, 'vendor_payment'>,
): Promise<{ key?: string; error?: string }> {
  const form = new FormData();
  form.append('file', file);
  form.append('purpose', purpose);

  const res = await fetch('/api/upload', {
    method: 'POST',
    body: form,
  });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) return { error: body.error || 'Upload failed' };
  if (typeof body.key !== 'string') return { error: 'Upload completed without a file key' };

  return { key: body.key };
}
