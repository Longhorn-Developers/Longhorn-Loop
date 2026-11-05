// College of Education scraper: education.utexas.edu/events (WordPress).
//
// The site exposes a custom "event" post type through the standard WP REST
// API at /wp-json/wp/v2/event, but unlike Cockrell that endpoint says nothing
// about WHEN or WHERE: `acf` is an empty array, `content.rendered` is empty,
// and `date` is the post's publish date, not the event date (a recurring post
// published in 2024 is still being edited and shown in 2026). So the work is
// split in two:
//   - the API supplies identity: the stable post id, title, excerpt, link,
//     taxonomy terms (via _embed), and the featured image.
//   - each event's own detail page supplies the date, time, location and
//     registration button, as plain labelled blocks in the server-rendered
//     HTML. Its only JSON-LD is a BreadcrumbList, so there is nothing
//     structured to read there.
//
// Things we can't get:
//   - organizer: there is no per-event host. The "Contact" block is a person
//     or an advising inbox, not an organization.
//   - end time, for events whose page lists a single time (about a quarter
//     of them). They are stored with no end, like every other scraper that
//     can't find one.
//   - a time zone: the page appends a static "(CST)" even to October dates
//     that are in daylight time, so the label is ignored and we compute the
//     America/Chicago offset ourselves (DST-aware, via Intl).
//   - the full description: the detail page body is mostly buttons and link
//     lists, so we keep the API excerpt, the same short blurb shown on the
//     listing.
//
// The Date block is "Oct 20, 2026" or "Oct 20, 2026 - Oct 22, 2026". The range
// form is common in the site's history, but almost always a one-day event
// written with the same day on both sides (see parseDetailDates).
//
// Images: the API's embedded featured media is preferred, since it carries the
// full-size URL, MIME type, alt text and dimensions together. When it is
// missing we fall back to the detail page's og:image tag, which has the URL,
// dimensions, type and alt text too. That happens in two situations:
//   - the API withholds some attachments (HTTP 401 on /media/:id), so they
//     never embed, yet the page renders them. There og:image IS the editor's
//     picture: it matched the API image on every event where both exist.
//   - the editor picked no image at all. The site then advertises the
//     college's logo banner as og:image, and we attach that logo to the event.
//     This is deliberate: a recognisable college logo on the card is
//     acceptable, and it is the same image the site shows when the event is
//     shared. If it ever reads badly in the app, gate the fallback on the
//     post's `featured_media` field (0 means no picture was picked) and those
//     events go back to having no image.
//
// Dedup key: the WP post id. Recurring sessions ("...-session-3", "...-4")
// are separate posts, each with its own id, so each is its own event.

import { ingestEvents } from '../events/ingest';
import { classifyAspectRatio, fetchImageMeta } from '../events/normalize';
import { fetchWithRetry, sleep } from '../events/polite-fetch';
import type { NormalizedEvent } from '../events/types';
import type { Env } from '../worker';
import {
  buildDatetime,
  chicagoOffset,
  decodeHtmlEntities,
  htmlToText,
  inferVenueType,
  parseTime12h,
} from './helpers';

const API_BASE = 'https://education.utexas.edu/wp-json/wp/v2/event';
export const SOURCE = 'education';

const PER_PAGE = 100;
const DEFAULT_ORG_NAME = 'College of Education';
// One detail page is fetched per event, so pace them instead of bursting.
const REQUEST_DELAY_MS = 200;

interface ScraperResult {
  eventsProcessed: number;
  eventsUpserted: number;
  eventsSkipped: number;
  errors: string[];
  durationMs: number;
}

interface WpTerm {
  id: number;
  taxonomy: string;
  name: string;
}

interface WpMedia {
  source_url: string;
  mime_type: string;
  alt_text: string;
  media_details?: { width: number; height: number };
}

export interface WpEvent {
  id: number;
  slug: string;
  link: string;
  title: { rendered: string };
  excerpt: { rendered: string };
  _embedded?: {
    'wp:term'?: WpTerm[][];
    'wp:featuredmedia'?: WpMedia[];
  };
}

// One event image, whether it came from the embedded API media or from the
// page's og:image tags.
interface EventImage {
  url: string;
  width: number | null;
  height: number | null;
  mimeType: string | null;
  altText: string | null;
}

// Raw strings read off an event's detail page. Kept unparsed so the date and
// time logic lives in one pure function (parseWpEvent) that is easy to test.
export interface EventDetail {
  dateText: string;
  timeText: string | null;
  location: string | null;
  rsvpUrl: string | null;
  ogImage: EventImage | null;
}

