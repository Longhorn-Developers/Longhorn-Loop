import { readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveBuilding, isNonPhysicalLocation } from '../../src/lib/utBuildings';
import {
  endInstant,
  eventPath,
  extractEventTypes,
  extractListingCards,
  fetchListingCards,
  hasNextPage,
  parseDateLine,
  parseDetailPage,
  parseEvent,
  scrapeArchitecture,
  tokenize,
} from '../../src/scrapers/architecture';
import type { Env } from '../../src/worker';

function loadFixture(name: string): string {
  return readFileSync(
    join(__dirname, '..', '..', 'src', 'scrapers', '__fixtures__', 'architecture', name),
    'utf-8',
  );
}

// Before every fixture event, so none is filtered out as past.
const NOW = new Date('2026-10-01T00:00:00Z').getTime();

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Architecture listing parser', () => {
  it('reads every card on the upcoming page, and nothing from the site chrome', () => {
    const cards = extractListingCards(loadFixture('listing-upcoming.html'));
    expect(cards.map((c) => c.path)).toEqual([
      '/events/dont-get-too-attached',
      '/events/prospective-graduate-student-information-session-9',
      '/events/utsoa-career-fair-2027',
    ]);

    expect(cards[0]).toEqual({
      path: '/events/dont-get-too-attached',
      title: 'Don’t Get Too Attached',
      type: 'Exhibition',
      status: 'Scheduled',
      dateLine: 'Friday October 30, 2026, 5:00pm - Monday November 30, 2026, 7:00pm',
      teaser:
        "Beginning October 30 at 5:00 pm, Don't Get Too Attached in on view. The exhibition is designed and curated by Assistant Professor of Interior Design Ria Bravo.",
      location: 'North Gallery of Goldsmith Hall',
      imageUrl:
        'https://soa.utexas.edu/sites/default/files/styles/utexas_image_style_840w_656h/public/2026-10/Screenshot%202026-10-21%20at%209.43.07%E2%80%AFAM.png?itok=wHG3Dpcb',
      // Trailing space trimmed (the site's alt has one).
      imageAlt: 'a pink drawing of a woman at a sewing machine',
    });
  });

  it('takes an unlinked last line as the location', () => {
    const [, virtual, fair] = extractListingCards(loadFixture('listing-upcoming.html'));
    expect(virtual.location).toBe('Virtual');
    expect(virtual.teaser).toMatch(/^Learn more about/);
    expect(fair.location).toBe(
      'Zlotnik Ballroom, AT&T Hotel and Conference Center, 1900 University Ave, Austin, TX 78705',
    );
    expect(fair.type).toBe('Career Services');
  });

  it('handles a card with no type, an all-day range and a linked venue off the building map', () => {
    const cards = extractListingCards(loadFixture('listing-paged.html'));
    expect(cards).toHaveLength(9);
    const byPath = (slug: string) => cards.find((c) => c.path === `/events/${slug}`)!;

    expect(byPath('steve-adler-city-forum').location).toBe('GOL 3.120');
    const noType = byPath('prospective-graduate-student-information-session-7');
    expect(noType.type).toBeNull();
    expect(noType.status).toBe('Scheduled');
    expect(noType.imageAlt).toBe('students in the couryard chatting with each other');
    const headshots = byPath('headshots-0');
    expect(headshots.dateLine).toBe('Wednesday October 28 - Friday October 30, 2026, All day');
    expect(headshots.location).toBe('TBD');
    const tenEyck = byPath('lecture-christine-ten-eyck');
    expect(tenEyck.location).toBe('Harry Ransom Center - Prothro Theater');
    expect(tenEyck.teaser).toBe(
      'Join us on November 2 for a lecture by Christine Ten Eyck, Ten Eyck Landscape Architects.',
    );
    // The pager after the last card is not part of it.
    const last = cards[cards.length - 1];
    expect(last.path).toBe('/events/scales-city-michael-maltzan');
    expect(last.location).toBe('William C. Powers, Jr. Student Activity Center (WCP) Auditorium');
    expect(last.teaser).toBe(
      'Join us on October 26 for Michael Maltzan\'s lecture, "Scales of the City."',
    );
  });

  it('throws when the page has no main region, rather than reporting 0 events', () => {
    expect(() => extractListingCards('<html><body><p>Maintenance</p></body></html>')).toThrow(
      /main content/,
    );
  });

  it('reads the event types from the filter select', () => {
    const types = extractEventTypes(loadFixture('listing-upcoming.html'));
    expect(types.has('Exhibition')).toBe(true);
    expect(types.has('Lecture Series')).toBe(true);
    expect(types.has('- Any -')).toBe(false);
    expect(types.size).toBe(15);
  });

  it('detects the Drupal pager', () => {
    expect(hasNextPage(loadFixture('listing-paged.html'), 0)).toBe(true);
    expect(hasNextPage(loadFixture('listing-upcoming.html'), 0)).toBe(false);
  });

  it('only treats this site’s /events/<slug> links as event pages', () => {
    expect(eventPath('/events/headshots-0')).toBe('/events/headshots-0');
    expect(eventPath('https://soa.utexas.edu/events/headshots-0/')).toBe('/events/headshots-0');
    expect(eventPath('/events')).toBeNull();
    expect(eventPath('/past-events')).toBeNull();
    expect(eventPath('https://calendar.utexas.edu/events/x')).toBeNull();
  });

  it('keeps inline formatting inside one text run', () => {
    expect(tokenize('<p>A <em>big</em> talk<br>tonight</p><div>Next</div>')).toEqual([
      { kind: 'text', text: 'A big talk tonight' },
      { kind: 'text', text: 'Next' },
    ]);
  });
});

