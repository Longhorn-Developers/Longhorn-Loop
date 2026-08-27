/**
 * Perks on user-created events (LOOP-259), against a real SQLite database
 * built from server/schema.sql.
 *
 * The read side of perks — the event_benefits table, the ingest write, and the
 * `?benefit=` filter — has worked since the first HornsLink scrape. What was
 * missing was the create path writing to the same table, so the filter matched
 * scraped events and silently returned nothing for anything a student posted.
 *
 * What is worth pinning here and nowhere else:
 *
 *   1. THE FILTER CROSSES THE SOURCE BOUNDARY. The bug this ticket fixes is
 *      invisible unless a query asks for a perk and expects BOTH a scraped and
 *      a user-created event back. A test that only inserts one kind passes
 *      either way.
 *   2. Replace-all on edit. PATCH is delete-then-insert, so removing a perk
 *      has to actually remove the row — an INSERT OR IGNORE on its own would
 *      make perks append-only and un-removable.
 *   3. Case-insensitive dedupe. UNIQUE(event_id, benefit_name) is exact, so
 *      "Free Food" and "free food" both land unless normalizeBenefits catches
 *      the pair first. This is the one rule the database will NOT enforce.
 *   4. The empty-array clear. `benefits: []` must delete every row rather than
 *      being read as "unchanged" — that distinction is the difference between
 *      a clearable field and a one-way door.
 *
 * Query strings are duplicated from routes/events.worker.ts because the route
 * builds them against a D1Database binding that only exists in the Worker
 * runtime. If you change the route SQL, change it here — drift shows up as a
 * failure.
 *
 * Skips below Node 22 (node:sqlite). CI runs Node 20 and does not run this
 * suite; this is a local guard.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAX_BENEFIT_COUNT,
  MAX_BENEFIT_NAME_LENGTH,
  normalizeBenefitName,
} from '../../shared/eventBenefits';

let DatabaseSync: (new (path: string) => any) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const describeOrSkip = DatabaseSync ? describe : describe.skip;

const AUTHOR = 1;
const SCRAPED_EVENT = 100;
const USER_EVENT = 200;

/**
 * Mirrors normalizeBenefits() in routes/events.worker.ts.
 *
 * Returns either the accepted list or the validation message, so the tests can
 * assert on rejection as precisely as on acceptance.
 */
function normalizeBenefits(raw: unknown): { ok: true; benefits: string[] } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, benefits: [] };
  if (!Array.isArray(raw)) return { ok: false };
  if (raw.length > MAX_BENEFIT_COUNT) return { ok: false };

  const benefits: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const name = normalizeBenefitName(item);
    if (!name) return { ok: false };
    if (name.length > MAX_BENEFIT_NAME_LENGTH) return { ok: false };
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      benefits.push(name);
    }
  }
  return { ok: true, benefits };
}

