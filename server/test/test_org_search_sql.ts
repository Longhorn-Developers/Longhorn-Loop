/**
 * Executes the GET /orgs/search query from routes/orgs.worker.ts (LOOP-141,
 * grown into a directory by LOOP-264) against a real SQLite database built
 * from server/schema.sql.
 *
 * What is worth pinning here and nowhere else:
 *
 *   1. Ranking. "Rowing" must beat "Texas Rowing Alumni Social Committee" for
 *      the query "rowing", and an exact name must beat both. That ordering is
 *      a CASE expression over three LIKE comparisons — the kind of thing that
 *      still returns plausible-looking rows when it is wrong.
 *   2. Filters (verified / category / hasUpcomingEvents) apply as plain WHERE
 *      predicates alongside search, not instead of it.
 *   3. Sort keys. Each of trending / newest / az has its own primary column,
 *      and search relevance is spliced in as a tie-breaker only when that
 *      primary column is otherwise tied — a real difference in the primary
 *      sort key must win regardless of how well a name matches.
 *   4. Claim state. Whether an org is claimable is derived from THREE columns
 *      across two tables (`verified`, `verification_status`, and whether any
 *      org_members row has role 'admin'). Only a real database proves that an
 *      admin who arrived via an invite — never touching verification_status —
 *      still marks the org as taken.
 *   5. LIKE escaping. Org names contain '%' and '_' rarely, but a QUERY
 *      containing one is a wildcard unless it is escaped, and "%" matching
 *      every org is the worst possible search result.
 *
 * Query strings are duplicated from the route because the route builds them
 * against a D1Database binding that only exists in the Worker runtime. If you
 * change the route SQL, change it here — drift shows up as a failure.
 * Cursor pagination itself (encode/decode, keyset WHERE, validation errors) is
 * covered end-to-end against the real route in test/routes/test_org_search.ts
 * instead of being re-derived here a second time.
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
  type OrgSortOption,
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

// Filter fixtures.
const CAT_PROFESSIONAL = 20;
const CAT_SPORTS = 21;
const UPCOMING_ORG = 30;
const PAST_ONLY_ORG = 31;

// Sort fixtures.
const TRENDING_HIGH = 40;
const TRENDING_LOW = 41;
const TRENDING_OLD_FOLLOWERS = 42;
// Isolated under its own keyword ("kumquat") rather than "rowing" so it can't
// change the exact/prefix/contains fixtures the ranking tests below depend on.
const TIEBREAK_EXACT = 43; // exact match, no trending signal
const TIEBREAK_CONTAINS = 44; // contains-only match, but a real trending signal
const NEWEST_A = 50;
const NEWEST_B = 51;

describeOrSkip('org search SQL (LOOP-141, LOOP-264)', () => {
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

  type SortKey = { expr: string; dir: 'ASC' | 'DESC'; field: string };

  /** Mirrors sortKeysFor() in routes/orgs.worker.ts. */
  const sortKeysFor = (sort: OrgSortOption, searching: boolean): SortKey[] => {
    const id: SortKey = { expr: 'id', dir: 'ASC', field: 'id' };
    const name: SortKey = { expr: 'name COLLATE NOCASE', dir: 'ASC', field: 'name' };
    const relevance: SortKey[] = [
      { expr: 'search_tier', dir: 'ASC', field: 'search_tier' },
      { expr: 'name_length', dir: 'ASC', field: 'name_length' },
      name,
    ];
    if (sort === 'newest') {
      const updatedAt: SortKey = { expr: 'updated_at', dir: 'DESC', field: 'updated_at' };
      return searching ? [updatedAt, ...relevance, id] : [updatedAt, id];
    }
    if (sort === 'az') {
      return searching ? [name, relevance[0], relevance[1], id] : [name, id];
    }
    const trending: SortKey = { expr: 'trending_score', dir: 'DESC', field: 'trending_score' };
    return searching ? [trending, ...relevance, id] : [trending, name, id];
  };

  type SearchOpts = {
    q?: string;
    sort?: OrgSortOption;
    verified?: boolean;
    category?: string[];
    hasUpcomingEvents?: boolean;
    limit?: number;
  };

  /** Mirrors the GET /orgs/search handler's query-building, guard included. */
  const search = (opts: SearchOpts = {}): any[] => {
    const q = (opts.q ?? '').trim();
    const searching = q.length > 0 && q.length >= ORG_SEARCH_MIN_QUERY;
    if (q.length > 0 && q.length < ORG_SEARCH_MIN_QUERY) return [];

    const sort = opts.sort ?? 'trending';
    const limit = opts.limit ?? ORG_SEARCH_LIMIT;
    const keys = sortKeysFor(sort, searching);

    const selectExtra: string[] = [];
    const selectBinds: unknown[] = [];
    const whereParts: string[] = [];
    const whereBinds: unknown[] = [];

    if (searching) {
      const lowered = q.toLowerCase();
      const needle = escapeLike(lowered);
      selectExtra.push(
        `, CASE
             WHEN lower(o.name) = ?               THEN 0
             WHEN lower(o.name) LIKE ? ESCAPE '\\' THEN 1
             ELSE 2
           END AS search_tier,
           length(o.name) AS name_length`,
      );
      selectBinds.push(lowered, `${needle}%`);
      whereParts.push(`lower(o.name) LIKE ? ESCAPE '\\'`);
      whereBinds.push(`%${needle}%`);
    }
    if (opts.verified) whereParts.push('o.verified = 1');
    if (opts.category && opts.category.length > 0) {
      whereParts.push(`o.category IN (${opts.category.map(() => '?').join(', ')})`);
      whereBinds.push(...opts.category);
    }
    if (opts.hasUpcomingEvents) {
      whereParts.push(
        `EXISTS (SELECT 1 FROM events e
                  WHERE e.host_organization_id = o.id
                    AND e.status = 'active'
                    AND e.start_datetime > datetime('now'))`,
      );
    }

    const rows = db
      .prepare(
        `WITH scored AS (
           SELECT o.id, o.name, o.profile_picture, o.category, o.verified,
                  o.verification_status, o.updated_at,
                  (SELECT COUNT(*) FROM org_members m
                    WHERE m.org_id = o.id AND m.role = 'admin') AS admin_count,
                  (SELECT COUNT(*) FROM org_followers f
                    WHERE f.org_id = o.id AND f.created_at >= datetime('now', '-7 days')) AS trending_score
                  ${selectExtra.join('')}
             FROM organizations o
             ${whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : ''}
         )
         SELECT * FROM scored
         ORDER BY ${keys.map((k) => `${k.expr} ${k.dir}`).join(', ')}
         LIMIT ?`,
      )
      .all(...selectBinds, ...whereBinds, limit);

    return rows.map((o: any) => {
      const claim_state = claimStateOf(o);
      return { ...o, claim_state, claimable: claim_state === 'available' };
    });
  };

  const ids = (q: string, opts: Omit<SearchOpts, 'q'> = {}) =>
    search({ q, ...opts }).map((o: any) => o.id);
  const stateOf = (id: number): OrgClaimState =>
    search({ q: String(id === ODD_NAME_ORG ? 'odd' : 'claim') }).find((o: any) => o.id === id)
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

    // --- filter fixtures ----------------------------------------------------
    db.exec(`INSERT INTO organizations (id, name, category) VALUES
      (${CAT_PROFESSIONAL}, 'Category Professional Org', 'Professional'),
      (${CAT_SPORTS},       'Category Sports Org',       'Sports')`);

    db.exec(`INSERT INTO organizations (id, name) VALUES
      (${UPCOMING_ORG},  'Upcoming Events Org'),
      (${PAST_ONLY_ORG}, 'Past Only Org')`);
    db.exec(`INSERT INTO events
      (id, source, source_event_id, title, start_datetime, host_organization_id, status) VALUES
      (100, 'hornslink', 'ev100', 'Future Active',    datetime('now', '+3 days'), ${UPCOMING_ORG},  'active'),
      (101, 'hornslink', 'ev101', 'Future Cancelled', datetime('now', '+3 days'), ${PAST_ONLY_ORG}, 'cancelled'),
      (102, 'hornslink', 'ev102', 'Past Active',      datetime('now', '-3 days'), ${PAST_ONLY_ORG}, 'active')`);

    // --- sort fixtures -------------------------------------------------------
    db.exec(`INSERT INTO organizations (id, name) VALUES
      (${TRENDING_HIGH},          'Trending High Org'),
      (${TRENDING_LOW},           'Trending Low Org'),
      (${TRENDING_OLD_FOLLOWERS}, 'Trending Old Followers Org'),
      (${TIEBREAK_EXACT},         'Kumquat'),
      (${TIEBREAK_CONTAINS},      'Kumquat Fan Society')`);
    db.exec(`INSERT INTO org_followers (org_id, user_id, created_at) VALUES
      (${TRENDING_HIGH}, ${HOLDER},        datetime('now', '-1 days')),
      (${TRENDING_HIGH}, ${INVITED_ADMIN}, datetime('now', '-2 days')),
      (${TRENDING_HIGH}, ${EDITOR_ONLY},   datetime('now', '-3 days')),
      (${TRENDING_LOW},  ${HOLDER},        datetime('now', '-1 days')),
      (${TRENDING_OLD_FOLLOWERS}, ${HOLDER}, datetime('now', '-10 days')),
      (${TIEBREAK_CONTAINS}, ${HOLDER},    datetime('now', '-1 days'))`);

    db.exec(`INSERT INTO organizations (id, name) VALUES
      (${NEWEST_A}, 'Newest A Org'),
      (${NEWEST_B}, 'Newest B Org')`);
    db.exec(`UPDATE organizations SET updated_at = '2025-01-01 00:00:00' WHERE id = ${NEWEST_A}`);
    db.exec(`UPDATE organizations SET updated_at = '2024-01-01 00:00:00' WHERE id = ${NEWEST_B}`);
  });

  describe('the empty-query guard', () => {
    it('treats an empty (or omitted) query as "browse everything" (LOOP-264)', () => {
      // Pre-LOOP-264 this returned []. The endpoint is now also a browsable
      // directory, and Default Behavior says "no search" returns the
      // trending-sorted list, not an empty page.
      expect(ids('')).not.toEqual([]);
      expect(ids('   ')).not.toEqual([]);
    });

    it('returns nothing for a non-empty query below the minimum length', () => {
      // 'r' would match many orgs on a bare LIKE '%r%'; a still-typing query
      // must not spam the caller with near-everything.
      expect(search({ q: 'r' })).toEqual([]);
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
    });

    it('returns an empty list when nothing matches', () => {
      expect(search({ q: 'quidditch' })).toEqual([]);
    });

    it('treats LIKE wildcards in the query as literal characters', () => {
      expect(ids('100%')).toEqual([ODD_NAME_ORG]);
      expect(ids('_name_')).toEqual([ODD_NAME_ORG]);
      expect(ids('%%')).toEqual([]);
    });
  });

  describe('ranking (no explicit sort -- defaults to trending, which ties at 0 for these orgs)', () => {
    it('puts an exact name first, then prefixes, then contains-matches', () => {
      expect(ids('rowing')).toEqual([ROWING, ROWING_CLUB, TEXAS_ROWING, LONGHORN_ROWING]);
    });

    it('an all-caps query still finds a mixed-case name', () => {
      expect(ids('LONGHORN')).toEqual([LONGHORN_ROWING]);
    });

    it('prefers the shorter name inside a tier', () => {
      const ranked = ids('rowing');
      expect(ranked.indexOf(TEXAS_ROWING)).toBeLessThan(ranked.indexOf(LONGHORN_ROWING));
    });

    it('ranks a prefix match above a longer exact-substring match', () => {
      const ranked = ids('rowing');
      expect(ranked.indexOf(ROWING_CLUB)).toBeLessThan(ranked.indexOf(TEXAS_ROWING));
    });

    it('honours the limit', () => {
      expect(search({ q: 'rowing', limit: 2 }).map((o: any) => o.id)).toEqual([
        ROWING,
        ROWING_CLUB,
      ]);
    });
  });

  describe('filters', () => {
    it('verified=true keeps only verified orgs', () => {
      const found = search({ verified: true }).map((o: any) => o.id);
      expect(found).toContain(VERIFIED_ORG);
      expect(found).not.toContain(ROWING);
    });

    it('omitting verified applies no filter', () => {
      // limit raised past the fixture count -- see the comment in 'sorting'
      // below for why the default page size would otherwise hide ROWING here.
      const found = search({ limit: 100 }).map((o: any) => o.id);
      expect(found).toContain(ROWING);
      expect(found).toContain(VERIFIED_ORG);
    });

    it('category keeps only orgs in the selected category', () => {
      expect(search({ category: ['Professional'] }).map((o: any) => o.id)).toEqual([
        CAT_PROFESSIONAL,
      ]);
    });

    it('multiple categories match any of the selected ones', () => {
      const found = search({ category: ['Professional', 'Sports'] })
        .map((o: any) => o.id)
        .sort((a: number, b: number) => a - b);
      expect(found).toEqual([CAT_PROFESSIONAL, CAT_SPORTS].sort((a, b) => a - b));
    });

    it('hasUpcomingEvents keeps only orgs with a future, active event', () => {
      const found = search({ hasUpcomingEvents: true }).map((o: any) => o.id);
      expect(found).toContain(UPCOMING_ORG);
      // PAST_ONLY_ORG has a future event that's cancelled and a past event
      // that's active -- neither alone satisfies "future AND active".
      expect(found).not.toContain(PAST_ONLY_ORG);
    });
  });

  describe('sorting', () => {
    // limit is raised well past the fixture count in this block: these checks
    // filter the full result down to a handful of ids afterward, and the
    // default page size (ORG_SEARCH_LIMIT) would otherwise truncate the
    // candidate list before that filter ever saw the ones being asserted on.
    const BIG_ENOUGH_LIMIT = 100;

    it('trending orders by followers gained in the past 7 days, most first', () => {
      const found = ids('', { sort: 'trending', limit: BIG_ENOUGH_LIMIT }).filter((id) =>
        [TRENDING_HIGH, TRENDING_LOW, TRENDING_OLD_FOLLOWERS].includes(id),
      );
      // TRENDING_OLD_FOLLOWERS' one follower is 10 days old and doesn't count,
      // so it ties ROWING et al. at zero and lands with the alphabetical pack
      // -- last among these three regardless.
      expect(found).toEqual([TRENDING_HIGH, TRENDING_LOW, TRENDING_OLD_FOLLOWERS]);
    });

    it('newest orders by updated_at, most recently updated first', () => {
      const found = ids('', { sort: 'newest', limit: BIG_ENOUGH_LIMIT }).filter((id) =>
        [NEWEST_A, NEWEST_B].includes(id),
      );
      expect(found).toEqual([NEWEST_A, NEWEST_B]);
    });

    it('az orders alphabetically by name', () => {
      const found = ids('', { sort: 'az', limit: BIG_ENOUGH_LIMIT }).filter((id) =>
        [ROWING, ROWING_CLUB, TEXAS_ROWING, LONGHORN_ROWING].includes(id),
      );
      expect(found).toEqual([LONGHORN_ROWING, ROWING, ROWING_CLUB, TEXAS_ROWING]);
    });

    it('uses search relevance as a tie-breaker only when the primary sort key is tied', () => {
      // TIEBREAK_CONTAINS only "contains" the query -- a worse tier than
      // TIEBREAK_EXACT's exact match -- but it has a genuine trending signal
      // TIEBREAK_EXACT doesn't. Trending, the actual sort in effect, must put
      // it first; search tier only matters once trending_score ties.
      expect(ids('kumquat', { sort: 'trending' })[0]).toBe(TIEBREAK_CONTAINS);
    });
  });

  describe('claim state', () => {
    it('flags an org held by an admin as claimed', () => {
      expect(stateOf(CLAIMED_ORG)).toBe('claimed');
    });

    it('reports a mid-flight claim as pending_review, not merely claimed', () => {
      expect(stateOf(PENDING_ORG)).toBe('pending_review');
    });

    it('flags a human-approved org as claimed even though its status never moved', () => {
      expect(stateOf(VERIFIED_ORG)).toBe('claimed');
    });

    it('leaves a rejected org with no admin claimable', () => {
      expect(stateOf(REJECTED_ORG)).toBe('available');
    });

    it('marks an untouched org as claimable', () => {
      expect(search({ q: 'rowing' }).find((o: any) => o.id === ROWING)?.claimable).toBe(true);
    });

    it('never marks a claimed org as claimable', () => {
      const taken = search({ q: 'claim' }).filter((o: any) => o.claim_state !== 'available');
      expect(taken.length).toBe(3);
      expect(taken.every((o: any) => o.claimable === false)).toBe(true);
    });
  });
});
