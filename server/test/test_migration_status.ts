/**
 * The "is prod behind the code?" guard (LOOP-308, lib/migrationStatus.ts).
 *
 * 0020 and 0021 were merged and deployed without being applied to prod, and
 * nothing noticed for weeks. These pin the pieces that would have caught it:
 * the comparison, the list staying in step with server/migrations/, the 503 on
 * GET /health/schema, and the cron log line.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EXPECTED_MIGRATIONS,
  compareMigrations,
  getMigrationStatus,
} from '../src/lib/migrationStatus';
import worker, { type Env } from '../src/worker';

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

// A D1 stand-in that answers `SELECT name FROM d1_migrations` with `names`,
// or throws like D1 does when the table doesn't exist.
function fakeDb(names: string[] | 'no-table'): D1Database {
  return {
    prepare: () => ({
      all: async () => {
        if (names === 'no-table') throw new Error('D1_ERROR: no such table: d1_migrations');
        return { results: names.map((name) => ({ name })) };
      },
    }),
  } as unknown as D1Database;
}

const envWith = (db: D1Database) => ({ DB: db }) as unknown as Env;

afterEach(() => vi.restoreAllMocks());

describe('EXPECTED_MIGRATIONS', () => {
  // The same rule scripts/check-migration-list.mjs enforces in CI. A file
  // missing from the list would make prod look up to date when it isn't.
  it('names every file in server/migrations/, in order', () => {
    const onDisk = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    expect([...EXPECTED_MIGRATIONS]).toEqual(onDisk);
  });
});

describe('compareMigrations', () => {
  const expected = ['0001_a.sql', '0002_b.sql', '0003_c.sql'];

  it('is ok when everything expected is applied', () => {
    expect(compareMigrations(expected, expected)).toEqual({
      status: 'ok',
      applied: 3,
      expected: 3,
      unknownApplied: [],
    });
  });

  // Prod's exact state before the fix: 0000-0019 applied, 0020 and 0021 not.
  it('lists what is pending, in apply order', () => {
    const applied = EXPECTED_MIGRATIONS.slice(0, 20);
    const result = compareMigrations(applied);
    expect(result.status).toBe('behind');
    expect(result.status === 'behind' && result.pending).toEqual([
      '0020_add_event_announcements.sql',
      '0021_add_org_meetings.sql',
    ]);
  });

  // d1_migrations is ordered by apply time, not filename: prod ran 0012 before
  // 0007 and 0000 after 0011. Order must not matter.
  it('ignores the order migrations were applied in', () => {
    expect(compareMigrations(['0003_c.sql', '0001_a.sql', '0002_b.sql'], expected).status).toBe(
      'ok',
    );
  });

  // An older Worker deployed over a newer schema: reported, not a failure.
  it('reports migrations the build does not know without failing', () => {
    const result = compareMigrations([...expected, '0004_future.sql'], expected);
    expect(result).toMatchObject({ status: 'ok', unknownApplied: ['0004_future.sql'] });
  });
});

describe('getMigrationStatus', () => {
  // A local DB built with `wrangler d1 execute --file=schema.sql` has no
  // d1_migrations table. That is not an outage.
  it("is 'unknown', not an error, when d1_migrations doesn't exist", async () => {
    const result = await getMigrationStatus(fakeDb('no-table'));
    expect(result.status).toBe('unknown');
    expect(result.status === 'unknown' && result.reason).toMatch(/no such table/);
  });
});

describe('GET /health/schema', () => {
  const get = (db: D1Database) =>
    worker.fetch(new Request('https://loop.test/health/schema'), envWith(db));

  it('is 200 when prod is up to date', async () => {
    const res = await get(fakeDb([...EXPECTED_MIGRATIONS]));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok' });
  });

  it('is 503 with the pending names when prod is behind', async () => {
    const res = await get(fakeDb(EXPECTED_MIGRATIONS.slice(0, 20)));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      status: 'behind',
      pending: ['0020_add_event_announcements.sql', '0021_add_org_meetings.sql'],
    });
  });

  it('is 200 with status unknown when there is nothing to read', async () => {
    const res = await get(fakeDb('no-table'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'unknown' });
  });

  it('leaves plain /health untouched', async () => {
    const res = await worker.fetch(
      new Request('https://loop.test/health'),
      envWith(fakeDb('no-table')),
    );
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});

describe('cron alert', () => {
  // Reminders run on every tick and fail against this fake DB (it has no
  // .bind), logging their own error. Only the migration line is under test.
  const migrationLines = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('database is behind') || line.includes('migration check'));

  async function tick(db: D1Database) {
    const waits: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => waits.push(p) } as ExecutionContext;
    const event = { scheduledTime: Date.UTC(2026, 10, 24, 13, 7), cron: '*/15 * * * *' };
    await worker.scheduled(event as ScheduledEvent, envWith(db), ctx);
    await Promise.all(waits);
  }

  it('logs the pending migrations while prod is behind', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await tick(fakeDb(EXPECTED_MIGRATIONS.slice(0, 21)));
    const lines = migrationLines(error);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('database is behind the code: 1 migration(s) not applied');
    expect(lines[0]).toContain('0021_add_org_meetings.sql');
  });

  it('stays quiet when up to date, or when there is nothing to read', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await tick(fakeDb([...EXPECTED_MIGRATIONS]));
    await tick(fakeDb('no-table'));
    expect(migrationLines(error)).toEqual([]);
  });
});
