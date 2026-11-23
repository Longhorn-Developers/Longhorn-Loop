import { readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isNonPhysicalLocation, resolveBuilding } from '../../src/lib/utBuildings';
import { parseCalendarEvent, parseDetailPage, scrapeIschool } from '../../src/scrapers/ischool';
import {
  cleanTitle,
  extractCalendarEvents,
  resolveTiming,
  type CalendarEvent,
} from '../../src/scrapers/utDrupalCalendar';
import type { Env } from '../../src/worker';

// Trimmed copies of ischool.utexas.edu as of Nov 2026. The calendar keeps seven
// real entries from the ~700 embedded; each event page keeps its <head>, the
// event's <article> and the real site footer (whose media-image field is the
// point of the "footer banner" test below).
function loadFixture(name: string): string {
  return readFileSync(
    join(__dirname, '..', '..', 'src', 'scrapers', '__fixtures__', 'ischool', name),
    'utf-8',
  );
}

const calendar = extractCalendarEvents(loadFixture('calendar.html'));
const byEid = (eid: string): CalendarEvent => calendar.find((e) => e.eid === eid)!;

const CAPSTONE = '9344-D-0'; // Fri Dec 4 2026, 12 - 2pm
const MSIS = '9187-D-0'; // Wed Nov 18 2026, 12 - 1pm, virtual
const COLLOQUIUM = '9189-D-0'; // Fri Sep 25 2026, 12:30 - 2pm
const TACO = '9181-D-0'; // Tue Sep 15 2026, 9:30 - 10:30am

const BEFORE_FALL = new Date('2026-09-01T00:00:00-05:00').getTime();
// The day this was written: only the capstone showcase is still ahead.
const TODAY = new Date('2026-11-23T12:00:00-06:00').getTime();

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('iSchool calendar', () => {
  it('reads the embedded entries and cleans their titles', () => {
    expect(calendar).toHaveLength(7);
    expect(cleanTitle(byEid(CAPSTONE).title)).toBe('Fall 2026 iSchool Capstone Poster Showcase');
    // "Let&#039;s Taco &#039;Bout Informatics" in the source, plus the hidden date prefix.
    expect(cleanTitle(byEid(TACO).title)).toBe("Let's Taco 'Bout Informatics");
  });

  it('treats FullCalendar all-day ends as exclusive', () => {
    // Grad Welcome Week: start 2025-08-18, exclusive end 2025-08-25.
    expect(resolveTiming(byEid('8025-D-0'))).toMatchObject({
      startDatetime: '2025-08-18',
      endDatetime: '2025-08-24',
    });
    // Founder's Day: a one-day all-day event has no separate end.
    expect(resolveTiming(byEid('7289-D-0'))).toMatchObject({
      startDatetime: '2023-09-22',
      endDatetime: null,
    });
  });
});

describe('iSchool event page', () => {
  it("reads the event's own fields", () => {
    expect(parseDetailPage(loadFixture('capstone-showcase.html'))).toEqual({
      description:
        'Join about 60 iSchool students as they present their capstone projects. Open to everyone; light refreshments served.',
      location: '(UNB) Texas Union Quadrangle Room',
      address: null,
      tags: [
        { id: 'event-type-949', name: 'Research' },
        { id: 'event-type-964', name: 'Capstone' },
        { id: 'event-type-61', name: 'Career' },
      ],
      rsvpUrl: null,
      image: {
        url: 'https://ischool.utexas.edu/sites/default/files/styles/utexas_image_style_1600w/public/2026-11/fall-2026-capstone-showcase-banner.png?itok=rwIzs-Kb',
        width: 1600,
        height: 800,
        altText: 'Fall 2026 iSchool Capstone Poster Showcase',
      },
    });
  });

  it("does not take the footer's department banner for the event's image", () => {
    const html = loadFixture('msis-info-session.html');
    // The footer really does carry a media-image field with the banner in it...
    expect(html).toContain('footer-signature-department-of-information');
    // ...and an event with no picture of its own still has none.
    expect(parseDetailPage(html).image).toBeNull();
  });

  it('reads the registration button and a virtual location', () => {
    const detail = parseDetailPage(loadFixture('msis-info-session.html'));
    expect(detail.location).toBe('Virtual');
    expect(detail.rsvpUrl).toBe('https://utexas.zoom.us/j/85038965833');
    expect(detail.tags).toEqual([{ id: 'event-type-48', name: 'MSIS Info Session' }]);
  });

  it('has no registration link when the body has no button', () => {
    const detail = parseDetailPage(loadFixture('colloquium.html'));
    expect(detail.location).toBe('UTA 5.522 (Large Conference Room)');
    expect(detail.rsvpUrl).toBeNull();
    expect(detail.tags.map((t) => t.name)).toEqual(['Research', 'Colloquium & Talks']);
  });
});

