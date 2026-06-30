/**
 * McCombs Events scraper — pulls events from calendar.mccombs.utexas.edu
 * (a LiveWhale Calendar instance) and upserts them into D1.
 *
 * LiveWhale doesn't expose a public JSON API the way Localist does (the
 * in-page calendar widget hydrates client-side via an undocumented AJAX
 * endpoint that requires an obfuscated "widget syntax" token we can't
 * reproduce server-side). Instead we use two things LiveWhale *does* render
 * server-side and that are stable/documented:
 *
 *  1. `/sitemap.livewhale.xml` -> `/sitemap.events.xml` — a standard XML
 *     sitemap listing every event page URL across all McCombs sub-calendars
 *     (Alumni, GSLI, McCombs+, BBA, MBA programs, etc). This is our
 *     discovery/pagination mechanism.
 *  2. Each event page embeds a schema.org `Event` JSON-LD block
 *     (`<script type="application/ld+json">`) for SEO. This is our data
 *     source — title, dates, location, organizer, and (when present) a
 *     flyer image.
 *
 * Caveats this approach inherits (documented rather than papered over):
 *  - `rsvp_url` is only populated when an event's description happens to
 *    contain a literal URL — LiveWhale doesn't expose registration links
 *    as structured data server-side.
 *  - `image_alt_text` is never available — not present in the JSON-LD.
 *  - Per-event tags/audience aren't exposed server-side either, so we don't
 *    write to `event_categories` for this source (see LOOP-147 discussion;
 *    the `events` table also has no `tags`/`audience` column to fill).
 *
 * Deduplication key: (source, source_event_id) = ("mccombs", numeric event ID
 * parsed out of the event URL, e.g. ".../event/11049-some-slug" -> "11049").
 */

import type { Env } from "../worker";

const SITEMAP_INDEX_URL =
  "https://calendar.mccombs.utexas.edu/sitemap.livewhale.xml";
const USER_AGENT = "LonghornLoop/1.0 (+https://longhornloop.app)";
export const SOURCE = "mccombs";

// Polite scraping settings — sequential fetches with a short delay between
// event pages, plus a hard cap so a single cron run can't run away.
const REQUEST_DELAY_MS = 200;
const DEFAULT_MAX_EVENTS = 500;

// ─── JSON-LD shape (schema.org Event, as rendered by LiveWhale) ───────────

interface LiveWhaleEventJsonLd {
  "@type": string;
  name: string;
  startDate: string;
  endDate?: string;
  url: string;
  description?: string;
  location?: {
    name?: string;
    address?: { streetAddress?: string };
  }[];
  organizer?: { name?: string };
  image?: { url?: string; width?: number; height?: number };
}

// ─── Output type ──────────────────────────────────────────────────────────

export interface ParsedEvent {
  source: string;
  source_event_id: string;
  title: string;
  description: string | null;
  start_datetime: string;
  end_datetime: string | null;
  location_short: string | null;
  location_full: string | null;
  host_organization_name: string | null;
  event_url: string;
  rsvp_url: string | null;
  image_url: string | null;
  image_width: number | null;
  image_height: number | null;
  image_aspect_ratio: "vertical" | "square" | "horizontal" | "none";
  image_mime_type: string | null;
  image_alt_text: string | null;
}

interface ScraperResult {
  eventsProcessed: number;
  eventsUpserted: number;
  eventsSkipped: number;
  errors: string[];
  durationMs: number;
}

// ─── Pure helper functions (exported for unit tests) ──────────────────────

/** Decode the small set of HTML entities LiveWhale leaves in JSON-LD text. */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** Collapse the multi-space runs left behind when LiveWhale strips HTML tags. */
export function cleanDescription(
  description: string | null | undefined,
): string | null {
  if (!description) return null;
  const cleaned = decodeHtmlEntities(description).replace(/\s+/g, " ").trim();
  return cleaned || null;
}

/**
 * Find the first literal URL inside a description and treat it as the
 * registration / RSVP link. LiveWhale renders "Register now" as plain text
 * (the anchor's href is lost), so this only catches the case where an
 * organizer pastes a bare URL into the description body.
 */
export function extractRsvpUrl(
  description: string | null | undefined,
): string | null {
  if (!description) return null;
  const match = decodeHtmlEntities(description).match(/https?:\/\/\S+/);
  if (!match) return null;
  return match[0].replace(/[.,)\]]+$/, "");
}

