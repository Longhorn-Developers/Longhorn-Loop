/**
 * UT's colleges and schools, as Explore's top-level filter.
 *
 * Design: "Explore filters — Concept 01, College Lens". College sits above
 * interests in the filter sheet, as a rail of monogram crests.
 *
 * Dependency-free by design, like taxonomy.ts beside it: the client imports it
 * via `@/shared/colleges`, and a future server-side filter can import it by
 * relative path without dragging React in.
 *
 * ---------------------------------------------------------------------------
 * WHERE COLLEGE COMES FROM, AND WHY IT IS THE SCRAPER SLUG.
 *
 * There is no `college` column. Not on `events`, not on `organizations`, not
 * anywhere in schema.sql — so this cannot be read, only derived.
 *
 * What DOES exist is `events.source`, which records the scraper that ingested
 * the row, and most of our scrapers are a single college's events calendar.
 * `source = 'cockrell'` means the row came off Cockrell's own calendar, which
 * is a stronger claim than a keyword guess would be: the college published it
 * itself. So the mapping below is one line per scraper, and adding a college
 * scraper to scrapers/registry.ts is one line here to light the crest up.
 *
 * THE SLUGS ARE NOT THE REGISTRY NAMES. Three of them differ — the registry
 * calls them `lawSchool`, `texasGlobal` and `texasToday` while the rows carry
 * `ut_law`, `texas_global` and `texas_today`. The registry name is a route
 * slug; the value here is each scraper's exported SOURCE constant, which is
 * what actually lands in the column. Check the scraper, not the registry.
 *
 * WHAT THIS DOES NOT COVER. UT has sixteen colleges and schools; eight of them
 * have a scraper. Architecture, Education, Jackson Geosciences, Social Work,
 * Nursing, LBJ, Dell Med and Civic Leadership are absent here on purpose,
 * because an entry for them would be a crest that can only ever read 0. The
 * design's "zero-count chips dim rather than vanish" rule is about a count that
 * went to zero because of the OTHER filters you picked — a taxonomy that stays
 * still while you explore. It is not a licence to advertise eight colleges the
 * app has no events for. They arrive when their scraper does.
 */

/** A college's identity in the filter UI. */
export interface College {
  /** Stable id, persisted in filter state. Matches the monogram, lowercased. */
  id: string;
  /** The 2-4 letter monogram on the crest tile. */
  monogram: string;
  /** Full name, for accessibility labels and the "All 16" picker. */
  name: string;
  /** What students actually say, rendered under the crest. Keep it short. */
  short: string;
}

/**
 * Events that belong to no single college: campus-wide calendars (Texas Today),
 * university-level offices (Texas Global), HornsLink's student-org feed, and
 * anything a user posted themselves.
 *
 * A real, selectable option rather than a dumping ground — "show me things that
 * aren't any one college's" is a reasonable thing to want, and it is where
 * RecSports, the Union, Housing, Greek life and student government live.
 */
export const CAMPUS_WIDE_ID = 'ut';

export const COLLEGES: College[] = [
  { id: 'cse', monogram: 'CSE', name: 'Cockrell School of Engineering', short: 'Cockrell' },
  { id: 'msb', monogram: 'MSB', name: 'McCombs School of Business', short: 'McCombs' },
  { id: 'cns', monogram: 'CNS', name: 'College of Natural Sciences', short: 'Natural Sci' },
  { id: 'cola', monogram: 'COLA', name: 'College of Liberal Arts', short: 'Liberal Arts' },
  { id: 'mcc', monogram: 'MCC', name: 'Moody College of Communication', short: 'Moody' },
  { id: 'cfa', monogram: 'CFA', name: 'College of Fine Arts', short: 'Fine Arts' },
  { id: 'law', monogram: 'LAW', name: 'School of Law', short: 'Law' },
  { id: 'cop', monogram: 'COP', name: 'College of Pharmacy', short: 'Pharmacy' },
  { id: CAMPUS_WIDE_ID, monogram: 'UT', name: 'Campus-wide', short: 'Campus-wide' },
];

/**
 * `events.source` -> college id.
 *
 * Every value on the left is a scraper's exported SOURCE constant. A source
 * that isn't here — a new scraper, a user-created event, `manual` — resolves to
 * campus-wide rather than to nothing, so a new ingest path can never make
 * events invisible to the filter. Silently un-filterable events would be a much
 * worse failure than one mis-bucketed row.
 */
const SOURCE_TO_COLLEGE: Record<string, string> = {
  cockrell: 'cse',
  mccombs: 'msb',
  cns: 'cns',
  cola: 'cola',
  moody: 'mcc',
  cofa: 'cfa',
  ut_law: 'law',
  pharmacy: 'cop',

  // Explicit, not just fallthrough: these are known campus-wide sources, and
  // listing them says so rather than leaving a reader to wonder whether they
  // were forgotten.
  texas_today: CAMPUS_WIDE_ID,
  texas_global: CAMPUS_WIDE_ID,
  hornslink: CAMPUS_WIDE_ID,
};

/** Which college an event belongs to. Never null — see the note above. */
export function collegeForSource(source: string | null | undefined): string {
  if (!source) return CAMPUS_WIDE_ID;
  return SOURCE_TO_COLLEGE[source] ?? CAMPUS_WIDE_ID;
}

/** Look up a college for rendering. Undefined for an id no longer in the list. */
export function collegeById(id: string | null | undefined): College | undefined {
  if (!id) return undefined;
  return COLLEGES.find((c) => c.id === id);
}