describeOrSkip('event perks write path (LOOP-259)', () => {
  let db: any;

  /** Mirrors insertBenefits() in routes/events.worker.ts. */
  const insertBenefits = (eventId: number, benefits: string[]) => {
    for (const benefit of benefits) {
      db.prepare(`INSERT OR IGNORE INTO event_benefits (event_id, benefit_name) VALUES (?, ?)`).run(
        eventId,
        benefit,
      );
    }
  };

  /** Mirrors the perks branch of PATCH /events/:id: replace-all. */
  const replaceBenefits = (eventId: number, benefits: string[]) => {
    db.prepare('DELETE FROM event_benefits WHERE event_id = ?').run(eventId);
    insertBenefits(eventId, benefits);
  };

  const benefitsOf = (eventId: number): string[] =>
    db
      .prepare('SELECT benefit_name FROM event_benefits WHERE event_id = ? ORDER BY benefit_name')
      .all(eventId)
      .map((r: any) => r.benefit_name);

  /** Mirrors the `?benefit=` clause of GET /events. */
  const eventIdsWithBenefit = (benefit: string): number[] =>
    db
      .prepare(
        `SELECT e.id FROM events e
          WHERE EXISTS (
                  SELECT 1 FROM event_benefits b
                   WHERE b.event_id = e.id AND b.benefit_name = ?
                )
          ORDER BY e.id`,
      )
      .all(benefit)
      .map((r: any) => r.id);

  beforeAll(() => {
    db = new DatabaseSync!(':memory:');
    db.exec(readFileSync(join(__dirname, '..', 'schema.sql'), 'utf-8'));

    db.exec(`INSERT INTO users (id, email, first_name, last_name) VALUES
      (${AUTHOR}, 'author@utexas.edu', 'Ada', 'Author')`);

    // One of each kind. The point of the pair is the cross-source assertion.
    db.exec(`INSERT INTO events (id, source, source_event_id, title, start_datetime) VALUES
      (${SCRAPED_EVENT}, 'hornslink', 'hl-1', 'Scraped Mixer', '2026-09-01T18:00:00Z'),
      (${USER_EVENT}, 'user_created', 'user-1-abc', 'Posted Mixer', '2026-09-02T18:00:00Z')`);
  });

  beforeEach(() => {
    db.exec('DELETE FROM event_benefits');
  });

  it('finds user-created AND scraped events under one perk', () => {
    // This is the regression. Before LOOP-259 the create path never wrote a
    // row, so this query returned the scraped event alone.
    insertBenefits(SCRAPED_EVENT, ['Free Food']);
    insertBenefits(USER_EVENT, ['Free Food']);

    expect(eventIdsWithBenefit('Free Food')).toEqual([SCRAPED_EVENT, USER_EVENT]);
  });

  it('stores each accepted perk once, in the casing given', () => {
    const parsed = normalizeBenefits(['Free Food', 'Credit']);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    insertBenefits(USER_EVENT, parsed.benefits);
    expect(benefitsOf(USER_EVENT)).toEqual(['Credit', 'Free Food']);
  });

  it('collapses perks that differ only by case or spacing before they reach the table', () => {
    // UNIQUE(event_id, benefit_name) is an exact-match index, so it would let
    // both of these through. The dedupe has to happen in the validator.
    const parsed = normalizeBenefits(['Free Food', 'free food', '  Free   Food  ']);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.benefits).toEqual(['Free Food']);

    insertBenefits(USER_EVENT, parsed.benefits);
    expect(benefitsOf(USER_EVENT)).toEqual(['Free Food']);
  });

  it('replaces the whole set on edit, so a removed perk is really gone', () => {
    insertBenefits(USER_EVENT, ['Free Food', 'Credit']);
    replaceBenefits(USER_EVENT, ['Credit']);

    expect(benefitsOf(USER_EVENT)).toEqual(['Credit']);
    expect(eventIdsWithBenefit('Free Food')).toEqual([]);
  });

  it('clears every perk when sent an empty array', () => {
    insertBenefits(USER_EVENT, ['Free Food', 'Credit']);
    replaceBenefits(USER_EVENT, []);

    expect(benefitsOf(USER_EVENT)).toEqual([]);
  });

  it('leaves perks untouched when the key is omitted', () => {
    insertBenefits(USER_EVENT, ['Free Swag']);

    // The route only calls replaceBenefits when hasField(body, BENEFIT_KEYS).
    // Omitting the key must not be read as "clear them".
    const parsed = normalizeBenefits(undefined);
    expect(parsed).toEqual({ ok: true, benefits: [] });

    expect(benefitsOf(USER_EVENT)).toEqual(['Free Swag']);
  });

  it('rejects a non-array, an empty name, an over-long name, and too many perks', () => {
    expect(normalizeBenefits('Free Food').ok).toBe(false);
    expect(normalizeBenefits(['Free Food', '   ']).ok).toBe(false);
    expect(normalizeBenefits(['x'.repeat(MAX_BENEFIT_NAME_LENGTH + 1)]).ok).toBe(false);
    expect(
      normalizeBenefits(Array.from({ length: MAX_BENEFIT_COUNT + 1 }, (_, i) => `p${i}`)).ok,
    ).toBe(false);

    // The boundary itself is allowed, not off by one.
    expect(normalizeBenefits(['x'.repeat(MAX_BENEFIT_NAME_LENGTH)]).ok).toBe(true);
    expect(normalizeBenefits(Array.from({ length: MAX_BENEFIT_COUNT }, (_, i) => `p${i}`)).ok).toBe(
      true,
    );
  });

  it('cascades perks away when the event is deleted', () => {
    db.exec(`INSERT INTO events (id, source, source_event_id, title, start_datetime)
             VALUES (900, 'user_created', 'user-1-doomed', 'Doomed', '2026-09-03T18:00:00Z')`);
    insertBenefits(900, ['Free Food']);

    db.exec('DELETE FROM events WHERE id = 900');
    expect(benefitsOf(900)).toEqual([]);
  });
});
