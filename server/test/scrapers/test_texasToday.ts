// texasToday's fetch loop (LOOP-309).
//
// texasToday is the only Localist scraper with no group_id -- it pulls the
// whole campus calendar -- so a wrong page-size parameter costs it 10x the
// requests, not a rounding error. These tests pin the query string it sends
// and that it stops at Localist's page.total.
//
// The fixture is pharmacy's: both read the same /api/2/events shape.

import { readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAllEvents, type LocalistRawEvent } from '../../src/scrapers/texasToday';

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('texasToday fetchAllEvents', () => {
  it('asks Localist for 100 per page with pp, and walks page.total', async () => {
    const event = loadFixture();
    event.event.photo_url = null;
    event.event.event_instances[0].event_instance.start = '2099-05-09T08:00:00-05:00';

    const urls: URL[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      urls.push(url);
      const page = Number(url.searchParams.get('page'));
      const copy = structuredClone(event);
      copy.event.event_instances[0].event_instance.id = 80000000000000 + page;
      return new Response(
        JSON.stringify({ events: [copy], page: { current: page, size: 100, total: 3 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const events = await fetchAllEvents();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const url of urls) {
      expect(url.searchParams.get('pp')).toBe('100');
      // The bug: Localist ignores per_page and serves 10 a page.
      expect(url.searchParams.has('per_page')).toBe(false);
      // Campus-wide: no department filter.
      expect(url.searchParams.has('group_id')).toBe(false);
    }
    expect(urls.map((u) => u.searchParams.get('page'))).toEqual(['1', '2', '3']);
    expect(events).toHaveLength(3);
  });
});
