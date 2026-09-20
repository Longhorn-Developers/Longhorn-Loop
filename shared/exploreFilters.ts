/**
 * Explore's filter model: what a filter IS, how groups combine, and what count
 * each chip should carry.
 *
 * Design: "Explore filters — Concept 01, College Lens".
 *
 * Dependency-free, like taxonomy.ts and colleges.ts beside it. It lives in
 * shared/ rather than in the component for two reasons: the combination rules
 * below are the part that is easy to get subtly wrong and worth unit-testing
 * without mounting React (see server/test/test_explore_filters.ts), and when
 * GET /feed/explore eventually learns these as query parameters, the server can
 * import the same predicate instead of reimplementing it slightly differently.
 *
 * ---------------------------------------------------------------------------
 * HOW THE GROUPS COMBINE. Getting this wrong is how filters return zero and
 * users stop trusting them, so it is stated once, here, and everything else
 * derives from it:
 *
 *   WITHIN a group  -> OR.  Free Food or Credit. Picking a second perk WIDENS
 *                           the results; it must never narrow them.
 *   BETWEEN groups  -> AND. Cockrell AND (Free Food OR Credit) AND This week.
 *                           Every group you touch shrinks the set.
 *
 * College is single-select, so its "OR" is trivial, but it is still AND-ed
 * against the rest.
 *
 * ---------------------------------------------------------------------------
 * AND ABOUT ZERO RESULTS. The design's rule is "never show an empty screen —
 * drop the most recently added group and say so". This module does something
 * simpler that gets the same outcome, and the difference is worth knowing:
 *
 * The count is on the button. `Show 47 events` updates on every tap, and at
 * zero the button is spent — the caller disables it. You therefore cannot
 * arrive at an empty result screen by pressing a button that promised results,
 * which is the failure the rule exists to prevent. Reaching for a
 * most-recently-added-group stack on top of that would mean the app silently
 * discarding a filter the user just chose, which is its own kind of
 * untrustworthy. Facet counts (below) do the rest: a chip that would produce
 * zero says so BEFORE you tap it.
 */

/** The shape of an event this module needs. Structural on purpose: the client
 *  passes ApiEvent, a test passes a literal, and neither has to import the
 *  other's type. */
export interface FilterableEvent {
  source: string | null;
  start_datetime: string;
  discovery_bucket?: string | null;
  tags?: string[];
  benefits?: string[];
}

export type WhenId = 'any' | 'today' | 'tomorrow' | 'weekend' | 'week';

export interface ExploreFilters {
  /** Single-select. Null is "All of UT" — no college constraint at all, which
   *  is NOT the same as the campus-wide college. */
  collegeId: string | null;
  /** Taxonomy bucket ids. OR within the group. */
  interests: string[];
  when: WhenId;
  /** event_benefits names, e.g. "Free Food". OR within the group. */
  perks: string[];
}

export const EMPTY_FILTERS: ExploreFilters = {
  collegeId: null,
  interests: [],
  when: 'any',
  perks: [],
};

export const WHEN_OPTIONS: { id: WhenId; label: string }[] = [
  { id: 'any', label: 'Any time' },
  { id: 'today', label: 'Today' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'weekend', label: 'This weekend' },
  { id: 'week', label: 'This week' },
];

