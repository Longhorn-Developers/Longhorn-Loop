// Account deletion cascade (LOOP-131).
//
// The SQL lives here rather than inline in routes/users.worker.ts for one
// reason: correctness here is only provable against a real database. A
// forgotten table leaves a dangling row that resurfaces as somebody else's
// data the next time an id is reused; a forgotten counter decrement leaves
// events.rsvp_count reporting attendees who no longer exist. Neither shows up
// in a type check. Because this module imports nothing from the Worker
// runtime — every export is a plain string or a plain object — the test suite
// can execute the exact statements that ship against SQLite built from
// schema.sql, instead of a hand-copied paraphrase of them that drifts.
//
// SCOPE. This is a HARD delete, as the ticket specifies: the users row and
// everything hanging off it goes. Two things deliberately survive, both
// because destroying them would damage somebody who is not the departing user:
//
//   - feedback rows (user_id set to NULL). The schema already declares
//     ON DELETE SET NULL and says why: a bug report must not vanish the moment
//     the reporter leaves, which is exactly when the team still needs it.
//   - events the user created. See eventDisposition below.
//
// Not covered here, on purpose: purging the user from analytics that are
// derived rather than stored (org engagement series, feed scores) — those are
// recomputed from the tables this module empties, so they correct themselves.

/** A single prepared statement: SQL plus its positional binds, in order. */
export interface SqlStatement {
  sql: string;
  binds: unknown[];
}

/**
 * What happens to an org the departing user administers.
 *
 * Read the org's membership BEFORE the cascade runs (see ORG_SUCCESSION_QUERY)
 * and hand the rows to accountDeletionStatements, which turns each one into
 * the statement that resolves it.
 */
export interface OrgAdminSuccession {
  orgId: number;
  /** Admins of this org OTHER than the departing user. */
  otherAdmins: number;
  /** Longest-serving editor, or null when the user is the only member left. */
  successorUserId: number | null;
}

/**
 * Every org the departing user is an admin of, with the two facts needed to
 * decide the org's fate: how many admins would remain, and who has been an
 * editor longest.
 *
 * Binds: [userId, userId, userId] — SQLite numbers anonymous parameters by
 * their order in the SQL text, and the two correlated subqueries are written
 * before the outer WHERE.
 *
 * Ties on created_at break by user_id so the choice of successor is
 * deterministic; two people invited in the same second must not produce a
 * different admin depending on row order.
 */
export const ORG_SUCCESSION_QUERY = `
  SELECT
    m.org_id AS org_id,
    (SELECT COUNT(*) FROM org_members oa
      WHERE oa.org_id = m.org_id AND oa.role = 'admin' AND oa.user_id <> ?) AS other_admins,
    (SELECT oe.user_id FROM org_members oe
      WHERE oe.org_id = m.org_id AND oe.role = 'editor' AND oe.user_id <> ?
      ORDER BY oe.created_at ASC, oe.user_id ASC
      LIMIT 1) AS successor_user_id
  FROM org_members m
  WHERE m.user_id = ? AND m.role = 'admin'
`;

/**
 * Namespaced key for the delete-confirmation code in verification_codes.
 *
 * Same trick as orgVerificationKey in routes/orgs.worker.ts, for the same
 * reason and one sharper one. The table is keyed by email alone, so writing
 * the delete code under the bare address would (a) clobber a login code the
 * user requested seconds earlier and (b) — much worse — let a code that was
 * emailed for *signing in* satisfy an irreversible account deletion. The
 * prefix keeps the two namespaces from ever satisfying each other.
 */
export function deleteAccountCodeKey(email: string): string {
  return `delete:${email.trim().toLowerCase()}`;
}

/**
 * SHA-256 of the code, matching auth.worker.ts and orgs.worker.ts.
 *
 * WHY the duplication: this is the third copy. Consolidating it means picking
 * one home for a helper the Worker, the org flow and this all reach into, and
 * that refactor belongs with the fix rather than ahead of it.
 *
 * KNOWN WEAKNESS, tracked as LOOP-238: the digest is unsalted, so a six-digit
 * code has only a million preimages and the whole table is rainbow-tableable
 * by anyone who can read it. Deliberately NOT fixed here — changing the scheme
 * invalidates every code in flight across login and org verification, which is
 * its own migration and its own ticket. This flow inherits the weakness rather
 * than adding to it.
 */
export async function hashCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const DELETE_CODE_LENGTH = 6;
export const DELETE_CODE_TTL_MS = 10 * 60 * 1000;
export const DELETE_CODE_RESEND_COOLDOWN_MS = 60 * 1000;
export const DELETE_CODE_MAX_ATTEMPTS = 5;

