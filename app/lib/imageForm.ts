// Attaching a picked image (from expo-image-picker) to a FormData upload.
// Shared by anything that posts a photo — event flyers (OptionalExtras) and
// avatar photos (OnboardingComplete) — so the web/native branching only
// exists once.

import { Platform } from 'react-native';

export function getFileNameFromUri(uri: string, fallback: string): string {
  const withoutQuery = uri.split('?')[0] ?? uri;
  const lastSegment = withoutQuery.split('/').filter(Boolean).pop();
  if (!lastSegment) return fallback;

  try {
    return decodeURIComponent(lastSegment);
  } catch {
    return lastSegment;
  }
}

export function inferImageMimeType(fileName: string, pickerMimeType: string | null): string {
  if (pickerMimeType?.startsWith('image/')) return pickerMimeType;

  const extension = fileName.split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'webp') return 'image/webp';
  return 'image/jpeg';
}

/**
 * Appends a picked image to `form` under `fieldName`. Web needs the actual
 * bytes (a Blob, fetched from the blob: URI the picker returns there);
 * native can hand the file URI straight to FormData and let the platform
 * stream it. Throws IMAGE_READ_FAILED if the web fetch of the local blob
 * fails — the URI came from the picker moments earlier, so a failure here
 * means the file became unreadable, not a network issue.
 */
export async function appendImageFile(
  form: FormData,
  fieldName: string,
  image: { uri: string; name: string | null; mimeType: string | null },
): Promise<void> {
  const fileName = image.name ?? getFileNameFromUri(image.uri, `${fieldName}.jpg`);
  const mimeType = inferImageMimeType(fileName, image.mimeType);

  if (Platform.OS === 'web') {
    const response = await fetch(image.uri);
    if (!response.ok) throw new Error('IMAGE_READ_FAILED');

    const blob = await response.blob();
    const uploadBlob =
      blob.type === mimeType ? blob : new Blob([await blob.arrayBuffer()], { type: mimeType });
    form.append(fieldName, uploadBlob, fileName);
    return;
  }

  form.append(fieldName, {
    uri: image.uri,
    name: fileName,
    type: mimeType,
  } as unknown as Blob);
}