/**
 * Strip the "Org Name (McCombs School of Business - The University of Texas
 * at Austin)" boilerplate suffix LiveWhale appends to every organizer name,
 * leaving the specific department/center/program (e.g. "MSITM",
 * "Herb Kelleher Center").
 */
export function cleanHostOrganization(
  organizerName: string | null | undefined,
): string | null {
  if (!organizerName) return null;
  const decoded = decodeHtmlEntities(organizerName).trim();
  const stripped = decoded.replace(/\s*\(McCombs School of Business[^)]*\)\s*$/i, "");
  return stripped || decoded || null;
}

/**
 * Extract a stable dedup ID from an event URL. Most events get a numeric ID
 * LiveWhale embeds right after "/event/" (e.g. "/event/11049-some-slug" ->
 * "11049"). Some organizers opt into a vanity slug instead
 * (e.g. "/event/career-expo", with no number at all) — for those, fall
 * back to the full URL path, which is still unique and stable site-wide.
 */
export function extractSourceEventId(eventUrl: string): string | null {
  const numeric = eventUrl.match(/\/event\/(\d+)/);
  if (numeric) return numeric[1];

  try {
    const path = new URL(eventUrl).pathname.replace(/^\/+|\/+$/g, "");
    return path || null;
  } catch {
    return null;
  }
}

/**
 * Build a display-friendly short location (≤ 40 chars). LiveWhale gives us
 * one combined "venue, street address" string — we take the part before the
 * first comma as the venue name when there is one.
 */
export function buildLocationShort(
  location: string | null | undefined,
): string | null {
  if (!location) return null;
  const decoded = decodeHtmlEntities(location).trim();
  const firstSegment = decoded.split(",")[0].trim();
  const candidate = firstSegment || decoded;
  if (candidate.length <= 40) return candidate;
  return candidate.substring(0, 37) + "...";
}

export function buildLocationFull(
  location: string | null | undefined,
): string | null {
  if (!location) return null;
  const decoded = decodeHtmlEntities(location).trim();
  return decoded || null;
}

/**
 * Classify the aspect ratio of an image. Uses a 5% tolerance band so a
 * 1000×999 image reads as "square" not "horizontal". Returns "none" when
 * dimensions are absent (no image).
 */
export function classifyAspectRatio(
  width: number | null | undefined,
  height: number | null | undefined,
): "vertical" | "square" | "horizontal" | "none" {
  if (!width || !height || width <= 0 || height <= 0) return "none";
  const ratio = width / height;
  if (ratio > 1.05) return "horizontal";
  if (ratio < 0.95) return "vertical";
  return "square";
}

/**
 * LiveWhale serves resized/cropped variants at URLs like
 * `/live/image/gid/{id}/width/600/height/600/crop/1/src_region/.../file.png`.
 * Stripping the width/height/crop/src_region segment returns the original
 * full-resolution upload at `/live/image/gid/{id}/file.png`.
 */
export function upgradeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/\/width\/\d+\/height\/\d+\/crop\/\d+\/src_region\/[^/]+/, "");
}

/**
 * Parse width/height out of raw image bytes (PNG, JPEG, or GIF headers).
 * Returns null when the format isn't recognized or there aren't enough
 * bytes to read the header — callers should treat that as "unknown",
 * not an error.
 */
export function parseImageDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  // PNG: 8-byte signature, then an IHDR chunk with width/height as
  // big-endian uint32s at offsets 16 and 20.
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

  // GIF: 6-byte signature, then width/height as little-endian uint16s.
  if (
    bytes.length >= 10 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }

  // JPEG: walk the marker segments looking for a Start-Of-Frame marker
  // (0xC0–0xCF, excluding the DHT/JPG markers 0xC4, 0xC8, 0xCC).
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
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

// ─── XML sitemap parsing (regex-based — sitemaps are simple, well-formed) ─

export function extractLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

// ─── JSON-LD extraction + event parsing ────────────────────────────────────

function extractEventJsonLd(html: string): LiveWhaleEventJsonLd | null {
  const blocks = html.matchAll(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
  );
  for (const block of blocks) {
    const raw = block[1]
      .replace(/\/\*<!\[CDATA\[\*\//, "")
      .replace(/\/\*\]\]>\*\//, "")
      .trim();
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed["@type"] === "Event") return parsed;
    } catch {
      // Not valid JSON (or not the block we want) — keep looking.
    }
  }
  return null;
}

