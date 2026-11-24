import { readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hostName,
  parseCalendarEvent,
  parseDetailPage,
  scrapeLbj,
  type EventDetail,
} from '../../src/scrapers/lbj';
import { htmlToText } from '../../src/scrapers/helpers';
import {
  extractCalendarEvents,
  resolveTiming,
  type CalendarEvent,
} from '../../src/scrapers/utDrupalCalendar';
import { isNonPhysicalLocation, resolveBuilding } from '../../src/lib/utBuildings';
import type { Env } from '../../src/worker';

function loadFixture(name: string): string {
  return readFileSync(
    join(__dirname, '..', '..', 'src', 'scrapers', '__fixtures__', 'lbj', name),
    'utf-8',
  );
}

// The fixtures were captured together on 2026-11-20, so "upcoming" means after
// this. Every upcoming entry in calendar.html is in December 2026 or later.
const NOW = new Date('2026-11-20T18:00:00Z').getTime();

const calendar = extractCalendarEvents(loadFixture('calendar.html'));
const byEid = (eid: string): CalendarEvent => calendar.find((e) => e.eid === eid)!;
const upcoming = calendar.filter((ev) => resolveTiming(ev)!.endMs >= NOW);

// Every distinct page behind the upcoming entries, as captured.
const PAGES: Record<string, string> = {
  '/lbj-business-policy-forum-0': 'business-policy-forum.html',
  '/social-contract-age-ai-future-skills-jobs-and-entrepreneurship': 'social-contract.html',
  '/join-us-graduate-virtual-information-session': 'info-session.html',
  '/environmental-and-energy-economics-and-policy-seminar-fall-2026': 'eee-seminar-fall.html',
  '/environmental-and-energy-economics-and-policy-seminar-spring-2027': 'eee-seminar-spring.html',
  '/events/mlk-book-talk-brandon-terry': 'mlk-book-talk.html',
  '/events/book-talk-ashley-farmer': 'farmer-book-talk.html',
};
const detailFor = (url: string): EventDetail => parseDetailPage(loadFixture(PAGES[url]));

const EMPTY_DETAIL: EventDetail = {
  description: null,
  location: null,
  tags: [],
  rsvpUrl: null,
  image: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LBJ calendar', () => {
  it('reads the calendar the site embeds in /calendar', () => {
    expect(calendar).toHaveLength(24);
    expect(upcoming).toHaveLength(19);
    expect(byEid('77829-D-0')).toMatchObject({
      url: '/social-contract-age-ai-future-skills-jobs-and-entrepreneurship',
      start: '2026-12-02T16:00:00',
      end: '2026-12-02T18:00:00',
      allDay: false,
    });
  });

  // The reason the scraper reads /calendar instead of paginating /events: the
  // two list the same upcoming occurrences. /events shows dates AP-style, with
  // the year left off for the year of capture ("Dec. 2, 4 to 6 p.m.", "Jan. 7,
  // 2027, 5 to 6 p.m."), so each calendar entry is rendered that way to compare.
  it('holds every occurrence the paginated /events listing shows, and nothing else', () => {
    const AP_MONTHS = [
      'Jan.',
      'Feb.',
      'March',
      'April',
      'May',
      'June',
      'July',
      'Aug.',
      'Sept.',
      'Oct.',
      'Nov.',
      'Dec.',
    ];
    const apDate = (iso: string) => {
      const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
      return `${AP_MONTHS[m - 1]} ${d}${y === 2026 ? '' : `, ${y}`}`;
    };

    const listed = ['listing-page-0.html', 'listing-page-1.html'].flatMap((name) =>
      loadFixture(name)
        .split(/<div class="views-row row-\d+">/)
        .slice(1)
        .map((row) => {
          const href = row.match(/<a\s[^>]*href="([^"]*)"/)![1];
          const when = htmlToText(
            row.match(/views-field-field-utevent-datetime">([\s\S]*?)<\/div>/)![1],
          ).replace('Date and time:', '');
          // "Dec. 2, 4 to 6 p.m." -> "Dec. 2"; "Jan. 7, 2027, 5 to 6 p.m." -> "Jan. 7, 2027"
          return `${href} ${when.trim().match(/^[A-Za-z.]+ \d+(?:, \d{4})?/)![0]}`;
        }),
    );
    const fromCalendar = upcoming.map((ev) => `${ev.url} ${apDate(ev.start)}`);

    // 10 + 9 rows: the second page is the last.
    expect(listed).toHaveLength(19);
    expect(loadFixture('listing-page-1.html')).not.toContain('pager__item--next');
    expect([...fromCalendar].sort()).toEqual([...listed].sort());
  });

  it('turns every upcoming occurrence into an event', () => {
    const events = upcoming.map((ev) => parseCalendarEvent(ev, detailFor(ev.url), NOW));

    expect(events.every((e) => e !== null)).toBe(true);
    // One row per occurrence: 19 distinct ids, so repeat runs upsert in place.
    expect(new Set(events.map((e) => e!.sourceEventId)).size).toBe(19);
  });
});