/**
 * The subset of a verification_codes row the guard below actually reads.
 *
 * Fields are optional-unknown so a raw D1 row (Record<string, unknown>) can be
 * passed straight in; the guard coerces and never trusts the shape.
 */
export interface DeletionCodeRecord {
  code_hash?: unknown;
  expires_at?: unknown;
  attempts?: unknown;
}

export type DeletionCodeCheck =
  | { ok: true }
  | {
      ok: false;
      error: 'NO_PENDING_DELETION' | 'CODE_EXPIRED' | 'TOO_MANY_ATTEMPTS' | 'INVALID_CODE';
      message: string;
      status: 400 | 422 | 429;
      /** Whether the stored row is now spent and should be deleted. */
      voids: boolean;
      /** Whether this was a wrong guess and should cost an attempt. */
      countsAsAttempt: boolean;
    };

/**
 * Decides whether a submitted code may proceed to the cascade.
 *
 * Pulled out of the route as a pure function for one reason: "a wrong code
 * deletes nothing" is the single most important property of this feature, and
 * a property that only holds because of the control flow around an `if` is
 * hard to test and easy to break with a refactor. Here it is one assertion.
 *
 * Order matters — expiry is checked before attempts so a stale row reports the
 * honest reason, and the hash comparison happens last so an expired or
 * exhausted request never even reveals whether the digits were right.
 */
export function checkDeletionCode(
  record: DeletionCodeRecord | null,
  providedHash: string,
  now: number,
): DeletionCodeCheck {
  if (!record) {
    return {
      ok: false,
      error: 'NO_PENDING_DELETION',
      message: 'That request expired. Start again from Settings.',
      status: 400,
      voids: false,
      countsAsAttempt: false,
    };
  }

  if (Number(record.expires_at) < now) {
    return {
      ok: false,
      error: 'CODE_EXPIRED',
      message: 'That code has expired. Request a new one.',
      status: 400,
      voids: true,
      countsAsAttempt: false,
    };
  }

  if (Number(record.attempts) >= DELETE_CODE_MAX_ATTEMPTS) {
    return {
      ok: false,
      error: 'TOO_MANY_ATTEMPTS',
      message: 'Too many tries. Start again from Settings.',
      status: 429,
      voids: true,
      countsAsAttempt: false,
    };
  }

  if (record.code_hash !== providedHash) {
    return {
      ok: false,
      error: 'INVALID_CODE',
      message: 'That code isn’t right. Check it and try again.',
      status: 422,
      voids: false,
      countsAsAttempt: true,
    };
  }

  return { ok: true };
}

/** Escape LIKE wildcards so an address containing _ or % can't over-match. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Events the departing user created do NOT get deleted.
 *
 * An event is a thing other people saved, RSVP'd to and planned around;
 * deleting the author should not delete their evening. So:
 *
 *   - hosted by an org  -> drop the user reference, leave the event with the
 *     org. The org still owns it and its editors can still manage it.
 *   - hosted by nobody  -> there is no one left who can edit or cancel it, so
 *     archive it. is_archived is the same soft-delete the cleanup job (LOOP-150)
 *     uses, which means the event drops out of every feed but stays readable in
 *     the history of the people who attended (LOOP-200) rather than blanking
 *     their past.
 *
 * archived_at is COALESCE'd so re-running this can't rewrite the timestamp of
 * an event the cleanup job already archived.
 */
const eventDisposition = (userId: number): SqlStatement[] => [
  {
    sql: `UPDATE events SET created_by_user_id = NULL, updated_at = datetime('now')
          WHERE created_by_user_id = ? AND host_organization_id IS NOT NULL`,
    binds: [userId],
  },
  {
    sql: `UPDATE events
             SET created_by_user_id = NULL,
                 is_archived = 1,
                 archived_at = COALESCE(archived_at, datetime('now')),
                 updated_at = datetime('now')
           WHERE created_by_user_id = ? AND host_organization_id IS NULL`,
    binds: [userId],
  },
];

/**
 * The counters on `events` are denormalized (Phase 1) and maintained inline by
 * the save/rsvp/view endpoints, so nothing recomputes them. Removing a user's
 * rows without decrementing leaves an event advertising RSVPs from people who
 * no longer exist — and the feed ranks on exactly these numbers, so the drift
 * is not cosmetic.
 *
 * MUST run before the corresponding DELETEs: each one counts the rows it is
 * about to compensate for. Clamped at 0 so a counter that has already drifted
 * negative for some other reason can't be driven further down.
 */
const COUNTER_COMPENSATIONS: [string, string][] = [
  ['rsvp_count', 'event_rsvps'],
  ['save_count', 'saved_events'],
  ['view_count', 'event_views'],
];

