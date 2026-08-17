const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

const ALLOWED_ATTACHMENT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])

export function validateAttachmentUpload(file: File, key: string): string | null {
  if (!(file instanceof File) || !file.size) {
    return 'A valid non-empty file is required'
  }

  if (file.size > MAX_ATTACHMENT_BYTES) {
    return 'Files must be 10 MB or smaller'
  }

  if (!ALLOWED_ATTACHMENT_TYPES.has(file.type.toLowerCase())) {
    return 'Only PDF and common image files are allowed'
  }

  // Existing clients generate flat random filenames. Keep that contract while
  // preventing path traversal and arbitrary object prefixes.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(key)) {
    return 'Invalid attachment key'
  }

  return null
}
