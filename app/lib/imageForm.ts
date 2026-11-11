// Attaching a picked image (from expo-image-picker) to a FormData upload.
// Shared by anything that posts a photo — event flyers (OptionalExtras) and
// avatar photos (OnboardingComplete) — so the web/native branching only
// exists once.

import { File } from 'expo-file-system';
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
 * bytes (a Blob, fetched from the blob: URI the picker returns there).
 * Throws IMAGE_READ_FAILED if the web fetch of the local blob fails — the URI
 * came from the picker moments earlier, so a failure here means the file
 * became unreadable, not a network issue.
 *
 * NATIVE: NOT THE { uri, name, type } OBJECT ANY MORE (SDK 58). React Native's
 * own fetch streamed that shape from disk. SDK 58's global fetch is Expo's
 * (expo/src/winter/fetch), and its multipart encoder only accepts strings,
 * Blobs, or objects with a `bytes()` method -- anything else throws
 * "Unsupported FormDataPart implementation", which is what "Go to home" at
 * the end of onboarding hit for anyone who had picked a profile photo, and
 * what an event flyer upload would hit too.
 *
 * So the part is an object with `bytes()` reading through expo-file-system's
 * File, plus the `name` and `type` the encoder writes into the part headers.
 * A wrapper rather than the File itself because File.type is guessed from the
 * extension, and the server rejects anything outside ALLOWED_IMAGE_MIME_TYPES
 * -- the MIME type has to be the one worked out above, not a guess.
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

  const file = new File(image.uri);
  if (!file.exists) throw new Error('IMAGE_READ_FAILED');

  form.append(fieldName, {
    name: fileName,
    type: mimeType,
    bytes: () => file.bytes(),
  } as unknown as Blob);
}