// SYNTHETIC, not a capture: none of the 12 live cards (2026-11-27) is missing a
// teaser or a location, so these cards are built in the site's own markup to
// cover the shapes the order-based reading used to get wrong.
function syntheticListing(body: string | null, location: string | null): string {
  const field = (name: string, inner: string) =>
    `<div class="views-field views-field-field-soaevent-${name}"><div class="field-content">${inner}</div></div>`;
  return `<main><div class="views-row row-1">
    ${field('datetime', 'Tuesday December 1, 2026, 6:00 - 7:00pm')}
    <div class="views-field views-field-title"><span class="field-content"><a href="/events/test-event">Test Event</a></span></div>
    ${body === null ? '' : field('body ut-copy', body)}
    ${location === null ? '' : field('location-link', location)}
  </div></main>`;
}

describe('Architecture teaser and location fields', () => {
  const read = (body: string | null, location: string | null) => {
    const [card] = extractListingCards(syntheticListing(body, location));
    return { teaser: card.teaser, location: card.location };
  };

  it('keeps a two-paragraph teaser whole when there is no location', () => {
    expect(read('<p>First paragraph.</p><p>Second paragraph.</p>', null)).toEqual({
      teaser: 'First paragraph. Second paragraph.',
      location: null,
    });
  });

  it('keeps a link inside the teaser as teaser text', () => {
    expect(
      read('<p>Please <a href="https://example.com/rsvp">RSVP</a> for the talk.</p>', null),
    ).toEqual({
      teaser: 'Please RSVP for the talk.',
      location: null,
    });
  });

  it('does not mistake a short teaser for a location', () => {
    expect(read('Join us!', null)).toEqual({ teaser: 'Join us!', location: null });
  });

  it('reads a long unlinked location when there is no teaser', () => {
    const address = 'Zlotnik Ballroom, AT&amp;T Hotel and Conference Center, 1900 University Ave';
    expect(read(null, address)).toEqual({
      teaser: null,
      location: 'Zlotnik Ballroom, AT&T Hotel and Conference Center, 1900 University Ave',
    });
  });

  it('strips the "Location:" prefix from a linked location', () => {
    expect(
      read('A talk.', '<a href="https://maps.example/gol">Location: Goldsmith Hall</a>'),
    ).toEqual({
      teaser: 'A talk.',
      location: 'Goldsmith Hall',
    });
  });
});

