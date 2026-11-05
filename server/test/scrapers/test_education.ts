import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  parseDetailDates,
  parseDetailPage,
  parseTimeRange,
  parseWpEvent,
  type EventDetail,
  type WpEvent,
} from '../../src/scrapers/education';

function fixturePath(name: string): string {
  return join(__dirname, '..', '..', 'src', 'scrapers', '__fixtures__', 'education', name);
}

function loadEvent(id: number): WpEvent {
  const events: WpEvent[] = JSON.parse(readFileSync(fixturePath('events.json'), 'utf-8'));
  const event = events.find((e) => e.id === id);
  if (!event) throw new Error(`No fixture event ${id}`);
  return event;
}

function loadDetail(name: string): EventDetail {
  const detail = parseDetailPage(readFileSync(fixturePath(`detail-${name}.html`), 'utf-8'));
  if (!detail) throw new Error(`Fixture detail-${name}.html has no Date block`);
  return detail;
}

// A real detail page with some of its fields replaced. Cases that differ from
// the saved pages only in a text value (a location, a time) use this instead of
// carrying a near-identical copy of the markup.
function standardWith(overrides: Partial<EventDetail>): EventDetail {
  return { ...loadDetail('standard'), ...overrides };
}

// Fixture events run from Oct 2026 to Jan 2027; parse "now" as before all of
// them (except where a test moves it to exercise the past-event skip).
const NOW = new Date('2026-10-01T00:00:00Z').getTime();

describe('parseDetailPage', () => {
  it('reads the labelled date, time, location and registration button', () => {
    const detail = loadDetail('standard');
    expect(detail.dateText).toBe('Oct 20, 2026');
    expect(detail.timeText).toBe('5:00 pm - 6:00 pm (CST)');
    expect(detail.location).toBe('George I. Sánchez Building SZB 3.504');
    expect(detail.rsvpUrl).toBe('https://utexas.qualtrics.com/jfe/form/SV_byFo7TWaWxdhLOC');
  });

  it('reads the og:image URL, dimensions, MIME type and alt text', () => {
    expect(loadDetail('media-not-embedded').ogImage).toEqual({
      url: 'https://education.utexas.edu/wp-content/uploads/2026/03/SanchezBldgUT-1024x683.jpg',
      width: 1024,
      height: 683,
      mimeType: 'image/jpeg',
      altText: 'Longhorns in Residence Information Session',
    });
  });

  it('takes the registration link from the button on pages that also link out', () => {
    expect(loadDetail('external-registration').rsvpUrl).toBe(
      'https://bealonghorn.admissions.utexas.edu/register/?id=1843510f-62da-4a05-9770-cb2d8d2b2a56',
    );
  });

  it('has no registration link when the page has no button', () => {
    expect(loadDetail('no-image').rsvpUrl).toBeNull();
  });

  it('reads a date range, and has no time when the page has no Time block', () => {
    const timed = loadDetail('multi-day');
    expect(timed.dateText).toBe('Jun 6, 2025 - Aug 1, 2025');
    expect(timed.timeText).toBe('8:00 am - 5:00 pm (CST)');

    const allDay = loadDetail('multi-day-all-day');
    expect(allDay.dateText).toBe('Apr 13, 2020 - Apr 17, 2020');
    expect(allDay.timeText).toBeNull();
    expect(allDay.location).toBe('Online');
  });

  // The fixtures above have been through Prettier, which breaks tags across
  // lines. The live site serves them compact, with attributes on one line, so
  // pin that layout (and a swapped attribute order) explicitly.
  it('reads the compact, single-line markup the live site serves', () => {
    const html = [
      '<meta property="og:image" content="https://education.utexas.edu/a-1024x683.jpg" />',
      '<meta content="image/jpeg" property="og:image:type" />',
      '<meta property="og:image:alt" content="Tom &amp; Jerry" />',
      '<div class="event-info"><div class="text-ut-bluebonnet event-details-title">',
      '<svg></svg>  Date</div><div class="coe-events_event-date">Oct 20, 2026 </div></div>',
      '<div class="btn-coe btn-orange"><a href="https://example.com/reg?a=1&amp;b=2"><strong>Register</strong></a></div>',
    ].join('\n');
    expect(parseDetailPage(html)).toEqual({
      dateText: 'Oct 20, 2026',
      timeText: null,
      location: null,
      rsvpUrl: 'https://example.com/reg?a=1&b=2',
      ogImage: {
        url: 'https://education.utexas.edu/a-1024x683.jpg',
        width: null,
        height: null,
        mimeType: 'image/jpeg',
        altText: 'Tom & Jerry',
      },
    });
  });

  it('returns null when the page has no Date block', () => {
    expect(parseDetailPage('<html><body><h1>Not an event</h1></body></html>')).toBeNull();
  });
});