describe('iSchool event mapping', () => {
  it('maps a calendar entry and its page into the shared schema', () => {
    const detail = parseDetailPage(loadFixture('capstone-showcase.html'));

    expect(parseCalendarEvent(byEid(CAPSTONE), detail, TODAY)).toEqual({
      source: 'ischool',
      // Entity id + date, not the eid's position-in-series suffix.
      sourceEventId: '9344-2026-12-04',
      title: 'Fall 2026 iSchool Capstone Poster Showcase',
      description: detail.description,
      // CST in December.
      startDatetime: '2026-12-04T12:00:00-06:00',
      endDatetime: '2026-12-04T14:00:00-06:00',
      venueType: 'in_person',
      locationShort: '(UNB) Texas Union Quadrangle Room',
      locationFull: '(UNB) Texas Union Quadrangle Room',
      latitude: null,
      longitude: null,
      organization: { sourceOrgId: null, name: 'School of Information', profilePicture: null },
      eventUrl: 'https://ischool.utexas.edu/events/fall-2026-ischool-capstone-poster-showcase',
      rsvpUrl: null,
      imageUrl: detail.image?.url,
      imageWidth: 1600,
      imageHeight: 800,
      imageAspectRatio: 'horizontal',
      imageMimeType: null,
      imageAltText: 'Fall 2026 iSchool Capstone Poster Showcase',
      theme: null,
      visibility: 'Public',
      rsvpTotal: 0,
      categories: detail.tags,
      benefits: [],
    });
  });

  it('marks a virtual session online, with the DST offset of its date', () => {
    const event = parseCalendarEvent(
      byEid(MSIS),
      parseDetailPage(loadFixture('msis-info-session.html')),
      BEFORE_FALL,
    );
    expect(event).toMatchObject({
      venueType: 'online',
      startDatetime: '2026-11-18T12:00:00-06:00',
      endDatetime: '2026-11-18T13:00:00-06:00',
      rsvpUrl: 'https://utexas.zoom.us/j/85038965833',
      imageUrl: null,
      imageAspectRatio: 'none',
    });

    const september = parseCalendarEvent(
      byEid(COLLOQUIUM),
      parseDetailPage(loadFixture('colloquium.html')),
      BEFORE_FALL,
    );
    expect(september?.startDatetime).toBe('2026-09-25T12:30:00-05:00');
  });

  it('keeps an event until it ends, then drops it', () => {
    const detail = parseDetailPage(loadFixture('capstone-showcase.html'));
    const duringIt = new Date('2026-12-04T13:59:00-06:00').getTime();
    const afterIt = new Date('2026-12-04T14:01:00-06:00').getTime();

    expect(parseCalendarEvent(byEid(CAPSTONE), detail, duringIt)).not.toBeNull();
    expect(parseCalendarEvent(byEid(CAPSTONE), detail, afterIt)).toBeNull();
  });
});

// The scraper leaves latitude/longitude null and relies on ingest's building
// registry. If one of these stops resolving, those events lose their map pin.
describe('iSchool venues resolve to map pins', () => {
  it.each([
    ['(UNB) Texas Union Quadrangle Room', 'UNB'],
    ['(UNB) Union Building Santa Rita Suite (3.502)', 'UNB'],
    ['(UNB) Texas Union Shirley Bird Perry Ballroom', 'UNB'],
    ['Texas Union Patio', 'UNB'],
    ['UTA 5.522 (Large Conference Room)', 'UTA'],
    ['UTA 1.208', 'UTA'],
    ['Student Lounge (FAC 18N)', 'FAC'],
  ])('%s -> %s', (location, code) => {
    expect(resolveBuilding(location)?.code).toBe(code);
  });

  it('gives virtual sessions no pin', () => {
    expect(isNonPhysicalLocation('Virtual')).toBe(true);
  });
});

describe('iSchool scraper run', () => {
  function stubSite(failPath?: string) {
    const requested: string[] = [];
    const pages: Record<string, string> = {
      '/calendar': loadFixture('calendar.html'),
      '/events/fall-2026-ischool-capstone-poster-showcase': loadFixture('capstone-showcase.html'),
      '/events/msis-graduate-information-session-1': loadFixture('msis-info-session.html'),
      '/events/colloquium-peer-production-book-talk': loadFixture('colloquium.html'),
      '/events/lets-taco-bout-informatics': loadFixture('colloquium.html'),
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

  function freezeClock(at: number) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at);
  }

  it('reads /calendar once and fetches pages only for events still ahead', async () => {
    freezeClock(TODAY);
    const requested = stubSite();

    const result = await scrapeIschool({} as Env, { dryRun: true });

    expect(result.errors).toEqual([]);
    expect(requested).toEqual(['/calendar', '/events/fall-2026-ischool-capstone-poster-showcase']);
    expect(result.events?.map((e) => e.sourceEventId)).toEqual(['9344-2026-12-04']);
  });

  it('produces the same keys on every run, each once', async () => {
    freezeClock(BEFORE_FALL);
    stubSite();

    const first = await scrapeIschool({} as Env, { dryRun: true });
    const second = await scrapeIschool({} as Env, { dryRun: true });
    const ids = (r: typeof first) => r.events!.map((e) => `${e.source}:${e.sourceEventId}`);

    expect(ids(first)).toEqual([
      'ischool:9181-2026-09-15',
      'ischool:9189-2026-09-25',
      'ischool:9187-2026-11-18',
      'ischool:9344-2026-12-04',
    ]);
    expect(ids(second)).toEqual(ids(first));
  });

  it('skips an event whose page cannot be fetched and keeps the rest', async () => {
    freezeClock(BEFORE_FALL);
    stubSite('/events/msis-graduate-information-session-1');

    const result = await scrapeIschool({} as Env, { dryRun: true });

    expect(result.eventsSkipped).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('msis-graduate-information-session-1');
    expect(result.events).toHaveLength(3);
  }, 20_000);

  it('reports a fatal error when the calendar is not on the page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>redesigned</html>', { status: 200 })),
    );

    const result = await scrapeIschool({} as Env, { dryRun: true });

    expect(result.eventsProcessed).toBe(0);
    expect(result.errors[0]).toMatch(/Fatal error fetching events/);
  });
});