describe('parseDateLine', () => {
  it.each([
    [
      'Friday October 30, 2026, 5:00pm - Monday November 30, 2026, 7:00pm',
      // Crosses the DST change on Nov 1: CDT start, CST end.
      '2026-10-30T17:00:00-05:00',
      '2026-11-30T19:00:00-06:00',
    ],
    [
      'Tuesday February 16, 2027, 10:00am - 5:00pm',
      '2027-02-16T10:00:00-06:00',
      '2027-02-16T17:00:00-06:00',
    ],
    // The start borrows the end's meridiem.
    [
      'Tuesday December 1, 2026, 6:00 - 7:00pm',
      '2026-12-01T18:00:00-06:00',
      '2026-12-01T19:00:00-06:00',
    ],
    // 12:00 shares "pm": noon.
    [
      'Friday November 20, 2026, 12:00 - 1:30pm',
      '2026-11-20T12:00:00-06:00',
      '2026-11-20T13:30:00-06:00',
    ],
    [
      'Thursday November 5, 2026, 11:00am - 12:00pm',
      '2026-11-05T11:00:00-06:00',
      '2026-11-05T12:00:00-06:00',
    ],
    // Sharing "pm" would put 11 after 1, so it is 11am.
    [
      'Monday March 1, 2027, 11:00 - 1:00pm',
      '2027-03-01T11:00:00-06:00',
      '2027-03-01T13:00:00-06:00',
    ],
    ['Monday November 9, 2026, 5:00pm', '2026-11-09T17:00:00-06:00', null],
  ])('%s', (line, start, end) => {
    expect(parseDateLine(line)).toEqual({ startDatetime: start, endDatetime: end });
  });

  it('emits bare dates for all-day events, as the other scrapers do', () => {
    expect(parseDateLine('Wednesday October 28 - Friday October 30, 2026, All day')).toEqual({
      startDatetime: '2026-10-28',
      endDatetime: '2026-10-30',
    });
    expect(parseDateLine('Monday November 9, 2026, All day')).toEqual({
      startDatetime: '2026-11-09',
      endDatetime: null,
    });
    // The year is written once, at the end; the start is the year before.
    expect(parseDateLine('Wednesday December 30 - Saturday January 2, 2027, All day')).toEqual({
      startDatetime: '2026-12-30',
      endDatetime: '2027-01-02',
    });
  });

  it.each(['Date TBA', 'Friday February 30, 2027, 5:00pm', 'Friday October 30, 2026, 13:00pm', ''])(
    'rejects %j',
    (line) => {
      expect(parseDateLine(line)).toBeNull();
    },
  );

  it('ends an all-day event at the end of its last day in Chicago', () => {
    expect(endInstant({ startDatetime: '2026-10-28', endDatetime: '2026-10-30' })).toBe(
      new Date('2026-10-31T04:59:59Z').getTime(),
    );
  });
});

// SYNTHETIC, not a capture: every event page on the site has Open Graph tags
// (all 12 listed events checked, 2026-11-27), so there is no real page without
// them to save. This exercises the fallback to the card's own data.
const BARE_PAGE = '<!doctype html><html><head><meta charset="utf-8" /></head><body></body></html>';

const OG_IMAGE =
  'https://soa.utexas.edu/sites/default/files/styles/large/public/2026-10/Screenshot%202026-10-21%20at%209.43.07%E2%80%AFAM.png?itok=rPH4Cl0y';

