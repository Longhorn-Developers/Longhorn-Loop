// HornsLink scraper. Public discovery API, no auth.
// API:   https://utexas.campuslabs.com/engage/api/discovery/event/search
// Images: https://se-images.campuslabs.com/clink/images/

import { ingestEvents } from '../events/ingest';
import {
  buildAbsoluteUrl,
  classifyAspectRatio,
  parseCoordinate,
  stripHtml,
  truncateLocation,
} from '../events/normalize';
import { fetchWithRetry, sleep } from '../events/polite-fetch';
import type { NormalizedEvent } from '../events/types';
import type { Env } from '../worker';

// Types

interface HornsLinkEvent {
  id: string;
  institutionId: number;
  organizationId: number;
  organizationName: string;
  organizationProfilePicture: string | null;
  organizationNames: string[];
  name: string;
  description: string;
  location: string | null;
  startsOn: string;
  endsOn: string | null;
  imagePath: string | null;
  theme: string | null;
  categoryIds: string[];
  categoryNames: string[];
  benefitNames: string[];
  visibility: string;
  status: string;
  latitude: string | null;
  longitude: string | null;
  rsvpTotal: number;
  '@search.score': number;
}

interface HornsLinkSearchResponse {
  '@odata.count': number;
  value: HornsLinkEvent[];
}

interface ScraperResult {
  eventsProcessed: number;
  eventsInserted: number;
  eventsUpdated: number;
  eventsSkipped: number;
  errors: string[];
  durationMs: number;
}

// Constants

const HORNSLINK_API_BASE = 'https://utexas.campuslabs.com/engage/api/discovery/event/search';
const HORNSLINK_EVENT_URL_BASE = 'https://utexas.campuslabs.com/engage/event/';
const IMAGE_BASE_URL = 'https://se-images.campuslabs.com/clink/images/';

const PAGE_SIZE = 20;
const MAX_PAGES = 5;
const REQUEST_DELAY_MS = 500;
const DAYS_AHEAD = 30;

// Cron: 25 pages * 20 = up to 500 events, matching the target run size.
const CRON_MAX_PAGES = 25;
// Stop early if we're close to the Workers CPU budget. Results are
// ordered by endsOn asc, so soonest-ending events get done first and
// leftovers roll to the next run.
const TIME_BUDGET_MS = 25_000;

// Helpers

function buildSearchUrl(page: number): string {
  const now = new Date();
  const endDate = new Date(now.getTime() + DAYS_AHEAD * 24 * 60 * 60 * 1000);

  const params = new URLSearchParams({
    endsAfter: now.toISOString(),
    endsBefore: endDate.toISOString(),
    orderByField: 'endsOn',
    orderByDirection: 'ascending',
    status: 'Approved',
    take: PAGE_SIZE.toString(),
    skip: (page * PAGE_SIZE).toString(),
  });

  return `${HORNSLINK_API_BASE}?${params.toString()}`;
}

// Normalize

function toNormalizedEvent(raw: HornsLinkEvent): NormalizedEvent {
  const imageUrl = buildAbsoluteUrl(IMAGE_BASE_URL, raw.imagePath);
  const profilePicture = buildAbsoluteUrl(IMAGE_BASE_URL, raw.organizationProfilePicture);

  const categories = raw.categoryIds.map((id, i) => ({
    id,
    name: raw.categoryNames[i] ?? null,
  }));

  return {
    source: 'hornslink',
    sourceEventId: raw.id,
    title: raw.name,
    description: stripHtml(raw.description),
    startDatetime: raw.startsOn,
    endDatetime: raw.endsOn,
    locationShort: truncateLocation(raw.location),
    locationFull: raw.location,
    latitude: parseCoordinate(raw.latitude),
    longitude: parseCoordinate(raw.longitude),
    organization: {
      sourceOrgId: raw.organizationId,
      name: raw.organizationName,
      profilePicture,
    },
    eventUrl: `${HORNSLINK_EVENT_URL_BASE}${raw.id}`,
    rsvpUrl: null,
    imageUrl,
    imageAspectRatio: classifyAspectRatio(null, null, !!imageUrl),
    imageWidth: null,
    imageHeight: null,
    imageMimeType: null,
    imageAltText: null,
    theme: raw.theme,
    visibility: raw.visibility,
    rsvpTotal: raw.rsvpTotal,
    categories,
    benefits: raw.benefitNames,
  };
}