/**
 * Parse one event detail page into our normalized shape. Pure/sync so it
 * can be unit-tested directly against saved HTML fixtures — image
 * width/height/mime are filled in afterward by the orchestrator, which
 * needs a network round trip the parser itself shouldn't make.
 */
export function parseEventFromHtml(
  html: string,
  pageUrl: string,
): ParsedEvent | null {
  const event = extractEventJsonLd(html);
  if (!event) {
    console.warn(`[mccombs] No Event JSON-LD found on ${pageUrl} — skipping`);
    return null;
  }

  const eventUrl = event.url || pageUrl;
  const sourceEventId = extractSourceEventId(eventUrl);
  if (!sourceEventId) {
    console.warn(`[mccombs] Could not extract event ID from ${eventUrl} — skipping`);
    return null;
  }

  if (!event.startDate) {
    console.warn(`[mccombs] Event ${sourceEventId} missing startDate — skipping`);
    return null;
  }

  const place = event.location?.[0];
  const locationString = place?.address?.streetAddress || place?.name || null;
  const description = cleanDescription(event.description);
  const imageUrl = upgradeImageUrl(event.image?.url);

  return {
    source: SOURCE,
    source_event_id: sourceEventId,
    title: decodeHtmlEntities(event.name || "").trim(),
    description,
    start_datetime: event.startDate,
    end_datetime: event.endDate ?? null,
    location_short: buildLocationShort(locationString),
    location_full: buildLocationFull(locationString),
    host_organization_name: cleanHostOrganization(event.organizer?.name),
    event_url: eventUrl,
    rsvp_url: extractRsvpUrl(description),
    image_url: imageUrl,
    // Filled in by fetchImageMeta() in the orchestrator when image_url is set.
    image_width: null,
    image_height: null,
    image_aspect_ratio: imageUrl ? "horizontal" : "none",
    image_mime_type: null,
    image_alt_text: null,
  };
}

// ─── Fetchers ───────────────────────────────────────────────────────────

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} — ${url}`);
  }
  return res.text();
}

/** Discover every event page URL via the LiveWhale sitemap. */
export async function discoverEventUrls(): Promise<string[]> {
  const indexXml = await fetchText(SITEMAP_INDEX_URL);
  const sitemapUrls = extractLocs(indexXml);

  const eventUrls = new Set<string>();
  for (const sitemapUrl of sitemapUrls) {
    const xml = await fetchText(sitemapUrl);
    for (const loc of extractLocs(xml)) eventUrls.add(loc);
  }
  return [...eventUrls];
}

/**
 * Fetch just enough of an image to read its header (width/height) and its
 * Content-Type, without downloading the whole (possibly multi-MB) file.
 */
async function fetchImageMeta(
  imageUrl: string,
): Promise<{ width: number | null; height: number | null; mimeType: string | null }> {
  try {
    const res = await fetch(imageUrl, {
      headers: { "User-Agent": USER_AGENT, Range: "bytes=0-65535" },
    });
    if (!res.ok && res.status !== 206) {
      return { width: null, height: null, mimeType: null };
    }
    const mimeType = res.headers.get("content-type");
    const bytes = new Uint8Array(await res.arrayBuffer());
    const dims = parseImageDimensions(bytes);
    return { width: dims?.width ?? null, height: dims?.height ?? null, mimeType };
  } catch (err) {
    console.warn(`[mccombs] Failed to read image metadata for ${imageUrl}: ${err}`);
    return { width: null, height: null, mimeType: null };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── D1 upsert ────────────────────────────────────────────────────────────

const UPSERT_SQL = `
  INSERT INTO events (
    source, source_event_id, title, description,
    start_datetime, end_datetime,
    location_short, location_full,
    host_organization_id, host_organization_name,
    event_url, rsvp_url,
    image_url, image_width, image_height, image_aspect_ratio,
    image_mime_type, image_alt_text,
    expires_at,
    visibility, status, updated_at
  ) VALUES (
    ?, ?, ?, ?,
    ?, ?,
    ?, ?,
    NULL, ?,
    ?, ?,
    ?, ?, ?, ?,
    ?, ?,
    ?,
    'Public', 'active', datetime('now')
  )
  ON CONFLICT(source, source_event_id) DO UPDATE SET
    title                  = excluded.title,
    description            = excluded.description,
    start_datetime         = excluded.start_datetime,
    end_datetime           = excluded.end_datetime,
    location_short         = excluded.location_short,
    location_full          = excluded.location_full,
    host_organization_name = excluded.host_organization_name,
    event_url              = excluded.event_url,
    rsvp_url               = excluded.rsvp_url,
    image_url              = excluded.image_url,
    image_width            = excluded.image_width,
    image_height           = excluded.image_height,
    image_aspect_ratio     = excluded.image_aspect_ratio,
    image_mime_type        = excluded.image_mime_type,
    image_alt_text         = excluded.image_alt_text,
    expires_at              = excluded.expires_at,
    updated_at              = datetime('now')
