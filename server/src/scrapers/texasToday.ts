// Texas Today scraper: calendar.utexas.edu (Localist JSON API).
// Dedup key: instance_id, not event_id, so recurring events get one row
// per occurrence.

import { ingestEvents } from '../events/ingest';
import { classifyAspectRatio, stripHtml } from '../events/normalize';
import { fetchWithRetry } from '../events/polite-fetch';
import type { ImageAspectRatio, NormalizedEvent } from '../events/types';
import type { Env } from '../worker';

const BASE_URL = 'https://calendar.utexas.edu';
const API_BASE = `${BASE_URL}/api/2/events`;
const PER_PAGE = 100;
const DAYS_AHEAD = 30;
export const SOURCE = 'texas_today';

// Localist API types

interface LocalistEventInstance {
  event_instance: {
    id: number;
    event_id: number;
    start: string; // ISO 8601 with America/Chicago offset
    end: string | null;
    all_day: boolean;
  };
}

export interface LocalistDepartment {
  name: string;
  url: string;
  localist_url: string;
  hashtag: string;
}

export interface LocalistRawEvent {
  event: {
    id: number;
    title: string;
    description: string | null;
    location: string | null;
    room: string | null;
    address: string | null;
    url: string;
    localist_url: string;
    event_instances: LocalistEventInstance[];
    photo_url: string | null;
    photo_width: number | null;
    photo_height: number | null;
    photo_alt: string | null;
    photo_content_type: string | null;
    departments: LocalistDepartment[];
    filters: Record<string, Array<{ name: string; id: number }>>;
    tags: string[];
    keywords: string[];
  };
}

interface LocalistApiResponse {
  events: LocalistRawEvent[];
  page: {
    current: number;
    size: number;
    total: number; // total number of PAGES, not events
  };
}

// Strips trailing street address so "Gregory Gym (GRE), 2101 Speedway"
// becomes "Gregory Gym (GRE)".
export function buildLocationShort(location: string | null | undefined): string | null {
  if (!location) return null;
  const stripped = location.replace(/,\s*\d+[^,]*$/, '').trim();
  const candidate = stripped || location.trim();
  if (candidate.length <= 40) return candidate;
  return candidate.substring(0, 37) + '...';
}

