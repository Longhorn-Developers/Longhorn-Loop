/**
 * Reading the `exp` claim off our own JWTs, without a library.
 *
 * Lives in shared/ for the usual reason (see shared/taxonomy.ts,
 * shared/orgRegistration.ts): both sides need the same answer and must not
 * drift. The client uses it at launch to decide whether a stored token is
 * worth restoring; keeping the rule here means it can never disagree with the
 * server's own expiry check in lib/utils.ts getAuthUser.
 *
 * Dependency-free by design — no React, no Worker globals, no jose/jsonwebtoken.
 * `atob` is present in Workers, in Node 16+, and in Hermes on RN 0.74+, with a
 * Buffer fallback for anything older.
 *
 * THIS DOES NOT VERIFY THE SIGNATURE, and must never be used to decide whether
 * a request is authorized. It answers exactly one question — "is this token
 * already past its expiry" — so the app can send someone to sign in instead of
 * letting them in and having every screen 401 at once. The Worker still
 * verifies the HMAC on every request; that is the real gate.
 */

/** Decoded `exp`, in seconds since the epoch. Null if unreadable or absent. */
export function jwtExpiry(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;

    // NOTE: generateJWT in auth.worker.ts emits standard base64 with the '='
    // padding stripped — it does NOT map '+' to '-' and '/' to '_', so these
    // are not base64url tokens despite looking like JWTs. atob wants exactly
    // that dialect, so it works today. If the server is ever corrected to emit
    // real base64url, add the inverse mapping here at the same time or every
    // stored session silently becomes unreadable.
    const json =
      typeof atob === 'function' ? atob(payload) : Buffer.from(payload, 'base64').toString('utf-8');

    const claims = JSON.parse(json) as { exp?: unknown };
    return typeof claims.exp === 'number' && Number.isFinite(claims.exp) ? claims.exp : null;
  } catch {
    return null;
  }
}

/**
 * True only when we can PROVE the token is expired.
 *
 * A token we cannot parse returns false — "no opinion" — deliberately. Being
 * wrong in that direction means the Worker rejects the request and the user
 * signs in again; being wrong the other way logs out someone whose session was
 * perfectly valid because of a decoding quirk. The second failure is worse and
 * much harder to reproduce.
 */
export function isJwtExpired(token: string, nowMs: number = Date.now()): boolean {
  const exp = jwtExpiry(token);
  if (exp === null) return false;
  return exp < Math.floor(nowMs / 1000);
}
