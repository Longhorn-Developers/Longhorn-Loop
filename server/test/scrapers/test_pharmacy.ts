import { readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchAllEvents,
  parseEvent,
  parseEventInstance,
  type LocalistRawEvent,
} from '../../src/scrapers/pharmacy';

function loadFixture(): LocalistRawEvent {
  return JSON.parse(
    readFileSync(
      join(
        __dirname,
        '..',
        '..',
        'src',
        'scrapers',
        '__fixtures__',
        'pharmacy',
        'commencement.json',
      ),
      'utf-8',
    ),
  );
}

const NOW = new Date('2025-05-01T00:00:00Z').getTime();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Pharmacy Localist scraper', () => {
  it('maps a saved Pharmacy event into the shared event schema', () => {
    const results = parseEvent(loadFixture(), NOW);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      source: 'pharmacy',
      sourceEventId: '49454950428617',
      title: 'College of Pharmacy Undergraduate, Graduate, & Doctoral Commencement',
      description:
        'The College of Pharmacy holds commencement ceremonies each May to honor our graduates. Attendance at the graduation ceremony is optional. The commencement speaker will be Dr. Cheryl Beal Anderson.',
      startDatetime: '2025-05-09T08:00:00-05:00',
      endDatetime: '2025-05-09T10:00:00-05:00',
      locationShort: 'Bass Concert Hall, Performing Arts Ce...',
      locationFull:
        'Bass Concert Hall, Performing Arts Center (PAC), 2350 Robert Dedman Drive, Austin, TX 78712',
      latitude: 30.285816,
      longitude: -97.73098,
      organization: {
        sourceOrgId: null,
        name: 'College of Pharmacy',
        profilePicture: null,
      },
      eventUrl: 'https://calendar.utexas.edu/event/college-of-pharmacy-undergraduate-commencement',
      imageWidth: 275,
      imageHeight: 183,
      imageAspectRatio: 'horizontal',
      imageMimeType: 'image/jpeg',
      categories: [
        { id: 'ceremonies', name: 'ceremonies' },
        { id: 'academics', name: 'Academics' },
      ],
    });
  });

  it.each([
    [300, 600, 'vertical'],
    [500, 500, 'square'],
    [600, 300, 'horizontal'],
  ] as const)('classifies a %s x %s image as %s', (width, height, expected) => {
    const raw = loadFixture();
    raw.event.photo_width = width;
    raw.event.photo_height = height;

    const parsed = parseEvent(raw, NOW);
    expect(parsed[0].imageAspectRatio).toBe(expected);
  });

  it('uses none when the source has no image', () => {
    const raw = loadFixture();
    raw.event.photo_url = null;

    const parsed = parseEvent(raw, NOW);
    expect(parsed[0].imageAspectRatio).toBe('none');
    expect(parsed[0].imageWidth).toBeNull();
    expect(parsed[0].imageHeight).toBeNull();
  });

  it('isolates invalid instances and keeps valid recurring instances', () => {
    const raw = loadFixture();
    raw.event.event_instances.unshift({
      event_instance: {
        id: 49454950428616,
        event_id: raw.event.id,
        start: 'not-a-date',
        end: null,
        all_day: false,
      },
    });
    raw.event.event_instances.push({
      event_instance: {
        id: 49454950428618,
        event_id: raw.event.id,
        start: '2025-05-10T08:00:00-05:00',
        end: null,
        all_day: false,
      },
    });

    expect(parseEvent(raw, NOW).map((event) => event.sourceEventId)).toEqual([
      '49454950428617',
      '49454950428618',
    ]);
  });

  it('returns null for an instance missing its required start datetime', () => {
    const raw = loadFixture();
    const instance = raw.event.event_instances[0];
    instance.event_instance.start = '';

    expect(parseEventInstance(raw, instance)).toBeNull();
  });

  it('fetches every page of upcoming department events', async () => {
    const pageOneEvent = loadFixture();
    pageOneEvent.event.photo_url = null;
    pageOneEvent.event.event_instances[0].event_instance.id = 70000000000001;
    pageOneEvent.event.event_instances[0].event_instance.start = '2099-05-09T08:00:00-05:00';

    const pageTwoEvent = structuredClone(pageOneEvent);
    pageTwoEvent.event.event_instances[0].event_instance.id = 70000000000002;

    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const page = new URL(String(url)).searchParams.get('page');
      const body = {
        events: [page === '1' ? pageOneEvent : pageTwoEvent],
        page: { current: Number(page), size: 1, total: 2 },
      };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const events = await fetchAllEvents();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(events.map((event) => event.sourceEventId)).toEqual([
      '70000000000001',
      '70000000000002',
    ]);
  });
});
