import { readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanTitle,
  extractCalendarEvents,
  parseCalendarEvent,
  parseDetailPage,
  resolveTiming,
  scrapeNursing,
  type CalendarEvent,
  type EventDetail,
} from '../../src/scrapers/nursing';
import { isNonPhysicalLocation, resolveBuilding } from '../../src/lib/utBuildings';
import type { Env } from '../../src/worker';

function loadFixture(name: string): string {
  return readFileSync(
    join(__dirname, '..', '..', 'src', 'scrapers', '__fixtures__', 'nursing', name),
    'utf-8',
  );
}

// Before every upcoming event in the listing fixture, after the 2019 and 2023 ones.
const NOW = new Date('2026-10-20T00:00:00Z').getTime();

const calendar = extractCalendarEvents(loadFixture('listing.html'));
const byEid = (eid: string): CalendarEvent => calendar.find((e) => e.eid === eid)!;

const EMPTY_DETAIL: EventDetail = {
  description: null,
  location: null,
  address: null,
  tags: [],
  rsvpUrl: null,
  image: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Nursing calendar extraction', () => {
  it('reads the event list out of the double-encoded drupalSettings JSON', () => {
    expect(calendar).toHaveLength(9);
    expect(byEid('2515-D-0')).toMatchObject({
      url: '/events/cpds-hrsa-grants-presentation',
      start: '2026-10-21T12:00:00',
      end: '2026-10-21T13:00:00',
      allDay: false,
    });
  });

  it('throws when the page has no calendar, so a layout change is not mistaken for "no events"', () => {
    expect(() => extractCalendarEvents('<html><body>nothing here</body></html>')).toThrow(
      /drupalSettings/,
    );
    const noEvents = `<script data-drupal-selector="drupal-settings-json">{"fullCalendarView":[{}]}</script>`;
    expect(() => extractCalendarEvents(noEvents)).toThrow(/events not found/);
  });
});

describe('Nursing title', () => {
  it('drops the visually-hidden date prefix the calendar adds', () => {
    expect(cleanTitle(byEid('2515-D-0').title)).toBe('CPDS: HRSA Grants Presentation');
  });

  it('decodes entities in the title', () => {
    expect(cleanTitle(byEid('455-D-0').title)).toBe(
      'Center for Excellence in Aging Services & LTC - Lecture Series',
    );
  });
});

describe('Nursing timing', () => {
  it('attaches the Chicago offset for the date: CDT in October', () => {
    expect(resolveTiming(byEid('2515-D-0'))).toMatchObject({
      startDatetime: '2026-10-21T12:00:00-05:00',
      endDatetime: '2026-10-21T13:00:00-05:00',
    });
  });

  it('attaches CST in January', () => {
    expect(resolveTiming(byEid('1389-R-5-I-1'))).toMatchObject({
      startDatetime: '2023-01-06T08:15:00-06:00',
      endDatetime: '2023-01-06T11:30:00-06:00',
    });
  });

  it('treats a one-day all-day event as a bare date with no end (FullCalendar ends it at the next midnight)', () => {
    expect(resolveTiming(byEid('2455-D-0'))).toMatchObject({
      startDatetime: '2026-12-07',
      endDatetime: null,
    });
  });

  it('ends a multi-day all-day event on its last day, not the exclusive end date', () => {
    // Spring break: calendar start Mar 18, exclusive end Mar 23 -> last day Mar 22.
    expect(resolveTiming(byEid('449-D-0'))).toMatchObject({
      startDatetime: '2019-03-18',
      endDatetime: '2019-03-22',
    });
  });

  it('measures an all-day event to the end of its last day in Chicago', () => {
    // 2026-12-07 23:59:59-06:00 is 2026-12-08T05:59:59Z.
    expect(resolveTiming(byEid('2455-D-0'))!.endMs).toBe(Date.parse('2026-12-08T05:59:59Z'));
  });

  it('drops an end that is before the start rather than storing an inverted range', () => {
    const inverted = { ...byEid('2515-D-0'), end: '2026-10-21T09:00:00' };
    expect(resolveTiming(inverted)).toMatchObject({
      startDatetime: '2026-10-21T12:00:00-05:00',
      endDatetime: null,
    });
  });

  it('returns null for an entry with no usable times', () => {
    expect(resolveTiming({ ...byEid('2515-D-0'), start: '', end: '' })).toBeNull();
    expect(resolveTiming({ ...byEid('2515-D-0'), start: 'garbage', end: 'garbage' })).toBeNull();
  });
});

