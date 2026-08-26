// Year classification labels, shared by onboarding (CreateAccount) and the
// profile editor. They were two separate copies of the same array, which is how
// they came to share a typo.
//
// The label IS the stored value. `users.year_classification` is a free TEXT
// column and users.worker.ts writes through whatever string it is handed —
// there is no server-side enum — so editing this list changes what gets written
// for everyone who picks that option from here on.
//
// Which is the whole reason normalizeYear exists. The list read "Freshmen", a
// plural among four singulars, until the August 2026 bug bash caught it. Rows
// written before the fix still hold "Freshmen", and the profile editor decides
// which pill is lit with `year === option` — so an un-normalized legacy value
// matches nothing and those users open the editor to a classification that
// looks like it was never set. Map the old spelling forward on read and their
// next save writes the corrected one.

export const YEAR_OPTIONS: string[] = ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate'];

/** Stored spellings we have since corrected, mapped to the current label. */
const LEGACY_YEARS: Record<string, string> = {
  Freshmen: 'Freshman',
};

/**
 * Convert a stored `year_classification` into the label this build renders.
 * Returns '' for null/empty so callers can feed it straight into form state,
 * and passes anything unrecognised through untouched rather than blanking it.
 */
export function normalizeYear(stored: string | null | undefined): string {
  if (!stored) return '';
  return LEGACY_YEARS[stored] ?? stored;
}
