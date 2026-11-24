import { readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseImageDimensions } from '../../src/events/normalize';
import { isNonPhysicalLocation, resolveBuilding } from '../../src/lib/utBuildings';
import {
  LISTING_URL,
  extractListSections,
  isUpcomingSection,
  parseCivicLeadershipEvent,
  parseDetailDate,
  parseDetailPage,
  parseListingDate,
  parseTimeText,
  scrapeCivicLeadership,
  type ListingCard,
} from '../../src/scrapers/civicLeadership';
import type { Env } from '../../src/worker';

// Fixtures are trimmed copies of civicleadership.utexas.edu as of Nov 2026: the
// real Webflow markup for the lists, sidebar and body, minus nav, footer, SVG
// icons and CSS.
const FIXTURES = join(__dirname, '..', '..', 'src', 'scrapers', '__fixtures__', 'civicLeadership');

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf-8');
}

function prospectiveCards(html = loadFixture('listing-page.html')): ListingCard[] {
  return extractListSections(html).find((s) => s.heading === 'Prospective Student Sessions')!.cards;
}

function previousCard(slug: string): ListingCard {
  const previous = extractListSections(loadFixture('listing-page.html')).find(
    (s) => s.heading === 'Previous Events',
  )!;
  // Re-homed under a generic heading, as if the event were still upcoming.
  return { ...previous.cards.find((c) => c.slug === slug)!, section: 'Upcoming Events' };
}

const SEMINAR_IMAGE =
  'https://cdn.prod.website-files.com/6a16e011014ad9969cf1a9d0/6a745a174498f5754b3080dc_6a745932b148be74392f155c_F%2526VSeminar.avif';

// Before every fixture event (the earliest is 2026-10-08).
const BEFORE_ALL = new Date('2026-10-01T00:00:00-05:00').getTime();
// The day this was written: November events are over, the 2027 seminars are not.
const TODAY = new Date('2026-11-23T12:00:00-06:00').getTime();

// ---------------------------------------------------------------------------
// Minimal ISO-BMFF writer for AVIF headers.
// ---------------------------------------------------------------------------

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const out = concat(new Uint8Array(4), ascii(type), ...payload);
  new DataView(out.buffer).setUint32(0, out.length);
  return out;
}

function ispe(width: number, height: number): Uint8Array {
  const body = new Uint8Array(12); // 4 bytes version/flags, then width, height
  new DataView(body.buffer).setUint32(4, width);
  new DataView(body.buffer).setUint32(8, height);
  return box('ispe', body);
}

function avif(...properties: Uint8Array[]): Uint8Array {
  return concat(
    box('ftyp', ascii('avif'), new Uint8Array(4), ascii('mif1avif')),
    box(
      'meta',
      new Uint8Array(4), // version/flags
      box('hdlr', new Uint8Array(25)),
      box('iprp', box('ipco', ...properties)),
    ),
  );
}

// ---------------------------------------------------------------------------

describe('Civic Leadership listing page', () => {
  it('finds every collection list under its heading and skips only past ones', () => {
    const sections = extractListSections(loadFixture('listing-page.html'));

    expect(sections.map((s) => s.heading)).toEqual([
      '', // the nav's quick links, a CMS list that is not events
      'Upcoming Events',
      'Prospective Student Sessions',
      'Previous Events',
    ]);
    expect(sections.map((s) => s.cards.length)).toEqual([0, 0, 3, 3]);
    expect(sections.filter(isUpcomingSection).map((s) => s.heading)).not.toContain(
      'Previous Events',
    );
  });

  it('reads a card', () => {
    expect(prospectiveCards()[0]).toEqual({
      slug: 'scl-freedom-virtue-seminar',
      title: 'SCL Freedom & Virtue Seminar',
      date: '2027-02-05',
      location: 'Littlefield Home',
      imageUrl: SEMINAR_IMAGE,
      imageAltText: 'SCL Freedom & Virtue Seminar',
      section: 'Prospective Student Sessions',
    });
  });

  it("follows each list's own pager, decoding the other lists' carried state", () => {
    const page1 = extractListSections(loadFixture('listing-page.html'));
    const page2 = extractListSections(loadFixture('listing-page-2.html'));
    const next = (sections: typeof page1, heading: string) =>
      sections.find((s) => s.heading === heading)!.nextPageUrl;

    expect(next(page1, 'Prospective Student Sessions')).toBe(`${LISTING_URL}?2dd7016c_page=2`);
    expect(next(page2, 'Prospective Student Sessions')).toBeNull();
    expect(prospectiveCards(loadFixture('listing-page-2.html')).map((c) => c.slug)).toEqual([
      'scl-freedom-virtue-seminar-4',
    ]);
    // On page 2 of one list, another list's "next" names both (`&amp;` in the HTML).
    expect(next(page2, 'Previous Events')).toBe(`${LISTING_URL}?2dd7016c_page=2&33ba72fa_page=2`);
  });

  it("never lets the last card of the last list borrow the footer's venue or image", () => {
    const html = loadFixture('listing-page.html')
      .replace(/<div class="style-label">\s*LBJ School of Public Affairs\s*<\/div>/, '')
      .replace(/<img\b[^>]*Sexton[^>]*>/, '');
    const { cards } = extractListSections(html).find((s) => s.heading === 'Previous Events')!;
    const last = cards[cards.length - 1];

    expect(last.slug).toBe('america-in-the-world-at-250-a-view-from-the-bloody-borderland');
    expect(last.location).toBeNull();
    expect(last.imageUrl).toBeNull();
  });
});