export function whenLabel(id: WhenId): string {
  return WHEN_OPTIONS.find((o) => o.id === id)?.label ?? 'Any time';
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * The [start, end) window a When option describes, in LOCAL time.
 *
 * Local, not UTC, because these words are about the user's day: "Today" has to
 * stop at midnight where they are standing, and Austin is 5-6 hours behind UTC,
 * so a UTC day boundary would move every evening event to tomorrow.
 *
 * Null means no constraint.
 */
export function whenWindow(id: WhenId, now: Date): { start: Date; end: Date } | null {
  if (id === 'any') return null;

  const today = startOfDay(now);

  if (id === 'today') {
    return { start: today, end: new Date(today.getTime() + DAY_MS) };
  }

  if (id === 'tomorrow') {
    const start = new Date(today.getTime() + DAY_MS);
    return { start, end: new Date(start.getTime() + DAY_MS) };
  }

  if (id === 'weekend') {
    // Friday 00:00 through Monday 00:00. On a Saturday, "this weekend" is the
    // one you are standing in, not the next one, so the window starts at the
    // most recent Friday rather than the next one.
    const day = today.getDay(); // 0 Sun ... 6 Sat
    const daysSinceFriday = day === 0 ? 2 : day === 6 ? 1 : (day + 2) % 7;
    const friday =
      day === 0 || day === 6
        ? new Date(today.getTime() - daysSinceFriday * DAY_MS)
        : new Date(today.getTime() + ((5 - day + 7) % 7) * DAY_MS);
    return { start: friday, end: new Date(friday.getTime() + 3 * DAY_MS) };
  }

  // 'week' — the next seven days from now, not the calendar week. "This week"
  // on a Saturday should not mean "one day left".
  return { start: today, end: new Date(today.getTime() + 7 * DAY_MS) };
}

/**
 * Does this event carry this interest bucket?
 *
 * Checks `discovery_bucket` first — the classifier's single primary bucket —
 * and falls back to the taxonomy tags, because scraped events that predate the
 * bucket column still carry tags. Matching either way is deliberate: an event
 * tagged "Hackathons" with a null bucket should still answer to Technology.
 */
function matchesInterest(event: FilterableEvent, bucketId: string, bucketTags: string[]): boolean {
  if (event.discovery_bucket === bucketId) return true;
  if (!event.tags?.length || !bucketTags.length) return false;
  return event.tags.some((tag) => bucketTags.includes(tag));
}

/** Tag lists per bucket id, passed in so this module stays free of taxonomy.ts
 *  import order concerns and a test can supply its own. */
export type BucketTags = Record<string, string[]>;

/**
 * One group's verdict, kept separate so facet counting can skip exactly one.
 *
 * Every predicate returns true for an untouched group — an empty interests
 * array is "no opinion", never "match nothing".
 */
const GROUPS = ['college', 'interests', 'when', 'perks'] as const;
export type FilterGroup = (typeof GROUPS)[number];

function matchesGroup(
  group: FilterGroup,
  event: FilterableEvent,
  filters: ExploreFilters,
  bucketTags: BucketTags,
  now: Date,
  collegeOf: (source: string | null) => string,
): boolean {
  if (group === 'college') {
    if (!filters.collegeId) return true;
    return collegeOf(event.source) === filters.collegeId;
  }

  if (group === 'interests') {
    if (filters.interests.length === 0) return true;
    return filters.interests.some((id) => matchesInterest(event, id, bucketTags[id] ?? []));
  }

  if (group === 'when') {
    const window = whenWindow(filters.when, now);
    if (!window) return true;
    const start = new Date(event.start_datetime).getTime();
    if (Number.isNaN(start)) return false;
    return start >= window.start.getTime() && start < window.end.getTime();
  }

  // perks. Captured to a local rather than asserted non-null: narrowing does
  // not survive into the closure, and a `!` here would be load-bearing.
  const benefits = event.benefits;
  if (filters.perks.length === 0) return true;
  if (!benefits?.length) return false;
  return filters.perks.some((perk) => benefits.includes(perk));
}

export interface FilterContext {
  bucketTags: BucketTags;
  now: Date;
  collegeOf: (source: string | null) => string;
}

/** Every group AND-ed together. */
export function matchesFilters(
  event: FilterableEvent,
  filters: ExploreFilters,
  ctx: FilterContext,
): boolean {
  return GROUPS.every((g) =>
    matchesGroup(g, event, filters, ctx.bucketTags, ctx.now, ctx.collegeOf),
  );
}

export function applyFilters<T extends FilterableEvent>(
  events: T[],
  filters: ExploreFilters,
  ctx: FilterContext,
): T[] {
  return events.filter((e) => matchesFilters(e, filters, ctx));
}

/**
 * The count every chip carries.
 *
 * THE RULE: a chip's count is computed against the other active groups but NOT
 * against its own. The Cockrell crest answers "how many events would I get if I
 * picked Cockrell, keeping my current interests and time" — so tapping it
 * produces exactly the number it was advertising. Counting a group against
 * itself is the classic faceted-search bug: every unselected chip in a group
 * you have already touched reads 0, the whole row dims, and the filter looks
 * broken.
 *
 * Interests are counted one bucket at a time for the same reason — each is
 * "what if I added this one", not "what if this were the only one".
 */
export interface FacetCounts {
  colleges: Record<string, number>;
  interests: Record<string, number>;
  perks: Record<string, number>;
  /** Everything AND-ed, i.e. what the footer button promises. */
  total: number;
}

export function facetCounts(
  events: FilterableEvent[],
  filters: ExploreFilters,
  ctx: FilterContext,
  options: { collegeIds: string[]; bucketIds: string[]; perkNames: string[] },
): FacetCounts {
  const { bucketTags, now, collegeOf } = ctx;

  // Precompute each group's verdict per event once, rather than re-running the
  // whole predicate for every chip. With ~100 events and ~25 chips the naive
  // version is 2,500 predicate runs on every tap; this is 400.
  const verdicts = events.map((event) => ({
    event,
    college: matchesGroup('college', event, filters, bucketTags, now, collegeOf),
    interests: matchesGroup('interests', event, filters, bucketTags, now, collegeOf),
    when: matchesGroup('when', event, filters, bucketTags, now, collegeOf),
    perks: matchesGroup('perks', event, filters, bucketTags, now, collegeOf),
  }));

  const colleges: Record<string, number> = {};
  for (const id of options.collegeIds) colleges[id] = 0;
  const interests: Record<string, number> = {};
  for (const id of options.bucketIds) interests[id] = 0;
  const perks: Record<string, number> = {};
  for (const name of options.perkNames) perks[name] = 0;

  let total = 0;

  for (const v of verdicts) {
    if (v.college && v.interests && v.when && v.perks) total++;

    // Colleges: hold interests + when + perks, ignore the college group.
    if (v.interests && v.when && v.perks) {
      const id = collegeOf(v.event.source);
      if (id in colleges) colleges[id]++;
    }

    // Interests: hold college + when + perks, test each bucket on its own.
    if (v.college && v.when && v.perks) {
      for (const id of options.bucketIds) {
        if (matchesInterest(v.event, id, bucketTags[id] ?? [])) interests[id]++;
      }
    }

    // Perks: hold college + interests + when.
    if (v.college && v.interests && v.when) {
      for (const name of options.perkNames) {
        if (v.event.benefits?.includes(name)) perks[name]++;
      }
    }
  }

  return { colleges, interests, perks, total };
}

/** How many groups are constraining the results — the badge on the Filters
 *  button, and what tells the caller whether "Reset" has anything to do. */
export function activeFilterCount(filters: ExploreFilters): number {
  let n = 0;
  if (filters.collegeId) n++;
  if (filters.interests.length) n++;
  if (filters.when !== 'any') n++;
  if (filters.perks.length) n++;
  return n;
}

export function hasActiveFilters(filters: ExploreFilters): boolean {
  return activeFilterCount(filters) > 0;
}

/** Toggle a value in an OR group. */
export function toggleInArray(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

/**
 * The line above the results: "47 events · Cockrell · this week".
 *
 * Built here rather than in the component so the summary chip on the collapsed
 * header and the header above the list cannot word the same state differently.
 */
export function describeFilters(
  filters: ExploreFilters,
  collegeShortName: (id: string) => string | undefined,
): string[] {
  const parts: string[] = [];
  if (filters.collegeId) parts.push(collegeShortName(filters.collegeId) ?? filters.collegeId);
  if (filters.interests.length) {
    parts.push(
      filters.interests.length === 1 ? '1 interest' : `${filters.interests.length} interests`,
    );
  }
  if (filters.when !== 'any') parts.push(whenLabel(filters.when).toLowerCase());
  if (filters.perks.length) parts.push(filters.perks.join(' or ').toLowerCase());
  return parts;
}
