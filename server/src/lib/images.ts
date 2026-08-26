// Shared primitives for handling uploaded image bytes, used by any route that
// accepts a multipart file (event flyers in events.worker.ts, profile photos
// in users.worker.ts). Extracted so both stay pinned to the same allowed
// types, size cap, and extension mapping instead of drifting independently.

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

export function isFileLike(value: FormDataEntryValue): value is File {
  return typeof File !== 'undefined' && value instanceof File;
}

export function extensionForMimeType(mimeType: string, filename: string | null): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/gif') return 'gif';
  if (mimeType === 'image/webp') return 'webp';
  const filenameMatch = filename?.match(/\.([a-z0-9]+)$/i);
  return filenameMatch?.[1].toLowerCase() ?? 'bin';
}