describe('parseWpEvent', () => {
  it('parses a timed event with a start and end', () => {
    const parsed = parseWpEvent(loadEvent(56137), loadDetail('standard'), NOW);
    expect(parsed).not.toBeNull();
    expect(parsed?.source).toBe('education');
    expect(parsed?.sourceEventId).toBe('56137');
    expect(parsed?.title).toBe('Internal Transfer Student Information Session');
    expect(parsed?.description).toMatch(/^Join us for an Internal Transfer Student/);
    expect(parsed?.startDatetime).toBe('2026-10-20T17:00:00-05:00');
    expect(parsed?.endDatetime).toBe('2026-10-20T18:00:00-05:00');
    expect(parsed?.venueType).toBe('in_person');
    expect(parsed?.locationFull).toBe('George I. Sánchez Building SZB 3.504');
    expect(parsed?.organization).toEqual({
      sourceOrgId: null,
      name: 'College of Education',
      profilePicture: null,
    });
    expect(parsed?.eventUrl).toBe(
      'https://education.utexas.edu/event/internal-transfer-student-session-5/',
    );
    expect(parsed?.rsvpUrl).toBe('https://utexas.qualtrics.com/jfe/form/SV_byFo7TWaWxdhLOC');
    expect(parsed?.categories).toEqual([
      { id: 'eventtypes-250', name: 'Internal Transfer Information Session' },
      { id: 'eventtypes-80', name: 'Undergraduate Students' },
      { id: 'eventtag-658', name: 'collegewide' },
    ]);
  });

  it('uses the embedded featured media for the image', () => {
    const parsed = parseWpEvent(loadEvent(56137), loadDetail('standard'), NOW);
    expect(parsed?.imageUrl).toBe(
      'https://education.utexas.edu/wp-content/uploads/2025/04/internal-transfer-featured-scaled.jpg',
    );
    expect(parsed?.imageWidth).toBe(2560);
    expect(parsed?.imageHeight).toBe(1707);
    expect(parsed?.imageMimeType).toBe('image/jpeg');
    expect(parsed?.imageAspectRatio).toBe('horizontal');
  });

  it('keeps the registration link for events the listing links out to', () => {
    const parsed = parseWpEvent(loadEvent(58496), loadDetail('external-registration'), NOW);
    expect(parsed?.eventUrl).toBe(
      'https://education.utexas.edu/event/prospective-student-information-session-1/',
    );
    expect(parsed?.rsvpUrl).toBe(
      'https://bealonghorn.admissions.utexas.edu/register/?id=1843510f-62da-4a05-9770-cb2d8d2b2a56',
    );
  });

  it('marks a Zoom event online, applies the winter offset, and decodes the title', () => {
    const detail = standardWith({
      dateText: 'Dec 7, 2026',
      timeText: '12:00 pm - 1:00 pm (CST)',
      location: 'Virtually via Zoom',
    });
    const parsed = parseWpEvent(loadEvent(61805), detail, NOW);
    expect(parsed?.title).toBe('Counselor Education Master’s Program Information Session');
    expect(parsed?.venueType).toBe('online');
    expect(parsed?.locationFull).toBe('Virtually via Zoom');
    expect(parsed?.startDatetime).toBe('2026-12-07T12:00:00-06:00');
    expect(parsed?.endDatetime).toBe('2026-12-07T13:00:00-06:00');
  });

  it('stores no end time when the page lists a single time', () => {
    const detail = standardWith({
      dateText: 'Jan 11, 2027',
      timeText: '12:00 pm (CST)',
      location: 'Virtual',
    });
    const parsed = parseWpEvent(loadEvent(69466), detail, NOW);
    expect(parsed?.startDatetime).toBe('2027-01-11T12:00:00-06:00');
    expect(parsed?.endDatetime).toBeNull();
    expect(parsed?.venueType).toBe('online');
  });

  it('truncates locationShort to 40 characters but keeps the full location', () => {
    const parsed = parseWpEvent(loadEvent(2200), loadDetail('no-image'), NOW);
    expect(parsed?.locationShort).toHaveLength(40);
    expect(parsed?.locationFull).toBe("Cissy McDaniel Parker Dean's Conference Room, SZB 2.624");
    expect(parsed?.startDatetime).toBe('2026-11-17T15:00:00-06:00');
  });

  it('skips events that have already ended', () => {
    const later = new Date('2027-02-01T00:00:00Z').getTime();
    expect(parseWpEvent(loadEvent(56137), loadDetail('standard'), later)).toBeNull();
  });

  it('skips an event whose date it cannot read', () => {
    expect(parseWpEvent(loadEvent(56137), standardWith({ dateText: 'Oct 20' }), NOW)).toBeNull();
  });

  it('drops the end time when it falls before the start', () => {
    const detail = standardWith({ timeText: '11:20 pm - 12:50 am (CST)' });
    const parsed = parseWpEvent(loadEvent(56137), detail, NOW);
    expect(parsed?.startDatetime).toBe('2026-10-20T23:20:00-05:00');
    expect(parsed?.endDatetime).toBeNull();
  });

  it('treats an unparseable time as an all-day event', () => {
    const parsed = parseWpEvent(loadEvent(56137), standardWith({ timeText: 'All day' }), NOW);
    expect(parsed?.startDatetime).toBe('2026-10-20');
    expect(parsed?.endDatetime).toBeNull();
  });

  it('treats an impossible time like 9:99 am as unparseable instead of building a bad date', () => {
    const parsed = parseWpEvent(loadEvent(56137), standardWith({ timeText: '9:99 am (CST)' }), NOW);
    expect(parsed?.startDatetime).toBe('2026-10-20');
  });
});

