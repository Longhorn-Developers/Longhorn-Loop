// School of Nursing scraper: nursing.utexas.edu/events (Drupal 11, UT Drupal Kit).
//
// The site runs the stock UT Drupal Kit event calendar, so the scraping itself
// lives in utDrupalCalendar.ts (shared with ischool.ts); this file is the site
// config plus the Nursing-specific notes. The exports keep their original
// shapes so test_nursing.ts and the registry are unaffected by the extraction.
//
// What is particular to Nursing:
//   - the /events page embeds about 1,600 entries back to 2019.
//   - address: some bodies carry the editors' "Location: NUR 5.178 | School of
//     Nursing | 1710 Red River St., Austin, Texas" line (4 of the 12 upcoming
//     pages when this was written, one of them a non-Nursing building), which
//     is appended to the location. "NUR 5.178", "NUR - various" and that
//     address all resolve to the Nursing building in ingest's registry.
//   - images: only about one in seven pages has a picture, and the site sets
//     no og:image to fall back on.

import type { NormalizedEvent } from '../events/types';
import type { Env } from '../worker';
import {
  parseCalendarEvent as parseUtDrupalCalendarEvent,
  parseDetailPage as parseUtDrupalDetailPage,
  scrapeUtDrupalCalendar,
  type CalendarEvent,
  type EventDetail,
  type ScraperResult,
  type UtDrupalCalendarSite,
} from './utDrupalCalendar';

export { cleanTitle, extractCalendarEvents, resolveTiming } from './utDrupalCalendar';
export type { CalendarEvent, EventDetail } from './utDrupalCalendar';

export const SOURCE = 'nursing';

const SITE: UtDrupalCalendarSite = {
  source: SOURCE,
  siteBase: 'https://nursing.utexas.edu',
  calendarPath: '/events',
  orgName: 'School of Nursing',
};

export function parseDetailPage(html: string): EventDetail {
  return parseUtDrupalDetailPage(html, SITE);
}

export function parseCalendarEvent(
  ev: CalendarEvent,
  detail: EventDetail,
  now = Date.now(),
): NormalizedEvent | null {
  return parseUtDrupalCalendarEvent(ev, detail, SITE, now);
}

export function scrapeNursing(
  env: Env,
  options: { dryRun?: boolean } = {},
): Promise<ScraperResult> {
  return scrapeUtDrupalCalendar(env, SITE, options);
}

export async function run(env: Env): Promise<void> {
  console.log('[nursing] Scraper started');
  await scrapeNursing(env);
}
