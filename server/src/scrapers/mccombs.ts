// McCombs scraper: calendar.mccombs.utexas.edu (LiveWhale).
//
// LiveWhale has no JSON API. We work around that with:
//   1. The sitemap at /sitemap.livewhale.xml lists every event page URL.
//   2. Each event page has a schema.org Event JSON-LD block for SEO,
//      which we parse for the actual event data.
//
// Things we can't get:
//   - rsvpUrl only appears if the organizer pasted a bare URL into the
//     description. LiveWhale doesn't expose the registration link itself.
//   - imageAltText is not in the JSON-LD.
//   - Tags / audience are not server-rendered, so no event_categories rows.
//
// Dedup key: numeric event id from the URL (".../event/11049-slug" -> "11049").

import { ingestEvents } from '../events/ingest';
import { classifyAspectRatio, fetchImageMeta } from '../events/normalize';
import { fetchWithRetry, sleep } from '../events/polite-fetch';
import type { NormalizedEvent } from '../events/types';
import type { Env } from '../worker';

const SITEMAP_INDEX_URL = 'https://calendar.mccombs.utexas.edu/sitemap.livewhale.xml';
export const SOURCE = 'mccombs';

const REQUEST_DELAY_MS = 200;
const DEFAULT_MAX_EVENTS = 500;
const DEFAULT_ORG_NAME = 'McCombs School of Business';

// schema.org Event shape, as LiveWhale renders it
interface LiveWhaleEventJsonLd {
  '@type': string;
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

interface ScraperResult {
  eventsProcessed: number;
  eventsUpserted: number;
  eventsSkipped: number;
  errors: string[];
  durationMs: number;
}

// Helpers, exported for unit tests

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export function cleanDescription(description: string | null | undefined): string | null {
  if (!description) return null;
  const cleaned = decodeHtmlEntities(description).replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

// LiveWhale flattens "Register now" links into plain text, so we can only
// catch RSVP links when the organizer pasted a bare URL into the body.
export function extractRsvpUrl(description: string | null | undefined): string | null {
  if (!description) return null;
  const match = decodeHtmlEntities(description).match(/https?:\/\/\S+/);
  if (!match) return null;
  return match[0].replace(/[.,)\]]+$/, '');
}

// Every organizer name has a "(McCombs School of Business - ...)"
// suffix appended. Strip it so we get the specific unit.
export function cleanHostOrganization(organizerName: string | null | undefined): string | null {
  if (!organizerName) return null;
  const decoded = decodeHtmlEntities(organizerName).trim();
  const stripped = decoded.replace(/\s*\(McCombs School of Business[^)]*\)\s*$/i, '');
  return stripped || decoded || null;
}

// "/event/11049-slug" -> "11049". Vanity slugs (no number) fall back
// to the URL path. Specific to LiveWhale URL structure.
export function extractMccombsEventId(eventUrl: string): string | null {
  const numeric = eventUrl.match(/\/event\/(\d+)/);
  if (numeric) return numeric[1];

  try {
    const path = new URL(eventUrl).pathname.replace(/^\/+|\/+$/g, '');
    return path || null;
  } catch {
    return null;
  }
}

// LiveWhale gives one "venue, street address" string. Take the part
// before the first comma as the venue.
export function buildLocationShort(location: string | null | undefined): string | null {
  if (!location) return null;
  const decoded = decodeHtmlEntities(location).trim();
  const firstSegment = decoded.split(',')[0].trim();
  const candidate = firstSegment || decoded;
  if (candidate.length <= 40) return candidate;
  return candidate.substring(0, 37) + '...';
}

export function buildLocationFull(location: string | null | undefined): string | null {
  if (!location) return null;
  const decoded = decodeHtmlEntities(location).trim();
  return decoded || null;
}

// LiveWhale serves resized images at .../live/image/gid/{id}/width/N/height/N/crop/1/src_region/.../file.
// Strip that segment to get the original upload URL. LiveWhale-specific.
export function upgradeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/\/width\/\d+\/height\/\d+\/crop\/\d+\/src_region\/[^/]+/, '');
}

// Sitemaps are simple and well-formed, so a regex works fine.
export function extractLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

function extractEventJsonLd(html: string): LiveWhaleEventJsonLd | null {
  const blocks = html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
  for (const block of blocks) {
    const raw = block[1]
      .replace(/\/\*<!\[CDATA\[\*\//, '')
      .replace(/\/\*\]\]>\*\//, '')
      .trim();
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed['@type'] === 'Event') return parsed;
    } catch {
      // Not the block we want. Keep looking.
    }
  }
  return null;
}