describe('parseWpEvent text cleanup', () => {
  it('strips tags and decodes entities exactly once in the title and excerpt', () => {
    const ev = {
      ...loadEvent(56137),
      title: { rendered: 'Q&amp;amp;A <em>night</em> &#8211; Fall' },
      excerpt: { rendered: '<p>Use &lt;b&gt; &amp; more</p>\n<p>Second line</p>' },
    };
    const parsed = parseWpEvent(ev, loadDetail('standard'), NOW);
    // "&amp;amp;" was literal text "&amp;" on the page, so one decode leaves it.
    expect(parsed?.title).toBe('Q&amp;A night – Fall');
    // Escaped markup stays text; real tags become spacing between the blocks.
    expect(parsed?.description).toBe('Use <b> & more Second line');
  });

  it('leaves the description null when the excerpt is empty', () => {
    const parsed = parseWpEvent(loadEvent(71579), standardWith({}), NOW);
    expect(parsed?.description).toBeNull();
    expect(parsed?.title).toBe('COE Faculty Media Training');
  });
});

describe('parseWpEvent images', () => {
  it('falls back to og:image when the API withholds an attachment the page shows', () => {
    const ev = loadEvent(61515);
    expect(ev._embedded?.['wp:featuredmedia']).toBeUndefined();

    const parsed = parseWpEvent(ev, loadDetail('media-not-embedded'), NOW);
    expect(parsed?.imageUrl).toBe(
      'https://education.utexas.edu/wp-content/uploads/2026/03/SanchezBldgUT-1024x683.jpg',
    );
    expect(parsed?.imageWidth).toBe(1024);
    expect(parsed?.imageHeight).toBe(683);
    expect(parsed?.imageMimeType).toBe('image/jpeg');
    expect(parsed?.imageAspectRatio).toBe('horizontal');
    expect(parsed?.imageAltText).toBe('Longhorns in Residence Information Session');
  });

  // Deliberate (see "Images" in education.ts): the site advertises its logo
  // banner as og:image for an event with no picture, and we attach it.
  it('attaches the college logo banner to an event with no picture chosen', () => {
    const ev = loadEvent(2200);
    expect(ev._embedded?.['wp:featuredmedia']).toBeUndefined();

    const parsed = parseWpEvent(ev, loadDetail('no-image'), NOW);
    expect(parsed?.imageUrl).toBe(
      'https://education.utexas.edu/wp-content/uploads/2025/05/coe_meta_data_image_1200x630.jpg',
    );
    expect(parsed?.imageWidth).toBe(1200);
    expect(parsed?.imageHeight).toBe(630);
    expect(parsed?.imageMimeType).toBe('image/jpeg');
    expect(parsed?.imageAspectRatio).toBe('horizontal');
    expect(parsed?.imageAltText).toBe('College of Education, UT Austin, logo');
  });

  it('has no image when neither the API nor the page offers one', () => {
    const parsed = parseWpEvent(loadEvent(2200), standardWith({ ogImage: null }), NOW);
    expect(parsed?.imageUrl).toBeNull();
    expect(parsed?.imageAspectRatio).toBe('none');
    expect(parsed?.imageMimeType).toBeNull();
    expect(parsed?.imageAltText).toBeNull();
  });
});

