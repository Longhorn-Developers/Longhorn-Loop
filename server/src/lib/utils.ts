// Shared helpers used across multiple route files.

/**
 * Verify a Bearer JWT and return the decoded email claim.
 * Returns null if the token is missing, malformed, or expired.
 */
export async function getAuthUser(
  authHeader: string | undefined,
  secret: string,
): Promise<{ email: string } | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];

  try {
    const [headerB64, payloadB64, sigB64] = token.split('.');
    const encoder = new TextEncoder();
    const signingInput = `${headerB64}.${payloadB64}`;

    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    const sigBytes = Uint8Array.from(atob(sigB64), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(signingInput));

    if (!valid) return null;

    const payload = JSON.parse(atob(payloadB64));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

    return { email: payload.email };
  } catch {
    return null;
  }
}

/**
 * Look up a user's numeric ID by email. Returns null if not found.
 */
export async function getUserId(db: D1Database, email: string): Promise<number | null> {
  const row = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  return row ? (row.id as number) : null;
}
