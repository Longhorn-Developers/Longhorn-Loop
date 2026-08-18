/**
 * Who is allowed to receive a verification code (LOOP-255).
 *
 * Lives in shared/ for the usual reason — see shared/orgRegistration.ts and
 * shared/taxonomy.ts. The client greys out the button and the server refuses
 * the request, and those two must agree exactly. A client that permits an
 * address the server rejects produces a form that looks fine and then fails
 * on submit; a client stricter than the server locks people out of an app
 * that would have let them in.
 *
 * WHY THIS EXISTS AT ALL
 *
 * The gate was written and then commented out for testing:
 *
 *     // TODO: Re-enable UT email check for production
 *     // if (!isValidUTEmail(normalizedEmail)) {
 *
 * So `/auth/send-code` has been emailing a working sign-in code to any address
 * on earth. Turning it back on is the point of this module.
 *
 * There were also two contradictory definitions of "a UT email" in the
 * codebase:
 *
 *   - `isValidUTEmail` in auth.worker.ts — `endsWith('@utexas.edu')`, which
 *     REJECTS my.utexas.edu, one of the domains students actually use.
 *   - the regex in orgs.worker.ts — `@([\w-]+\.)*utexas\.edu`, which accepts
 *     ANY subdomain, so anything UT ever issued gets through.
 *
 * Both are replaced by this.
 */

/**
 * The three student-facing domains. An allow-list, not a subdomain wildcard.
 *
 * `eid.utexas.edu` is here because EID-style addresses are real and in use —
 * one appears on this project's own Linear team. Other UT subdomains
 * (departmental, alumni, staff) are still excluded, and a student on one is
 * locked out with no self-serve route.
 *
 * This array is the one place to widen if lockout reports arrive during beta,
 * and widening is safe: it only ever lets more people in, never fewer.
 */
export const ALLOWED_UT_DOMAINS = ['utexas.edu', 'my.utexas.edu', 'eid.utexas.edu'] as const;

/**
 * Is this an address we will email a code to?
 *
 * Case-insensitive and whitespace-tolerant, because this runs on whatever a
 * person typed into a text field on a phone. Deliberately NOT a full RFC 5322
 * validator — the domain is the security boundary, and the local part only has
 * to be non-empty and free of the characters that would make it two addresses.
 *
 * The domain is compared by exact equality against the allow-list rather than
 * by suffix. `endsWith('utexas.edu')` would happily accept
 * `evil-utexas.edu` and `utexas.edu.attacker.com`, which is the classic way
 * this check gets written wrong.
 */
export function isAllowedUTEmail(value: unknown): boolean {
  if (typeof value !== 'string') return false;

  const email = value.trim().toLowerCase();

  // Exactly one '@', with something either side.
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@') || at === email.length - 1) return false;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);

  // No whitespace or comma anywhere — a comma is how you smuggle a second
  // recipient into a header if anything downstream ever splits on it.
  if (/[\s,;<>]/.test(email)) return false;

  // Local part: at least one character, no leading/trailing dot, no '..'.
  if (local.length === 0 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    return false;
  }

  return (ALLOWED_UT_DOMAINS as readonly string[]).includes(domain);
}

/** Normalized form to store and compare. Call only on values that pass. */
export function normalizeUTEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** The one message users see. Kept here so both sides say the same thing. */
export const UT_EMAIL_ERROR = 'Use your UT email — utexas.edu, my.utexas.edu or eid.utexas.edu.';