describe('Nursing detail page', () => {
  it('reads description, location, tags and image from an event page', () => {
    const detail = parseDetailPage(loadFixture('cpds-grants.html'));

    // The JSON-LD description ships "\r\n" and a doubled space; both collapse.
    expect(detail.description).toBe(
      'The Center for Professional Development and Scholarship invites you to a HRSA Grants Presentation on Wednesday, October 21st from 12:00 pm – 1:00 pm in room NUR 5.178 at the School of Nursing.',
    );
    expect(detail.location).toBe('NUR 5.178');
    // From the body's "Location: NUR 5.178 | School of Nursing | <address>" line.
    expect(detail.address).toBe('1710 Red River St., Austin, Texas');
    expect(detail.tags).toEqual([
      { id: 'event-type-141', name: 'Faculty' },
      { id: 'event-type-138', name: 'Information Session' },
      { id: 'event-type-145', name: 'Meeting' },
    ]);
    expect(detail.image).toEqual({
      url: 'https://nursing.utexas.edu/sites/default/files/styles/large/public/2024-02/cpds_logo_web.png?itok=lMkpWDgR',
      width: 480,
      height: 101,
      // The page's alt is the literal string `""`, which means "no alt text".
      altText: null,
    });
  });

  it('does not mistake the site-wide "Give" button for a registration link', () => {
    expect(parseDetailPage(loadFixture('cpds-grants.html')).rsvpUrl).toBeNull();
  });

  it('takes the registration link from the event body', () => {
    const detail = parseDetailPage(loadFixture('info-session-series.html'));

    expect(detail.rsvpUrl).toBe('https://utexas.zoom.us/j/89690535791');
    expect(detail.location).toBe('Zoom Meeting');
    expect(detail.address).toBeNull();
    expect(detail.tags.map((t) => t.name)).toEqual(['Current Students', 'Information Session']);
    expect(detail.image).toBeNull();
  });

  it('survives a plain page that is not an event node (no location, tags or JSON-LD)', () => {
    // Some calendar entries link to ordinary pages, e.g. a livestreamed ceremony.
    const detail = parseDetailPage(loadFixture('lamp-pinning.html'));

    expect(detail).toEqual({
      description: null,
      location: null,
      address: null,
      tags: [],
      // No event body to scope to, so the livestream button is not picked up,
      // and neither is the footer's "Give" button.
      rsvpUrl: null,
      image: null,
    });
  });

  describe('street address', () => {
    // The editors' template, as it appears inside an event body.
    const body = (line: string) =>
      `<div class="field field--name-field-utevent-body"><p><strong>Location:</strong> ${line}</p></div>`;

    it('takes the last "|" part of the Location line when it is a street address', () => {
      const html = body(
        'UTC, Room TBA | University Teaching Center (UTC) |&nbsp;<a href="https://maps.example">105 West 21st Street, Austin, Texas</a>',
      );

      expect(parseDetailPage(html).address).toBe('105 West 21st Street, Austin, Texas');
    });

    it('ignores a Location line whose last part is a room or building, not an address', () => {
      expect(parseDetailPage(body('NUR 5.178 | School of Nursing')).address).toBeNull();
    });

    it('takes a Location line that is only an address, and ignores one that is not', () => {
      expect(parseDetailPage(body('1710 Red River St., Austin, Texas')).address).toBe(
        '1710 Red River St., Austin, Texas',
      );
      expect(parseDetailPage(body('Zoom')).address).toBeNull();
    });

    it('finds no address on a page without a body', () => {
      expect(
        parseDetailPage('<p><strong>Location:</strong> A | 1 Main St., Austin</p>').address,
      ).toBeNull();
    });
  });

  it('falls back to og:description when the page has no JSON-LD', () => {
    const html = `<meta property="og:description" content="Fish &amp; chips night" />`;
    expect(parseDetailPage(html).description).toBe('Fish & chips night');
  });

  it('falls back to og:description when the JSON-LD is malformed', () => {
    const html = `<script type="application/ld+json">{ not json</script>
      <meta property="og:description" content="Backup text" />`;
    expect(parseDetailPage(html).description).toBe('Backup text');
  });
});

