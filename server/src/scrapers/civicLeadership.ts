// School of Civic Leadership scraper: civicleadership.utexas.edu/events (Webflow).
//
// THE LISTING. /events is one static Webflow page holding several CMS
// collection lists, each under its own <h2> and each paginated on its own:
//
//   "Upcoming Events"               lectures, panels, book talks
//   "Prospective Student Sessions"  seminars and info sessions for applicants
//   "Previous Events"               everything that has already happened
//
// Webflow paginates each list with its own query parameter, named after the
// list's element id (`?2dd7016c_page=2`), and EVERY page renders ALL the lists,
// the others at whatever page the URL leaves them on. So each list is followed
// through its own "next" link, and on the next page it is found again by its
// heading. The ids are Webflow-generated and change if an editor rebuilds the
// list, which is why they are read off the page and never hardcoded. Nor can
// they identify a list on a later page: Webflow carries the other lists' state
// in every pager link, so on page 2 of one list, a second list's "next" reads
// `?2dd7016c_page=2&33ba72fa_page=2` and names both.
//
// A list whose heading says "Previous" or "Past" is skipped outright. Any
// other list is crawled, so a new upcoming section an editor adds is picked up
// with no code change. Cards are still filtered by date, in case a list's
// heading and its contents ever disagree.
//
// THE CARD gives slug, title, date ("2/5/2027"), venue and a thumbnail. For
// some items that is all there is: the 2027 "SCL Freedom & Virtue Seminar"
// cards link to pages that 301 back to /events (the CMS items exist but have
// no published page). Those are kept as all-day events built from the card,
// with /events as their URL, because that is where a student can see them.
//
// THE DETAIL PAGE (/events/<slug>) adds time, location, registration link,
// description and cover image. Its sidebar is three label/value pairs:
//
//   Date      "Nov 18th, 2026"               the same CMS date field as the card
//   Time      "5 pm Reception, 6 pm Event"   FREE TEXT, see parseTimeText()
//   Location  "Harry Ransom Center, Tom Lea Room"
//
// Things we can't get:
//   - categories: the site has no taxonomy. The list heading is the only
//     grouping it publishes, so a card under "Prospective Student Sessions"
//     carries that as its category. The generic "Upcoming Events" adds none.
//     Interest tags come from the classifier in ingest, as for every source.
//   - organizer: the hosting program is only named in prose ("hosted by the
//     Ackerman Program..."), so every event is attributed to the school.
//   - coordinates: the site publishes none, so latitude/longitude stay null
//     here on purpose. ingestEvents fills them from the UT building registry
//     (attachBuildingCoordinates in events/ingest.ts), and that resolves every
//     venue this site used in 2026: Littlefield Home, HRC, FAC, POB, RLP, TCC,
//     WCP, LBJ. The test file pins that. "Online" and "Provided upon
//     registration" correctly get no pin.
//
// Images: Webflow's CDN serves most uploads as AVIF (32 of the 39 event pages
// in Nov 2026). parseImageDimensions reads AVIF headers, so the range-read in
// fetchImageMeta gets real dimensions for them.
//
// Dedup key: the Webflow item slug. It is unique within the collection, it is
// the only identifier the page exposes, and the URL is built from it, so it
// survives every edit except a rename. A renamed slug is a new URL anyway.

import { ingestEvents } from '../events/ingest';
import { classifyAspectRatio, fetchImageMeta, truncateLocation } from '../events/normalize';
import { fetchWithRetry, sleep } from '../events/polite-fetch';
import type { NormalizedEvent } from '../events/types';
import type { Env } from '../worker';
import {
  buildDatetime,
  chicagoOffset,
  decodeHtmlEntities,
  htmlToText,
  inferVenueType,
} from './helpers';

const SITE_BASE = 'https://civicleadership.utexas.edu';
export const LISTING_URL = `${SITE_BASE}/events`;
export const SOURCE = 'civic_leadership';

const DEFAULT_ORG_NAME = 'School of Civic Leadership';
const DEFAULT_MAX_EVENTS = 200;
// Per list. Upcoming lists have been one or two pages of three; "Previous
// Events" (skipped) runs to ten. The cap only stops a pager that loops back on
// itself from running the Worker out of time.
const MAX_PAGES_PER_LIST = 20;
const REQUEST_DELAY_MS = 200;

