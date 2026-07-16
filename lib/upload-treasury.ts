/**
 * Upload a treasury payment attachment to its own R2 bucket via /api/upload-treasury.
 * Mirrors lib/upload.ts, kept separate so treasury attachments never touch the
 * general expenses/invoices/claims bucket.
 */
export async function uploadTreasuryFile(file: File, key: string): Promise<{ error?: string }> {
  const form = new FormData();
  form.append('file', file);
  form.append('key', key);

  const res = await fetch('/api/upload-treasury', {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error || 'Upload failed' };
  }

  return {};
}