// Main scraper

export async function scrapeHornsLink(
  db: D1Database,
  options?: { maxPages?: number; dryRun?: boolean; timeBudgetMs?: number },
): Promise<ScraperResult> {
  const startTime = Date.now();
  const maxPages = options?.maxPages ?? MAX_PAGES;
  const dryRun = options?.dryRun ?? false;
  const timeBudgetMs = options?.timeBudgetMs ?? TIME_BUDGET_MS;
  const cutoffMs = startTime + DAYS_AHEAD * 24 * 60 * 60 * 1000;

  const result: ScraperResult = {
    eventsProcessed: 0,
    eventsInserted: 0,
    eventsUpdated: 0,
    eventsSkipped: 0,
    errors: [],
    durationMs: 0,
  };

  console.log(`[HornsLink] Starting scrape (maxPages=${maxPages}, dryRun=${dryRun})`);

  for (let page = 0; page < maxPages; page++) {
    if (page > 0 && Date.now() - startTime > timeBudgetMs) {
      console.warn(
        `[HornsLink] Time budget (${timeBudgetMs}ms) exceeded after page ${page}, stopping early.`,
      );
      break;
    }

    try {
      const url = buildSearchUrl(page);
      console.log(`[HornsLink] Fetching page ${page + 1}/${maxPages}...`);

      const res = await fetchWithRetry(url);
      const data: HornsLinkSearchResponse = await res.json();

      if (!data.value || data.value.length === 0) {
        console.log(`[HornsLink] No more events on page ${page + 1}, stopping.`);
        break;
      }

      console.log(
        `[HornsLink] Got ${data.value.length} events (total available: ${data['@odata.count']})`,
      );

      // Client-side cutoff enforcement in case the API ignores endsBefore.
      const inWindow: HornsLinkEvent[] = [];
      for (const raw of data.value) {
        result.eventsProcessed++;
        const startMs = new Date(raw.startsOn).getTime();
        if (!isNaN(startMs) && startMs > cutoffMs) {
          result.eventsSkipped++;
          continue;
        }
        inWindow.push(raw);
      }

      if (dryRun) {
        for (const raw of inWindow) {
          console.log(
            `[DRY RUN] "${raw.name}" by ${raw.organizationName} @ ${raw.location || 'TBD'} on ${raw.startsOn}`,
          );
        }
      } else {
        const normalized = inWindow.map(toNormalizedEvent);
        const ingested = await ingestEvents(db, normalized);
        result.eventsInserted += ingested.inserted;
        result.eventsUpdated += ingested.updated;
        result.errors.push(...ingested.errors);
      }

      if (page < maxPages - 1) await sleep(REQUEST_DELAY_MS);
    } catch (err) {
      const msg = `Failed to fetch page ${page + 1}: ${err}`;
      console.error(`[HornsLink] ${msg}`);
      result.errors.push(msg);
    }
  }

  result.durationMs = Date.now() - startTime;
  console.log(
    `[HornsLink] Scrape complete: ${result.eventsProcessed} fetched, ` +
      `${result.eventsInserted + result.eventsUpdated} upserted ` +
      `(${result.eventsInserted} inserted, ${result.eventsUpdated} updated), ` +
      `${result.eventsSkipped} skipped, ${result.errors.length} errors ` +
      `in ${result.durationMs}ms`,
  );

  return result;
}

// Cron entrypoint. Larger page budget than the manual scrape route.
export async function run(env: Env): Promise<void> {
  console.log('[HornsLink] Cron scrape started');
  const result = await scrapeHornsLink(env.DB, { maxPages: CRON_MAX_PAGES });
  if (result.errors.length > 0) {
    console.error(
      `[HornsLink] Cron run had ${result.errors.length} event-level error(s):`,
      result.errors,
    );
  }
}
