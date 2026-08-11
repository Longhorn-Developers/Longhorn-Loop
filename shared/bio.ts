/**
 * Profile bio rules, shared by the Edit Profile screen and the Worker so the
 * cap and the cleanup can't drift apart. Previously MAX_BIO was declared twice
 * — once in app/profile/edit.tsx and once in users.worker.ts — with a comment
 * on each asking whoever changed one to remember the other.
 *
 * Dependency-free on purpose: the client bundles it and the Worker imports it
 * directly from ../../../shared.
 */

/** The cap the Edit Profile counter reads against ("44 / 150"). */
export const MAX_BIO = 150;

/** Below this many characters remaining the counter turns warning-coloured. */
export const BIO_WARN_REMAINING = 20;

/**
 * Tidy a bio for storage. Line breaks are kept — they're how people lay a bio
 * out — but the shapes that only ever come from stray typing are removed:
 * carriage returns, trailing spaces on a line, runs of three or more newlines,
 * and leading/trailing whitespace. Returns null for anything that ends up
 * empty, matching the "NULL = unset" convention in the users table.
 */
export function normalizeBio(raw: string | null | undefined): string | null {
  if (raw == null) return null;

  const cleaned = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return cleaned.length > 0 ? cleaned : null;
}
