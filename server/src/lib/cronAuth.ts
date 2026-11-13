// Operator auth for the routes the cron and the team call by hand:
// POST /events/scrape/:name, /events/reclassify, /events/backfill-coordinates.
//
// WHY THIS EXISTS. Each of those routes used to inline
//
//   if (c.req.header('Authorization') !== `Bearer ${c.env.CRON_SECRET}`)
//
// and prod never had CRON_SECRET set. A template literal turns a missing
// secret into the string "undefined", so the expected header became
// "Bearer undefined" -- a value anyone could send. The cron "worked" only
// because it sent the same "Bearer undefined" from the same missing binding.
// On top of that, /reclassify had no check at all (anyone could re-run Workers
// AI tagging over the whole table), and /scrape/:name fell through to the
// `manual` scrapers for any caller whose header didn't match, which is every
// caller.
//
// FAIL CLOSED. No configured secret means NOBODY is authorised, including the
// cron. That is deliberate: a missing secret should show up as loud 401s in
// the cron log the same day, not as an endpoint that silently accepts
// everyone for months.

/** True only when a non-empty secret is configured AND the header carries it. */
export function isCronAuthorized(
  authorizationHeader: string | null | undefined,
  secret: string | null | undefined,
): boolean {
  if (typeof secret !== 'string' || secret.length === 0) return false;
  if (typeof authorizationHeader !== 'string') return false;
  return constantTimeEqual(authorizationHeader, `Bearer ${secret}`);
}

/** Whether the Worker has a usable CRON_SECRET at all (for the dispatcher's log). */
export function hasCronSecret(secret: string | null | undefined): secret is string {
  return typeof secret === 'string' && secret.length > 0;
}

// Plain === short-circuits on the first differing character, which leaks how
// much of a guess was right through response timing. Workers' non-standard
// crypto.subtle.timingSafeEqual does not exist under Node (where the tests
// run), so compare by hand: always walk the full expected length, and fold the
// length mismatch into the result instead of returning early on it.
function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < y.length; i++) {
    diff |= (x[i] ?? 0) ^ y[i];
  }
  return diff === 0;
}
