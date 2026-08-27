// College of Pharmacy scraper: calendar.utexas.edu (Localist JSON API),
// scoped to the Pharmacy department via group_id.
//
// Pharmacy events are relatively sparse, so each run requests the next
// 365 days and follows every page returned by Localist.
//
// Dedup key: instance_id, not event_id, so recurring events get one row
// per occurrence. ingestEvents upserts on (source, source_event_id).

import { ingestEvents } from '../events/ingest';
import {
  classifyAspectRatio,
  fetchImageMeta,
  parseCoordinate,
  stripHtml,
} from '../events/normalize';
import { fetchWithRetry } from '../events/polite-fetch';
import type { ImageAspectRatio, NormalizedEvent } from '../events/types';
import type { Env } from '../worker';

const API_BASE = 'https://calendar.utexas.edu/api/2/events';
// Confirmed against https://calendar.utexas.edu/department/college-of-pharmacy.
const GROUP_ID = 47748554254291;
const PER_PAGE = 100;
const DAYS_AHEAD = 365;
export const SOURCE = 'pharmacy';
const DEFAULT_ORG_NAME = 'College of Pharmacy';

// Localist returns event definitions containing one or more dated instances.
// Several properties are optional because the list API omits them when the
// event submitter did not provide a value.
export interface LocalistEventInstance {
  event_instance: {
    id: number;
    event_id: number;
    start: string;
    end: string | null;
    all_day: boolean;
  };
}

export interface LocalistDepartment {
  id?: number;
  name: string;
  url?: string;
  localist_url?: string;
  hashtag?: string;
}

export interface LocalistRawEvent {
  event: {
    id: number;
    title: string;
    description: string | null;
    location?: string | null;
    location_name?: string | null;
    room?: string | null;
    room_number?: string | null;
    address: string | null;
    url: string | null;
    localist_url: string;
    event_instances: LocalistEventInstance[];
    photo_url: string | null;
    photo_width?: number | null;
    photo_height?: number | null;
    photo_alt?: string | null;
    photo_content_type?: string | null;
    departments: LocalistDepartment[];
    filters: Record<string, { name: string; id: number }[]>;
    tags: string[];
    keywords: string[];
    geo?: {
      latitude?: string | null;
      longitude?: string | null;
    } | null;
  };
}

interface LocalistApiResponse {
  events: LocalistRawEvent[];
  page: {
    current: number;
    size: number;
    // Localist reports the number of pages here, not the number of events.
    total: number;
  };
}

// Removes a trailing street address and enforces the events table's
// display-friendly 40-character short-location convention.
function buildLocationShort(location: string | null | undefined): string | null {
  if (!location) return null;
  const stripped = location.replace(/,\s*\d+[^,]*$/, '').trim();
  const candidate = stripped || location.trim();
  if (candidate.length <= 40) return candidate;
  return candidate.substring(0, 37) + '...';
}