describe('Civic Leadership dates and times', () => {
  it('reads card dates (M/D/YYYY) and rejects impossible ones', () => {
    expect(parseListingDate('2/5/2027')).toBe('2027-02-05');
    expect(parseListingDate('11/18/2026')).toBe('2026-11-18');
    expect(parseListingDate('2/30/2027')).toBeNull();
    expect(parseListingDate('Littlefield Home')).toBeNull();
  });

  it('reads detail-page dates', () => {
    expect(parseDetailDate('Nov 18th, 2026')).toBe('2026-11-18');
    expect(parseDetailDate('Sep 2nd, 2026')).toBe('2026-09-02');
    expect(parseDetailDate('Sept 2, 2026')).toBe('2026-09-02');
    expect(parseDetailDate('November 18, 2026')).toBe('2026-11-18');
    expect(parseDetailDate('Ma 3, 2026')).toBeNull(); // too short to name a month
    expect(parseDetailDate('Date TBA')).toBeNull();
  });

  // Every "Time" value on the site's 39 event pages, plus the edge cases.
  it.each([
    ['7:00pm - 8:00pm', '7:00 pm', '8:00 pm'],
    ['8:30am - 2:00pm', '8:30 am', '2:00 pm'],
    ['5pm - 6pm', '5:00 pm', '6:00 pm'],
    ['2pm-3:30pm', '2:00 pm', '3:30 pm'],
    ['1:30 - 2:30 pm', '1:30 pm', '2:30 pm'],
    ['5:00 - 7:00 pm', '5:00 pm', '7:00 pm'],
    ['5-6:30pm', '5:00 pm', '6:30 pm'],
    ['12 - 1pm', '12:00 pm', '1:00 pm'],
    ['8:30 - 10:00am', '8:30 am', '10:00 am'],
    ['11-1pm', '11:00 am', '1:00 pm'], // across noon: borrowing "pm" would start after the end
    ['4:00 – 5:15 p.m.', '4:00 pm', '5:15 pm'],
    ['Noon - 1:30pm', '12:00 pm', '1:30 pm'],
    ['2:00 pm', '2:00 pm', null],
    ['6pm', '6:00 pm', null],
    ['5 pm Reception, 6 pm Event', '5:00 pm', null],
    ['6pm - 5pm', '6:00 pm', null], // inverted: keep the start, drop the end
  ])('parses %j', (text, start, end) => {
    expect(parseTimeText(text)).toEqual({ start, end });
  });

  it.each(['5:00 - 7:00', 'TBA', '', '13:00 pm'])('gives up on %j', (text) => {
    expect(parseTimeText(text)).toBeNull();
  });
});

