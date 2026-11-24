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

// ISO-BMFF (the container AVIF and HEIC use) is a tree of boxes: a 32-bit size
// that includes the 8-byte header, then a four-character type. Size 1 means a
// 64-bit size follows the type; size 0 means "runs to the end of the parent".
interface IsoBox {
  type: string;
  body: number;
  end: number;
}

function isoChildBoxes(bytes: Uint8Array, start: number, end: number): IsoBox[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes: IsoBox[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    let body = offset + 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      size = view.getUint32(offset + 8) * 2 ** 32 + view.getUint32(offset + 12);
      body = offset + 16;
    } else if (size === 0) {
      size = end - offset;
    }
    // A size smaller than its own header is corrupt, and would loop forever.
    if (size < body - offset) break;
    boxes.push({ type, body, end: Math.min(offset + size, end) });
    offset += size;
  }
  return boxes;
}

// AVIF keeps its dimensions in an 'ispe' (image spatial extent) property:
// ftyp, then meta > iprp > ipco > ispe, all inside the first few hundred bytes.
// 'meta' and 'ispe' are "full boxes" with 4 bytes of version/flags before their
// content.
//
// A file can hold several ispe boxes -- one per image item, so a grid image
// has the full canvas plus one per tile, and a thumbnail or alpha plane adds
// its own. The largest is the picture that is displayed. Resolving the primary
// item properly (pitm -> ipma) would be exact, but every file this has met
// agrees with the largest, and the answer only feeds a three-way aspect
// classification.
//
// 'irot' with an odd angle (90 or 270 degrees) means the stored pixels are
// rotated relative to how the image is shown, so width and height swap.
function parseIsoBmffDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const meta = isoChildBoxes(bytes, 0, bytes.length).find((b) => b.type === 'meta');
  if (!meta) return null;
  const iprp = isoChildBoxes(bytes, meta.body + 4, meta.end).find((b) => b.type === 'iprp');
  if (!iprp) return null;
  const ipco = isoChildBoxes(bytes, iprp.body, iprp.end).find((b) => b.type === 'ipco');
  if (!ipco) return null;

  let largest: { width: number; height: number } | null = null;
  let quarterTurn = false;
  for (const box of isoChildBoxes(bytes, ipco.body, ipco.end)) {
    if (box.type === 'ispe' && box.body + 12 <= box.end) {
      const width = view.getUint32(box.body + 4);
      const height = view.getUint32(box.body + 8);
      if (
        width > 0 &&
        height > 0 &&
        (!largest || width * height > largest.width * largest.height)
      ) {
        largest = { width, height };
      }
    } else if (box.type === 'irot' && box.body < box.end) {
      quarterTurn = (bytes[box.body] & 0x03) % 2 === 1;
    }
  }
  if (!largest) return null;
  return quarterTurn ? { width: largest.height, height: largest.width } : largest;
}

// Read width/height directly from PNG, GIF, JPEG, or AVIF header bytes.
// Lets us know the shape without downloading the whole file.
export function parseImageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  // AVIF / ISO-BMFF: an 'ftyp' box first. Webflow's CDN serves most uploads as
  // AVIF (scrapers/civicLeadership.ts); before this branch every one of them
  // came back null and was classified 'square' regardless of its shape.
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 && // f
    bytes[5] === 0x74 && // t
    bytes[6] === 0x79 && // y
    bytes[7] === 0x70 // p
  ) {
    return parseIsoBmffDimensions(bytes);
  }

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