describe('LBJ timing', () => {
  it('attaches CST in December', () => {
    expect(resolveTiming(byEid('77829-D-0'))).toMatchObject({
      startDatetime: '2026-12-02T16:00:00-06:00',
      endDatetime: '2026-12-02T18:00:00-06:00',
    });
  });

  it('switches offset inside one series when it crosses the DST change', () => {
    // EEE Spring 2027: DST starts March 14.
    expect(resolveTiming(byEid('77852-D-2'))!.startDatetime).toBe('2027-03-02T10:30:00-06:00');
    expect(resolveTiming(byEid('77852-D-3'))!.startDatetime).toBe('2027-04-09T10:30:00-05:00');
  });

  it('ends a multi-day all-day event on its last day, not the exclusive end date', () => {
    // Calendar end 2025-12-06; the page says "Nov. 30 to Dec. 5, 2025".
    expect(resolveTiming(byEid('77071-D-0'))).toMatchObject({
      startDatetime: '2025-11-30',
      endDatetime: '2025-12-05',
    });
  });

  it('takes times from the calendar, never from the page JSON-LD', () => {
    // A recurring page's JSON-LD carries the series' FIRST occurrence: the Fall
    // seminar's page says Aug 28 while the occurrence still to come is Dec 4.
    const page = loadFixture('eee-seminar-fall.html');
    expect(page).toContain('"startDate": "2026-08-28T10:30:00-05:00"');

    const event = parseCalendarEvent(byEid('77590-D-4'), parseDetailPage(page), NOW)!;

    expect(event.startDatetime).toBe('2026-12-04T10:30:00-06:00');
    expect(event.endDatetime).toBe('2026-12-04T11:45:00-06:00');
  });
});

