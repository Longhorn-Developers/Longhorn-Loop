/**
 * Event perks — the `event_benefits` rows behind `GET /events?benefit=`.
 *
 * The read side of this has worked since the first HornsLink scrape: the
 * table, the ingest write, and the filter all shipped together. What never
 * existed was a write path from the app, so `?benefit=` silently returned
 * nothing for anything a student posted (LOOP-259).
 *
 * ---------------------------------------------------------------------------
 * WHY THE COLUMN STAYS FREE TEXT
 *
 * `event_benefits.benefit_name` is TEXT with no CHECK and no lookup table, and
 * the values in it come from HornsLink's `benefitNames`. Narrowing the column
 * to an enum now would orphan every scraped row whose value isn't in the enum,
 * and the filter would quietly stop matching them — the failure would look
 * like "the perks filter is broken" rather than like a migration.
 *
 * So the API accepts any string within the caps below, and the list here is
 * only what the create form OFFERS. A picker that suggests the common values
 * gets user events onto the same vocabulary as scraped ones without making
 * that vocabulary load-bearing.
 *
 * OPTIONS ARE SEEDED, NOT VERIFIED. HornsLink is a CampusLabs Engage instance
 * and these are Engage's three standard perks, which is why they're the seed.
 * Nobody has run `SELECT DISTINCT benefit_name FROM event_benefits` against
 * production to confirm the scrape isn't also writing others. Do that before
 * treating this list as complete — adding a value here is free, and any value
 * already in the table keeps filtering whether or not it appears below.
 */

/** What the create form offers. Not a constraint — see the note above. */
export const EVENT_BENEFIT_OPTIONS = ['Free Food', 'Free Swag', 'Credit'] as const;

/**
 * Matches MAX_CATEGORY_COUNT in events.worker.ts. Ten is far above anything
 * real; it exists so a malformed client can't write unbounded rows.
 */
export const MAX_BENEFIT_COUNT = 10;

/** Long enough for the longest plausible perk, short enough to bound the row. */
export const MAX_BENEFIT_NAME_LENGTH = 60;

/**
 * Trim and collapse internal whitespace, so "Free  Food " and "Free Food" are
 * one perk rather than two. Returns null for anything that ends up empty.
 *
 * Case is NOT folded. The value is displayed as stored, and the scraper writes
 * HornsLink's own casing; lowercasing here would make user events read
 * "free food" next to a scraped "Free Food".
 */
export function normalizeBenefitName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : null;
}