// The API only lists upcoming events, so there is no API record for the
// historical pages below. They are real pages of the shape that will recur, and
// each is paired with an unrelated fixture record purely to supply an id.
describe('parseWpEvent date ranges', () => {
  it('spans the first day at the first time to the last day at the last time', () => {
    const before = new Date('2025-01-01T00:00:00Z').getTime();
    const parsed = parseWpEvent(loadEvent(56137), loadDetail('multi-day'), before);
    expect(parsed?.startDatetime).toBe('2025-06-06T08:00:00-05:00');
    expect(parsed?.endDatetime).toBe('2025-08-01T17:00:00-05:00');
  });

  it('keeps a multi-day event visible while it is still running', () => {
    const detail = loadDetail('multi-day');
    const during = new Date('2025-07-01T00:00:00Z').getTime();
    const after = new Date('2025-09-01T00:00:00Z').getTime();
    expect(parseWpEvent(loadEvent(56137), detail, during)).not.toBeNull();
    expect(parseWpEvent(loadEvent(56137), detail, after)).toBeNull();
  });

  it('stores a multi-day event with no times as bare dates (all-day)', () => {
    const before = new Date('2020-01-01T00:00:00Z').getTime();
    const parsed = parseWpEvent(loadEvent(56137), loadDetail('multi-day-all-day'), before);
    expect(parsed?.startDatetime).toBe('2020-04-13');
    expect(parsed?.endDatetime).toBe('2020-04-17');
    expect(parsed?.venueType).toBe('online');
  });

  it('treats a range with the same day on both sides as a one-day event', () => {
    const detail = standardWith({ dateText: 'Oct 20, 2026 - Oct 20, 2026' });
    const parsed = parseWpEvent(loadEvent(56137), detail, NOW);
    expect(parsed?.startDatetime).toBe('2026-10-20T17:00:00-05:00');
    expect(parsed?.endDatetime).toBe('2026-10-20T18:00:00-05:00');
  });

  it('ends on the bare last date when a multi-day event lists only a start time', () => {
    const detail = standardWith({
      dateText: 'Oct 20, 2026 - Oct 22, 2026',
      timeText: '5:00 pm (CST)',
    });
    const parsed = parseWpEvent(loadEvent(56137), detail, NOW);
    expect(parsed?.startDatetime).toBe('2026-10-20T17:00:00-05:00');
    expect(parsed?.endDatetime).toBe('2026-10-22');
  });

  it('applies the offset of each day, across the November daylight-saving change', () => {
    const detail = standardWith({
      dateText: 'Oct 31, 2026 - Nov 2, 2026',
      timeText: '9:00 am - 5:00 pm (CST)',
    });
    const parsed = parseWpEvent(loadEvent(56137), detail, NOW);
    expect(parsed?.startDatetime).toBe('2026-10-31T09:00:00-05:00');
    expect(parsed?.endDatetime).toBe('2026-11-02T17:00:00-06:00');
  });

  it('drops the end of a backwards range', () => {
    const detail = standardWith({ dateText: 'Oct 22, 2026 - Oct 20, 2026', timeText: null });
    const parsed = parseWpEvent(loadEvent(56137), detail, NOW);
    expect(parsed?.startDatetime).toBe('2026-10-22');
    expect(parsed?.endDatetime).toBeNull();
  });
});