describe('Architecture detail parser', () => {
  it('reads the Open Graph tags', () => {
    expect(parseDetailPage(loadFixture('detail.html'))).toEqual({
      description:
        "Beginning October 30 at 5:00 pm, Don't Get Too Attached in on view. The exhibition is designed and curated by Assistant Professor of Interior Design Ria Bravo.",
      imageUrl: OG_IMAGE,
      imageAlt: 'a pink drawing of a woman at a sewing machine',
      // From drupalSettings.path.currentPath ("node\/3465").
      nodeId: '3465',
    });
  });

  it('returns nulls for a page without them', () => {
    expect(parseDetailPage(BARE_PAGE)).toEqual({
      description: null,
      imageUrl: null,
      imageAlt: null,
      nodeId: null,
    });
  });

  it('reads the node id whether or not the slash is escaped', () => {
    expect(parseDetailPage('<script>{"path":{"currentPath":"node/42"}}</script>').nodeId).toBe(
      '42',
    );
    // The shared menu's /node/N links are not this page's node.
    expect(parseDetailPage('<a href="/node/7">Menu</a>').nodeId).toBeNull();
  });
});

describe('Architecture event mapping', () => {
  const [exhibition, virtual] = extractListingCards(loadFixture('listing-upcoming.html'));
  const detail = parseDetailPage(loadFixture('detail.html'));
  const bare = parseDetailPage(BARE_PAGE);

  it('maps a card and its page into the shared event schema', () => {
    expect(parseEvent(exhibition, detail, NOW)).toEqual({
      source: 'soa',
      // The page's Drupal node id: stable across retitles and reschedules.
      sourceEventId: 'node-3465',
      title: 'Don’t Get Too Attached',
      description:
        "Beginning October 30 at 5:00 pm, Don't Get Too Attached in on view. The exhibition is designed and curated by Assistant Professor of Interior Design Ria Bravo.",
      startDatetime: '2026-10-30T17:00:00-05:00',
      endDatetime: '2026-11-30T19:00:00-06:00',
      venueType: 'in_person',
      locationShort: 'North Gallery of Goldsmith Hall',
      locationFull: 'North Gallery of Goldsmith Hall',
      latitude: null,
      longitude: null,
      organization: { sourceOrgId: null, name: 'School of Architecture', profilePicture: null },
      eventUrl: 'https://soa.utexas.edu/events/dont-get-too-attached',
      rsvpUrl: null,
      // og:image, not the card's 840x656 crop.
      imageUrl: OG_IMAGE,
      imageWidth: null,
      imageHeight: null,
      imageAspectRatio: 'square',
      imageMimeType: null,
      imageAltText: 'a pink drawing of a woman at a sewing machine',
      theme: null,
      visibility: 'Public',
      rsvpTotal: 0,
      categories: [{ id: 'exhibition', name: 'Exhibition' }],
      benefits: [],
    });
  });

  it('keeps the same id when an event is moved to another date', () => {
    const moved = { ...exhibition, dateLine: 'Friday January 8, 2027, 5:00 - 7:00pm' };
    expect(parseEvent(moved, detail, NOW)!.sourceEventId).toBe('node-3465');
  });

  it('adds the date when one page is listed more than once', () => {
    const event = parseEvent(exhibition, detail, NOW, { repeatsOnListing: true })!;
    expect(event.sourceEventId).toBe('node-3465-2026-10-30');
  });

  it('falls back to the card when the page has no Open Graph tags', () => {
    const event = parseEvent(virtual, bare, NOW)!;
    // No node id on the page: slug plus start date.
    expect(event.sourceEventId).toBe(
      'prospective-graduate-student-information-session-9-2026-12-01',
    );
    expect(event.description).toMatch(/^Learn more about/);
    expect(event.imageUrl).toMatch(/utexas_image_style_840w_656h/);
    expect(event.imageAltText).toBe('students in the couryard chatting with each other');
    expect(event.venueType).toBe('online');
    expect(event.categories).toEqual([{ id: 'admissions', name: 'Admissions' }]);
  });

  it('truncates a long location to 40 characters for locationShort', () => {
    const fair = extractListingCards(loadFixture('listing-upcoming.html'))[2];
    const event = parseEvent(fair, bare, NOW)!;
    expect(event.locationShort).toBe('Zlotnik Ballroom, AT&T Hotel and Conf...');
    expect(event.locationFull).toBe(
      'Zlotnik Ballroom, AT&T Hotel and Conference Center, 1900 University Ave, Austin, TX 78705',
    );
  });

  it('skips events that are over, cancelled, or undated', () => {
    expect(parseEvent(exhibition, detail, new Date('2026-12-01T06:00:00Z').getTime())).toBeNull();
    expect(parseEvent({ ...exhibition, status: 'Cancelled' }, detail, NOW)).toBeNull();
    expect(parseEvent({ ...exhibition, dateLine: 'Date TBA' }, detail, NOW)).toBeNull();
  });

  it('is still listed while an all-day event’s last day is running in Chicago', () => {
    const headshots = extractListingCards(loadFixture('listing-paged.html')).find(
      (c) => c.path === '/events/headshots-0',
    )!;
    // 11pm on Oct 30 in Chicago is already Oct 31 in UTC.
    expect(parseEvent(headshots, bare, new Date('2026-10-31T04:00:00Z').getTime())).not.toBeNull();
  });

  // ingestEvents resolves coordinates from the location (LOOP-275), so the
  // scraper writes none. This pins that every location seen on the live
  // listing resolves there, or is correctly treated as non-physical.
  it.each([
    ['North Gallery of Goldsmith Hall', 'GOL'],
    ['GOL 3.120', 'GOL'],
    ["Dean's Conference Room (GOL 2.302B)", 'GOL'],
    ['Goldsmith Hall Auditorium', 'GOL'],
    ['Harry Ransom Center - Prothro Theater', 'HRC'],
    ['William C. Powers, Jr. Student Activity Center (WCP) Auditorium', 'WCP'],
    [
      'Zlotnik Ballroom, AT&T Hotel and Conference Center, 1900 University Ave, Austin, TX 78705',
      'ATT',
    ],
  ])('geocodes %j via the building registry', (location, code) => {
    expect(resolveBuilding(location)?.code).toBe(code);
  });

  it.each(['Virtual', 'TBD'])('treats %j as having no place to pin', (location) => {
    expect(isNonPhysicalLocation(location)).toBe(true);
  });
});

