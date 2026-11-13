/**
 * dedupeRecurring — the Home feed's series collapse (LOOP-268).
 *
 * Bug bash: "Post 3 events — only the last one shows up on Home." A
 * user-created event posted as yourself carries your name as
 * host_organization_name, so three same-titled posts keyed identically and
 * collapsed to one card. The collapse exists for scraper series and now only
 * applies to scraped rows.
 */

import { describe, expect, it } from 'vitest';
import { dedupeRecurring } from '../../src/routes/feed.worker';

const row = (id: number, source: string, title: string, host: string | null) => ({
  id,
  source,
  title,
  host_organization_name: host,
});

describe('dedupeRecurring (LOOP-268)', () => {
  it('keeps every user-created event, even with the same title and host', () => {
    const events = [
      row(1, 'user_created', 'Test Event', 'Matthew Walker'),
      row(2, 'user_created', 'Test Event', 'Matthew Walker'),
      row(3, 'user_created', 'test event ', 'Matthew Walker'),
    ];
    expect(dedupeRecurring(events).map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it('still collapses a scraped series to its first (soonest) occurrence', () => {
    const events = [
      row(1, 'cns', 'Bowden Fellows Speaker Series', 'CNS'),
      row(2, 'cns', 'Bowden Fellows Speaker Series', 'CNS'),
      row(3, 'cns', 'Bowden Fellows Speaker Series', 'CNS'),
    ];
    expect(dedupeRecurring(events).map((e) => e.id)).toEqual([1]);
  });

  it('keeps same-titled scraped events from different hosts', () => {
    const events = [
      row(1, 'hornslink', 'General Meeting', 'Longhorn Devs'),
      row(2, 'hornslink', 'General Meeting', 'Chess Club'),
    ];
    expect(dedupeRecurring(events).map((e) => e.id)).toEqual([1, 2]);
  });

  it('does not let a user post swallow a scraped event of the same name, or vice versa', () => {
    const events = [
      row(1, 'cns', 'Study Night', 'CNS'),
      row(2, 'user_created', 'Study Night', 'CNS'),
      row(3, 'cns', 'Study Night', 'CNS'),
    ];
    expect(dedupeRecurring(events).map((e) => e.id)).toEqual([1, 2]);
  });
});