describe('LBJ detail page', () => {
  it('reads description, location, tags, registration link and image', () => {
    const detail = parseDetailPage(loadFixture('social-contract.html'));

    // JSON-LD's "\r\n\r\n" paragraph break collapses to a space.
    expect(detail.description).toMatch(
      /^The event will center on public policy: how we prepare workers for transition,/,
    );
    expect(detail.description).toContain('entry-level pathways. Bringing together leaders');
    expect(detail.location).toBe('LBJ Bass Lecture Hall');
    expect(detail.tags).toEqual([{ id: 'event-type-15', name: 'LBJ School Events' }]);
    expect(detail.rsvpUrl).toBe(
      'https://www.eventbrite.com/e/a-new-social-contract-skills-jobs-economic-security-in-the-age-of-ai-tickets-2003981142543?aff=oddtdtcreator',
    );
    expect(detail.image).toEqual({
      // The 480px derivative, not the 1920x1080 upload in field-photo.
      url: 'https://lbj.utexas.edu/sites/default/files/styles/large/public/2026-11/LBJBPF%20DEC%20Event%20Digital%20Screen%201.png?itok=NoGgHKpk',
      // Unknown until the file is read; the JSON-LD's 480x480 is not trusted.
      width: null,
      height: null,
      mimeType: null,
      altText: 'Social Contract in the Age of AI: The Future of Skills, Jobs, and Entrepreneurship',
    });
  });

  it('falls back to the first button in the body when there is no Event URL field', () => {
    // Its body embeds images before the button, which would end a
    // fieldBlock()-scoped search early.
    const detail = parseDetailPage(loadFixture('business-policy-forum.html'));

    expect(detail.rsvpUrl).toBe('https://www.eventbrite.com/e/2003981142543?aff=oddtdtcreator');
  });

  it('decodes the Event URL field (its query string arrives as &amp;)', () => {
    const detail = parseDetailPage(loadFixture('info-session.html'));

    expect(detail.rsvpUrl).toMatch(/^https:\/\/lbj\.utexas\.edu\/admissions-events\?gad_source=1&/);
    expect(detail.rsvpUrl).not.toContain('&amp;');
    expect(detail.location).toBe('Virtual via Zoom');
  });

  it('does not mistake the footer newsletter button for a registration link', () => {
    // Every page has "Subscribe to our newsletter" as a ut-btn; this page has
    // no registration link of its own.
    const page = loadFixture('mlk-book-talk.html');
    expect(page).toContain('Subscribe to our newsletter');

    const detail = parseDetailPage(page);

    expect(detail.rsvpUrl).toBeNull();
    expect(detail.location).toBeNull();
  });

  it('reads a location written as building and room', () => {
    expect(parseDetailPage(loadFixture('eee-seminar-fall.html')).location).toBe(
      'LBJ School of Public Affairs, SRH 3, Room 3.124',
    );
    expect(parseDetailPage(loadFixture('eee-seminar-spring.html')).location).toBe(
      'LBJ - SRH 3.122',
    );
  });

  it('falls back to field-photo, with its own dimensions, when the page has no og:image', () => {
    // As on lbj.utexas.edu/ukrainian-village-way-european-union-data-policy-recommendations.
    const html = `<div class="field field--name-field-photo field--type-image field--label-hidden utevent-event-field utevent-event-field--field-photo">
      <div class="field__item utevent-event-field__item"><img loading="lazy" src="/sites/default/files/event1%20-%20photo2.JPG" width="1280" height="860" alt="Ukrainian village" /></div></div>`;

    expect(parseDetailPage(html).image).toEqual({
      url: 'https://lbj.utexas.edu/sites/default/files/event1%20-%20photo2.JPG',
      width: 1280,
      height: 860,
      mimeType: null,
      altText: 'Ukrainian village',
    });
  });

  it('refuses a registration link that is not a web address', () => {
    const html = `<div class="field field--name-field-event-url"><div class="field__item utevent-event-field__item"><a href="mailto:lbj@austin.utexas.edu">RSVP</a></div></div>`;

    expect(parseDetailPage(html).rsvpUrl).toBeNull();
  });

  it('survives an empty page', () => {
    expect(parseDetailPage('<html></html>')).toEqual(EMPTY_DETAIL);
  });
});

describe('LBJ host', () => {
  it('names the unit in the tags as the host', () => {
    expect(hostName(detailFor('/events/mlk-book-talk-brandon-terry').tags)).toBe(
      'Center for the Study of Race and Democracy',
    );
    expect(hostName(detailFor('/join-us-graduate-virtual-information-session').tags)).toBe(
      'Office of Student Affairs and Admissions (OSAA)',
    );
  });

  it('falls back to the School for the catch-all tags, or none', () => {
    expect(hostName([{ id: 'event-type-15', name: 'LBJ School Events' }])).toBe(
      'LBJ School of Public Affairs',
    );
    expect(hostName([{ id: 'event-type-1300', name: 'Non-LBJ School Events' }])).toBe(
      'LBJ School of Public Affairs',
    );
    expect(hostName([])).toBe('LBJ School of Public Affairs');
  });

  it('skips a catch-all tag to reach the unit after it', () => {
    expect(
      hostName([
        { id: 'event-type-15', name: 'LBJ School Events' },
        { id: 'event-type-1182', name: 'RGK Center for Philanthropy and Community Service' },
      ]),
    ).toBe('RGK Center for Philanthropy and Community Service');
  });
});

