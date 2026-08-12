/**
 * Executes the "Find your organization" query from routes/orgs.worker.ts
 * (LOOP-141) against a real SQLite database built from server/schema.sql.
 *
 * What is worth pinning here and nowhere else:
 *
 *   1. Ranking. "Rowing" must beat "Texas Rowing Alumni Social Committee" for
 *      the query "rowing", and an exact name must beat both. That ordering is
 *      a CASE expression over three LIKE comparisons — the kind of thing that
 *      still returns plausible-looking rows when it is wrong.
 *   2. The empty-query guard. A search field that returns the whole directory
 *      when it is untouched is the default behaviour of a naive LIKE '%%', so
 *      the guard needs a test that fails if someone removes it.
 *   3. Claim state. Whether an org is claimable is derived from THREE columns
 *      across two tables (`verified`, `verification_status`, and whether any
 *      org_members row has role 'admin'). Only a real database proves that an
 *      admin who arrived via an invite — never touching verification_status —
 *      still marks the org as taken.
 *   4. LIKE escaping. Org names contain '%' and '_' rarely, but a QUERY
 *      containing one is a wildcard unless it is escaped, and "%" matching
 *      every org is the worst possible search result.
 *
 * Query strings are duplicated from the route because the route builds them
 * against a D1Database binding that only exists in the Worker runtime. If you
 * change the route SQL, change it here — drift shows up as a failure.
 *
 * Skips below Node 22 (node:sqlite). CI runs Node 20 and does not run this
 * suite; this is a local guard.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ORG_SEARCH_LIMIT,
  ORG_SEARCH_MIN_QUERY,
  type OrgClaimState,
} from '../../shared/orgRegistration';

let DatabaseSync: (new (path: string) => any) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const describeOrSkip = DatabaseSync ? describe : describe.skip;

// Orgs. Names are chosen so the ranking tiers are distinguishable: "Rowing" is
// an exact match, "Rowing Club" a prefix match, "Texas Rowing Alumni" a
// contains match, and "Longhorn Rowing Society" a longer contains match.
const ROWING = 1;
const ROWING_CLUB = 2;
const TEXAS_ROWING = 3;
const LONGHORN_ROWING = 4;
const CLAIMED_ORG = 5;
const PENDING_ORG = 6;
const VERIFIED_ORG = 7;
const REJECTED_ORG = 8;
const ODD_NAME_ORG = 9;

const HOLDER = 1;
const INVITED_ADMIN = 2;
const EDITOR_ONLY = 3;

describeOrSkip('org search SQL (LOOP-141)', () => {
  let db: any;

  /** Mirrors escapeLike() in routes/orgs.worker.ts. */
  const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (ch) => `\\${ch}`);

  /** Mirrors claimStateOf() in routes/orgs.worker.ts. */
  const claimStateOf = (row: any): OrgClaimState => {
    if (Number(row.verified) === 1) return 'claimed';
    if (String(row.verification_status ?? '') === 'pending_review') return 'pending_review';
    if (Number(row.admin_count ?? 0) > 0) return 'claimed';
    return 'available';
  };

  /** Mirrors the GET /orgs/search handler, guard included. */
  const search = (q: string, limit = ORG_SEARCH_LIMIT) => {
    const trimmed = q.trim();
    if (trimmed.length < ORG_SEARCH_MIN_QUERY) return [];

    const lowered = trimmed.toLowerCase();
    const needle = escapeLike(lowered);

    const rows = db
      .prepare(
        `SELECT o.id, o.name, o.profile_picture, o.category, o.verified, o.verification_status,
                (SELECT COUNT(*) FROM org_members m
                  WHERE m.org_id = o.id AND m.role = 'admin') AS admin_count
           FROM organizations o
          WHERE lower(o.name) LIKE ? ESCAPE '\\'
          ORDER BY CASE
                     WHEN lower(o.name) = ?               THEN 0
                     WHEN lower(o.name) LIKE ? ESCAPE '\\' THEN 1
                     ELSE 2
                   END,
                   length(o.name) ASC,
                   o.name COLLATE NOCASE ASC
          LIMIT ?`,
      )
      .all(`%${needle}%`, lowered, `${needle}%`, limit);

    return rows.map((o: any) => {
      const claim_state = claimStateOf(o);
      return { ...o, claim_state, claimable: claim_state === 'available' };
    });
  };

  const ids = (q: string) => search(q).map((o: any) => o.id);
  const stateOf = (id: number): OrgClaimState =>
    search(String(id === ODD_NAME_ORG ? 'odd' : 'claim')).find((o: any) => o.id === id)
      ?.claim_state ?? 'available';

  beforeAll(() => {
    db = new DatabaseSync!(':memory:');
    db.exec(readFileSync(join(__dirname, '..', 'schema.sql'), 'utf-8'));

    db.exec(`INSERT INTO users (id, email, first_name, last_name) VALUES
      (${HOLDER}, 'holder@utexas.edu', 'Hal', 'Holder'),
      (${INVITED_ADMIN}, 'invited@utexas.edu', 'Ivy', 'Invited'),
      (${EDITOR_ONLY}, 'editor@utexas.edu', 'Eli', 'Editor')`);

    db.exec(`INSERT INTO organizations (id, name, verification_status) VALUES
      (${ROWING},           'Rowing',                   'unverified'),
      (${ROWING_CLUB},      'Rowing Club',              'unverified'),
      (${TEXAS_ROWING},     'Texas Rowing Alumni',      'unverified'),
      (${LONGHORN_ROWING},  'Longhorn Rowing Society',  'unverified'),
      (${CLAIMED_ORG},      'Claim Test Alpha',         'unverified'),
      (${PENDING_ORG},      'Claim Test Bravo',         'pending_review'),
      (${VERIFIED_ORG},     'Claim Test Charlie',       'unverified'),
      (${REJECTED_ORG},     'Claim Test Delta',         'rejected'),
      (${ODD_NAME_ORG},     'Odd 100% _Name_ Club',     'unverified')`);

    db.exec(`UPDATE organizations SET verified = 1 WHERE id = ${VERIFIED_ORG}`);

    // CLAIMED_ORG is held by someone who ran the registration flow.
    db.exec(
      `INSERT INTO org_members (org_id, user_id, role) VALUES (${CLAIMED_ORG}, ${HOLDER}, 'admin')`,
    );
    // PENDING_ORG matches what /register/confirm actually writes: an admin row
    // AND pending_review, in that same request.
    db.exec(
      `INSERT INTO org_members (org_id, user_id, role) VALUES (${PENDING_ORG}, ${HOLDER}, 'admin')`,
    );
    // VERIFIED_ORG got its admin by invite, so verification_status never moved.
    db.exec(
      `INSERT INTO org_members (org_id, user_id, role) VALUES (${VERIFIED_ORG}, ${INVITED_ADMIN}, 'admin')`,
    );
    // An EDITOR is not control of the org: REJECTED_ORG stays claimable.
    db.exec(
      `INSERT INTO org_members (org_id, user_id, role) VALUES (${REJECTED_ORG}, ${EDITOR_ONLY}, 'editor')`,
    );
  });

  describe('the empty-query guard', () => {
    it('returns nothing rather than everything for an empty query', () => {
      expect(search('')).toEqual([]);
      expect(search('   ')).toEqual([]);
    });

    it('returns nothing for a query below the minimum length', () => {
      // 'r' would match five of the nine orgs on a bare LIKE '%r%'.
      expect(search('r')).toEqual([]);
      expect(ORG_SEARCH_MIN_QUERY).toBeGreaterThan(1);
    });

    it('starts returning results at exactly the minimum length', () => {
      expect(ids('ro').length).toBeGreaterThan(0);
    });
  });

  describe('matching', () => {
    it('finds an org by a fragment from the middle of its name', () => {
      expect(ids('alumni')).toEqual([TEXAS_ROWING]);
    });

    it('is case-insensitive in both directions', () => {
      const lower = ids('rowing club');
      expect(lower).toContain(ROWING_CLUB);
      expect(ids('ROWING CLUB')).toEqual(lower);
      expect(ids('RoWiNg cLuB')).toEqual(lower);
      // And an all-caps query still finds a mixed-case NAME.
      expect(ids('LONGHORN')).toEqual([LONGHORN_ROWING]);
    });

    it('returns an empty list when nothing matches', () => {
      // The case the "skip for now" affordance exists for: an org that has
      // never posted an event is simply not in this table.
      expect(search('quidditch')).toEqual([]);
    });

    it('treats LIKE wildcards in the query as literal characters', () => {
      // Unescaped, '%' matches every org in the table.
      expect(ids('100%')).toEqual([ODD_NAME_ORG]);
      expect(ids('_name_')).toEqual([ODD_NAME_ORG]);
      // A lone wildcard pair must not become "select everything".
      expect(ids('%%')).toEqual([]);
    });
  });

  describe('ranking', () => {
    it('puts an exact name first, then prefixes, then contains-matches', () => {
      expect(ids('rowing')).toEqual([ROWING, ROWING_CLUB, TEXAS_ROWING, LONGHORN_ROWING]);
    });

    it('prefers the shorter name inside a tier', () => {
      // Both merely contain "rowing"; "Texas Rowing Alumni" (19) is shorter
      // than "Longhorn Rowing Society" (23), and the specific org is the more
      // likely answer than the umbrella one.
      const ranked = ids('rowing');
      expect(ranked.indexOf(TEXAS_ROWING)).toBeLessThan(ranked.indexOf(LONGHORN_ROWING));
    });

    it('ranks a prefix match above a longer exact-substring match', () => {
      const ranked = ids('rowing');
      expect(ranked.indexOf(ROWING_CLUB)).toBeLessThan(ranked.indexOf(TEXAS_ROWING));
    });

    it('honours the limit', () => {
      expect(search('rowing', 2).map((o: any) => o.id)).toEqual([ROWING, ROWING_CLUB]);
    });
  });

  describe('claim state', () => {
    it('flags an org held by an admin as claimed', () => {
      expect(stateOf(CLAIMED_ORG)).toBe('claimed');
    });

    it('reports a mid-flight claim as pending_review, not merely claimed', () => {
      // /register/confirm writes an admin row AND pending_review together;
      // the more specific state has to win or the user is told the wrong thing.
      expect(stateOf(PENDING_ORG)).toBe('pending_review');
    });

    it('flags a human-approved org as claimed even though its status never moved', () => {
      // The invite path never touches verification_status. Deriving claimability
      // from that column alone would offer this org up for claiming.
      expect(stateOf(VERIFIED_ORG)).toBe('claimed');
    });

    it('leaves a rejected org with no admin claimable', () => {
      // A turned-down claim must not lock the real president out forever, and
      // an editor is not control of the org.
      expect(stateOf(REJECTED_ORG)).toBe('available');
    });

    it('marks an untouched org as claimable', () => {
      expect(search('rowing').find((o: any) => o.id === ROWING)?.claimable).toBe(true);
    });

    it('never marks a claimed org as claimable', () => {
      const taken = search('claim').filter((o: any) => o.claim_state !== 'available');
      expect(taken.length).toBe(3);
      expect(taken.every((o: any) => o.claimable === false)).toBe(true);
    });
  });
});
