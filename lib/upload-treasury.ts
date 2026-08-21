/** Upload a vendor-payment file; the authenticated server creates the R2 key. */
export async function uploadTreasuryFile(file: File): Promise<{ key?: string; error?: string }> {
  const form = new FormData();
  form.append('file', file);
  form.append('purpose', 'vendor_payment');

  const res = await fetch('/api/upload-treasury', {
    method: 'POST',
    body: form,
  });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) return { error: body.error || 'Upload failed' };
  if (typeof body.key !== 'string') return { error: 'Upload completed without a file key' };

  return { key: body.key };
}
