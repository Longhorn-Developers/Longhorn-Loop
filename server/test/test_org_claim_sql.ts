/**
 * Executes the claim-completion writes from POST /orgs/register/confirm
 * (LOOP-242) against a real SQLite database built from server/schema.sql.
 *
 * Worth pinning here specifically:
 *
 *   1. `verified` actually reaches 1. Before LOOP-242 nothing in the codebase
 *      ever wrote this column — the route parked the org in 'pending_review'
 *      for an approval step that had no route and no UI behind it, so the
 *      LOOP-140 badge was unreachable by every path. A test that fails when
 *      the flip is removed is the cheapest guard against that regressing into
 *      "aspirational review queue" a second time.
 *   2. The category COALESCE. A claimant who skips the dropdown must not blank
 *      a category the org already carries, and the difference between
 *      `category = ?` and `category = COALESCE(?, category)` is invisible in
 *      review and silent in production.
 *   3. Claim state after the fact. `claimStateOf` orders `verified` ahead of
 *      everything else, so a freshly verified org has to read as 'claimed' in
 *      search — otherwise the org it just handed to someone shows up as still
 *      available to the next person who searches for it.
 *
 * Query strings are duplicated from the route for the same reason as
 * test_org_search_sql.ts: the route builds them against a D1Database binding
 * that only exists in the Worker runtime. If you change the route SQL, change
 * it here — drift shows up as a failure.
 *
 * Skips below Node 22 (node:sqlite). CI runs Node 20 and does not run this
 * suite; this is a local guard.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OrgClaimState } from '../../shared/orgRegistration';

let DatabaseSync: (new (path: string) => any) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const describeOrSkip = DatabaseSync ? describe : describe.skip;

const UNCATEGORIZED_ORG = 101;
const CATEGORIZED_ORG = 102;
const CLAIMANT = 1;

describeOrSkip('org claim completion SQL (LOOP-242)', () => {
  let db: any;

  /** Mirrors claimStateOf() in routes/orgs.worker.ts. */
  const claimStateOf = (row: any): OrgClaimState => {
    if (Number(row.verified) === 1) return 'claimed';
    if (String(row.verification_status ?? '') === 'pending_review') return 'pending_review';
    if (Number(row.admin_count ?? 0) > 0) return 'claimed';
    return 'available';
  };

  /** Mirrors the two writes at the tail of POST /orgs/register/confirm. */
  const completeClaim = (orgId: number, userId: number, category: string | null) => {
    db.prepare(
      `INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, 'admin')
       ON CONFLICT(org_id, user_id) DO UPDATE SET role = 'admin'`,
    ).run(orgId, userId);

    db.prepare(
      `UPDATE organizations
          SET verified            = 1,
              verification_status = 'verified',
              category            = COALESCE(?, category),
              updated_at          = datetime('now')
        WHERE id = ?`,
    ).run(category, orgId);
  };

  const readOrg = (orgId: number) =>
    db
      .prepare(
        `SELECT o.id, o.verified, o.verification_status, o.category,
                (SELECT COUNT(*) FROM org_members m
                  WHERE m.org_id = o.id AND m.role = 'admin') AS admin_count
           FROM organizations o WHERE o.id = ?`,
      )
      .get(orgId);

  beforeEach(() => {
    db = new DatabaseSync!(':memory:');
    db.exec(readFileSync(join(__dirname, '..', 'schema.sql'), 'utf-8'));

    db.exec(
      `INSERT INTO users (id, email, first_name, last_name)
       VALUES (${CLAIMANT}, 'claimant@utexas.edu', 'Claim', 'Ant')`,
    );
    db.exec(`
      INSERT INTO organizations (id, name, president_email, category) VALUES
        (${UNCATEGORIZED_ORG}, 'Chess Club', 'pres@utexas.edu', NULL),
        (${CATEGORIZED_ORG}, 'Rowing', 'pres2@utexas.edu', 'Sports');
    `);
  });

  it('flips verified to 1 — the column nothing wrote before LOOP-242', () => {
    expect(Number(readOrg(UNCATEGORIZED_ORG).verified)).toBe(0);

    completeClaim(UNCATEGORIZED_ORG, CLAIMANT, 'Academic');

    expect(Number(readOrg(UNCATEGORIZED_ORG).verified)).toBe(1);
  });

  it('sets verification_status to verified, not pending_review', () => {
    completeClaim(UNCATEGORIZED_ORG, CLAIMANT, 'Academic');
    expect(readOrg(UNCATEGORIZED_ORG).verification_status).toBe('verified');
  });

  it('makes the claimant an admin', () => {
    completeClaim(UNCATEGORIZED_ORG, CLAIMANT, 'Academic');
    expect(Number(readOrg(UNCATEGORIZED_ORG).admin_count)).toBe(1);
  });

  it('is idempotent — re-running does not duplicate the admin row', () => {
    completeClaim(UNCATEGORIZED_ORG, CLAIMANT, 'Academic');
    completeClaim(UNCATEGORIZED_ORG, CLAIMANT, 'Academic');
    expect(Number(readOrg(UNCATEGORIZED_ORG).admin_count)).toBe(1);
  });

  it('writes the submitted category onto an org that had none', () => {
    completeClaim(UNCATEGORIZED_ORG, CLAIMANT, 'Academic');
    expect(readOrg(UNCATEGORIZED_ORG).category).toBe('Academic');
  });

  it('COALESCE keeps the existing category when the claimant skipped the dropdown', () => {
    completeClaim(CATEGORIZED_ORG, CLAIMANT, null);
    expect(readOrg(CATEGORIZED_ORG).category).toBe('Sports');
  });

  it('a submitted category still overwrites an existing one', () => {
    completeClaim(CATEGORIZED_ORG, CLAIMANT, 'Cultural');
    expect(readOrg(CATEGORIZED_ORG).category).toBe('Cultural');
  });

  it('reads as claimed in search afterwards, so nobody else is offered it', () => {
    expect(claimStateOf(readOrg(UNCATEGORIZED_ORG))).toBe('available');

    completeClaim(UNCATEGORIZED_ORG, CLAIMANT, 'Academic');

    expect(claimStateOf(readOrg(UNCATEGORIZED_ORG))).toBe('claimed');
  });

  it('leaves other orgs untouched', () => {
    completeClaim(UNCATEGORIZED_ORG, CLAIMANT, 'Academic');
    expect(Number(readOrg(CATEGORIZED_ORG).verified)).toBe(0);
    expect(claimStateOf(readOrg(CATEGORIZED_ORG))).toBe('available');
  });
});