describe('fetchListingCards', () => {
  it('follows the pager and stops on the last page', async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested.push(url);
        const body = url.endsWith('?page=1')
          ? loadFixture('listing-upcoming.html')
          : loadFixture('listing-paged.html');
        return new Response(body, { status: 200 });
      }),
    );

    const cards = await fetchListingCards();
    expect(requested).toEqual([
      'https://soa.utexas.edu/events',
      'https://soa.utexas.edu/events?page=1',
    ]);
    expect(cards).toHaveLength(12);
  });
});

describe('scrapeArchitecture', () => {
  it('does not fetch the pages of events it will skip', async () => {
    // Nov 21: all 9 /past-events cards are over (the last ended Nov 20, 1:30pm);
    // the 3 upcoming ones are not.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-21T18:00:00Z'));
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested.push(url);
        if (url === 'https://soa.utexas.edu/events') {
          return new Response(loadFixture('listing-paged.html'), { status: 200 });
        }
        if (url === 'https://soa.utexas.edu/events?page=1') {
          return new Response(loadFixture('listing-upcoming.html'), { status: 200 });
        }
        if (url.startsWith('https://soa.utexas.edu/events/')) {
          return new Response(loadFixture('detail.html'), { status: 200 });
        }
        return new Response('', { status: 200 }); // image metadata
      }),
    );

    const result = await scrapeArchitecture({} as Env, { dryRun: true });

    const pastPaths = extractListingCards(loadFixture('listing-paged.html')).map((c) => c.path);
    const upcomingPaths = extractListingCards(loadFixture('listing-upcoming.html')).map(
      (c) => c.path,
    );
    const eventPagesFetched = requested
      .filter((u) => u.startsWith('https://soa.utexas.edu/events/'))
      .map((u) => new URL(u).pathname);
    expect(eventPagesFetched.sort()).toEqual([...upcomingPaths].sort());
    for (const path of pastPaths) expect(eventPagesFetched).not.toContain(path);
    expect(result.eventsProcessed).toBe(12);
    expect(result.eventsSkipped).toBe(9);
    expect(result.errors).toEqual([]);
  });
});