describe('Civic Leadership detail page', () => {
  it('reads the sidebar, registration link, body and cover', () => {
    const detail = parseDetailPage(
      loadFixture('detail-standard.html'),
      'the-athena-series-why-rome-matters',
    );
    expect(detail).toMatchObject({
      title: 'The Athena Series: Why Rome Matters',
      dateText: 'Oct 8th, 2026',
      timeText: '5:00pm - 6:30pm',
      location: 'Avaya Auditorium (POB 2.302)',
      rsvpUrl: 'https://luma.com/o2d23uzh',
      imageUrl:
        'https://cdn.prod.website-files.com/6a16e011014ad9969cf1a9d0/6abec8bb6651a992754f868b_Why%20Rome%20Matters%20digiscreen%20-%2010.1.26.jpeg',
      imageAltText: null,
    });
    expect(detail?.description).toMatch(/^Join the Thomas Jefferson Center for the Study/);
    expect(detail?.description).toMatch(/RSVP to attend the event\.$/);
  });

  it('keeps widget code and Webflow padding out of the description', () => {
    const detail = parseDetailPage(
      loadFixture('detail-reception.html'),
      'the-jewish-roots-of-american-liberty',
    );
    const description = detail?.description ?? '';

    expect(description).toMatch(/^Please join us on Wednesday, Nov 18/);
    expect(description).toMatch(/Western world and the American republic\.$/);
    // The Luma button embedded in the body, and its script.
    expect(description).not.toContain('Register for');
    expect(description).not.toContain('luma');
    // Empty <p>&zwj;</p> paragraphs, and spaces before punctuation after <em>.
    expect(description).not.toMatch(/‍/);
    expect(description).toContain('Invitation to the Great American Story.');
    expect(description).not.toMatch(/ [.,;:]/);
  });

  it('has no registration link when the page shows no button', () => {
    const detail = parseDetailPage(
      loadFixture('detail-no-registration.html'),
      'tribal-politics---how-brexit-divided-britain',
    );
    expect(detail?.timeText).toBe('2:00 pm');
    expect(detail?.location).toBe('Harry Ransom Center, Tom Lea Room');
    expect(detail?.rsvpUrl).toBeNull();
  });

  it('does not mistake the listing (where a missing page redirects) for an event page', () => {
    expect(
      parseDetailPage(loadFixture('listing-page.html'), 'scl-freedom-virtue-seminar'),
    ).toBeNull();
    expect(parseDetailPage(loadFixture('detail-standard.html'), 'some-other-event')).toBeNull();
  });
});