describe('Nursing event mapping', () => {
  const cpds = parseDetailPage(loadFixture('cpds-grants.html'));
  const series = parseDetailPage(loadFixture('info-session-series.html'));

  it('maps a calendar entry plus its page into the shared event schema', () => {
    expect(parseCalendarEvent(byEid('2515-D-0'), cpds, NOW)).toEqual({
      source: 'nursing',
      sourceEventId: '2515-2026-10-21',
      title: 'CPDS: HRSA Grants Presentation',
      description: cpds.description,
      startDatetime: '2026-10-21T12:00:00-05:00',
      endDatetime: '2026-10-21T13:00:00-05:00',
      venueType: 'in_person',
      // The card shows the room; the full form keeps the address too.
      locationShort: 'NUR 5.178',
      locationFull: 'NUR 5.178, 1710 Red River St., Austin, Texas',
      latitude: null,
      longitude: null,
      organization: { sourceOrgId: null, name: 'School of Nursing', profilePicture: null },
      eventUrl: 'https://nursing.utexas.edu/events/cpds-hrsa-grants-presentation',
      rsvpUrl: null,
      imageUrl: cpds.image!.url,
      imageWidth: 480,
      imageHeight: 101,
      // 480 x 101 is wide.
      imageAspectRatio: 'horizontal',
      imageMimeType: null,
      imageAltText: null,
      theme: null,
      visibility: 'Public',
      rsvpTotal: 0,
      categories: cpds.tags,
      benefits: [],
    });
  });

  it('marks a Zoom event online and carries its registration link', () => {
    const event = parseCalendarEvent(byEid('2473-D-3'), series, NOW)!;

    expect(event.venueType).toBe('online');
    expect(event.rsvpUrl).toBe('https://utexas.zoom.us/j/89690535791');
    expect(event.imageUrl).toBeNull();
    expect(event.imageAspectRatio).toBe('none');
  });

  it('gives each occurrence of a recurring series its own stable id', () => {
    const ids = [byEid('2473-D-3'), byEid('2473-D-4')].map(
      (ev) => parseCalendarEvent(ev, series, NOW)!.sourceEventId,
    );

    expect(ids).toEqual(['2473-2026-10-26', '2473-2026-11-16']);
  });

  it('keeps the id when an editor deletes an earlier date and the series position shifts', () => {
    const shifted = { ...byEid('2473-D-4'), eid: '2473-D-3' };

    expect(parseCalendarEvent(shifted, series, NOW)!.sourceEventId).toBe('2473-2026-11-16');
  });

  it('builds the id for the R-style eids of rule-based series', () => {
    const event = parseCalendarEvent(byEid('1389-R-5-I-1'), EMPTY_DETAIL, 0)!;

    expect(event.sourceEventId).toBe('1389-2023-01-06');
  });

  it('produces an all-day event for a date-only entry', () => {
    expect(parseCalendarEvent(byEid('2455-D-0'), EMPTY_DETAIL, NOW)).toMatchObject({
      title: 'Last class day',
      startDatetime: '2026-12-07',
      endDatetime: null,
      locationShort: null,
      locationFull: null,
      venueType: 'in_person',
    });
  });

  it('truncates a long location to 40 characters with an ellipsis', () => {
    const detail = {
      ...EMPTY_DETAIL,
      location: 'Nursing Building, Room 5.178, School of Nursing Atrium',
    };
    const event = parseCalendarEvent(byEid('2515-D-0'), detail, NOW)!;

    expect(event.locationShort).toHaveLength(40);
    expect(event.locationShort).toBe('Nursing Building, Room 5.178, School ...');
    expect(event.locationFull).toBe(detail.location);
  });

  it('does not repeat an address the room text already contains', () => {
    const detail = {
      ...EMPTY_DETAIL,
      location: 'NUR 5.178, 1710 Red River St., Austin, Texas',
      address: '1710 Red River St., Austin, Texas',
    };

    expect(parseCalendarEvent(byEid('2515-D-0'), detail, NOW)!.locationFull).toBe(
      'NUR 5.178, 1710 Red River St., Austin, Texas',
    );
  });

  it('uses the address alone when the page has no room', () => {
    const detail = { ...EMPTY_DETAIL, address: '1710 Red River St., Austin, Texas' };
    const event = parseCalendarEvent(byEid('2515-D-0'), detail, NOW)!;

    expect(event.locationFull).toBe('1710 Red River St., Austin, Texas');
    expect(event.locationShort).toBe('1710 Red River St., Austin, Texas');
  });

  // The scraper leaves coordinates null and ingestEvents fills them from the UT
  // building registry using locationFull (attachBuildingCoordinates). These pin
  // that contract: if Nursing's location text stops resolving, events silently
  // lose their map pins, and nothing else would fail.
  describe('coordinates (resolved at ingest from the building registry)', () => {
    it('resolves the room, the address-bearing form and the "various" placeholder to the Nursing building', () => {
      const withAddress = parseCalendarEvent(byEid('2515-D-0'), cpds, NOW)!;
      const various = parseCalendarEvent(
        byEid('2515-D-0'),
        { ...EMPTY_DETAIL, location: 'NUR - various' },
        NOW,
      )!;

      for (const event of [withAddress, various]) {
        expect(event.latitude).toBeNull();
        expect(resolveBuilding(event.locationFull)).toMatchObject({
          code: 'NUR',
          address: '1710 RED RIVER ST, AUSTIN, TX 78712',
          latitude: 30.2776692,
          longitude: -97.7333708,
        });
      }
    });

    it('treats online locations as non-physical, so ingest skips them instead of warning', () => {
      const event = parseCalendarEvent(byEid('2473-D-3'), series, NOW)!;

      expect(event.venueType).toBe('online');
      expect(isNonPhysicalLocation(event.locationFull)).toBe(true);
    });
  });

  it('returns null for events that are over', () => {
    expect(parseCalendarEvent(byEid('420-D-0'), EMPTY_DETAIL, NOW)).toBeNull();
    // Over at its end time, not its start time.
    const during = Date.parse('2026-10-21T17:30:00Z'); // 12:30 CDT
    expect(parseCalendarEvent(byEid('2515-D-0'), cpds, during)).not.toBeNull();
    expect(
      parseCalendarEvent(byEid('2515-D-0'), cpds, Date.parse('2026-10-21T18:30:00Z')),
    ).toBeNull();
  });

  it('keeps an all-day event through the evening of its day', () => {
    const eveningOfDay = Date.parse('2026-12-08T03:00:00Z'); // 21:00 CST on Dec 7
    expect(parseCalendarEvent(byEid('2455-D-0'), EMPTY_DETAIL, eveningOfDay)).not.toBeNull();
  });

  it('returns null for an entry without an entity id', () => {
    expect(parseCalendarEvent({ ...byEid('2515-D-0'), eid: 'weird' }, cpds, NOW)).toBeNull();
  });
});