// Headings of lists that hold only past events.
const PAST_SECTION = /\b(?:previous|past)\b/i;
// Headings that just mean "the events" and say nothing about the event.
const GENERIC_SECTION = /^(?:upcoming\s+)?events$/i;

interface ScraperResult {
  eventsProcessed: number;
  eventsUpserted: number;
  eventsSkipped: number;
  errors: string[];
  durationMs: number;
  /** Dry run only: what would have been ingested, for POST /events/scrape/civicLeadership. */
  events?: NormalizedEvent[];
}

export interface ListingCard {
  slug: string;
  title: string;
  /** YYYY-MM-DD, or null when the card's date label can't be read. */
  date: string | null;
  location: string | null;
  imageUrl: string | null;
  imageAltText: string | null;
  /** Heading of the list the card was found under. */
  section: string;
}

export interface ListingSection {
  heading: string;
  cards: ListingCard[];
  /** Absolute URL of this list's next page, or null on its last page. */
  nextPageUrl: string | null;
}

export interface EventDetail {
  title: string | null;
  dateText: string | null;
  timeText: string | null;
  location: string | null;
  rsvpUrl: string | null;
  description: string | null;
  imageUrl: string | null;
  imageAltText: string | null;
}

// ---------------------------------------------------------------------------
// HTML utilities
// ---------------------------------------------------------------------------

// Collapse whitespace so the patterns below survive reformatting. The saved
// fixtures are prettier-formatted, which moves text onto its own line and can
// put a tag's closing ">" on the next one. Whitespace BETWEEN tags is kept: in
// a description, "</em> <em>" is a word break.
export function compactHtml(html: string): string {
  return html.replace(/\s+/g, ' ').replace(/\s+>/g, '>').replace(/<\s+/g, '<');
}

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return match ? decodeHtmlEntities(match[1]) : null;
}

function metaContent(html: string, key: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/g) ?? []) {
    if (attr(tag, 'property') === key || attr(tag, 'name') === key) {
      return attr(tag, 'content')?.trim() || null;
    }
  }
  return null;
}

/**
 * The html from the first `startMarker` up to the tag that contains the next
 * `endMarker`. The markers are attributes (`class="..."`), so the cut is moved
 * back to that tag's "<": otherwise every slice would end in a dangling
 * "<div id=..." that no tag pattern matches, and it would reach the text.
 */
function sliceBetween(html: string, startMarker: string, endMarker: string): string | null {
  const start = html.indexOf(startMarker);
  if (start < 0) return null;
  const end = html.indexOf(endMarker, start + startMarker.length);
  if (end < 0) return html.slice(start);
  return html.slice(start, Math.max(start, html.lastIndexOf('<', end)));
}

function absoluteHttpUrl(href: string | null): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, SITE_BASE);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

// Inline elements carry no break. htmlToText puts a space for every tag, which
// is right between paragraphs and wrong inside one: "<em>Story</em>." would
// read "Story .". Dropping inline tags first keeps the punctuation attached.
const INLINE_TAG = /<\/?(?:a|abbr|b|cite|code|em|i|mark|q|s|small|span|strong|sub|sup|u)\b[^>]*>/gi;

// Webflow pads empty paragraphs with a lone zero-width joiner (`<p>&zwj;</p>`).
// Only a standalone one is removed: inside an emoji sequence it is meaningful.
const LONE_ZERO_WIDTH = /(^|\s)[​-‍﻿]+(?=\s|$)/g;