describe('Civic Leadership event mapping', () => {
  it('maps a card and its page into the shared schema', () => {
    const card = previousCard('the-jewish-roots-of-american-liberty');
    const detail = parseDetailPage(loadFixture('detail-reception.html'), card.slug);

    expect(parseCivicLeadershipEvent(card, detail, BEFORE_ALL)).toEqual({
      source: 'civic_leadership',
      sourceEventId: 'the-jewish-roots-of-american-liberty',
      title: 'The Jewish Roots of American Liberty',
      description: detail?.description,
      // "5 pm Reception, 6 pm Event": starts with the reception. CST in November.
      startDatetime: '2026-11-18T17:00:00-06:00',
      endDatetime: null,
      venueType: 'in_person',
      // The page's spelling wins over the card's "Provided up on registration".
      locationShort: 'Provided upon registration',
      locationFull: 'Provided upon registration',
      latitude: null,
      longitude: null,
      organization: { sourceOrgId: null, name: 'School of Civic Leadership', profilePicture: null },
      eventUrl: 'https://civicleadership.utexas.edu/events/the-jewish-roots-of-american-liberty',
      rsvpUrl: 'https://luma.com/2y407fg6',
      imageUrl:
        'https://cdn.prod.website-files.com/6a16e011014ad9969cf1a9d0/6ae24387acb714416ba21a66_Jewish%20Roots%20slide.jpg',
      // Dimensions come later, from the image header (see the run tests).
      imageAspectRatio: 'square',
      imageWidth: null,
      imageHeight: null,
      imageMimeType: 'image/jpeg',
      imageAltText: 'The Jewish Roots of American Liberty',
      theme: null,
      visibility: 'Public',
      rsvpTotal: 0,
      categories: [],
      benefits: [],
    });
  });

  it('builds a timed range with the DST offset of the event date', () => {
    const card: ListingCard = {
      slug: 'the-athena-series-why-rome-matters',
      title: 'The Athena Series: Why Rome Matters',
      date: '2026-10-08',
      location: 'Avaya Auditorium (POB 2.302)',
      imageUrl: null,
      imageAltText: null,
      section: 'Upcoming Events',
    };
    const detail = parseDetailPage(loadFixture('detail-standard.html'), card.slug);
    const event = parseCivicLeadershipEvent(card, detail, BEFORE_ALL);

    expect(event?.startDatetime).toBe('2026-10-08T17:00:00-05:00');
    expect(event?.endDatetime).toBe('2026-10-08T18:30:00-05:00');
    expect(event?.locationShort).toBe('Avaya Auditorium (POB 2.302)');
    expect(event?.rsvpUrl).toBe('https://luma.com/o2d23uzh');
  });

  it('keeps a card with no page of its own as an all-day event at /events', () => {
    const event = parseCivicLeadershipEvent(prospectiveCards()[0], null, TODAY);

    expect(event).toMatchObject({
      sourceEventId: 'scl-freedom-virtue-seminar',
      title: 'SCL Freedom & Virtue Seminar',
      description: null,
      startDatetime: '2027-02-05',
      endDatetime: null,
      locationFull: 'Littlefield Home',
      eventUrl: LISTING_URL,
      rsvpUrl: null,
      imageUrl: SEMINAR_IMAGE,
      imageMimeType: 'image/avif',
      imageAltText: 'SCL Freedom & Virtue Seminar',
      categories: [{ id: 'prospective-student-sessions', name: 'Prospective Student Sessions' }],
    });
  });

  it('marks online events', () => {
    const card = previousCard('tribal-politics---how-brexit-divided-britain');
    const detail = parseDetailPage(loadFixture('detail-no-registration.html'), card.slug)!;
    const event = parseCivicLeadershipEvent(card, { ...detail, location: 'Online' }, BEFORE_ALL);
    expect(event?.venueType).toBe('online');
  });

  it('stores an unreadable time as all-day instead of dropping the event', () => {
    const card = previousCard('tribal-politics---how-brexit-divided-britain');
    const detail = parseDetailPage(loadFixture('detail-no-registration.html'), card.slug)!;
    const event = parseCivicLeadershipEvent(card, { ...detail, timeText: 'TBA' }, BEFORE_ALL);
    expect(event?.startDatetime).toBe('2026-11-13');
  });

  it('keeps an all-day event until the end of its day in Austin, then drops it', () => {
    const card = prospectiveCards()[0]; // 2027-02-05, no page
    const lateThatNight = new Date('2027-02-05T23:00:00-06:00').getTime();
    const nextMorning = new Date('2027-02-06T00:30:00-06:00').getTime();

    expect(parseCivicLeadershipEvent(card, null, lateThatNight)).not.toBeNull();
    expect(parseCivicLeadershipEvent(card, null, nextMorning)).toBeNull();
  });

  it('drops a timed event once it has ended', () => {
    const card = previousCard('tribal-politics---how-brexit-divided-britain');
    const detail = parseDetailPage(loadFixture('detail-no-registration.html'), card.slug);
    expect(parseCivicLeadershipEvent(card, detail, TODAY)).toBeNull();
  });
});

// The scraper leaves latitude/longitude null and relies on ingest's building
// registry. If one of these stops resolving, those events lose their map pin.
describe('Civic Leadership venues resolve to map pins', () => {
  it.each([
    ['Littlefield Home', 'LFH'],
    ['Littlefield Home Mirror Room', 'LFH'],
    ['Harry Ransom Center, Tom Lea Room', 'HRC'],
    ['FAC 2.142', 'FAC'],
    ['Avaya Auditorium (POB 2.302)', 'POB'],
    ['Patton Hall (RLP), 1.302E', 'RLP'],
    ['Joe C. Thompson Conference Center, Room 1.110', 'TCC'],
    ['William C. Powers, Jr. Student Activity Center, 2201 Speedway', 'WCP'],
    // The School is in Sid Richardson Hall, not the LBJ Library next door
    // (code LBJ). This read 'LBJ' until LOOP-275's alias in utBuildings.ts.
    ['LBJ School of Public Affairs', 'SRH'],
  ])('%s -> %s', (location, code) => {
    expect(resolveBuilding(location)?.code).toBe(code);
  });

  it('gives online events no pin', () => {
    expect(isNonPhysicalLocation('Online')).toBe(true);
  });
});

