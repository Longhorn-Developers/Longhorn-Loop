// Block enforcement (LOOP-180).
//
// Blocking is a safety feature, so it is enforced on the SERVER, on every read
// that could surface one blocked party to the other. A client-side hide is not
// a block: it protects nobody who is running a modified client, an old build,
// or the API directly, which is exactly the population a block exists to
// defend against.
//
// The product rule is MUTUAL invisibility. If A blocks B then A cannot see B
// and B cannot see A — the direction of the row does not narrow who is hidden
// from whom, only who can lift it. Every predicate below therefore tests both
// column orders; a filter that only checked `blocker_user_id = me` would leave
// the blocked party still able to browse the person who blocked them, which is
// the failure mode that matters most.
//
// These are SQL fragments plus their binds rather than a helper that runs a
// query, because the filters have to compose into the WHERE clause of reads
// that are already one round trip (the feed loads 500 candidates in one
// statement). Fetching a block list first and filtering in JavaScript would
// mean a second query on every request and a filter the SQL no longer states.

/**
 * A boolean SQL expression, plus its binds, that is TRUE when `viewerId` and
 * the user identified by `otherColumn` have a block between them in either
 * direction.
 *
 * `otherColumn` is interpolated, never bound — it is a column reference, and
 * SQLite cannot bind one. Every call site passes a literal.
 */
function blockPairExists(otherColumn: string): string {
  return `EXISTS (
            SELECT 1 FROM user_blocks ub
             WHERE (ub.blocker_user_id = ? AND ub.blocked_user_id = ${otherColumn})
                OR (ub.blocked_user_id = ? AND ub.blocker_user_id = ${otherColumn})
          )`;
}

/**
 * `AND NOT EXISTS (...)` for a query that must hide rows authored by someone
 * the viewer has blocked, or who has blocked the viewer.
 *
 * Returns empty SQL and no binds for an anonymous caller: with no viewer there
 * is no pair to test, and appending a clause with an unbindable parameter is
 * how you get a "wrong number of parameter bindings" 500 on the logged-out
 * feed.
 *
 * `authorColumn` defaults to the events alias used by every feed and list
 * query in this codebase. Events with a NULL created_by_user_id are scraped,
 * belong to no user, and are never hidden — NOT EXISTS over a NULL comparison
 * is true, which is the behaviour we want, but it is worth being explicit that
 * blocking a person does not hide HornsLink.
 */
export function blockedAuthorFilter(
  viewerId: number | null,
  authorColumn = 'e.created_by_user_id',
): { sql: string; params: unknown[] } {
  if (viewerId === null) return { sql: '', params: [] };
  return {
    sql: ` AND NOT ${blockPairExists(authorColumn)}`,
    params: [viewerId, viewerId],
  };
}

/**
 * The same predicate for a query whose rows ARE users rather than events —
 * an attendee list, a follower list.
 */
export function blockedUserFilter(
  viewerId: number | null,
  userColumn: string,
): { sql: string; params: unknown[] } {
  if (viewerId === null) return { sql: '', params: [] };
  return {
    sql: ` AND NOT ${blockPairExists(userColumn)}`,
    params: [viewerId, viewerId],
  };
}

/**
 * Is there a block between these two users, in either direction?
 *
 * The single-pair check behind "this profile does not exist" and "you cannot
 * follow this person". Returns false for a self-comparison so a user's own
 * profile can never be hidden from them by a malformed row.
 */
export async function isBlockedBetween(
  db: D1Database,
  a: number,
  b: number,
): Promise<{ blocked: boolean; iBlockedThem: boolean; theyBlockedMe: boolean }> {
  if (a === b) return { blocked: false, iBlockedThem: false, theyBlockedMe: false };

  const row = await db
    .prepare(
      `SELECT
         MAX(CASE WHEN blocker_user_id = ?1 THEN 1 ELSE 0 END) AS i_blocked,
         MAX(CASE WHEN blocker_user_id = ?2 THEN 1 ELSE 0 END) AS they_blocked
       FROM user_blocks
       WHERE (blocker_user_id = ?1 AND blocked_user_id = ?2)
          OR (blocker_user_id = ?2 AND blocked_user_id = ?1)`,
    )
    .bind(a, b)
    .first();

  const iBlockedThem = Number(row?.i_blocked ?? 0) === 1;
  const theyBlockedMe = Number(row?.they_blocked ?? 0) === 1;
  return { blocked: iBlockedThem || theyBlockedMe, iBlockedThem, theyBlockedMe };
}

/**
 * The statements that make a block take effect, in the order they must run.
 *
 * Exported as data so the test suite can execute the shipped SQL against a
 * real database instead of re-typing it — the same reason
 * lib/accountDeletion.ts is shaped this way. Handed to D1's batch(), which
 * wraps them in a transaction: a block row written without the follow rows
 * being dropped would leave the blocked party still following, still counted,
 * and still receiving whatever follows drive later.
 */
export function blockStatements(
  blockerId: number,
  blockedId: number,
): { sql: string; binds: unknown[] }[] {
  return [
    {
      sql: `INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (?, ?)
            ON CONFLICT DO NOTHING`,
      binds: [blockerId, blockedId],
    },
    // Both directions. Dropping only the blocker's follow would leave the
    // blocked party still following someone who can no longer see them, and
    // still contributing to their follower count.
    {
      sql: `DELETE FROM user_follows
             WHERE (follower_user_id = ? AND followed_user_id = ?)
                OR (follower_user_id = ? AND followed_user_id = ?)`,
      binds: [blockerId, blockedId, blockedId, blockerId],
    },
  ];
}
