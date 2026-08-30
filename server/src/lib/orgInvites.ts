// Turns a pending org invite into actual membership.
//
// THE GAP THIS CLOSES. POST /orgs/:id/invites writes an org_invites row with
// status 'pending' and emails the person. Nothing ever read that row back.
// There was code to CREATE an invite and code to REVOKE one, and no code
// anywhere that accepted one -- so an invited student signed in, found no
// organisation, and the admin saw an invite sitting at 'pending' forever with
// no way to tell whether it had been received.
//
// WHY EMAIL IS THE JOIN. An invite is addressed before the person exists in
// our database: an admin types an email, and that address may belong to
// somebody who has never opened the app. So the invite cannot hold a user id,
// and membership can only be granted once an account with that address turns
// up. Email is the only thing the two sides share.
//
// That makes the email comparison load-bearing, which is why it is normalised
// on both sides rather than compared as typed. An admin inviting
// "Student@my.utexas.edu" and a student signing in as
// "student@my.utexas.edu" are the same person, and a case-sensitive compare
// silently isn't.

/** Membership levels an invite can grant. Mirrors the org_invites CHECK. */
export type OrgRole = 'admin' | 'editor';

export interface RedeemedInvite {
  orgId: number;
  orgName: string;
  role: OrgRole;
}

/**
 * Accept every pending, unexpired invite addressed to this user's email.
 *
 * Returns what was granted, so a caller can tell the user which organisations
 * they just joined rather than leaving them to notice.
 *
 * SAFE TO CALL ON EVERY REQUEST. The common case is one indexed SELECT that
 * returns nothing (idx_org_invites_email), and no writes happen unless there
 * is something to redeem. That matters because this has to run somewhere a
 * signed-in client reaches regularly, not only at sign-up: an invite is very
 * often sent to somebody who ALREADY has an account, and that person has no
 * reason to verify their email ever again.
 */
export async function redeemPendingOrgInvites(
  db: D1Database,
  userId: number,
  email: string,
): Promise<RedeemedInvite[]> {
  const normalized = email.trim().toLowerCase();

  // Joined to organizations so the notification can name the org. Without the
  // name the only thing we could tell someone is that they joined "an
  // organisation", which is not worth a notification.
  const { results } = await db
    .prepare(
      `SELECT i.id, i.org_id, i.role, o.name AS org_name, o.profile_picture
         FROM org_invites i
         JOIN organizations o ON o.id = i.org_id
        WHERE LOWER(i.email) = ?
          AND i.status = 'pending'
          AND i.expires_at > datetime('now')`,
    )
    .bind(normalized)
    .all<{
      id: number;
      org_id: number;
      role: OrgRole;
      org_name: string;
      profile_picture: string | null;
    }>();

  const pending = results ?? [];
  if (pending.length === 0) return [];

  const statements = [];
  for (const invite of pending) {
    statements.push(
      // A membership that already exists wins. Someone can be invited to an
      // org they are already in -- an admin who cannot see the member list, or
      // a second invite sent before the first was noticed -- and a plain
      // INSERT would fail the whole batch, leaving every OTHER invite in it
      // unredeemed too. DO NOTHING also means an invite can never quietly
      // DEMOTE an existing admin to editor.
      db
        .prepare(
          `INSERT INTO org_members (org_id, user_id, role)
           VALUES (?, ?, ?)
           ON CONFLICT(org_id, user_id) DO NOTHING`,
        )
        .bind(invite.org_id, userId, invite.role),
    );
    statements.push(
      db
        .prepare(`UPDATE org_invites SET status = 'accepted' WHERE id = ?`)
        .bind(invite.id),
    );
    // TELL THEM. Membership that appears silently is indistinguishable from a
    // bug: the org console simply exists on your next visit, with no
    // explanation of why or who added you. This is also the only record the
    // invited person has that it happened at all -- the invite email is the
    // admin's side of the conversation, not ours.
    statements.push(
      db
        .prepare(
          `INSERT INTO notifications (user_id, type, title, subtitle, avatar_url)
           VALUES (?, 'org_invite', ?, ?, ?)`,
        )
        .bind(
          userId,
          `You joined ${invite.org_name}`,
          invite.role === 'admin'
            ? 'You can manage this organization and its events.'
            : 'You can post and edit events for this organization.',
          invite.profile_picture,
        ),
    );
  }

  // One batch, so membership and the status change land together. Split apart,
  // a failure between them leaves either an invite marked accepted that
  // granted nothing, or a member whose invite still reads pending and can be
  // "revoked" by an admin who thinks it never arrived.
  await db.batch(statements);

  return pending.map((invite) => ({
    orgId: invite.org_id,
    orgName: invite.org_name,
    role: invite.role,
  }));
}