describe('LBJ event mapping', () => {
  it('maps a calendar entry plus its page into the shared event schema', () => {
    const detail = detailFor('/social-contract-age-ai-future-skills-jobs-and-entrepreneurship');
    // As the orchestrator leaves it once the image has been read.
    detail.image = { ...detail.image!, width: 480, height: 270, mimeType: 'image/png' };

    expect(parseCalendarEvent(byEid('77829-D-0'), detail, NOW)).toEqual({
      source: 'lbj',
      sourceEventId: '77829-2026-12-02',
      title: 'Social Contract in the Age of AI: The Future of Skills, Jobs, and Entrepreneurship',
      description: detail.description,
      startDatetime: '2026-12-02T16:00:00-06:00',
      endDatetime: '2026-12-02T18:00:00-06:00',
      venueType: 'in_person',
      locationShort: 'LBJ Bass Lecture Hall',
      locationFull: 'LBJ Bass Lecture Hall',
      latitude: null,
      longitude: null,
      organization: {
        sourceOrgId: null,
        name: 'LBJ School of Public Affairs',
        profilePicture: null,
      },
      eventUrl:
        'https://lbj.utexas.edu/social-contract-age-ai-future-skills-jobs-and-entrepreneurship',
      rsvpUrl: detail.rsvpUrl,
      imageUrl: detail.image.url,
      imageWidth: 480,
      imageHeight: 270,
      imageAspectRatio: 'horizontal',
      imageMimeType: 'image/png',
      imageAltText: detail.image.altText,
      theme: null,
      visibility: 'Public',
      rsvpTotal: 0,
      categories: [{ id: 'event-type-15', name: 'LBJ School Events' }],
      benefits: [],
    });
  });

  it('marks a Zoom event online, hosted by the unit that runs it', () => {
    const detail = detailFor('/join-us-graduate-virtual-information-session');
    const event = parseCalendarEvent(byEid('77754-D-7'), detail, NOW)!;

    expect(event.venueType).toBe('online');
    expect(event.organization.name).toBe('Office of Student Affairs and Admissions (OSAA)');
  });

  it('classifies a portrait image as vertical', () => {
    const detail = detailFor('/events/mlk-book-talk-brandon-terry');
    detail.image = { ...detail.image!, width: 390, height: 480 };

    expect(parseCalendarEvent(byEid('77861-D-0'), detail, NOW)!.imageAspectRatio).toBe('vertical');
  });

  it('has no image when the page has none', () => {
    const event = parseCalendarEvent(byEid('77861-D-0'), EMPTY_DETAIL, NOW)!;

    expect(event.imageUrl).toBeNull();
    expect(event.imageAspectRatio).toBe('none');
  });

  it('truncates a long location to 40 characters and keeps the full one', () => {
    const event = parseCalendarEvent(
      byEid('77590-D-4'),
      detailFor('/environmental-and-energy-economics-and-policy-seminar-fall-2026'),
      NOW,
    )!;

    expect(event.locationShort).toBe('LBJ School of Public Affairs, SRH 3, ...');
    expect(event.locationShort).toHaveLength(40);
    expect(event.locationFull).toBe('LBJ School of Public Affairs, SRH 3, Room 3.124');
  });

  it('gives each occurrence of a series its own id, stable when an editor deletes a date', () => {
    const detail = detailFor('/join-us-graduate-virtual-information-session');
    const ids = [byEid('77754-D-7'), byEid('77754-D-8')].map(
      (ev) => parseCalendarEvent(ev, detail, NOW)!.sourceEventId,
    );
    const shifted = { ...byEid('77754-D-8'), eid: '77754-D-7' };

    expect(ids).toEqual(['77754-2026-12-03', '77754-2026-12-15']);
    expect(parseCalendarEvent(shifted, detail, NOW)!.sourceEventId).toBe('77754-2026-12-15');
  });

  it('builds the id for the R-style eids of rule-based series', () => {
    expect(parseCalendarEvent(byEid('76266-R-7-I-13'), EMPTY_DETAIL, 0)!.sourceEventId).toBe(
      '76266-2025-04-24',
    );
  });

  it('returns null for events that are over, and for an entry without an entity id', () => {
    // The info session the day before capture.
    expect(parseCalendarEvent(byEid('77754-D-6'), EMPTY_DETAIL, NOW)).toBeNull();
    expect(parseCalendarEvent({ ...byEid('77829-D-0'), eid: 'weird' }, EMPTY_DETAIL, NOW)).toBe(
      null,
    );
  });

  // The scraper leaves coordinates null and ingestEvents fills them from the UT
  // building registry using locationFull. These pin that contract: if LBJ's
  // location text stops resolving, its events silently lose their map pins, or
  // land on the LBJ Library instead of the School.
  describe('coordinates (resolved at ingest from the building registry)', () => {
    it.each([
      ['77829-D-0', '/social-contract-age-ai-future-skills-jobs-and-entrepreneurship'],
      ['77590-D-4', '/environmental-and-energy-economics-and-policy-seminar-fall-2026'],
      ['77852-D-0', '/environmental-and-energy-economics-and-policy-seminar-spring-2027'],
    ])('places %s in Sid Richardson Hall', (eid, url) => {
      const event = parseCalendarEvent(byEid(eid), detailFor(url), NOW)!;

      expect(event.latitude).toBeNull();
      expect(resolveBuilding(event.locationFull)).toMatchObject({
        code: 'SRH',
        latitude: 30.28499,
        longitude: -97.728866,
      });
    });

    it('treats the Zoom sessions as non-physical, so ingest skips them instead of warning', () => {
      const event = parseCalendarEvent(
        byEid('77754-D-7'),
        detailFor('/join-us-graduate-virtual-information-session'),
        NOW,
      )!;

      expect(isNonPhysicalLocation(event.locationFull)).toBe(true);
    });

    it('does not guess a building for "University of Texas at Austin"', () => {
      const event = parseCalendarEvent(
        byEid('77764-D-0'),
        detailFor('/lbj-business-policy-forum-0'),
        NOW,
      )!;

      expect(resolveBuilding(event.locationFull)).toBeNull();
    });
  });
});