// Helpers, exported for unit tests

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// One calendar date as the page writes it: "Oct 20, 2026".
const DATE_RE = /([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),\s*(\d{4})/;
// The Date block is that date alone, or two of them joined by a dash.
const DATE_BLOCK_RE = new RegExp(`^${DATE_RE.source}(?:\\s*[-–—]\\s*${DATE_RE.source})?$`);

// "Oct", "20", "2026" -> "2026-10-20", or null for a month name we don't know
// or a day that doesn't exist.
function toIsoDate(monthText: string, day: string, year: string): string | null {
  const month = MONTHS.indexOf(monthText.toLowerCase()) + 1;
  if (!month) return null;
  const iso = `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`;
  // "Feb 30" matches the pattern but is not a real day. Date() doesn't reject
  // it, it silently rolls over to Mar 2, so compare the round-tripped date.
  const parsed = new Date(`${iso}T12:00:00Z`);
  return !isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

// "Oct 20, 2026"                -> {start: "2026-10-20", end: null}
// "Oct 20, 2026 - Oct 22, 2026" -> {start: "2026-10-20", end: "2026-10-22"}
// "Oct 20, 2026 - Oct 20, 2026" -> {start: "2026-10-20", end: null}
//
// Older posts write most one-day events as a "range" whose two ends are the
// same day (80 of the 86 ranges in a 167-page sample of the site's history);
// that is a single day, not a multi-day event, so the end is dropped. Both ends
// always carry a full month, day and year, so no year has to be inferred.
// Anything else returns null and the event is skipped with a warning.
export function parseDetailDates(text: string): { start: string; end: string | null } | null {
  const match = text.trim().match(DATE_BLOCK_RE);
  if (!match) return null;
  const start = toIsoDate(match[1], match[2], match[3]);
  if (!start) return null;
  if (!match[4]) return { start, end: null };
  const end = toIsoDate(match[4], match[5], match[6]);
  if (!end) return null;
  return { start, end: end === start ? null : end };
}

// "5:00 pm - 6:00 pm (CST)" -> {start: "5:00 pm", end: "6:00 pm"}
// "5:30 pm (CST)"           -> {start: "5:30 pm", end: null}
// The page also double-spaces some ranges ("10:00 am  - 11:00 am"), which the
// separator pattern absorbs.
export function parseTimeRange(text: string): { start: string; end: string | null } | null {
  const cleaned = text.replace(/\((?:CST|CDT)\)/i, '').trim();
  const [start, end] = cleaned.split(/\s*[-–—]\s*/);
  if (!start || !parseTime12h(start)) return null;
  return { start, end: end && parseTime12h(end) ? end : null };
}

// Every field sits in an `.event-info` block: an icon + label div, then the
// value, which is a nested div for Date but a bare text node for Location and
// Time. Matching on the label (not on position) keeps this working when an
// optional block like Contact is missing. The Description heading uses a
// different class (`... mb-3`), so it can never be mistaken for a label.
function extractLabeledValue(html: string, label: string): string | null {
  const match = html.match(
    new RegExp(
      `<div class="text-ut-bluebonnet event-details-title">\\s*(?:<svg[\\s\\S]*?</svg>)?\\s*${label}\\s*</div>([\\s\\S]*?)</div>`,
    ),
  );
  if (!match) return null;
  return htmlToText(match[1]) || null;
}

// Find the tag first, then read its attribute: attribute order and line breaks
// inside a tag differ between SEO plugin versions (and after a formatter has
// touched a saved fixture), so neither can be assumed.
function extractMetaContent(html: string, property: string): string | null {
  const tag = html.match(new RegExp(`<meta\\s[^>]*property="${property}"[^>]*>`));
  const content = tag?.[0].match(/\bcontent="([^"]*)"/);
  return content ? decodeHtmlEntities(content[1]) : null;
}

function toNumberOrNull(value: string | null): number | null {
  const parsed = value ? parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

// Pure and sync so it's easy to test against saved HTML fixtures. Returns
// null when the page has no Date block, which means the layout changed and
// there is no start time to build an event from.
export function parseDetailPage(html: string): EventDetail | null {
  const dateText = extractLabeledValue(html, 'Date');
  if (!dateText) return null;

  // The registration button is the editors' "Register Now" call to action
  // (bealonghorn, Zoom, Qualtrics, RegFox, ...). It is the only `btn-coe`
  // link on a page, and the "View this event on an external site" link that
  // some pages add points at the same URL.
  const rsvpMatch = html.match(/<div class="btn-coe[^"]*">\s*<a\s[^>]*?href="([^"]+)"/);

  const ogUrl = extractMetaContent(html, 'og:image');

  return {
    dateText,
    timeText: extractLabeledValue(html, 'Time'),
    location: extractLabeledValue(html, 'Location'),
    rsvpUrl: rsvpMatch ? decodeHtmlEntities(rsvpMatch[1]) : null,
    ogImage: ogUrl
      ? {
          url: ogUrl,
          width: toNumberOrNull(extractMetaContent(html, 'og:image:width')),
          height: toNumberOrNull(extractMetaContent(html, 'og:image:height')),
          mimeType: extractMetaContent(html, 'og:image:type'),
          altText: extractMetaContent(html, 'og:image:alt'),
        }
      : null,
  };
}

// The embedded featured media is the best source. When it is missing, use the
// page's og:image, which is either the real picture the API withheld or the
// college logo banner for an event with no picture; see "Images" in the header
// for why the logo is attached on purpose.
function resolveImage(ev: WpEvent, detail: EventDetail): EventImage | null {
  const media = ev._embedded?.['wp:featuredmedia']?.[0];
  if (!media?.source_url) return detail.ogImage;
  return {
    url: media.source_url,
    width: media.media_details?.width ?? null,
    height: media.media_details?.height ?? null,
    mimeType: media.mime_type || null,
    altText: decodeHtmlEntities(media.alt_text ?? '').trim() || null,
  };
}

// A bare "YYYY-MM-DD" (an all-day event) parses as UTC midnight, which is the
// evening BEFORE in Chicago, so an all-day event would count as over while it
// is still running. Measure it to the end of its last day in Chicago instead.
function endOfEventMs(value: string): number {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T23:59:59${chicagoOffset(value)}`).getTime()
    : new Date(value).getTime();
}

// Pure and sync so it's easy to test against saved API + HTML fixtures.
// Image dimensions the API couldn't supply are filled in by the orchestrator
// (needs a network round-trip), same as Moody.
export function parseWpEvent(
  ev: WpEvent,
  detail: EventDetail,
  now = Date.now(),
): NormalizedEvent | null {
  const dates = parseDetailDates(detail.dateText);
  if (!dates) {
    console.warn(`[education] Event ${ev.id} has unparseable date "${detail.dateText}" — skipping`);
    return null;
  }

  const range = detail.timeText ? parseTimeRange(detail.timeText) : null;
  if (detail.timeText && !range) {
    console.warn(`[education] Event ${ev.id} has unparseable time "${detail.timeText}"`);
  }

  // Start is the first day at the first time. End is the last day (the first
  // day for a one-day event) at the second time, the same pairing Cockrell
  // uses for its separate start/end date and time fields. For a multi-day
  // event that lists daily hours ("Jun 6 - Aug 1", "8:00 am - 5:00 pm") this is
  // the outer envelope, the most one start/end pair can say. A multi-day event
  // with no end time ends on its bare last date (all-day).
  const startDatetime = buildDatetime(dates.start, range?.start ?? '');
  let endDatetime: string | null = null;
  if (range?.end) endDatetime = buildDatetime(dates.end ?? dates.start, range.end);
  else if (dates.end) endDatetime = buildDatetime(dates.end, '');

  const startMs = new Date(startDatetime).getTime();
  if (isNaN(startMs)) return null;
  // An end before the start is a data-entry slip, not a real range: the pages
  // list times like "11:20 pm - 12:50 am" (am/pm swapped) for evening-looking
  // starts, and nothing here could say which side is wrong. Keep the start,
  // drop the end rather than store an inverted range.
  if (endDatetime && endOfEventMs(endDatetime) < startMs) endDatetime = null;
  if (endOfEventMs(endDatetime ?? startDatetime) < now) return null;

  const image = resolveImage(ev, detail);
  const terms = (ev._embedded?.['wp:term'] ?? []).flat();
  const location = detail.location;

  return {
    source: SOURCE,
    sourceEventId: String(ev.id),
    title: htmlToText(ev.title.rendered),
    description: htmlToText(ev.excerpt.rendered) || null,
    startDatetime,
    endDatetime,
    venueType: inferVenueType(location, null),
    locationShort: location?.slice(0, 40) ?? null,
    locationFull: location,
    latitude: null,
    longitude: null,
    organization: {
      // Every event belongs to the same college; there's no per-event host
      // anywhere in the API or the page.
      sourceOrgId: null,
      name: DEFAULT_ORG_NAME,
      profilePicture: null,
    },
    eventUrl: ev.link,
    rsvpUrl: detail.rsvpUrl,
    imageUrl: image ? image.url : null,
    // fetchImageMeta() fills these in later when the source gave no size.
    imageWidth: image?.width ?? null,
    imageHeight: image?.height ?? null,
    imageAspectRatio: image ? classifyAspectRatio(image.width, image.height, true, 0.05) : 'none',
    imageMimeType: image?.mimeType ?? null,
    imageAltText: image?.altText ?? null,
    theme: null,
    visibility: 'Public',
    rsvpTotal: 0,
    categories: terms.map((t) => ({
      id: `${t.taxonomy}-${t.id}`,
      name: decodeHtmlEntities(t.name).trim(),
    })),
    benefits: [],
  };
}

export async function fetchAllEvents(): Promise<WpEvent[]> {
  const events: WpEvent[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const res = await fetchWithRetry(`${API_BASE}?per_page=${PER_PAGE}&page=${page}&_embed=1`, {
      headers: { Accept: 'application/json' },
    });
    const totalPagesHeader = res.headers.get('X-WP-TotalPages');
    if (totalPagesHeader) totalPages = parseInt(totalPagesHeader, 10) || 1;
    events.push(...((await res.json()) as WpEvent[]));
    page++;
  } while (page <= totalPages);

  return events;
}

async function fetchEventDetail(url: string): Promise<EventDetail | null> {
  const res = await fetchWithRetry(url, { headers: { Accept: 'text/html' } });
  return parseDetailPage(await res.text());
}

export async function scrapeEducation(
  env: Env,
  options: { dryRun?: boolean } = {},
): Promise<ScraperResult> {
  const dryRun = options.dryRun ?? false;
  const t0 = Date.now();

  const errors: string[] = [];
  let eventsUpserted = 0;
  let eventsSkipped = 0;

  let wpEvents: WpEvent[];
  try {
    wpEvents = await fetchAllEvents();
  } catch (err) {
    const msg = `Fatal error fetching events: ${err}`;
    console.error(`[education] ${msg}`);
    return {
      eventsProcessed: 0,
      eventsUpserted: 0,
      eventsSkipped: 0,
      errors: [msg],
      durationMs: Date.now() - t0,
    };
  }

  console.log(`[education] Fetched ${wpEvents.length} events`);

  const now = Date.now();
  const normalized: NormalizedEvent[] = [];

  for (const [i, ev] of wpEvents.entries()) {
    try {
      // Delay before the fetch (not after the loop body) so the early
      // `continue` below can't skip it.
      if (i > 0) await sleep(REQUEST_DELAY_MS);

      // The date only exists on the detail page, so even events that turn out
      // to be in the past cost one request before they can be skipped.
      const detail = await fetchEventDetail(ev.link);
      if (!detail) {
        console.warn(`[education] Event ${ev.id} detail page has no date block — skipping`);
        eventsSkipped++;
        continue;
      }

      const parsed = parseWpEvent(ev, detail, now);
      if (!parsed) {
        eventsSkipped++;
        continue;
      }

      if (parsed.imageUrl && (!parsed.imageWidth || !parsed.imageHeight)) {
        // The API and og tags usually provide dimensions. Only range-read the
        // image when that metadata is absent.
        const meta = await fetchImageMeta(parsed.imageUrl, 'education');
        parsed.imageWidth = meta.width;
        parsed.imageHeight = meta.height;
        parsed.imageMimeType = parsed.imageMimeType ?? meta.mimeType;
        parsed.imageAspectRatio = classifyAspectRatio(meta.width, meta.height, true, 0.05);
      }

      if (dryRun) {
        console.log(`[DRY RUN] "${parsed.title}" (${parsed.sourceEventId})`);
      } else {
        normalized.push(parsed);
      }
    } catch (err) {
      const msg = `Failed to process event ${ev.id}: ${err}`;
      console.error(`[education] ${msg}`);
      errors.push(msg);
    }
  }

  if (!dryRun && normalized.length > 0) {
    const result = await ingestEvents(env, normalized);
    eventsUpserted = result.inserted + result.updated;
    errors.push(...result.errors);
  }

  const durationMs = Date.now() - t0;
  console.log(
    `[education] Finished in ${(durationMs / 1000).toFixed(1)}s — ${eventsUpserted} upserted, ${eventsSkipped} skipped, ${errors.length} errors`,
  );

  return { eventsProcessed: wpEvents.length, eventsUpserted, eventsSkipped, errors, durationMs };
}

export async function run(env: Env): Promise<void> {
  console.log('[education] Scraper started');
  await scrapeEducation(env);
}