describe('parseImageDimensions: AVIF', () => {
  it('reads a real AVIF header from the Webflow CDN', () => {
    // The ftyp and meta boxes of a 3000x2000 event image; no pixel data.
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, 'cover-header.avif')));
    expect(parseImageDimensions(bytes)).toEqual({ width: 3000, height: 2000 });
  });

  it('reads the spatial extent property', () => {
    expect(parseImageDimensions(avif(ispe(1200, 1800)))).toEqual({ width: 1200, height: 1800 });
  });

  it('takes the largest extent when tiles or a thumbnail add their own', () => {
    const grid = avif(ispe(512, 512), ispe(4096, 2048), ispe(256, 128));
    expect(parseImageDimensions(grid)).toEqual({ width: 4096, height: 2048 });
  });

  it('swaps width and height for a quarter-turn rotation', () => {
    const rotated = avif(ispe(3000, 2000), box('irot', Uint8Array.of(1)));
    expect(parseImageDimensions(rotated)).toEqual({ width: 2000, height: 3000 });
  });

  it('returns null, without throwing or looping, on truncated or corrupt input', () => {
    const full = avif(ispe(3000, 2000));
    expect(parseImageDimensions(full.subarray(0, 60))).toBeNull();

    const corrupt = concat(box('ftyp', ascii('avif')), Uint8Array.of(0, 0, 0, 3, 0x6d, 0x65));
    expect(parseImageDimensions(corrupt)).toBeNull();

    // An MP4 also starts with ftyp, and has no image properties.
    expect(parseImageDimensions(box('ftyp', ascii('isom')))).toBeNull();
  });
});