function buildLocationFull(
  location: string | null | undefined,
  address: string | null | undefined,
): string | null {
  const parts = [location?.trim(), address?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

// Localist image URLs may point at resized variants. Store the largest
// available version so clients are not limited to a thumbnail.
function upgradeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url
    .replace(/\/thumb\//, '/huge/')
    .replace(/\/medium\//, '/huge/')
    .replace(/\/small\//, '/huge/');
}

// Current Localist responses use location_name/room_number, while older
// responses and saved CNS fixtures use location/room. Support both shapes.
function buildVenue(event: LocalistRawEvent['event']): string | null {
  const venue = event.location_name?.trim() || event.location?.trim();
  const room = event.room_number?.trim() || event.room?.trim();
  return [venue, room].filter(Boolean).join(', ') || null;
}

export function parseEventInstance(
  raw: LocalistRawEvent,
  instance: LocalistEventInstance,
): NormalizedEvent | null {
  const event = raw.event;
  const eventInstance = instance.event_instance;

  if (!eventInstance.start) {
    console.warn(
      `[pharmacy] Event ${event.id} instance ${eventInstance.id} missing start time — skipping`,
    );
    return null;
  }

  // Co-hosted events may list another department first. Prefer the Pharmacy
  // department explicitly, then fall back to the first available department.
  const department =
    event.departments?.find((item) => item.name === DEFAULT_ORG_NAME) ??
    event.departments?.[0] ??
    null;

  // Categories combine free-form tags and Localist event-type filters while
  // preserving source order and removing duplicates.
  const seen = new Set<string>();
  const categories: { id: string; name: string | null }[] = [];
  for (const tag of [
    ...(event.tags ?? []),
    ...(event.filters?.event_types?.map((item) => item.name) ?? []),
  ]) {
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      categories.push({ id: tag.toLowerCase().replace(/\s+/g, '-'), name: tag });
    }
  }

  const imageUrl = upgradeImageUrl(event.photo_url);
  const hasImage = Boolean(imageUrl);
  let imageAspectRatio: ImageAspectRatio = 'none';
  if (hasImage) {
    const classified = classifyAspectRatio(event.photo_width, event.photo_height, true);
    // If metadata lookup fails, retain the established Localist fallback:
    // images with unknown dimensions are treated as horizontal.
    imageAspectRatio = classified === 'square' && !event.photo_width ? 'horizontal' : classified;
  }

  const venue = buildVenue(event);

  return {
    source: SOURCE,
    sourceEventId: String(eventInstance.id),
    title: event.title,
    description: stripHtml(event.description),
    startDatetime: eventInstance.start,
    endDatetime: eventInstance.end ?? null,
    venueType: inferVenueType(venue, event.address),
    locationShort: buildLocationShort(venue || event.address),
    locationFull: buildLocationFull(venue, event.address),
    latitude: parseCoordinate(event.geo?.latitude ?? null),
    longitude: parseCoordinate(event.geo?.longitude ?? null),
    organization: {
      // Localist department IDs are not organization records in our schema,
      // so ingest stores the display name without upserting an organization.
      sourceOrgId: null,
      name: department?.name ?? DEFAULT_ORG_NAME,
      profilePicture: null,
    },
    eventUrl: event.localist_url || event.url || '',
    rsvpUrl: null,
    imageUrl,
    imageAspectRatio,
    imageWidth: hasImage ? (event.photo_width ?? null) : null,
    imageHeight: hasImage ? (event.photo_height ?? null) : null,
    imageMimeType: hasImage ? (event.photo_content_type ?? null) : null,
    imageAltText: hasImage ? (event.photo_alt ?? null) : null,
    theme: null,
    visibility: 'Public',
    rsvpTotal: 0,
    categories,
    benefits: [],
  };
}

// A Localist event can contain multiple occurrences. Emit one normalized row
// for each upcoming instance and isolate malformed instances from siblings.
export function parseEvent(raw: LocalistRawEvent, now = Date.now()): NormalizedEvent[] {
  const instances = raw.event?.event_instances ?? [];
  if (instances.length === 0) {
    console.warn(`[pharmacy] Event ${raw.event?.id} has no instances — skipping`);
    return [];
  }

  const results: NormalizedEvent[] = [];
  for (const instance of instances) {
    const startMs = new Date(instance.event_instance.start).getTime();
    if (isNaN(startMs) || startMs < now) continue;

    try {
      const parsed = parseEventInstance(raw, instance);
      if (parsed) results.push(parsed);
    } catch (err) {
      console.error(
        `[pharmacy] Failed to parse instance ${instance.event_instance.id} of event ${raw.event?.id}: ${err}`,
      );
    }
  }
  return results;
}

// The Localist list API usually supplies an image URL without dimensions.
// Range-read the image header only when metadata is missing, allowing accurate
// vertical/square/horizontal classification without downloading the full file.
async function hydrateImageMetadata(raw: LocalistRawEvent): Promise<void> {
  const imageUrl = upgradeImageUrl(raw.event.photo_url);
  if (!imageUrl || (raw.event.photo_width && raw.event.photo_height)) return;

  const metadata = await fetchImageMeta(imageUrl, SOURCE);
  raw.event.photo_width = metadata.width;
  raw.event.photo_height = metadata.height;
  raw.event.photo_content_type ??= metadata.mimeType;
}

async function fetchPage(page: number): Promise<LocalistApiResponse> {
  const url =
    `${API_BASE}?group_id=${GROUP_ID}&days=${DAYS_AHEAD}` + `&per_page=${PER_PAGE}&page=${page}`;
  const response = await fetchWithRetry(url);
  return response.json() as Promise<LocalistApiResponse>;
}

export async function fetchAllEvents(): Promise<NormalizedEvent[]> {
  const parsed: NormalizedEvent[] = [];
  let page = 1;
  let totalPages = 1;
  const now = Date.now();

  do {
    console.log(`[pharmacy] Fetching page ${page}/${totalPages}...`);
    const data = await fetchPage(page);
    totalPages = data.page.total;

    // One malformed event or failed metadata lookup must not discard the rest
    // of the page. ingestEvents provides the same isolation during D1 writes.
    for (const rawEvent of data.events) {
      try {
        await hydrateImageMetadata(rawEvent);
        parsed.push(...parseEvent(rawEvent, now));
      } catch (err) {
        console.error(`[pharmacy] Unhandled parse error for event ${rawEvent.event?.id}: ${err}`);
      }
    }

    page++;
  } while (page <= totalPages);

  return parsed;
}

// Scheduled Cloudflare Worker entrypoint.
export async function run(env: Env): Promise<void> {
  console.log('[pharmacy] Scraper started');
  const startedAt = Date.now();

  let events: NormalizedEvent[];
  try {
    events = await fetchAllEvents();
  } catch (err) {
    console.error(`[pharmacy] Fatal fetch error — aborting run: ${err}`);
    return;
  }

  console.log(`[pharmacy] Parsed ${events.length} event instances`);
  const { inserted, updated, errors } = await ingestEvents(env, events);
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[pharmacy] Finished in ${elapsed}s — ${inserted} inserted, ${updated} updated, ${errors.length} errors`,
  );
}
