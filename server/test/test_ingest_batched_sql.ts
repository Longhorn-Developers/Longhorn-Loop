/**
 * Batched ingest (LOOP-309), against a real SQLite database built from
 * server/schema.sql.
 *
 * Every scraper runs its whole ingest inside one Worker invocation, and D1
 * caps queries per invocation (1,000 on Workers Paid, 50 on Free). The old
 * ingest spent 8-10 queries per event, so a run silently stopped landing
 * events after the first ~100. What is worth pinning:
 *
 *   1. QUERY BUDGET. A large run stays far under the cap. This is the bug: a
 *      test that ingests five events passes either way.
 *   2. Children land with the parent. Categories, benefits and tags find
 *      their event through (source, source_event_id) inside the same batch,
 *      because a new event's id isn't known until the batch runs.
 *   3. Re-ingest is an update, not a duplicate, and an unchanged event is not
 *      sent back to Workers AI.
 *   4. One bad row doesn't sink its chunk. A batch is a transaction; the
 *      retry path has to land the other events and name the bad one.
 *
 * The shim's batch() is a real transaction (BEGIN / COMMIT / ROLLBACK), unlike
 * the one in routes/test_public_profiles.ts, because (4) depends on rollback.
 *
 * Skips below Node 22 (node:sqlite). CI runs Node 20 and does not run this
 * suite; this is a local guard.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ingestEvents } from '../src/events/ingest';
import type { NormalizedEvent } from '../src/events/types';
import type { Env } from '../src/worker';

let DatabaseSync: (new (path: string) => any) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const describeOrSkip = DatabaseSync ? describe : describe.skip;

// ---------------------------------------------------------------------------
// D1 shim over node:sqlite that counts queries the way D1 does: each
// first/all/run is one, and a whole batch() is one.
// ---------------------------------------------------------------------------

class Stmt {
  params: unknown[] = [];
  constructor(
    private readonly d1: CountingD1,
    readonly sql: string,
  ) {}
  bind(...params: unknown[]): Stmt {
    this.params = params;
    return this;
  }
  exec(): { last_row_id: number; changes: number } {
    const r = this.d1.raw.prepare(this.sql).run(...this.params);
    return { last_row_id: Number(r.lastInsertRowid ?? 0), changes: Number(r.changes ?? 0) };
  }
  async first(): Promise<Record<string, unknown> | null> {
    this.d1.queries++;
    return this.d1.raw.prepare(this.sql).get(...this.params) ?? null;
  }
  async all(): Promise<{ results: Record<string, unknown>[] }> {
    this.d1.queries++;
    return { results: this.d1.raw.prepare(this.sql).all(...this.params) };
  }
  async run(): Promise<{ meta: { last_row_id: number; changes: number } }> {
    this.d1.queries++;
    return { meta: this.exec() };
  }
}

class CountingD1 {
  queries = 0;
  constructor(readonly raw: any) {}
  prepare(sql: string): Stmt {
    return new Stmt(this, sql);
  }
  async batch(statements: Stmt[]): Promise<unknown[]> {
    this.queries++;
    this.raw.exec('BEGIN');
    try {
      const out = statements.map((s) => ({ meta: s.exec() }));
      this.raw.exec('COMMIT');
      return out;
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    }
  }
}

function makeEvent(n: number, overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    source: 'texas_today',
    sourceEventId: `evt-${n}`,
    title: `Event ${n}`,
    description: `Description ${n}`,
    startDatetime: '2099-05-09T13:00:00.000Z',
    endDatetime: '2099-05-09T15:00:00.000Z',
    venueType: 'online',
    locationShort: null,
    locationFull: null,
    latitude: null,
    longitude: null,
    organization: { sourceOrgId: null, name: 'Visual Arts Center', profilePicture: null },
    eventUrl: `https://calendar.utexas.edu/event/${n}`,
    rsvpUrl: null,
    imageUrl: null,
    imageWidth: null,
    imageHeight: null,
    imageAspectRatio: null,
    imageMimeType: null,
    imageAltText: null,
    theme: null,
    visibility: 'public',
    rsvpTotal: null,
    categories: [{ id: n, name: `Category ${n}` }],
    benefits: ['Free Food'],
    ...overrides,
  } as NormalizedEvent;
}

describeOrSkip('ingestEvents, batched (LOOP-309)', () => {
  let db: CountingD1;
  let aiCalls: number;
  let env: Env;

  beforeEach(() => {
    const raw = new DatabaseSync!(':memory:');
    raw.exec(readFileSync(join(__dirname, '..', 'schema.sql'), 'utf-8'));
    db = new CountingD1(raw);
    aiCalls = 0;
    env = {
      DB: db,
      // Answers nothing useful, so tags fall back to the keyword classifier;
      // the test only needs to know whether Workers AI was asked.
      AI: {
        run: async () => {
          aiCalls++;
          return { response: '[]' };
        },
      },
    } as unknown as Env;
  });

  const count = (sql: string) => Number(db.raw.prepare(sql).get().n);

  it('lands a Texas Today-sized run well under the per-invocation cap', async () => {
    const events = Array.from({ length: 720 }, (_, i) => makeEvent(i));
    const result = await ingestEvents(env, events);

    expect(result).toEqual({ inserted: 720, updated: 0, errors: [] });
    expect(count('SELECT COUNT(*) AS n FROM events')).toBe(720);
    // The old loop needed ~8 queries an event (~5,800 here). Free's cap is 50.
    expect(db.queries).toBeLessThan(50);
  });

  it('writes categories, benefits and tags against the new rows', async () => {
    await ingestEvents(env, [makeEvent(1), makeEvent(2)]);

    const rows = db.raw
      .prepare(
        `SELECT e.source_event_id,
                (SELECT COUNT(*) FROM event_categories c WHERE c.event_id = e.id) AS cats,
                (SELECT COUNT(*) FROM event_benefits b WHERE b.event_id = e.id) AS perks,
                (SELECT COUNT(*) FROM event_tags t WHERE t.event_id = e.id) AS tags
           FROM events e ORDER BY e.source_event_id`,
      )
      .all();
    for (const r of rows) {
      expect(Number(r.cats)).toBe(1);
      expect(Number(r.perks)).toBe(1);
      expect(Number(r.tags)).toBeGreaterThan(0);
    }
  });

  it('updates on re-ingest, and skips Workers AI for unchanged events', async () => {
    const events = Array.from({ length: 30 }, (_, i) => makeEvent(i));
    await ingestEvents(env, events);
    expect(aiCalls).toBeGreaterThan(0);

    aiCalls = 0;
    const again = await ingestEvents(env, events);

    expect(again).toEqual({ inserted: 0, updated: 30, errors: [] });
    expect(count('SELECT COUNT(*) AS n FROM events')).toBe(30);
    expect(aiCalls).toBe(0);
    // Tags survive an update that didn't re-tag.
    expect(count('SELECT COUNT(DISTINCT event_id) AS n FROM event_tags')).toBe(30);
  });

  it('re-tags an event whose title changed', async () => {
    await ingestEvents(env, [makeEvent(1)]);
    aiCalls = 0;
    await ingestEvents(env, [makeEvent(1, { title: 'Renamed: Gallery Opening' })]);
    expect(aiCalls).toBe(1);
    expect(
      db.raw.prepare(`SELECT title FROM events WHERE source_event_id = 'evt-1'`).get().title,
    ).toBe('Renamed: Gallery Opening');
  });

  it('isolates one bad row: the rest of its chunk still lands', async () => {
    const events = Array.from({ length: 20 }, (_, i) => makeEvent(i));
    // NOT NULL violation on events.title -- fails the whole batch it is in.
    events[7] = makeEvent(7, { title: null as unknown as string });

    const result = await ingestEvents(env, events);

    expect(result.inserted).toBe(19);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('texas_today:evt-7');
    expect(count('SELECT COUNT(*) AS n FROM events')).toBe(19);
    // No orphaned children from the rolled-back attempt.
    expect(
      count(
        'SELECT COUNT(*) AS n FROM event_categories WHERE event_id NOT IN (SELECT id FROM events)',
      ),
    ).toBe(0);
  });
});
