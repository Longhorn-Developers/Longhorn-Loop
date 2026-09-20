/**
 * shared/exploreFilters.ts — the combination rules and the facet counts.
 *
 * Lives under server/test because that is where the repo's vitest runs, and the
 * module under test is in shared/, which both sides import. Nothing here needs
 * a Worker, a database or React.
 *
 * The cases worth having are the ones that are easy to get backwards: OR that
 * accidentally narrows, AND that accidentally widens, and a facet count that
 * includes its own group (which makes every unselected chip in a touched group
 * read 0 and the filter look broken).
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTERS,
  activeFilterCount,
  applyFilters,
  describeFilters,
  facetCounts,
  matchesFilters,
  toggleInArray,
  whenWindow,
  type ExploreFilters,
  type FilterContext,
  type FilterableEvent,
} from '../../shared/exploreFilters';
import { CAMPUS_WIDE_ID, collegeForSource } from '../../shared/colleges';

/** Fixed clock, so "today" never depends on when CI runs. A Wednesday. */
const NOW = new Date('2026-03-11T12:00:00');

const BUCKET_TAGS = {
  tech: ['Hackathons', 'Startups'],
  food: ['Free Food Events'],
  social: ['Mixers'],
};

const ctx: FilterContext = {
  bucketTags: BUCKET_TAGS,
  now: NOW,
  collegeOf: collegeForSource,
};

function event(over: Partial<FilterableEvent> & { source: string }): FilterableEvent {
  return {
    start_datetime: '2026-03-11T18:00:00',
    discovery_bucket: null,
    tags: [],
    benefits: [],
    ...over,
  };
}

/**
 * A small corpus with deliberate overlaps, so a rule that is subtly wrong
 * produces a different number rather than the same one by luck.
 */
const EVENTS: FilterableEvent[] = [
  // Cockrell
  event({ source: 'cockrell', discovery_bucket: 'tech', benefits: ['Free Food'] }),
  event({ source: 'cockrell', discovery_bucket: 'tech' }),
  event({ source: 'cockrell', discovery_bucket: 'social', benefits: ['Credit'] }),
  // McCombs
  event({ source: 'mccombs', discovery_bucket: 'tech', benefits: ['Free Food'] }),
  event({ source: 'mccombs', discovery_bucket: 'food' }),
  // Campus-wide
  event({ source: 'texas_today', discovery_bucket: 'social' }),
  event({ source: 'some_new_scraper', discovery_bucket: 'food' }),
];

const filters = (over: Partial<ExploreFilters> = {}): ExploreFilters => ({
  ...EMPTY_FILTERS,
  ...over,
});

const counts = (f: ExploreFilters) =>
  facetCounts(EVENTS, f, ctx, {
    collegeIds: ['cse', 'msb', CAMPUS_WIDE_ID],
    bucketIds: ['tech', 'food', 'social'],
    perkNames: ['Free Food', 'Credit'],
  });

describe('college derivation', () => {
  it('maps a scraper slug to its college', () => {
    expect(collegeForSource('cockrell')).toBe('cse');
    expect(collegeForSource('ut_law')).toBe('law');
  });

  it('sends an unknown or missing source to campus-wide, never to nothing', () => {
    // The important half: a new scraper must not make its events invisible to
    // the filter. Silently un-filterable rows would be a far worse failure than
    // one mis-bucketed row.
    expect(collegeForSource('some_new_scraper')).toBe(CAMPUS_WIDE_ID);
    expect(collegeForSource(null)).toBe(CAMPUS_WIDE_ID);
  });
});

describe('combining groups', () => {
  it('treats an untouched group as no opinion, not as match-nothing', () => {
    expect(applyFilters(EVENTS, EMPTY_FILTERS, ctx)).toHaveLength(EVENTS.length);
  });

  it('ORs within a group — a second interest widens', () => {
    const one = applyFilters(EVENTS, filters({ interests: ['tech'] }), ctx).length;
    const two = applyFilters(EVENTS, filters({ interests: ['tech', 'food'] }), ctx).length;
    expect(one).toBe(3);
    expect(two).toBe(5);
    expect(two).toBeGreaterThan(one);
  });

  it('ANDs between groups — each group touched narrows', () => {
    const college = applyFilters(EVENTS, filters({ collegeId: 'cse' }), ctx).length;
    const both = applyFilters(
      EVENTS,
      filters({ collegeId: 'cse', interests: ['tech'] }),
      ctx,
    ).length;
    expect(college).toBe(3);
    expect(both).toBe(2);
  });

  it('matches an interest off tags when discovery_bucket is null', () => {
    // Scraped events predating the bucket column still carry tags, and an event
    // tagged "Hackathons" should answer to Technology.
    const tagged = event({ source: 'cockrell', discovery_bucket: null, tags: ['Hackathons'] });
    expect(matchesFilters(tagged, filters({ interests: ['tech'] }), ctx)).toBe(true);
    expect(matchesFilters(tagged, filters({ interests: ['food'] }), ctx)).toBe(false);
  });

  it('ORs perks and excludes events carrying none', () => {
    expect(applyFilters(EVENTS, filters({ perks: ['Free Food'] }), ctx)).toHaveLength(2);
    expect(applyFilters(EVENTS, filters({ perks: ['Free Food', 'Credit'] }), ctx)).toHaveLength(3);
  });

  it('separates "all of UT" from the campus-wide college', () => {
    // null is no constraint; CAMPUS_WIDE_ID is a real, narrower answer. Folding
    // the two together would silently turn "no college filter" into a filter.
    expect(applyFilters(EVENTS, filters({ collegeId: null }), ctx)).toHaveLength(7);
    expect(applyFilters(EVENTS, filters({ collegeId: CAMPUS_WIDE_ID }), ctx)).toHaveLength(2);
  });
});