describe('LBJ scraper run', () => {
  // A PNG's first 24 bytes: signature, IHDR length and type, width, height.
  function pngHeader(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(24);
    bytes.set([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
    ]);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, width);
    view.setUint32(20, height);
    return bytes;
  }

  function stubSite(failPath?: string) {
    const requested: string[] = [];
    const pages: Record<string, string> = { '/calendar': loadFixture('calendar.html') };
    for (const [path, file] of Object.entries(PAGES)) pages[path] = loadFixture(file);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const path = decodeURI(new URL(input).pathname);
        requested.push(path);
        if (path.startsWith('/sites/default/files/')) {
          return new Response(pngHeader(480, 270), {
            status: 206,
            headers: { 'content-type': 'image/png' },
          });
        }
        if (path === failPath || !(path in pages)) {
          return new Response('nope', { status: 500, statusText: 'Server Error' });
        }
        return new Response(pages[path], { status: 200 });
      }),
    );
    return requested;
  }

  function freezeClock() {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the calendar once, then each page and its image once per series', async () => {
    freezeClock();
    const requested = stubSite();

    const result = await scrapeLbj({} as Env, { dryRun: true });

    expect(result.eventsProcessed).toBe(19);
    expect(result.eventsSkipped).toBe(0);
    expect(result.errors).toEqual([]);
    const pagesAndCalendar = requested.filter((p) => !p.startsWith('/sites/'));
    expect(pagesAndCalendar.sort()).toEqual(['/calendar', ...Object.keys(PAGES)].sort());
    // Seven pages, seven pictures: not one image read per occurrence.
    expect(requested.filter((p) => p.startsWith('/sites/'))).toHaveLength(7);
  });

  it('skips a series whose page cannot be fetched, and keeps the rest', async () => {
    freezeClock();
    stubSite('/join-us-graduate-virtual-information-session');

    const result = await scrapeLbj({} as Env, { dryRun: true });

    // All eight upcoming info sessions share the failed page.
    expect(result.eventsProcessed).toBe(19);
    expect(result.eventsSkipped).toBe(8);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('graduate-virtual-information-session');
  }, 20_000);

  it('reports a fatal error when the calendar cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>redesigned</html>', { status: 200 })),
    );

    const result = await scrapeLbj({} as Env, { dryRun: true });

    expect(result.eventsProcessed).toBe(0);
    expect(result.errors[0]).toMatch(/Fatal error fetching events/);
  });
});