function richTextToPlain(html: string): string | null {
  const text = htmlToText(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      // Embed blocks hold widget code: here Luma's "Register for <title>"
      // button, whose label would otherwise become the description's last line.
      .replace(/<div class="w-embed[^"]*">[\s\S]*?<\/div>/g, ' ')
      .replace(INLINE_TAG, ''),
  )
    .replace(LONE_ZERO_WIDTH, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

function categoryId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function inferMimeType(url: string | null): string | null {
  if (!url) return null;
  const path = url.split('?')[0].toLowerCase();
  if (path.endsWith('.avif')) return 'image/avif';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.gif')) return 'image/gif';
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  return null;
}

// ---------------------------------------------------------------------------
// Dates and times
// ---------------------------------------------------------------------------

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** YYYY-MM-DD for a real calendar date, or null ("2/30/2027" is not one). */
function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Card date: "2/5/2027" (US order, M/D/YYYY). */
export function parseListingDate(text: string): string | null {
  const match = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  return isoDate(Number(match[3]), Number(match[1]), Number(match[2]));
}

/** Detail-page date: "Nov 18th, 2026", "Sept 2, 2026", "November 18, 2026". */
export function parseDetailDate(text: string): string | null {
  const match = text.trim().match(/^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i);
  if (!match) return null;
  const word = match[1].toLowerCase();
  // A prefix of a month name, at least three letters: "Nov", "Sept", "November".
  const month = word.length >= 3 ? MONTHS.findIndex((name) => name.startsWith(word)) + 1 : 0;
  if (month === 0) return null;
  return isoDate(Number(match[3]), month, Number(match[2]));
}

interface ClockToken {
  hour: number;
  minute: number;
  meridiem: 'am' | 'pm' | null;
}

// One clock time as editors write it: "5", "5pm", "5 pm", "5:30", "5:30 p.m.".
const CLOCK = String.raw`(\d{1,2})(?::(\d{2}))?\s*(?:([ap])\.?\s?m\b\.?)?`;
const CLOCK_RANGE = new RegExp(`^${CLOCK}\\s*(?:-|to|until)\\s*${CLOCK}$`, 'i');
const CLOCK_ONLY = new RegExp(`^${CLOCK}$`, 'i');
const CLOCK_ANYWHERE = new RegExp(`${CLOCK}(?:\\s*(?:-|to)\\s*${CLOCK})?`, 'gi');

function clockToken(hour?: string, minute?: string, meridiem?: string): ClockToken | null {
  if (hour === undefined) return null;
  const h = Number(hour);
  const m = minute === undefined ? 0 : Number(minute);
  if (h < 1 || h > 12 || m > 59) return null;
  return {
    hour: h,
    minute: m,
    meridiem: meridiem ? (meridiem.toLowerCase() === 'a' ? 'am' : 'pm') : null,
  };
}

function minutesOfDay(t: ClockToken, meridiem: 'am' | 'pm'): number {
  return ((t.hour % 12) + (meridiem === 'pm' ? 12 : 0)) * 60 + t.minute;
}

function formatClock(t: ClockToken, meridiem: 'am' | 'pm'): string {
  return `${t.hour}:${String(t.minute).padStart(2, '0')} ${meridiem}`;
}

// A range that writes the meridiem once, on its end ("5-6:30pm", "1:30 - 2:30
// pm"), means the same one for the start. The exception is a range across
// noon, "11-1pm": borrowing "pm" would start at 11 pm, after the end, so
// the start is morning.
function resolveRange(
  start: ClockToken,
  end: ClockToken | null,
): { start: string; end: string | null } | null {
  const endMeridiem = end?.meridiem ?? start.meridiem;
  let startMeridiem = start.meridiem ?? endMeridiem;
  if (!startMeridiem) return null; // "5:00 - 7:00": no way to tell morning from evening
  if (!end || !endMeridiem) return { start: formatClock(start, startMeridiem), end: null };

  if (
    !start.meridiem &&
    endMeridiem === 'pm' &&
    minutesOfDay(start, 'pm') > minutesOfDay(end, 'pm')
  ) {
    startMeridiem = 'am';
  }
  // Still inverted ("6pm - 5pm"): a typo. Keep the start, drop the end rather
  // than store a range that ends before it begins.
  if (minutesOfDay(end, endMeridiem) <= minutesOfDay(start, startMeridiem)) {
    return { start: formatClock(start, startMeridiem), end: null };
  }
  return { start: formatClock(start, startMeridiem), end: formatClock(end, endMeridiem) };
}

/**
 * The sidebar "Time" field, which is free text. Every shape seen on the site:
 *
 *   "7:00pm - 8:00pm"   "8:30am - 2:00pm"   "5pm - 6pm"   "2pm-3:30pm"
 *   "1:30 - 2:30 pm"    "5:00 - 7:00 pm"    "5-6:30pm"    "2:00 pm"
 *   "5 pm Reception, 6 pm Event"
 *
 * Returns "h:mm am" strings for buildDatetime(), or null when no time with a
 * readable am/pm is present (the event is then stored as all-day). Anything
 * that is not a plain time or range ("5 pm Reception, 6 pm Event") yields its
 * first time as the start and no end: the event begins then, and which of
 * the later times ends it is not something the text says.
 */
export function parseTimeText(text: string): { start: string; end: string | null } | null {
  const cleaned = text
    .toLowerCase()
    .replace(/[‒-―−]/g, '-')
    .replace(/\bnoon\b/g, '12:00 pm')
    .replace(/\(?\b(?:cst|cdt|ct)\b\)?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const range = cleaned.match(CLOCK_RANGE);
  if (range) {
    const start = clockToken(range[1], range[2], range[3]);
    const end = clockToken(range[4], range[5], range[6]);
    return start && end ? resolveRange(start, end) : null;
  }

  const single = cleaned.match(CLOCK_ONLY);
  if (single) {
    const start = clockToken(single[1], single[2], single[3]);
    return start?.meridiem ? resolveRange(start, null) : null;
  }

  for (const match of cleaned.matchAll(CLOCK_ANYWHERE)) {
    const start = clockToken(match[1], match[2], match[3]);
    const partner = clockToken(match[4], match[5], match[6]);
    if (!start) continue;
    const meridiem = start.meridiem ?? partner?.meridiem;
    if (!meridiem) continue;
    const resolved = partner ? resolveRange(start, partner) : null;
    return { start: resolved?.start ?? formatClock(start, meridiem), end: null };
  }
  return null;
}

// A bare "YYYY-MM-DD" (all-day) parses as UTC midnight, which is the evening
// BEFORE in Chicago, so an all-day event would count as over while it is still
// on. Measure it to the end of its day in Chicago instead.
function endOfEventMs(startDatetime: string, endDatetime: string | null): number {
  const value = endDatetime ?? startDatetime;
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T23:59:59${chicagoOffset(value)}`).getTime()
    : new Date(value).getTime();
}

// ---------------------------------------------------------------------------
// Listing page
// ---------------------------------------------------------------------------

const LIST_START = /<div\b[^>]*\bclass="[^"]*\bw-dyn-list\b[^"]*"[^>]*>/g;
const ITEM_START = /<div\b[^>]*\bclass="[^"]*\bw-dyn-item\b[^"]*"[^>]*>/;
// Section headings are <h2> (the page title is <h1>); card titles are <h3>, so
// they can never be mistaken for the heading of the list after them.
const SECTION_HEADING = /<h[12]\b[^>]*>([\s\S]*?)<\/h[12]>/g;

export function parseListingCard(cardHtml: string, section: string): ListingCard | null {
  const html = compactHtml(cardHtml);
  const link = html.match(/<a\b[^>]*\shref="\/events\/([^"/?#]+)\/?"/);
  if (!link || link.index === undefined) return null;
  // The whole card is one <a>, and anchors cannot nest, so it ends at the first
  // </a>. Bounding it matters for the last card of a list: its slice of the
  // page otherwise runs on to the next list (or, for the last list, the
  // footer), and a card with no venue or image would borrow one from there.
  const closeAt = html.indexOf('</a>', link.index);
  const card = html.slice(link.index, closeAt < 0 ? undefined : closeAt);
  const titleMatch = card.match(/<h[3-6]\b[^>]*>([\s\S]*?)<\/h[3-6]>/);
  const title = titleMatch ? htmlToText(titleMatch[1]) : '';
  if (!title) return null;

  // Two labels, date then venue. Told apart by shape rather than position, so
  // a card with no venue (or the two swapped) still reads correctly.
  const labels = [...card.matchAll(/<div class="style-label">([\s\S]*?)<\/div>/g)]
    .map((m) => htmlToText(m[1]))
    .filter(Boolean);
  const dateLabel = labels.find((label) => parseListingDate(label) !== null) ?? null;
  const location = labels.find((label) => label !== dateLabel) ?? null;

  const img = card.match(/<img\b[^>]*>/)?.[0] ?? null;
  return {
    slug: link[1],
    title,
    date: dateLabel ? parseListingDate(dateLabel) : null,
    location,
    imageUrl: img ? absoluteHttpUrl(attr(img, 'src')) : null,
    imageAltText: (img && attr(img, 'alt')?.trim()) || null,
    section,
  };
}

export function extractListSections(rawHtml: string): ListingSection[] {
  const html = compactHtml(rawHtml);
  const starts = [...html.matchAll(LIST_START)].map((m) => m.index ?? 0);

  return starts.map((start, i) => {
    const end = starts[i + 1] ?? html.length;
    const chunk = html.slice(start, end);

    // The heading is the last <h1>/<h2> before the list, looking back no
    // further than the previous list.
    const before = html.slice(i > 0 ? starts[i - 1] : 0, start);
    const headings = [...before.matchAll(SECTION_HEADING)];
    const heading = headings.length > 0 ? htmlToText(headings[headings.length - 1][1]) : '';

    const cards = chunk
      .split(ITEM_START)
      .slice(1)
      .map((item) => parseListingCard(item, heading))
      .filter((card): card is ListingCard => card !== null);

    const nextTag = chunk.match(/<a\b[^>]*\bw-pagination-next\b[^>]*>/)?.[0];
    const nextHref = nextTag ? attr(nextTag, 'href') : null;

    return {
      heading,
      cards,
      nextPageUrl: nextHref ? new URL(nextHref, LISTING_URL).toString() : null,
    };
  });
}

export function isUpcomingSection(section: Pick<ListingSection, 'heading'>): boolean {
  return !PAST_SECTION.test(section.heading);
}

// ---------------------------------------------------------------------------
// Detail page
// ---------------------------------------------------------------------------

/**
 * Null when the page is not this item's own page. A card whose page is gone
 * 301s back to /events, and fetch follows the redirect, so the HTML that
 * arrives is the listing. Webflow names the CMS item on <html> as
 * `data-wf-item-slug`, and the listing has none.
 */
export function parseDetailPage(rawHtml: string, slug: string): EventDetail | null {
  const html = compactHtml(rawHtml);
  const pageSlug = html.match(/\sdata-wf-item-slug="([^"]*)"/);
  if (!pageSlug || pageSlug[1] !== slug) return null;

  // The sidebar is rendered twice (hero, and sticky beside the body). The
  // hero copy comes first and ends where the summary column starts.
  const sidebar =
    sliceBetween(html, 'class="article-side-inner"', 'class="column-fill-5"') ??
    sliceBetween(html, 'class="article-side-inner"', 'class="content for-cover"') ??
    '';
  const fields = new Map<string, string>();
  for (const m of sidebar.matchAll(
    /<div class="style-label color-text-body-2">([\s\S]*?)<\/div>[\s\S]*?<div class="style-label">([\s\S]*?)<\/div>/g,
  )) {
    const label = htmlToText(m[1]).toLowerCase();
    const value = htmlToText(m[2]);
    if (label && value && !fields.has(label)) fields.set(label, value);
  }

  // The "Save Your Spot" button. Only present when the event has a link.
  const footAt = sidebar.indexOf('article-side-foot');
  const footLink = footAt >= 0 ? sidebar.slice(footAt).match(/<a\b[^>]*>/)?.[0] : undefined;
  const rsvpUrl = footLink ? absoluteHttpUrl(attr(footLink, 'href')) : null;

  const titleMatch = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/);
  const title = (titleMatch && htmlToText(titleMatch[1])) || metaContent(html, 'og:title');

  const body = sliceBetween(
    html,
    'class="richtext for-article w-richtext"',
    'class="sticky-article-sider-border"',
  );
  const summary = sliceBetween(html, 'class="column-fill-5"', 'class="content for-cover"');
  const description =
    (body && richTextToPlain(body.slice(body.indexOf('>') + 1))) ||
    (summary && richTextToPlain(summary.slice(summary.indexOf('>') + 1))) ||
    metaContent(html, 'description');

  const coverImg = html.match(/<div class="cover-image[^"]*">\s*(<img\b[^>]*>)/)?.[1] ?? null;
  const imageUrl =
    absoluteHttpUrl(coverImg ? attr(coverImg, 'src') : null) ??
    absoluteHttpUrl(metaContent(html, 'og:image'));

  return {
    title: title || null,
    dateText: fields.get('date') ?? null,
    timeText: fields.get('time') ?? null,
    location: fields.get('location') ?? null,
    rsvpUrl,
    description: description || null,
    imageUrl,
    imageAltText: (coverImg && attr(coverImg, 'alt')?.trim()) || null,
  };
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Pure and sync, so it can be tested against saved pages. `detail` is null for
 * a card with no page of its own; the card alone still makes an event. Image
 * dimensions are filled in by the orchestrator (that needs a network call).
 */
export function parseCivicLeadershipEvent(
  card: ListingCard,
  detail: EventDetail | null,
  now = Date.now(),
): NormalizedEvent | null {
  // The card and the page print the same CMS date field. The page's is
  // preferred only because it is the item's own page.
  const date = (detail?.dateText ? parseDetailDate(detail.dateText) : null) ?? card.date;
  if (!date) {
    console.warn(`[civicLeadership] "${card.slug}" has no readable date — skipping`);
    return null;
  }

  const time = detail?.timeText ? parseTimeText(detail.timeText) : null;
  if (detail?.timeText && !time) {
    console.warn(
      `[civicLeadership] "${card.slug}" has unparseable time "${detail.timeText}" — storing as all-day`,
    );
  }
  const startDatetime = buildDatetime(date, time?.start ?? '');
  const endDatetime = time?.end ? buildDatetime(date, time.end) : null;

  const endMs = endOfEventMs(startDatetime, endDatetime);
  if (!Number.isFinite(endMs) || endMs < now) return null;

  const location = detail?.location ?? card.location;
  const imageUrl = detail?.imageUrl ?? card.imageUrl;
  const categoryName = card.section.trim();

  return {
    source: SOURCE,
    sourceEventId: card.slug,
    title: detail?.title ?? card.title,
    description: detail?.description ?? null,
    startDatetime,
    endDatetime,
    venueType: inferVenueType(location, null),
    locationShort: truncateLocation(location),
    locationFull: location,
    // Filled by ingestEvents from the UT building registry. See the header.
    latitude: null,
    longitude: null,
    organization: { sourceOrgId: null, name: DEFAULT_ORG_NAME, profilePicture: null },
    eventUrl: detail ? `${LISTING_URL}/${card.slug}` : LISTING_URL,
    rsvpUrl: detail?.rsvpUrl ?? null,
    imageUrl,
    imageAspectRatio: classifyAspectRatio(null, null, Boolean(imageUrl)),
    imageWidth: null,
    imageHeight: null,
    imageMimeType: inferMimeType(imageUrl),
    imageAltText: imageUrl ? (detail?.imageAltText ?? card.imageAltText) : null,
    theme: null,
    visibility: 'Public',
    rsvpTotal: 0,
    categories:
      categoryName && !GENERIC_SECTION.test(categoryName)
        ? [{ id: categoryId(categoryName), name: categoryName }]
        : [],
    benefits: [],
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function fetchHtml(url: string): Promise<string> {
  const res = await fetchWithRetry(url, { headers: { Accept: 'text/html' } });
  return res.text();
}

/**
 * Every card in every upcoming list, across all of each list's pages, once
 * per slug. A failure on page 1 throws (there is nothing to work with); a
 * failure on a later page keeps what was already found and reports it.
 */
export async function discoverListingCards(): Promise<{ cards: ListingCard[]; errors: string[] }> {
  const errors: string[] = [];
  const firstPage = extractListSections(await fetchHtml(LISTING_URL));
  // An empty list still renders its container (with "No items found."), so
  // NO lists at all means the page was rebuilt. Fail loudly: returning zero
  // cards would look exactly like a quiet week, every six hours, indefinitely.
  if (firstPage.length === 0) {
    throw new Error('no Webflow collection lists on the page; has the layout changed?');
  }

  const bySlug = new Map<string, ListingCard>();
  for (const first of firstPage.filter(isUpcomingSection)) {
    const visited = new Set<string>([LISTING_URL]);
    let section: ListingSection | undefined = first;
    for (let page = 1; section; page++) {
      for (const card of section.cards) if (!bySlug.has(card.slug)) bySlug.set(card.slug, card);

      const next: string | null = section.nextPageUrl;
      if (!next || visited.has(next) || page >= MAX_PAGES_PER_LIST) break;
      visited.add(next);
      await sleep(REQUEST_DELAY_MS);
      try {
        section = extractListSections(await fetchHtml(next)).find(
          (s) => s.heading === first.heading,
        );
        if (!section) {
          console.warn(`[civicLeadership] "${first.heading}" not found on ${next} — stopping`);
        }
      } catch (err) {
        const msg = `Failed to fetch listing page ${next}: ${err}`;
        console.error(`[civicLeadership] ${msg}`);
        errors.push(msg);
        section = undefined;
      }
    }
  }
  return { cards: [...bySlug.values()], errors };
}

export async function scrapeCivicLeadership(
  env: Env,
  options: { maxEvents?: number; dryRun?: boolean } = {},
): Promise<ScraperResult> {
  const t0 = Date.now();
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  const dryRun = options.dryRun ?? false;
  const errors: string[] = [];
  let eventsSkipped = 0;
  let eventsUpserted = 0;

  let cards: ListingCard[];
  try {
    const discovered = await discoverListingCards();
    cards = discovered.cards;
    errors.push(...discovered.errors);
  } catch (err) {
    const msg = `Fatal error fetching the events listing: ${err}`;
    console.error(`[civicLeadership] ${msg}`);
    return {
      eventsProcessed: 0,
      eventsUpserted: 0,
      eventsSkipped: 0,
      errors: [msg],
      durationMs: Date.now() - t0,
    };
  }

  const now = Date.now();
  // A card already past by its own date needs no detail fetch. A card with no
  // readable date is kept: its page may still have one.
  const upcoming = cards
    .filter((card) => !card.date || endOfEventMs(card.date, null) >= now)
    .slice(0, maxEvents);
  console.log(`[civicLeadership] Listed ${cards.length} cards, ${upcoming.length} upcoming`);

  const normalized: NormalizedEvent[] = [];
  for (const [i, card] of upcoming.entries()) {
    try {
      if (i > 0) await sleep(REQUEST_DELAY_MS);

      let detail: EventDetail | null;
      try {
        detail = parseDetailPage(await fetchHtml(`${LISTING_URL}/${card.slug}`), card.slug);
      } catch (err) {
        // Skip rather than fall back to the card: the upsert would overwrite a
        // full row from an earlier run (description, time, RSVP link) with the
        // card's nulls. The next run retries. A page that REDIRECTS is not this
        // case: that parses to null above, and the card is all there is.
        const msg = `Failed to fetch detail page for "${card.slug}": ${err}`;
        console.error(`[civicLeadership] ${msg}`);
        errors.push(msg);
        eventsSkipped++;
        continue;
      }

      const parsed = parseCivicLeadershipEvent(card, detail, now);
      if (!parsed) {
        eventsSkipped++;
        continue;
      }

      if (parsed.imageUrl) {
        const meta = await fetchImageMeta(parsed.imageUrl, 'civicLeadership');
        parsed.imageWidth = meta.width;
        parsed.imageHeight = meta.height;
        parsed.imageMimeType = meta.mimeType ?? parsed.imageMimeType;
        // Real header dimensions, so the tight tolerance McCombs and Moody use.
        parsed.imageAspectRatio = classifyAspectRatio(meta.width, meta.height, true, 0.05);
      }

      if (dryRun) console.log(`[DRY RUN] "${parsed.title}" (${parsed.sourceEventId})`);
      normalized.push(parsed);
    } catch (err) {
      const msg = `Failed to process "${card.slug}": ${err}`;
      console.error(`[civicLeadership] ${msg}`);
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
    `[civicLeadership] Finished in ${(durationMs / 1000).toFixed(1)}s — ${eventsUpserted} upserted, ${eventsSkipped} skipped, ${errors.length} errors`,
  );
  return {
    eventsProcessed: upcoming.length,
    eventsUpserted,
    eventsSkipped,
    errors,
    durationMs,
    ...(dryRun ? { events: normalized } : {}),
  };
}

export async function run(env: Env): Promise<void> {
  console.log('[civicLeadership] Scraper started');
  await scrapeCivicLeadership(env);
}
