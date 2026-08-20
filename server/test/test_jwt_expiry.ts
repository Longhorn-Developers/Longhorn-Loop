/**
 * shared/jwtExpiry.ts — the launch-time "is this stored session still good?"
 * check (LOOP-247).
 *
 * Why this is worth a test file of its own: it decides whether a returning
 * user gets straight into the app or gets bounced to the sign-in screen, and
 * BOTH failure modes are quiet. Return true too eagerly and you log out
 * someone whose session was fine — which reproduces as "it randomly signs me
 * out" and nothing in the logs. Return false when the token really is dead and
 * every screen 401s at once on a user who thinks they are signed in.
 *
 * The tokens below are built the same way generateJWT builds them in
 * auth.worker.ts — standard base64 with '=' stripped, NOT base64url — because
 * that quirk is precisely the thing a naive decoder gets wrong.
 */

import { describe, expect, it } from 'vitest';
import { isJwtExpired, jwtExpiry } from '../../shared/jwtExpiry';

const NOW_MS = Date.UTC(2026, 7, 15, 12, 0, 0);
const NOW_S = Math.floor(NOW_MS / 1000);

/** Mirrors generateJWT's encoding: base64, padding stripped, signature fake. */
function makeToken(payload: Record<string, unknown>, signature = 'not-a-real-signature'): string {
  const b64 = (value: unknown) =>
    Buffer.from(JSON.stringify(value), 'utf-8').toString('base64').replace(/=/g, '');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.${signature}`;
}

describe('jwtExpiry', () => {
  it('reads the exp claim', () => {
    expect(jwtExpiry(makeToken({ email: 'a@utexas.edu', exp: 1799999999 }))).toBe(1799999999);
  });

  it('returns null when there is no exp claim', () => {
    expect(jwtExpiry(makeToken({ email: 'a@utexas.edu' }))).toBeNull();
  });

  it('returns null for a non-numeric exp rather than coercing it', () => {
    expect(jwtExpiry(makeToken({ exp: '1799999999' }))).toBeNull();
  });

  it('returns null for malformed input instead of throwing', () => {
    expect(jwtExpiry('')).toBeNull();
    expect(jwtExpiry('not-a-jwt')).toBeNull();
    expect(jwtExpiry('a.b')).toBeNull();
    expect(jwtExpiry('a.!!!not-base64!!!.c')).toBeNull();
  });

  it('handles a payload whose base64 contains + or /', () => {
    // The server emits standard base64, not base64url. A payload that encodes
    // to characters outside the base64url alphabet has to survive the trip —
    // a decoder that assumed base64url would mangle exactly these.
    const payload = { email: 'a+b/c@utexas.edu', note: '???ÿÿÿ', exp: 1799999999 };
    const token = makeToken(payload);
    expect(jwtExpiry(token)).toBe(1799999999);
  });
});

describe('isJwtExpired', () => {
  it('is true for a token that expired an hour ago', () => {
    expect(isJwtExpired(makeToken({ exp: NOW_S - 3600 }), NOW_MS)).toBe(true);
  });

  it('is false for a token with days left', () => {
    expect(isJwtExpired(makeToken({ exp: NOW_S + 7 * 24 * 3600 }), NOW_MS)).toBe(false);
  });

  it('is false one second before expiry and true one second after', () => {
    expect(isJwtExpired(makeToken({ exp: NOW_S + 1 }), NOW_MS)).toBe(false);
    expect(isJwtExpired(makeToken({ exp: NOW_S - 1 }), NOW_MS)).toBe(true);
  });

  it('treats an unreadable token as NOT expired', () => {
    // The deliberate asymmetry. An unparseable token is left for the Worker to
    // reject — being wrong here costs one sign-in, whereas wrongly declaring a
    // valid session dead logs people out for reasons nobody can reproduce.
    expect(isJwtExpired('garbage', NOW_MS)).toBe(false);
    expect(isJwtExpired(makeToken({ email: 'a@utexas.edu' }), NOW_MS)).toBe(false);
  });

  it('agrees with the server check in lib/utils.ts getAuthUser', () => {
    // getAuthUser: `if (payload.exp && payload.exp < Math.floor(Date.now()/1000))`
    const serverSaysExpired = (exp: number) => exp < Math.floor(NOW_MS / 1000);
    for (const exp of [NOW_S - 10, NOW_S, NOW_S + 10]) {
      expect(isJwtExpired(makeToken({ exp }), NOW_MS)).toBe(serverSaysExpired(exp));
    }
  });
});