describe('when windows', () => {
  it('has no opinion on "any"', () => {
    expect(whenWindow('any', NOW)).toBeNull();
  });

  it('bounds today to the local day', () => {
    const window = whenWindow('today', NOW)!;
    expect(window.start.getHours()).toBe(0);
    expect(window.end.getTime() - window.start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('treats the weekend you are standing in as this weekend', () => {
    // Saturday. "This weekend" must not mean the one seven days away.
    const saturday = new Date('2026-03-14T12:00:00');
    const window = whenWindow('weekend', saturday)!;
    expect(window.start.getDay()).toBe(5); // Friday
    expect(window.start.getDate()).toBe(13);
  });

  it('excludes an event outside the window', () => {
    const nextMonth = event({ source: 'cockrell', start_datetime: '2026-04-20T18:00:00' });
    expect(matchesFilters(nextMonth, filters({ when: 'week' }), ctx)).toBe(false);
    expect(matchesFilters(nextMonth, filters({ when: 'any' }), ctx)).toBe(true);
  });

  it('drops an unparseable date rather than throwing', () => {
    const broken = event({ source: 'cockrell', start_datetime: 'not a date' });
    expect(matchesFilters(broken, filters({ when: 'today' }), ctx)).toBe(false);
  });
});

describe('facet counts', () => {
  it('totals what the footer button promises', () => {
    const f = filters({ collegeId: 'cse', interests: ['tech'] });
    expect(counts(f).total).toBe(applyFilters(EVENTS, f, ctx).length);
  });

  it('counts a college against the OTHER groups, not against college', () => {
    // THE BUG THIS GUARDS. With Cockrell selected, McCombs must still report
    // what picking McCombs would give you — if it counted the college group
    // too, every unselected crest would read 0 and the rail would look dead.
    const c = counts(filters({ collegeId: 'cse' }));
    expect(c.colleges.cse).toBe(3);
    expect(c.colleges.msb).toBe(2);
    expect(c.colleges[CAMPUS_WIDE_ID]).toBe(2);
  });

  it('counts each interest on its own, not as an addition to the selection', () => {
    // With tech selected, food reports "what if I picked food", not
    // "tech OR food".
    const c = counts(filters({ interests: ['tech'] }));
    expect(c.interests.tech).toBe(3);
    expect(c.interests.food).toBe(2);
  });

  it('still honours the other groups when counting a chip', () => {
    // Cockrell has one Free Food event and no food-bucket events.
    const c = counts(filters({ collegeId: 'cse' }));
    expect(c.interests.food).toBe(0);
    expect(c.perks['Free Food']).toBe(1);
  });

  it('reports zero for a chip that would return nothing', () => {
    // A zero here is what dims the chip in place rather than removing it, so
    // the taxonomy stays still while you explore.
    const c = counts(filters({ collegeId: 'cse', interests: ['food'] }));
    expect(c.total).toBe(0);
    expect(c.interests.food).toBe(0);
  });
});

describe('filter state helpers', () => {
  it('counts active GROUPS, not selected chips', () => {
    // The badge answers "how many things are narrowing my results", so two
    // interests in one group is still one group.
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
    expect(activeFilterCount(filters({ interests: ['tech', 'food'] }))).toBe(1);
    expect(activeFilterCount(filters({ collegeId: 'cse', when: 'today' }))).toBe(2);
  });

  it('toggles a value in and out of an OR group', () => {
    expect(toggleInArray([], 'tech')).toEqual(['tech']);
    expect(toggleInArray(['tech', 'food'], 'tech')).toEqual(['food']);
  });

  it('describes the active filters in the order the sheet presents them', () => {
    const parts = describeFilters(
      filters({ collegeId: 'cse', interests: ['tech'], when: 'week' }),
      () => 'Cockrell',
    );
    expect(parts).toEqual(['Cockrell', '1 interest', 'this week']);
  });
});