describe('Civic Leadership scraper run', () => {
  // The 2027 seminar cards link to pages that 301 to /events. fetch follows
  // the redirect, so the listing is what their "detail" request returns.
  const SEMINARS = [
    'scl-freedom-virtue-seminar',
    'scl-freedom-virtue-seminar-2',
    'scl-freedom-virtue-seminar-3',
    'scl-freedom-virtue-seminar-4',
  ];

  function stubSite(overrides: Record<string, string | number> = {}) {
    const requested: string[] = [];
    const pages: Record<string, string> = {
      '/events': loadFixture('listing-page.html'),
      '/events?2dd7016c_page=2': loadFixture('listing-page-2.html'),
      ...Object.fromEntries(
        SEMINARS.map((slug) => [`/events/${slug}`, loadFixture('listing-page.html')]),
      ),
      ...Object.fromEntries(
        Object.entries(overrides).filter((e): e is [string, string] => typeof e[1] === 'string'),
      ),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.hostname === 'cdn.prod.website-files.com') {
          return new Response(avif(ispe(3000, 2000)), {
            status: 206,
            headers: { 'Content-Type': 'image/avif' },
          });
        }
        const key = url.pathname + url.search;
        requested.push(key);
        if (typeof overrides[key] === 'number' || !(key in pages)) {
          return new Response('nope', { status: 500, statusText: 'Server Error' });
        }
        return new Response(pages[key], { status: 200 });
      }),
    );
    return requested;
  }

  function freezeClock(at: number) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at);
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('crawls each upcoming list through all its pages, and never pages through past events', async () => {
    freezeClock(TODAY);
    const requested = stubSite();

    const result = await scrapeCivicLeadership({} as Env, { dryRun: true });

    expect(result.errors).toEqual([]);
    expect(requested).toEqual([
      '/events',
      '/events?2dd7016c_page=2', // "Prospective Student Sessions", page 2
      ...SEMINARS.map((slug) => `/events/${slug}`),
    ]);
    expect(result.eventsProcessed).toBe(4);
    expect(result.events?.map((e) => [e.sourceEventId, e.startDatetime])).toEqual([
      ['scl-freedom-virtue-seminar', '2027-02-05'],
      ['scl-freedom-virtue-seminar-2', '2027-03-12'],
      ['scl-freedom-virtue-seminar-3', '2027-04-16'],
      ['scl-freedom-virtue-seminar-4', '2027-04-30'],
    ]);
    // Dimensions from the AVIF header the CDN returned for the range read.
    expect(result.events?.[0]).toMatchObject({
      eventUrl: LISTING_URL,
      imageWidth: 3000,
      imageHeight: 2000,
      imageAspectRatio: 'horizontal',
      imageMimeType: 'image/avif',
    });
  });

  it('produces the same keys on every run, each once', async () => {
    freezeClock(TODAY);
    stubSite();

    const first = await scrapeCivicLeadership({} as Env, { dryRun: true });
    const second = await scrapeCivicLeadership({} as Env, { dryRun: true });
    const ids = (r: typeof first) => r.events!.map((e) => `${e.source}:${e.sourceEventId}`);

    expect(ids(second)).toEqual(ids(first));
    expect(new Set(ids(first)).size).toBe(ids(first).length);
  });

  it("reads a card's own page when it has one", async () => {
    freezeClock(BEFORE_ALL);
    // Present the November events as an upcoming list (with no pager), and give
    // two of them pages.
    const listing = loadFixture('listing-page.html')
      .replace('>Previous Events</h2>', '>Featured Events</h2>')
      .replace(/<a\b[^>]*href="\?33ba72fa_page=2"[\s\S]*?<\/a\s*>/, '');
    stubSite({
      '/events': listing,
      '/events/the-jewish-roots-of-american-liberty': loadFixture('detail-reception.html'),
      '/events/tribal-politics---how-brexit-divided-britain': loadFixture(
        'detail-no-registration.html',
      ),
      '/events/america-in-the-world-at-250-a-view-from-the-bloody-borderland': listing,
    });

    const result = await scrapeCivicLeadership({} as Env, { dryRun: true });
    const bySlug = new Map(result.events!.map((e) => [e.sourceEventId, e]));

    expect(result.errors).toEqual([]);
    expect(bySlug.get('the-jewish-roots-of-american-liberty')).toMatchObject({
      startDatetime: '2026-11-18T17:00:00-06:00',
      rsvpUrl: 'https://luma.com/2y407fg6',
      eventUrl: 'https://civicleadership.utexas.edu/events/the-jewish-roots-of-american-liberty',
      categories: [{ id: 'featured-events', name: 'Featured Events' }],
    });
    expect(bySlug.get('tribal-politics---how-brexit-divided-britain')?.startDatetime).toBe(
      '2026-11-13T14:00:00-06:00',
    );
  });

  it('stops a pager that loops back on itself, and keeps each card once', async () => {
    freezeClock(TODAY);
    // "Page 2" serves page 1 again, whose next link is page 2: a cycle.
    const requested = stubSite({ '/events?2dd7016c_page=2': loadFixture('listing-page.html') });

    const result = await scrapeCivicLeadership({} as Env, { dryRun: true });

    expect(requested.filter((path) => !path.startsWith('/events/'))).toEqual([
      '/events',
      '/events?2dd7016c_page=2',
    ]);
    expect(result.events?.map((e) => e.sourceEventId)).toEqual(SEMINARS.slice(0, 3));
  });

  it('skips an event whose page cannot be fetched and keeps the rest', async () => {
    freezeClock(TODAY);
    stubSite({ '/events/scl-freedom-virtue-seminar-2': 500 });

    const result = await scrapeCivicLeadership({} as Env, { dryRun: true });

    expect(result.eventsSkipped).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('scl-freedom-virtue-seminar-2');
    expect(result.events?.map((e) => e.sourceEventId)).toEqual([
      'scl-freedom-virtue-seminar',
      'scl-freedom-virtue-seminar-3',
      'scl-freedom-virtue-seminar-4',
    ]);
  }, 20_000);

  it('keeps what it found when a later listing page fails', async () => {
    freezeClock(TODAY);
    stubSite({ '/events?2dd7016c_page=2': 500 });

    const result = await scrapeCivicLeadership({} as Env, { dryRun: true });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/Failed to fetch listing page/);
    expect(result.events?.map((e) => e.sourceEventId)).toEqual(SEMINARS.slice(0, 3));
  }, 20_000);

  it('reports a fatal error when the page has no collection lists at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>redesigned</html>', { status: 200 })),
    );

    const result = await scrapeCivicLeadership({} as Env, { dryRun: true });

    expect(result.eventsProcessed).toBe(0);
    expect(result.errors[0]).toMatch(/Fatal error fetching the events listing/);
  });
});
