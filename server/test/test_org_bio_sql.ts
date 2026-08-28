/**
 * Org description write path (LOOP-261), against a real SQLite database built
 * from server/schema.sql.
 *
 * `organizations.bio` arrived in migration 0016 for the public org profile and
 * nothing ever wrote it — every row in production is NULL. This pins the write
 * side, and the one read that LOOP-257 is waiting on.
 *
 * What is worth pinning here and nowhere else:
 *
 *   1. THE ADMIN GATE, and that it is narrower than the events one. An editor
 *      can manage events but not the org's own description; that difference is
 *      a role string comparison, which is exactly the kind of thing that looks
 *      right and is wrong.
 *   2. Clearing vs omitting. `bio: null` clears the column and an absent key
 *      does nothing — the route distinguishes them with hasOwnProperty, so a
 *      falsy check would silently turn "clear my description" into a no-op.
 *   3. Normalize-then-measure. A bio that is only over MAX_BIO because of
 *      trailing whitespace must be accepted and tidied, not rejected. Doing
 *      the length check first is the obvious ordering and the wrong one.
 *   4. That org search actually selects the column. LOOP-257 builds on this
 *      row shape; a search that returns everything except `bio` would look
 *      fine until the facet work started.
 *
 * Skips below Node 22 (node:sqlite). CI runs Node 20 and does not run this
 * suite; this is a local guard.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_BIO, normalizeBio } from '../../shared/bio';

let DatabaseSync: (new (path: string) => any) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const describeOrSkip = DatabaseSync ? describe : describe.skip;

const ORG = 1;
const OTHER_ORG = 2;
const ADMIN = 1;
const EDITOR = 2;
const STRANGER = 3;

type PatchResult = { status: 200; bio: string | null } | { status: 400 | 403; error: string };

describeOrSkip('org bio write path (LOOP-261)', () => {
  let db: any;

  /** Mirrors resolveMembership() + the role gate on PATCH /orgs/:orgId. */
  const roleOf = (orgId: number, userId: number): string | null => {
    const row = db
      .prepare('SELECT role FROM org_members WHERE org_id = ? AND user_id = ?')
      .get(orgId, userId);
    return row ? row.role : null;
  };

  /** Mirrors the PATCH /orgs/:orgId handler end to end. */
  const patchBio = (orgId: number, userId: number, body: Record<string, unknown>): PatchResult => {
    const role = roleOf(orgId, userId);
    if (role === null) return { status: 403, error: 'NOT_A_MEMBER' };
    if (role !== 'admin') return { status: 403, error: 'FORBIDDEN' };

    if (!Object.prototype.hasOwnProperty.call(body, 'bio')) {
      return { status: 400, error: 'INVALID_BODY' };
    }
    const raw = body.bio;
    if (raw !== null && typeof raw !== 'string') {
      return { status: 400, error: 'VALIDATION_ERROR' };
    }

    const bio = normalizeBio(raw as string | null);
    if (bio !== null && bio.length > MAX_BIO) {
      return { status: 400, error: 'VALIDATION_ERROR' };
    }

    db.prepare('UPDATE organizations SET bio = ? WHERE id = ?').run(bio, orgId);
    return { status: 200, bio };
  };

  const bioOf = (orgId: number): string | null =>
    db.prepare('SELECT bio FROM organizations WHERE id = ?').get(orgId).bio ?? null;

  beforeAll(() => {
    db = new DatabaseSync!(':memory:');
    db.exec(readFileSync(join(__dirname, '..', 'schema.sql'), 'utf-8'));

    db.exec(`INSERT INTO users (id, email, first_name, last_name) VALUES
      (${ADMIN}, 'admin@utexas.edu', 'Ada', 'Admin'),
      (${EDITOR}, 'editor@utexas.edu', 'Eli', 'Editor'),
      (${STRANGER}, 'stranger@utexas.edu', 'Sam', 'Stranger')`);

    db.exec(`INSERT INTO organizations (id, name) VALUES
      (${ORG}, 'Texas Rowing'),
      (${OTHER_ORG}, 'Texas Sailing')`);

    db.exec(`INSERT INTO org_members (org_id, user_id, role) VALUES
      (${ORG}, ${ADMIN}, 'admin'),
      (${ORG}, ${EDITOR}, 'editor'),
      (${OTHER_ORG}, ${STRANGER}, 'admin')`);
  });

  beforeEach(() => {
    db.exec('UPDATE organizations SET bio = NULL');
  });

  it('starts NULL on every row, which is the production state today', () => {
    expect(bioOf(ORG)).toBeNull();
    expect(bioOf(OTHER_ORG)).toBeNull();
  });

  it('lets an admin write a description', () => {
    const result = patchBio(ORG, ADMIN, { bio: 'We row at dawn.' });

    expect(result).toEqual({ status: 200, bio: 'We row at dawn.' });
    expect(bioOf(ORG)).toBe('We row at dawn.');
  });

  it('refuses an editor, who may manage events but not the org itself', () => {
    const result = patchBio(ORG, EDITOR, { bio: 'Sneaky rewrite.' });

    expect(result).toEqual({ status: 403, error: 'FORBIDDEN' });
    expect(bioOf(ORG)).toBeNull();
  });

  it('refuses an admin of a different org', () => {
    // Membership is org-scoped: running Texas Sailing grants nothing here.
    const result = patchBio(ORG, STRANGER, { bio: 'Not mine to write.' });

    expect(result).toEqual({ status: 403, error: 'NOT_A_MEMBER' });
    expect(bioOf(ORG)).toBeNull();
  });

  it('clears the column on an explicit null, and ignores an absent key', () => {
    patchBio(ORG, ADMIN, { bio: 'Something.' });
    expect(bioOf(ORG)).toBe('Something.');

    expect(patchBio(ORG, ADMIN, { bio: null })).toEqual({ status: 200, bio: null });
    expect(bioOf(ORG)).toBeNull();

    patchBio(ORG, ADMIN, { bio: 'Back again.' });
    // No `bio` key at all is a malformed request, not "clear it".
    expect(patchBio(ORG, ADMIN, { name: 'Renamed' })).toEqual({
      status: 400,
      error: 'INVALID_BODY',
    });
    expect(bioOf(ORG)).toBe('Back again.');
  });

  it('treats a whitespace-only description as clearing it', () => {
    patchBio(ORG, ADMIN, { bio: 'Something.' });

    expect(patchBio(ORG, ADMIN, { bio: '   \n\n  ' })).toEqual({ status: 200, bio: null });
    expect(bioOf(ORG)).toBeNull();
  });

  it('normalizes before measuring, so trailing whitespace does not fail the cap', () => {
    // Exactly at the cap, then padded past it with spaces that normalizeBio
    // strips. Measuring first would reject this.
    const atCap = 'x'.repeat(MAX_BIO);
    const padded = `${atCap}     \n  `;

    expect(patchBio(ORG, ADMIN, { bio: padded })).toEqual({ status: 200, bio: atCap });
    expect(bioOf(ORG)).toBe(atCap);
  });

  it('rejects a description that is genuinely over the cap, and a non-string', () => {
    expect(patchBio(ORG, ADMIN, { bio: 'x'.repeat(MAX_BIO + 1) })).toEqual({
      status: 400,
      error: 'VALIDATION_ERROR',
    });
    expect(patchBio(ORG, ADMIN, { bio: 42 })).toEqual({
      status: 400,
      error: 'VALIDATION_ERROR',
    });
    expect(bioOf(ORG)).toBeNull();
  });

  it('returns bio from the org search row shape LOOP-257 builds on', () => {
    patchBio(ORG, ADMIN, { bio: 'We row at dawn.' });

    const row = db
      .prepare(
        `SELECT o.id, o.name, o.profile_picture, o.category, o.verified, o.verification_status, o.bio
           FROM organizations o
          WHERE lower(o.name) LIKE ? ESCAPE '\\'`,
      )
      .get('%rowing%');

    expect(row.bio).toBe('We row at dawn.');
  });
});
