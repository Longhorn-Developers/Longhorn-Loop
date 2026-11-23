// School of Information (iSchool) scraper: ischool.utexas.edu/calendar
// (Drupal 11, UT Drupal Kit).
//
// NOT Localist. Checked before writing anything, as the ticket asked: the page
// is Drupal ("Generator: Drupal 11"), `?format=json` is ignored and returns the
// same HTML, and /api/2/events is a 404. It is the same UT Drupal Kit calendar
// Nursing runs, field for field, so the scraping lives in utDrupalCalendar.ts
// and this file is only the site config. See that file for how the calendar,
// event pages, times and dedup key work.
//
// What is particular to the iSchool, as of Nov 2026:
//   - the /calendar page embeds ~700 entries back to 2018. /events lists the
//     same upcoming ones (one, the week this was written), so the embedded
//     list is complete, not a window.
//   - images: most events have none, and the site footer carries the
//     department's signature banner in a media-image field of its own. That
//     is why the shared parser reads fields from inside the event node; before
//     that, 9 of the 10 pages sampled came back with the footer banner as the
//     event's picture.
//   - venues are written with the building code in front or in parentheses,
//     "(UNB) Texas Union Quadrangle Room", "UTA 5.522 (Large Conference Room)",
//     "Student Lounge (FAC 18N)", and resolve in ingest's building registry.
//     Info sessions say "Virtual", which inferVenueType reads as online.
//   - registration links are the body's button: Qualtrics forms, the
//     admissions office's "Be a Longhorn" sign-up, or a Zoom join link.
//   - categories are the event-type tags: Research, Colloquium & Talks,
//     Career, Student Life, "MSIS Info Session", "PhD Info Session", ...
//   - the site calls itself the School of Information (its footer also names
//     the Department of Information, College of Natural Sciences), so that is
//     the host on every event.

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

export const SOURCE = 'ischool';

export const SITE: UtDrupalCalendarSite = {
  source: SOURCE,
  siteBase: 'https://ischool.utexas.edu',
  calendarPath: '/calendar',
  orgName: 'School of Information',
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

export function scrapeIschool(
  env: Env,
  options: { dryRun?: boolean } = {},
): Promise<ScraperResult> {
  return scrapeUtDrupalCalendar(env, SITE, options);
}

export async function run(env: Env): Promise<void> {
  console.log('[ischool] Scraper started');
  await scrapeIschool(env);
}