// Pure and sync so it's easy to test against saved HTML fixtures.
// The orchestrator fills in image width/height/mime after this runs,
// since those need a network round-trip that doesn't belong in a parser.
export function parseEventFromHtml(html: string, pageUrl: string): NormalizedEvent | null {
  const event = extractEventJsonLd(html);
  if (!event) {
    console.warn(`[mccombs] No Event JSON-LD found on ${pageUrl} — skipping`);
    return null;
  }

  const eventUrl = event.url || pageUrl;
  const sourceEventId = extractMccombsEventId(eventUrl);
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
  const orgName = cleanHostOrganization(event.organizer?.name) ?? DEFAULT_ORG_NAME;

  return {
    source: SOURCE,
    sourceEventId,
    title: decodeHtmlEntities(event.name || '').trim(),
    description,
    startDatetime: event.startDate,
    endDatetime: event.endDate ?? null,
    locationShort: buildLocationShort(locationString),
    locationFull: buildLocationFull(locationString),
    latitude: null,
    longitude: null,
    organization: {
      // Departments have no numeric id, so ingest skips the org row.
      sourceOrgId: null,
      name: orgName,
      profilePicture: null,
    },
    eventUrl,
    rsvpUrl: extractRsvpUrl(description),
    imageUrl,
    // fetchImageMeta() fills these in later when imageUrl is set.
    imageWidth: null,
    imageHeight: null,
    imageAspectRatio: imageUrl ? 'horizontal' : 'none',
    imageMimeType: null,
    imageAltText: null,
    theme: null,
    visibility: 'Public',
    rsvpTotal: 0,
    categories: [],
    benefits: [],
  };
}

export async function discoverEventUrls(): Promise<string[]> {
  const indexRes = await fetchWithRetry(SITEMAP_INDEX_URL, { headers: { Accept: '*/*' } });
  const indexXml = await indexRes.text();
  const sitemapUrls = extractLocs(indexXml);

  const eventUrls = new Set<string>();
  for (const sitemapUrl of sitemapUrls) {
    const res = await fetchWithRetry(sitemapUrl, { headers: { Accept: '*/*' } });
    const xml = await res.text();
    for (const loc of extractLocs(xml)) eventUrls.add(loc);
  }
  return [...eventUrls];
}

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
    return {
      eventsProcessed: 0,
      eventsUpserted: 0,
      eventsSkipped: 0,
      errors: [msg],
      durationMs: Date.now() - t0,
    };
  }

  console.log(`[mccombs] Discovered ${eventUrls.length} event URLs`);

  const normalized: NormalizedEvent[] = [];

  for (const url of eventUrls.slice(0, maxEvents)) {
    eventsProcessed++;
    try {
      const res = await fetchWithRetry(url, { headers: { Accept: '*/*' } });
      const html = await res.text();
      const parsed = parseEventFromHtml(html, url);
      if (!parsed) {
        eventsSkipped++;
        continue;
      }

      if (parsed.imageUrl) {
        const meta = await fetchImageMeta(parsed.imageUrl, 'mccombs');
        parsed.imageWidth = meta.width;
        parsed.imageHeight = meta.height;
        parsed.imageMimeType = meta.mimeType;
        // Only override the "horizontal" default when we actually know the
        // dimensions. An unreadable header keeps the safe fallback.
        // Tighter 5% tolerance since dimensions came from the real header.
        if (meta.width && meta.height) {
          parsed.imageAspectRatio = classifyAspectRatio(meta.width, meta.height, true, 0.05);
        }
      }

      if (dryRun) {
        console.log(
          `[DRY RUN] "${parsed.title}" (${parsed.sourceEventId}) — ${parsed.organization.name}`,
        );
      } else {
        normalized.push(parsed);
      }
    } catch (err) {
      const msg = `Failed to process ${url}: ${err}`;
      console.error(`[mccombs] ${msg}`);
      errors.push(msg);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  if (!dryRun && normalized.length > 0) {
    const result = await ingestEvents(db, normalized);
    eventsUpserted = result.inserted + result.updated;
    errors.push(...result.errors);
  }

  const durationMs = Date.now() - t0;
  console.log(
    `[mccombs] Finished in ${(durationMs / 1000).toFixed(1)}s — ${eventsUpserted} upserted, ${eventsSkipped} skipped, ${errors.length} errors`,
  );

  return { eventsProcessed, eventsUpserted, eventsSkipped, errors, durationMs };
}

export async function run(env: Env): Promise<void> {
  console.log('[mccombs] Scraper started');
  await scrapeMccombs(env.DB);
}
