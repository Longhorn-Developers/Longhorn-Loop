// Shared helpers used across multiple route files.

import type { Env } from '../worker';

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

//  Workers AI embeddings

// bge-large-en-v1.5 outputs 1024-dim vectors. Must match the Vectorize index
// dimensions (see wrangler.toml). If you change this model, recreate the index
// with the new dimension count and re-seed tag vectors. This is the ONLY place
// the model name lives.
const EMBEDDING_MODEL = '@cf/baai/bge-large-en-v1.5';

/**
 * Embed a single string into a 768-dim vector.
 *
 * Returns null (never throws) when the AI binding is missing or the call
 * fails, so callers can fall back to the keyword classifier instead of
 * crashing ingest.
 */
export async function embedText(env: Env, text: string): Promise<number[] | null> {
  if (!env.AI) return null;

  // Empty/whitespace text has no meaningful embedding; skip the API call.
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    // Workers AI returns { data: number[][] }: one vector per input string.
    // We pass a single string, so the vector we want is data[0].
    const result = (await env.AI.run(EMBEDDING_MODEL, { text: trimmed })) as {
      data?: number[][];
    };

    const vector = result?.data?.[0];
    if (!vector || vector.length === 0) return null;

    return vector;
  } catch {
    return null;
  }
}

/**
 * Embed many strings in ONE Workers AI call.
 *
 * Input:  env + array of texts.
 * Output: array of vectors aligned by index (result[i] is texts[i]'s vector),
 *         or null for the whole batch if the binding is missing or the call
 *         fails.
 * Why:    the model accepts a string[] and returns one vector each. Batching
 *         avoids firing dozens of separate env.AI.run calls in a single Worker
 *         invocation, which hits Workers AI's per-invocation request cap (this
 *         was why tag seeding stalled at exactly 50 tags).
 */
export async function embedTextBatch(env: Env, texts: string[]): Promise<number[][] | null> {
  if (!env.AI || texts.length === 0) return null;

  try {
    const result = (await env.AI.run(EMBEDDING_MODEL, { text: texts })) as {
      data?: number[][];
    };
    // data is one vector per input, in the same order we sent them.
    if (!result?.data || result.data.length !== texts.length) return null;
    return result.data;
  } catch {
    return null;
  }
}
