// Source-agnostic cleanup helpers used by scraper toNormalizedEvent() mappers.

import { fetchWithRetry } from './polite-fetch';
import type { ImageAspectRatio } from './types';

export function stripHtml(html: string | null): string | null {
  if (!html) return null;
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '”')
    .replace(/&ldquo;/g, '“')
    .replace(/&oacute;/g, 'ó')
    .replace(/&le;/g, '≤')
    .replace(/&ge;/g, '≥')
    .replace(/&times;/g, '×')
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncateLocation(location: string | null, maxLength = 40): string | null {
  if (!location) return null;
  if (location.length <= maxLength) return location;
  return location.substring(0, maxLength - 3) + '...';
}

// tolerance is the +/- band around 1.0 that still counts as "square".
// Default 0.2 for scrapers with unreliable dimensions. Scrapers that read
// real image headers (McCombs) can pass a tighter value like 0.05.
export function classifyAspectRatio(
  width: number | null | undefined,
  height: number | null | undefined,
  hasImage: boolean,
  tolerance: number = 0.2,
): ImageAspectRatio {
  if (!hasImage) return 'none';
  if (!width || !height || width <= 0 || height <= 0) return 'square';
  const ratio = width / height;
  if (ratio > 1 + tolerance) return 'horizontal';
  if (ratio < 1 - tolerance) return 'vertical';
  return 'square';
}

export function buildAbsoluteUrl(base: string, path: string | null): string | null {
  if (!path) return null;
  return `${base}${path}`;
}

export function parseCoordinate(raw: string | null): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

// Read width/height directly from PNG, GIF, or JPEG header bytes.
// Lets us know the shape without downloading the whole file.
export function parseImageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  // PNG: 8-byte signature, then IHDR with width at offset 16, height at 20 (BE uint32).
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  // GIF: 6-byte signature, then width at offset 6, height at 8 (LE uint16).
  if (bytes.length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }

  // JPEG: walk segments looking for a Start-Of-Frame marker (0xC0 to 0xCF,
  // excluding 0xC4/0xC8/0xCC which mean other things).
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = bytes[offset + 1];
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return {
          height: view.getUint16(offset + 5),
          width: view.getUint16(offset + 7),
        };
      }
      const segmentLength = view.getUint16(offset + 2);
      offset += 2 + segmentLength;
    }
  }

  return null;
}

export interface ImageMeta {
  width: number | null;
  height: number | null;
  mimeType: string | null;
}

// Range-reads the first 64KB of an image. Enough for the header without
// downloading a multi-MB flyer. Returns nulls on any failure so callers
// can fall back to unknown dimensions. logTag identifies which scraper
// is calling for cleaner log lines.
export async function fetchImageMeta(
  imageUrl: string,
  logTag: string = 'image-meta',
): Promise<ImageMeta> {
  try {
    const res = await fetchWithRetry(imageUrl, {
      headers: { Accept: '*/*', Range: 'bytes=0-65535' },
    });
    const mimeType = res.headers.get('content-type');
    const bytes = new Uint8Array(await res.arrayBuffer());
    const dims = parseImageDimensions(bytes);
    return { width: dims?.width ?? null, height: dims?.height ?? null, mimeType };
  } catch (err) {
    console.warn(`[${logTag}] Failed to read image metadata for ${imageUrl}: ${err}`);
    return { width: null, height: null, mimeType: null };
  }
}