/** Tables emptied outright: rows that are meaningless without their user. */
const USER_OWNED_TABLES = [
  'event_rsvps',
  'saved_events',
  'event_views',
  'event_reports',
  'notifications',
  'user_socials',
  'user_majors',
  'user_tags',
  'user_settings',
  'org_followers',
  'org_members',
];

/**
 * The full cascade, in dependency order, as one list to hand to D1's batch()
 * — which wraps it in a transaction, so a failure part-way through cannot
 * leave a half-deleted account behind.
 *
 * Order is load-bearing in three places:
 *   1. counter compensation reads the rows it compensates for, so it precedes
 *      the deletes;
 *   2. org succession promotes from org_members, so it precedes emptying it;
 *   3. the users row goes last.
 *
 * Every child row is removed EXPLICITLY rather than leaning on ON DELETE
 * CASCADE, because D1 does not guarantee PRAGMA foreign_keys is on and the
 * counter compensation has to happen alongside the deletes anyway. Explicit
 * also means the two tables whose declared behaviour is SET NULL (feedback,
 * org_invites.invited_by) are stated here rather than assumed.
 */
export function accountDeletionStatements(
  userId: number,
  email: string,
  orgSuccession: OrgAdminSuccession[] = [],
): SqlStatement[] {
  const normalizedEmail = email.trim().toLowerCase();
  const statements: SqlStatement[] = [];

  for (const [counter, table] of COUNTER_COMPENSATIONS) {
    statements.push({
      sql: `UPDATE events SET ${counter} = MAX(${counter} - 1, 0)
            WHERE id IN (SELECT event_id FROM ${table} WHERE user_id = ?)`,
      binds: [userId],
    });
  }

  // Orgs where this user is the last admin. Handled before org_members is
  // emptied, and before the users row goes, so the promotion has something to
  // promote.
  for (const org of orgSuccession) {
    if (org.otherAdmins > 0) continue;

    if (org.successorUserId !== null) {
      // Promote rather than block: an account deletion the user cannot
      // complete without first chasing down a co-admin is not a deletion.
      statements.push({
        sql: `UPDATE org_members SET role = 'admin' WHERE org_id = ? AND user_id = ?`,
        binds: [org.orgId, org.successorUserId],
      });
    } else {
      // Nobody left to promote. Return the org to unclaimed instead of
      // leaving it flagged as claimed-and-verified with zero members — an
      // unrecoverable state through the UI. Unclaimed means the next person
      // can take it through the president-email flow (LOOP-185). The
      // organizations row itself stays: it is scraped from HornsLink and
      // exists independently of anyone's account.
      statements.push({
        sql: `UPDATE organizations
                 SET verified = 0,
                     verification_status = 'unverified',
                     updated_at = datetime('now')
               WHERE id = ?`,
        binds: [org.orgId],
      });
    }
  }

  statements.push(...eventDisposition(userId));

  // Declared ON DELETE SET NULL in schema.sql; restated so the outcome does
  // not depend on the foreign_keys pragma.
  statements.push({ sql: 'UPDATE feedback SET user_id = NULL WHERE user_id = ?', binds: [userId] });
  statements.push({
    sql: 'UPDATE org_invites SET invited_by = NULL WHERE invited_by = ?',
    binds: [userId],
  });

  for (const table of USER_OWNED_TABLES) {
    statements.push({ sql: `DELETE FROM ${table} WHERE user_id = ?`, binds: [userId] });
  }

  // Follows are directional, and both directions are this user's data: the
  // people they followed AND the people who followed them.
  statements.push({
    sql: 'DELETE FROM user_follows WHERE follower_user_id = ? OR followed_user_id = ?',
    binds: [userId, userId],
  });

  // Invites are keyed by email, not user_id — they are written before the
  // invitee necessarily has an account (see schema.sql) — so a pending invite
  // is only reachable by address.
  statements.push({
    sql: 'DELETE FROM org_invites WHERE LOWER(email) = ?',
    binds: [normalizedEmail],
  });

  // Every namespaced code for this address: the login/2FA code, this flow's
  // own delete code, and any org-claim code (org:<id>:<email>). Leaving a live
  // code behind would let it be redeemed against a recycled address.
  statements.push({
    sql: `DELETE FROM verification_codes
           WHERE email = ? OR email = ? OR email LIKE ? ESCAPE '\\'`,
    binds: [
      normalizedEmail,
      deleteAccountCodeKey(normalizedEmail),
      `org:%:${escapeLike(normalizedEmail)}`,
    ],
  });

  statements.push({ sql: 'DELETE FROM users WHERE id = ?', binds: [userId] });

  return statements;
}
