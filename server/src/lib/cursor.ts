/**
 * Opaque keyset-pagination cursors (LOOP-264's GET /orgs/search is the first
 * caller; nothing else in the codebase paginates this way yet -- existing
 * lists use LIMIT/OFFSET, see GET /events).
 *
 * A cursor is base64 over UTF-8 JSON, not plain btoa(JSON.stringify(...)):
 * btoa only accepts Latin-1 strings, and an organization name is free-form
 * text that can contain anything. Going through TextEncoder/TextDecoder
 * keeps the round trip correct for any name a caller's WHERE clause captures
 * into the cursor.
 *
 * Callers should treat the decoded shape as untrusted input (a client can
 * send back an edited or unrelated string) and validate it before using any
 * field to build a query.
 */

export function encodeCursor(payload: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeCursor<T>(cursor: string): T | null {
  try {
    const binary = atob(cursor);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}