/**
 * The org-directory upsert (LOOP-241).
 *
 * The COALESCE columns are the whole point: a directory page that omits a
 * field must not blank one we already hold, because a live claim may be
 * resting on the stored president_email. Meanwhile name and picture DO
 * overwrite, so a renamed org doesn't stay stale in search. That asymmetry is
 * a decision, and decisions are what deserve tests.
 */
describeOrSkip('org directory upsert SQL (LOOP-241)', () => {
  let db: any;

  const upsertOrg = (
    id: number,
    name: string,
    slug: string | null,
    picture: string | null,
    email: string | null,
  ) => {
    db.prepare(
      `INSERT INTO organizations (id, name, slug, profile_picture, president_email, source, updated_at)
       VALUES (?, ?, ?, ?, ?, 'hornslink', datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         name            = excluded.name,
         slug            = COALESCE(excluded.slug, slug),
         profile_picture = COALESCE(excluded.profile_picture, profile_picture),
         president_email = COALESCE(excluded.president_email, president_email),
         updated_at      = datetime('now')`,
    ).run(id, name, slug, picture, email);
  };

  const readOrg = (id: number) => db.prepare('SELECT * FROM organizations WHERE id = ?').get(id);

  beforeEach(() => {
    db = new DatabaseSync!(':memory:');
    db.exec(readFileSync(join(__dirname, '..', 'schema.sql'), 'utf-8'));
  });

  it('inserts a new org', () => {
    upsertOrg(1, 'Chess Club', 'chess', 'pic.jpg', null);
    const row = readOrg(1);
    expect(row.name).toBe('Chess Club');
    expect(row.slug).toBe('chess');
    expect(row.president_email).toBeNull();
  });

  it('overwrites the name — a renamed org must not stay stale in search', () => {
    upsertOrg(1, 'Chess Club', 'chess', null, null);
    upsertOrg(1, 'UT Chess Club', 'chess', null, null);
    expect(readOrg(1).name).toBe('UT Chess Club');
  });

  it('does NOT blank president_email when the directory page omits it', () => {
    // The case that matters: the email arrives from the per-org detail pass,
    // never from the directory listing, so every subsequent directory sweep
    // upserts this row with a null email. A plain assignment here would wipe
    // the address out from under a claim once a day, forever.
    upsertOrg(1, 'Chess Club', 'chess', null, 'pres@utexas.edu');
    upsertOrg(1, 'Chess Club', 'chess', null, null);
    expect(readOrg(1).president_email).toBe('pres@utexas.edu');
  });

  it('does not blank an existing slug or picture either', () => {
    upsertOrg(1, 'Chess Club', 'chess', 'pic.jpg', null);
    upsertOrg(1, 'Chess Club', null, null, null);
    const row = readOrg(1);
    expect(row.slug).toBe('chess');
    expect(row.profile_picture).toBe('pic.jpg');
  });

  it('a fresh president_email does replace an older one', () => {
    // The answer to "if the president changes it on HornsLink, will a rescrape
    // pick it up?" — yes, via the detail pass, which supplies a non-null value.
    upsertOrg(1, 'Chess Club', 'chess', null, 'old@utexas.edu');
    upsertOrg(1, 'Chess Club', 'chess', null, 'new@utexas.edu');
    expect(readOrg(1).president_email).toBe('new@utexas.edu');
  });

  it('merges onto a row that event ingestion created first', () => {
    // organizations.id is the HornsLink org id in both paths, so the directory
    // sweep must land on the existing row rather than colliding or duplicating.
    db.exec("INSERT INTO organizations (id, name, source) VALUES (1, 'Chess Club', 'hornslink')");
    upsertOrg(1, 'Chess Club', 'chess', 'pic.jpg', 'pres@utexas.edu');

    const rows = db.prepare('SELECT COUNT(*) AS n FROM organizations').get();
    expect(Number(rows.n)).toBe(1);
    expect(readOrg(1).slug).toBe('chess');
  });
});
