/**
 * Operator-route auth fails closed (lib/cronAuth.ts).
 *
 * Prod ran without CRON_SECRET, and the old inline check compared the header
 * against `Bearer ${undefined}`, so "Bearer undefined" from anyone was
 * accepted. /reclassify had no check at all, and /scrape/:name handed the
 * manual scrapers to every caller whose header did not match. These cases pin
 * each of those shut.
 *
 * The routes are exercised through the real Hono app with a DB that throws on
 * any use: every rejection here must happen BEFORE a scraper or a query runs.
 */

import { describe, expect, it } from 'vitest';
import { hasCronSecret, isCronAuthorized } from '../src/lib/cronAuth';
import { eventRoutes } from '../src/routes/events.worker';
import type { Env } from '../src/worker';

describe('isCronAuthorized', () => {
  it('accepts the configured secret', () => {
    expect(isCronAuthorized('Bearer s3cret-value', 's3cret-value')).toBe(true);
  });

  it.each([
    ['missing secret, "Bearer undefined"', 'Bearer undefined', undefined],
    ['missing secret, "Bearer "', 'Bearer ', undefined],
    ['empty secret, "Bearer "', 'Bearer ', ''],
    ['null secret', 'Bearer null', null],
  ])('rejects everyone when no secret is configured (%s)', (_label, header, secret) => {
    expect(isCronAuthorized(header, secret)).toBe(false);
  });

  it.each([
    ['no header', undefined],
    ['wrong secret', 'Bearer nope'],
    ['prefix of the secret', 'Bearer s3cret'],
    ['secret plus extra', 'Bearer s3cret-value-and-more'],
    ['no Bearer scheme', 's3cret-value'],
    ['wrong case scheme', 'bearer s3cret-value'],
  ])('rejects %s', (_label, header) => {
    expect(isCronAuthorized(header, 's3cret-value')).toBe(false);
  });

  it('hasCronSecret treats empty and missing the same', () => {
    expect(hasCronSecret(undefined)).toBe(false);
    expect(hasCronSecret('')).toBe(false);
    expect(hasCronSecret('x')).toBe(true);
  });
});

describe('operator routes refuse before doing any work', () => {
  const explodingDb = new Proxy(
    {},
    {
      get() {
        throw new Error('DB touched by an unauthorised request');
      },
    },
  ) as unknown as D1Database;

  const envWith = (secret: string | undefined) =>
    ({ DB: explodingDb, JWT_SECRET: 'jwt', CRON_SECRET: secret }) as unknown as Env;

  const post = (path: string, env: Env, headers: Record<string, string> = {}) =>
    eventRoutes.request(
      `http://longhorn-loop.test${path}`,
      { method: 'POST', headers, body: headers['Content-Type'] ? '{}' : undefined },
      env,
    );

  const routes = ['/scrape/mccombs', '/scrape/texasToday', '/reclassify', '/backfill-coordinates'];

  it.each(routes)('%s: "Bearer undefined" is rejected when the secret is unset', async (path) => {
    const res = await post(path, envWith(undefined), { Authorization: 'Bearer undefined' });
    expect(res.status).toBe(401);
  });

  it.each(routes)('%s: no header is rejected', async (path) => {
    const res = await post(path, envWith('real-secret'));
    expect(res.status).toBe(401);
  });

  it('the manual scraper path is no longer open to unauthenticated callers', async () => {
    // Used to fall through to scrapeMccombs for any caller without the secret.
    const res = await post('/scrape/mccombs', envWith('real-secret'), {
      'Content-Type': 'application/json',
    });
    expect(res.status).toBe(401);
  });

  it('the right secret gets past auth', async () => {
    // Unknown scraper name: proves auth passed without running a real one.
    const res = await post('/scrape/not-a-scraper', envWith('real-secret'), {
      Authorization: 'Bearer real-secret',
    });
    expect(res.status).toBe(404);
  });
});