export function buildLocationFull(
  location: string | null | undefined,
  address: string | null | undefined,
): string | null {
  const parts = [location?.trim(), address?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

// Localist serves images at /thumb/, /medium/, /small/, /huge/.
// /huge/ is the original upload.
export function upgradeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url
    .replace(/\/thumb\//, '/huge/')
    .replace(/\/medium\//, '/huge/')
    .replace(/\/small\//, '/huge/');
}

// Returns null when required fields are missing.
export function parseEventInstance(
  raw: LocalistRawEvent,
  instance: LocalistEventInstance,
): NormalizedEvent | null {
  const e = raw.event;
  const inst = instance.event_instance;

  if (!inst.start) {
    console.warn(`[texasToday] Event ${e.id} instance ${inst.id} missing start time — skipping`);
    return null;
  }

  // First department is what the event submitter chose in the Localist UI.
  // Usually the school or office that owns the event (e.g. "McCombs School
  // of Business"). We only take the first; extras are rare on this feed.
  const dept = e.departments?.[0] ?? null;

  // Categories combine free-form tags with the event_type filter labels.
  const seen = new Set<string>();
  const categories: Array<{ id: string; name: string | null }> = [];
  for (const tag of [...(e.tags ?? []), ...(e.filters?.event_types?.map((t) => t.name) ?? [])]) {
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      categories.push({ id: tag.toLowerCase().replace(/\s+/g, '-'), name: tag });
    }
  }

  const imageUrl = upgradeImageUrl(e.photo_url);
  const hasImage = Boolean(imageUrl);

  // Localist sometimes omits width/height. Fall back to "horizontal"
  // since most flyers are landscape.
  let aspect: ImageAspectRatio = 'none';
  if (hasImage) {
    const classified = classifyAspectRatio(e.photo_width, e.photo_height, true);
    aspect = classified === 'square' && !e.photo_width ? 'horizontal' : classified;
  }

  return {
    source: SOURCE,
    sourceEventId: String(inst.id),
    title: e.title,
    description: stripHtml(e.description),
    startDatetime: inst.start,
    endDatetime: inst.end ?? null,
    // Fall back to the street address when Localist has no named venue.
    // Research studies and off-campus events often lack e.location.
    locationShort: buildLocationShort(e.location || e.address),
    locationFull: buildLocationFull(e.location, e.address),
    latitude: null,
    longitude: null,
    organization: {
      // Departments have no numeric id, so ingest skips the org row.
      sourceOrgId: null,
      name: dept?.name ?? 'The University of Texas at Austin',
      profilePicture: null,
    },
    eventUrl: e.localist_url || e.url,
    rsvpUrl: null,
    imageUrl,
    imageAspectRatio: aspect,
    imageWidth: hasImage ? (e.photo_width ?? null) : null,
    imageHeight: hasImage ? (e.photo_height ?? null) : null,
    imageMimeType: hasImage ? (e.photo_content_type ?? null) : null,
    imageAltText: hasImage ? (e.photo_alt ?? null) : null,
    theme: null,
    visibility: 'Public',
    rsvpTotal: 0,
    categories,
    benefits: [],
  };
}

// One raw event has N instances (recurrences). Emit one NormalizedEvent
// per future instance.
export function parseEvent(raw: LocalistRawEvent, now = Date.now()): NormalizedEvent[] {
  const instances = raw.event?.event_instances ?? [];
  if (instances.length === 0) {
    console.warn(`[texasToday] Event ${raw.event?.id} has no instances — skipping`);
    return [];
  }

  const results: NormalizedEvent[] = [];
  for (const inst of instances) {
    const startMs = new Date(inst.event_instance.start).getTime();
    if (isNaN(startMs) || startMs < now) continue;

    try {
      const parsed = parseEventInstance(raw, inst);
      if (parsed) results.push(parsed);
    } catch (err) {
      console.error(
        `[texasToday] Failed to parse instance ${inst.event_instance.id} of event ${raw.event?.id}: ${err}`,
      );
    }
  }
  return results;
}

async function fetchPage(page: number): Promise<LocalistApiResponse> {
  const url = `${API_BASE}?days=${DAYS_AHEAD}&per_page=${PER_PAGE}&page=${page}`;
  const res = await fetchWithRetry(url);
  return res.json() as Promise<LocalistApiResponse>;
}

export async function fetchAllEvents(): Promise<NormalizedEvent[]> {
  const parsed: NormalizedEvent[] = [];
  let page = 1;
  let totalPages = 1;
  const now = Date.now();

  do {
    console.log(`[texasToday] Fetching page ${page}/${totalPages}...`);
    const data = await fetchPage(page);

    // Localist quirk: page.total is total number of pages, not events.
    totalPages = data.page.total;

    for (const rawEvent of data.events) {
      try {
        parsed.push(...parseEvent(rawEvent, now));
      } catch (err) {
        console.error(`[texasToday] Unhandled parse error for event ${rawEvent.event?.id}: ${err}`);
      }
    }

    page++;
  } while (page <= totalPages);

  return parsed;
}

// Cron entrypoint.
export async function run(env: Env): Promise<void> {
  console.log('[texasToday] Scraper started');
  const t0 = Date.now();

  let events: NormalizedEvent[];
  try {
    events = await fetchAllEvents();
  } catch (err) {
    console.error(`[texasToday] Fatal fetch error — aborting run: ${err}`);
    return;
  }

  console.log(`[texasToday] Parsed ${events.length} event instances`);

  const { inserted, updated, errors } = await ingestEvents(env.DB, events);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(
    `[texasToday] Finished in ${elapsed}s — ${inserted} inserted, ${updated} updated, ${errors.length} errors`,
  );
}