describe('Nursing scraper run', () => {
  function stubSite(failPath?: string) {
    const requested: string[] = [];
    const pages: Record<string, string> = {
      '/events': loadFixture('listing.html'),
      '/events/cpds-hrsa-grants-presentation': loadFixture('cpds-grants.html'),
      '/events/fall-2026-information-session-internal-transfer': loadFixture(
        'info-session-series.html',
      ),
      '/events/last-class-day-fall2026': loadFixture('lamp-pinning.html'),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const path = new URL(input).pathname;
        requested.push(path);
        if (path === failPath || !(path in pages)) {
          return new Response('nope', { status: 500, statusText: 'Server Error' });
        }
        return new Response(pages[path], { status: 200 });
      }),
    );
    return requested;
  }

  // The fixture's events are dated 2026-10-21 and later.
  function freezeClock() {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches each page once per series and only for events that are still upcoming', async () => {
    freezeClock();
    const requested = stubSite();

    const result = await scrapeNursing({} as Env, { dryRun: true });

    // Upcoming: cpds (Oct 21), two internal-transfer occurrences, last class day.
    expect(result.eventsProcessed).toBe(4);
    expect(result.eventsSkipped).toBe(0);
    expect(result.errors).toEqual([]);
    expect(requested.sort()).toEqual([
      '/events',
      '/events/cpds-hrsa-grants-presentation',
      '/events/fall-2026-information-session-internal-transfer',
      '/events/last-class-day-fall2026',
    ]);
  });

  it('skips a series whose page cannot be fetched, instead of ingesting it without a description', async () => {
    freezeClock();
    stubSite('/events/fall-2026-information-session-internal-transfer');

    const result = await scrapeNursing({} as Env, { dryRun: true });

    // Both occurrences of the failed series are skipped; the other two are fine.
    expect(result.eventsSkipped).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('internal-transfer');
  }, 20_000);

  it('reports a fatal error when the listing cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>redesigned</html>', { status: 200 })),
    );

    const result = await scrapeNursing({} as Env, { dryRun: true });

    expect(result.eventsProcessed).toBe(0);
    expect(result.errors[0]).toMatch(/Fatal error fetching events/);
  });
});
