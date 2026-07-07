/**
 * Upload a file to R2 via the server-side /api/upload route.
 * This avoids CORS issues that occur when uploading directly to R2 from the browser.
 */
export async function uploadFile(file: File, key: string): Promise<{ error?: string }> {
  const form = new FormData();
  form.append('file', file);
  form.append('key', key);

  const res = await fetch('/api/upload', {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error || 'Upload failed' };
  }

  return {};
}