`;

// Purge target for the cleanup job (LOOP-150): end time + 7 days, falling
// back to the start time when an event has no end time.
const EXPIRES_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function computeExpiresAt(endDatetime: string | null, startDatetime: string): string {
  const base = endDatetime ?? startDatetime;
  return new Date(new Date(base).getTime() + EXPIRES_AFTER_MS).toISOString();
}

async function upsertEvent(db: D1Database, e: ParsedEvent): Promise<void> {
  const expiresAt = computeExpiresAt(e.end_datetime, e.start_datetime);

  await db
    .prepare(UPSERT_SQL)
    .bind(
      e.source,
      e.source_event_id,
      e.title,
      e.description,
      e.start_datetime,
      e.end_datetime,
      e.location_short,
      e.location_full,
      e.host_organization_name,
      e.event_url,
      e.rsvp_url,
      e.image_url,
      e.image_width,
      e.image_height,
      e.image_aspect_ratio,
      e.image_mime_type,
      e.image_alt_text,
      expiresAt,
    )
    .run();
}

// ─── Orchestrator ─────────────────────────────────────────────────────────

export async function scrapeMccombs(
  db: D1Database,
  options: { maxEvents?: number; dryRun?: boolean } = {},
): Promise<ScraperResult> {
  const dryRun = options.dryRun ?? false;
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  const t0 = Date.now();

  const errors: string[] = [];
  let eventsProcessed = 0;
  let eventsUpserted = 0;
  let eventsSkipped = 0;

  let eventUrls: string[];
  try {
    eventUrls = await discoverEventUrls();
  } catch (err) {
    const msg = `Fatal error discovering event URLs: ${err}`;
    console.error(`[mccombs] ${msg}`);
    return { eventsProcessed: 0, eventsUpserted: 0, eventsSkipped: 0, errors: [msg], durationMs: Date.now() - t0 };
  }

  console.log(`[mccombs] Discovered ${eventUrls.length} event URLs`);

  for (const url of eventUrls.slice(0, maxEvents)) {
    eventsProcessed++;
    try {
      const html = await fetchText(url);
      const parsed = parseEventFromHtml(html, url);
      if (!parsed) {
        eventsSkipped++;
        continue;
      }

      if (parsed.image_url) {
        const meta = await fetchImageMeta(parsed.image_url);
        parsed.image_width = meta.width;
        parsed.image_height = meta.height;
        parsed.image_mime_type = meta.mimeType;
        // Only override the "horizontal" default once we actually know the
        // real dimensions — an unreadable header keeps the safe default.
        if (meta.width && meta.height) {
          parsed.image_aspect_ratio = classifyAspectRatio(meta.width, meta.height);
        }
      }

      if (dryRun) {
        console.log(
          `[DRY RUN] Event: ${parsed.title} (${parsed.source_event_id}) — ${parsed.host_organization_name ?? "no org"}`,
        );
      } else {
        await upsertEvent(db, parsed);
        eventsUpserted++;
      }
    } catch (err) {
      const msg = `Failed to process ${url}: ${err}`;
      console.error(`[mccombs] ${msg}`);
      errors.push(msg);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  const durationMs = Date.now() - t0;
  console.log(
    `[mccombs] Finished in ${(durationMs / 1000).toFixed(1)}s — ${eventsUpserted} upserted, ${eventsSkipped} skipped, ${errors.length} errors`,
  );

  return { eventsProcessed, eventsUpserted, eventsSkipped, errors, durationMs };
}

/** Called by the scheduled cron handler in worker.ts. */
export async function run(env: Env): Promise<void> {
  console.log("[mccombs] Scraper started");
  await scrapeMccombs(env.DB);
}