// A bare date parses as UTC midnight, which is the previous evening in
// Chicago. An all-day event must stay listed until its last day is over there.
describe('parseWpEvent all-day events', () => {
  it('keeps a one-day all-day event through the end of its day in Chicago', () => {
    const detail = standardWith({ dateText: 'Oct 20, 2026', timeText: null });
    const nineAm = new Date('2026-10-20T14:00:00Z').getTime();
    const elevenPm = new Date('2026-10-21T04:00:00Z').getTime();
    const nextDay = new Date('2026-10-21T06:00:00Z').getTime();
    expect(parseWpEvent(loadEvent(56137), detail, nineAm)).not.toBeNull();
    expect(parseWpEvent(loadEvent(56137), detail, elevenPm)).not.toBeNull();
    expect(parseWpEvent(loadEvent(56137), detail, nextDay)).toBeNull();
  });

  it('keeps a multi-day all-day event through its last day', () => {
    const detail = standardWith({ dateText: 'Oct 20, 2026 - Oct 22, 2026', timeText: null });
    const lastMorning = new Date('2026-10-22T14:00:00Z').getTime();
    const dayAfter = new Date('2026-10-23T06:00:00Z').getTime();
    expect(parseWpEvent(loadEvent(56137), detail, lastMorning)).not.toBeNull();
    expect(parseWpEvent(loadEvent(56137), detail, dayAfter)).toBeNull();
  });

  it('keeps a timed start with a bare end date through the end of that last day', () => {
    const detail = standardWith({
      dateText: 'Oct 20, 2026 - Oct 22, 2026',
      timeText: '5:00 pm (CST)',
    });
    const lastMorning = new Date('2026-10-22T14:00:00Z').getTime();
    expect(parseWpEvent(loadEvent(56137), detail, lastMorning)).not.toBeNull();
  });
});

describe('parseDetailDates', () => {
  it('reads a single date', () => {
    expect(parseDetailDates('Oct 20, 2026')).toEqual({ start: '2026-10-20', end: null });
    expect(parseDetailDates('Nov 9, 2026')).toEqual({ start: '2026-11-09', end: null });
    expect(parseDetailDates(' Jan 11, 2027 ')).toEqual({ start: '2027-01-11', end: null });
  });

  it('reads a range of two full dates', () => {
    expect(parseDetailDates('Oct 20, 2026 - Oct 22, 2026')).toEqual({
      start: '2026-10-20',
      end: '2026-10-22',
    });
    expect(parseDetailDates('Jun 6, 2025 - Aug 1, 2025')).toEqual({
      start: '2025-06-06',
      end: '2025-08-01',
    });
  });

  it('reads a range across a year boundary', () => {
    expect(parseDetailDates('Dec 30, 2026 - Jan 2, 2027')).toEqual({
      start: '2026-12-30',
      end: '2027-01-02',
    });
  });

  it('treats a range with the same day on both sides as one day', () => {
    expect(parseDetailDates('Mar 20, 2023 - Mar 20, 2023')).toEqual({
      start: '2023-03-20',
      end: null,
    });
  });

  it('absorbs an en dash and uneven spacing around the separator', () => {
    expect(parseDetailDates('Oct 20, 2026 – Oct 22, 2026')).toEqual({
      start: '2026-10-20',
      end: '2026-10-22',
    });
    expect(parseDetailDates('Oct 20, 2026-Oct 22, 2026')).toEqual({
      start: '2026-10-20',
      end: '2026-10-22',
    });
  });

  it('accepts full month names', () => {
    expect(parseDetailDates('October 20, 2026')).toEqual({ start: '2026-10-20', end: null });
  });

  it('returns null for junk, partial dates, and impossible days on either side', () => {
    expect(parseDetailDates('Oct 20')).toBeNull();
    expect(parseDetailDates('Oct 20 - 22, 2026')).toBeNull();
    expect(parseDetailDates('Someday, 2026')).toBeNull();
    expect(parseDetailDates('Feb 30, 2026')).toBeNull();
    expect(parseDetailDates('Oct 20, 2026 - Feb 30, 2026')).toBeNull();
    expect(parseDetailDates('Oct 20, 2026 - Oct 22, 2026 - Oct 24, 2026')).toBeNull();
    expect(parseDetailDates('')).toBeNull();
  });
});

describe('parseTimeRange', () => {
  it('splits a range and drops the static time zone label', () => {
    expect(parseTimeRange('5:00 pm - 6:00 pm (CST)')).toEqual({ start: '5:00 pm', end: '6:00 pm' });
  });

  it('absorbs the double space and en dash the site sometimes emits', () => {
    expect(parseTimeRange('10:00 am  - 11:00 am (CST)')).toEqual({
      start: '10:00 am',
      end: '11:00 am',
    });
    expect(parseTimeRange('10:00 am – 11:00 am (CST)')).toEqual({
      start: '10:00 am',
      end: '11:00 am',
    });
  });

  it('returns no end for a single time', () => {
    expect(parseTimeRange('5:30 pm (CST)')).toEqual({ start: '5:30 pm', end: null });
  });

  it('returns null when the start is not a time', () => {
    expect(parseTimeRange('All day')).toBeNull();
    expect(parseTimeRange('')).toBeNull();
  });
});
