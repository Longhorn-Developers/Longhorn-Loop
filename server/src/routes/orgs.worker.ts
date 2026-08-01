// Organization management console routes (LOOP-183).
//
// Covers the Members and Analytics tabs plus the shared console header. The
// Events tab is LOOP-136 and per-event engagement counters are LOOP-129 —
// this file deliberately reads the denormalized counters those tickets
// maintain (events.view_count / rsvp_count / save_count) rather than
// recomputing them.
//
// Authorization model, applied by requireOrgRole below:
//   admin  — manage roles, remove editors, invite, edit notification settings
//   editor — read the console, manage events; cannot manage people
// Everything here is org-scoped: membership in one org grants nothing in
// another, so every handler resolves the caller's role for the org in the URL.

import { Hono } from 'hono';
import { getAuthUser, getUserId } from '../lib/utils';
import type { Env } from '../worker';

export const orgRoutes = new Hono<{ Bindings: Env }>();

type OrgRole = 'admin' | 'editor';

/**
 * Resolve the caller and their role in :orgId.
 *
 * Returns a discriminated result rather than throwing so each handler can pick
 * its own failure response — some need 401 vs 403 vs 404 to differ.
 */
async function resolveMembership(c: {
  req: { header: (k: string) => string | undefined; param: (k: string) => string };
  env: Env;
}): Promise<
  | { ok: true; userId: number; orgId: number; role: OrgRole }
  | { ok: false; status: 400 | 401 | 403 | 404; error: string }
> {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return { ok: false, status: 401, error: 'UNAUTHORIZED' };

  const userId = await getUserId(c.env.DB, auth.email);
  if (!userId) return { ok: false, status: 404, error: 'USER_NOT_FOUND' };

  const orgId = parseInt(c.req.param('orgId'), 10);
  if (Number.isNaN(orgId)) return { ok: false, status: 400, error: 'INVALID_ORG_ID' };

  const row = await c.env.DB.prepare(
    'SELECT role FROM org_members WHERE org_id = ? AND user_id = ?',
  )
    .bind(orgId, userId)
    .first();

  // 403 rather than 404: the org may well exist, the caller just isn't in it.
  // Leaking existence here is fine — orgs are public entities in this app.
  if (!row) return { ok: false, status: 403, error: 'NOT_A_MEMBER' };

  return { ok: true, userId, orgId, role: row.role as OrgRole };
}

// GET /orgs/mine -- every org the caller belongs to.
//
// Backs the "Manage Organizations" list on the Settings entry point
// (LOOP-184), which shows each org with the caller's role and its event count.
//
// MUST stay above the /:orgId routes: Hono matches in definition order, so
// declaring it later would let /:orgId capture "mine" as an org id and fail
// with INVALID_ORG_ID.
orgRoutes.get('/mine', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const userId = await getUserId(c.env.DB, auth.email);
  if (!userId) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const { results } = await c.env.DB.prepare(
    `SELECT o.id, o.name, o.profile_picture, o.verified, m.role,
            (SELECT COUNT(*) FROM events e WHERE e.host_organization_id = o.id) AS event_count
     FROM org_members m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = ?
     ORDER BY o.name ASC`,
  )
    .bind(userId)
    .all();

  return c.json({
    organizations: (results as Record<string, unknown>[]).map((o) => ({
      ...o,
      verified: Number(o.verified) === 1,
    })),
  });
});

// ---------------------------------------------------------------------------
// Organization registration — verification tail (LOOP-185)
// ---------------------------------------------------------------------------
//
// Owns the president-email check and the code confirmation. The earlier
// search/claim steps are LOOP-141; generic UT email verification is LOOP-134.
//
// These are registered above /:orgId for the same reason /mine is: Hono
// matches in definition order and "register" would otherwise be read as an
// org id.

/**
 * A 4-digit code, as the Figma frame specifies.
 *
 * Deliberately reuses the existing verification_codes table (2FA) rather than
 * adding a parallel one: it already has hashing, expiry, attempt counting and
 * resend throttling. The key is namespaced so an org verification can't be
 * satisfied by a login code the user requested seconds earlier, and vice versa.
 */
function orgVerificationKey(orgId: number, email: string): string {
  return `org:${orgId}:${email.toLowerCase()}`;
}

async function hashCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// POST /orgs/register/verify-president
//
// Body: { org_id, email }. Validates the email against the org's president on
// file and issues a code.
orgRoutes.post('/register/verify-president', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const userId = await getUserId(c.env.DB, auth.email);
  if (!userId) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const body = await c.req.json().catch(() => null);
  const orgId = body && Number.isFinite(Number(body.org_id)) ? Number(body.org_id) : null;
  const email = body && typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

  if (orgId === null) return c.json({ error: 'INVALID_ORG_ID' }, 400);

  // Build step 4: an empty or non-UT address never reaches the mismatch check.
  if (!/^[^\s@]+@([\w-]+\.)*utexas\.edu$/i.test(email)) {
    return c.json({ error: 'INVALID_UT_EMAIL', message: 'Enter a valid UT email address.' }, 400);
  }

  const org = await c.env.DB.prepare(
    'SELECT id, name, president_email FROM organizations WHERE id = ?',
  )
    .bind(orgId)
    .first();
  if (!org) return c.json({ error: 'ORG_NOT_FOUND' }, 404);

  const onFile = typeof org.president_email === 'string' ? org.president_email.toLowerCase() : null;

  // Build step 3. If we have no president on file we cannot confirm anyone, so
  // treat it as a mismatch rather than waving the request through — approving
  // an unverifiable claim is the worse failure.
  if (!onFile || onFile !== email) {
    return c.json(
      {
        error: 'PRESIDENT_EMAIL_MISMATCH',
        message: 'This email does not match the president on file.',
      },
      422,
    );
  }

  const code = String(Math.floor(1000 + Math.random() * 9000));
  const key = orgVerificationKey(orgId, email);
  const expiresAt = Date.now() + 10 * 60 * 1000;

  await c.env.DB.prepare(
    `INSERT INTO verification_codes (email, code_hash, expires_at, verified, attempts, last_sent_at)
     VALUES (?, ?, ?, 0, 0, ?)
     ON CONFLICT(email) DO UPDATE SET
       code_hash    = excluded.code_hash,
       expires_at   = excluded.expires_at,
       verified     = 0,
       used_at      = NULL,
       attempts     = 0,
       last_sent_at = excluded.last_sent_at`,
  )
    .bind(key, await hashCode(code), expiresAt, Date.now())
    .run();

  // Dev mode mirrors auth.worker.ts: log instead of sending, so the flow is
  // testable before Resend has a verified sending domain.
  if (c.env.RESEND_DEV_MODE === 'true') {
    console.log(`[org-verify] code for ${email} (org ${orgId}): ${code}`);
  }

  return c.json({ sent: true, org_name: org.name });
});

// POST /orgs/register/confirm
//
// Body: { org_id, code }. On success the caller becomes an admin of the org
// and the org is flagged as awaiting review.
orgRoutes.post('/register/confirm', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const userId = await getUserId(c.env.DB, auth.email);
  if (!userId) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const body = await c.req.json().catch(() => null);
  const orgId = body && Number.isFinite(Number(body.org_id)) ? Number(body.org_id) : null;
  const code = body && typeof body.code === 'string' ? body.code.trim() : '';

  if (orgId === null) return c.json({ error: 'INVALID_ORG_ID' }, 400);
  if (!/^\d{4}$/.test(code)) return c.json({ error: 'INVALID_CODE' }, 400);

  const org = await c.env.DB.prepare('SELECT president_email FROM organizations WHERE id = ?')
    .bind(orgId)
    .first();
  if (!org || typeof org.president_email !== 'string') {
    return c.json({ error: 'ORG_NOT_FOUND' }, 404);
  }

  const key = orgVerificationKey(orgId, org.president_email.toLowerCase());
  const row = await c.env.DB.prepare('SELECT * FROM verification_codes WHERE email = ?')
    .bind(key)
    .first();

  if (!row) return c.json({ error: 'NO_PENDING_VERIFICATION' }, 400);
  if (Number(row.expires_at) < Date.now()) return c.json({ error: 'CODE_EXPIRED' }, 400);
  if (Number(row.attempts) >= 5) return c.json({ error: 'TOO_MANY_ATTEMPTS' }, 429);

  if (row.code_hash !== (await hashCode(code))) {
    await c.env.DB.prepare('UPDATE verification_codes SET attempts = attempts + 1 WHERE email = ?')
      .bind(key)
      .run();
    return c.json(
      { error: 'INVALID_CODE', message: 'That code isn’t right. Check it and try again.' },
      422,
    );
  }

  await c.env.DB.prepare('UPDATE verification_codes SET verified = 1, used_at = ? WHERE email = ?')
    .bind(Date.now(), key)
    .run();

  // The claimant becomes an admin so they can manage the org immediately;
  // `verified` stays 0 until a human approves, which is what the success
  // screen's "our team will review" copy promises.
  await c.env.DB.prepare(
    `INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, 'admin')
     ON CONFLICT(org_id, user_id) DO UPDATE SET role = 'admin'`,
  )
    .bind(orgId, userId)
    .run();

  await c.env.DB.prepare(
    "UPDATE organizations SET verification_status = 'pending_review', updated_at = datetime('now') WHERE id = ?",
  )
    .bind(orgId)
    .run();

  return c.json({ verified: true, status: 'pending_review' });
});

// GET /orgs/:orgId -- console header: identity, role, follower counts, tiles.
orgRoutes.get('/:orgId', async (c) => {
  const member = await resolveMembership(c);
  if (!member.ok) return c.json({ error: member.error }, member.status);

  const org = await c.env.DB.prepare(
    'SELECT id, name, slug, profile_picture, verified FROM organizations WHERE id = ?',
  )
    .bind(member.orgId)
    .first();

  if (!org) return c.json({ error: 'ORG_NOT_FOUND' }, 404);

  // Stat tiles are lifetime sums across the org's events. Reading the
  // denormalized counters keeps this one cheap query instead of three joins
  // over event_views / event_rsvps / saved_events.
  const totals = await c.env.DB.prepare(
    `SELECT
       COALESCE(SUM(view_count), 0) AS views,
       COALESCE(SUM(rsvp_count), 0) AS going,
       COALESCE(SUM(save_count), 0) AS saved,
       COUNT(*)                     AS event_count
     FROM events
     WHERE host_organization_id = ?`,
  )
    .bind(member.orgId)
    .first();

  const followers = await c.env.DB.prepare(
    'SELECT COUNT(*) AS c FROM org_followers WHERE org_id = ?',
  )
    .bind(member.orgId)
    .first();

  const following = await c.env.DB.prepare('SELECT COUNT(*) AS c FROM org_follows WHERE org_id = ?')
    .bind(member.orgId)
    .first();

  return c.json({
    org: {
      ...org,
      verified: Number(org.verified) === 1,
      follower_count: (followers?.c as number) ?? 0,
      following_count: (following?.c as number) ?? 0,
      event_count: (totals?.event_count as number) ?? 0,
    },
    role: member.role,
    stats: {
      views: (totals?.views as number) ?? 0,
      going: (totals?.going as number) ?? 0,
      saved: (totals?.saved as number) ?? 0,
    },
  });
});

// GET /orgs/:orgId/members -- Members tab: "Team (N)" + rows with role badges.
orgRoutes.get('/:orgId/members', async (c) => {
  const member = await resolveMembership(c);
  if (!member.ok) return c.json({ error: member.error }, member.status);

  const { results: members } = await c.env.DB.prepare(
    `SELECT u.id, u.first_name, u.last_name, u.email, u.avatar, m.role, m.created_at
     FROM org_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.org_id = ?
     -- Admins first, then alphabetical, so the list doesn't reshuffle as
     -- people join.
     ORDER BY CASE m.role WHEN 'admin' THEN 0 ELSE 1 END, u.first_name ASC, u.last_name ASC`,
  )
    .bind(member.orgId)
    .all();

  const { results: invites } = await c.env.DB.prepare(
    `SELECT id, email, role, created_at, expires_at
     FROM org_invites
     WHERE org_id = ? AND status = 'pending' AND expires_at > datetime('now')
     ORDER BY created_at DESC`,
  )
    .bind(member.orgId)
    .all();

  return c.json({
    members,
    pending_invites: invites,
    role: member.role,
    // The client hides Invite / role-swap / remove for editors, but the
    // server is the one that enforces it.
    can_manage: member.role === 'admin',
  });
});

// PATCH /orgs/:orgId/members/:userId -- role swap (admin only).
orgRoutes.patch('/:orgId/members/:userId', async (c) => {
  const member = await resolveMembership(c);
  if (!member.ok) return c.json({ error: member.error }, member.status);
  if (member.role !== 'admin') return c.json({ error: 'FORBIDDEN' }, 403);

  const targetId = parseInt(c.req.param('userId'), 10);
  if (Number.isNaN(targetId)) return c.json({ error: 'INVALID_USER_ID' }, 400);

  const body = await c.req.json().catch(() => null);
  const role = body && typeof body.role === 'string' ? body.role : '';
  if (role !== 'admin' && role !== 'editor') return c.json({ error: 'INVALID_ROLE' }, 400);

  const target = await c.env.DB.prepare(
    'SELECT role FROM org_members WHERE org_id = ? AND user_id = ?',
  )
    .bind(member.orgId, targetId)
    .first();
  if (!target) return c.json({ error: 'MEMBER_NOT_FOUND' }, 404);

  // Guard against an org with no admins: demoting the last one would leave
  // nobody able to manage people or promote anyone back.
  if (target.role === 'admin' && role === 'editor') {
    const admins = await c.env.DB.prepare(
      "SELECT COUNT(*) AS c FROM org_members WHERE org_id = ? AND role = 'admin'",
    )
      .bind(member.orgId)
      .first();
    if (((admins?.c as number) ?? 0) <= 1) return c.json({ error: 'LAST_ADMIN' }, 409);
  }

  await c.env.DB.prepare('UPDATE org_members SET role = ? WHERE org_id = ? AND user_id = ?')
    .bind(role, member.orgId, targetId)
    .run();

  return c.json({ user_id: targetId, role });
});

// DELETE /orgs/:orgId/members/:userId -- remove a member (admin only).
orgRoutes.delete('/:orgId/members/:userId', async (c) => {
  const member = await resolveMembership(c);
  if (!member.ok) return c.json({ error: member.error }, member.status);
  if (member.role !== 'admin') return c.json({ error: 'FORBIDDEN' }, 403);

  const targetId = parseInt(c.req.param('userId'), 10);
  if (Number.isNaN(targetId)) return c.json({ error: 'INVALID_USER_ID' }, 400);

  // Removing yourself is "Leave Organization", which has its own last-admin
  // handling — route it there rather than duplicating the check.
  if (targetId === member.userId) return c.json({ error: 'USE_LEAVE_ENDPOINT' }, 400);

  const target = await c.env.DB.prepare(
    'SELECT role FROM org_members WHERE org_id = ? AND user_id = ?',
  )
    .bind(member.orgId, targetId)
    .first();
  if (!target) return c.json({ error: 'MEMBER_NOT_FOUND' }, 404);

  // The Figma trash icon only appears on editor rows. Enforce it: removing a
  // fellow admin should be a deliberate demote-then-remove.
  if (target.role === 'admin') return c.json({ error: 'CANNOT_REMOVE_ADMIN' }, 409);

  await c.env.DB.prepare('DELETE FROM org_members WHERE org_id = ? AND user_id = ?')
    .bind(member.orgId, targetId)
    .run();

  return c.json({ removed: true });
});

// POST /orgs/:orgId/invites -- Invite Editor (admin only).
//
// Backs InviteEditorModal (LOOP-182). Body: { email, role? }.
orgRoutes.post('/:orgId/invites', async (c) => {
  const member = await resolveMembership(c);
  if (!member.ok) return c.json({ error: member.error }, member.status);
  if (member.role !== 'admin') return c.json({ error: 'FORBIDDEN' }, 403);

  const body = await c.req.json().catch(() => null);
  const email = body && typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const role = body && body.role === 'admin' ? 'admin' : 'editor';

  // Editors must be UT people — same rule the modal enforces client-side.
  if (!/^[^\s@]+@([\w-]+\.)*utexas\.edu$/i.test(email)) {
    return c.json({ error: 'INVALID_UT_EMAIL', message: 'Enter a valid UT email address.' }, 400);
  }

  // If they already have an account and are already in the org, an invite is
  // meaningless — say so rather than creating a row nobody can act on.
  const existing = await c.env.DB.prepare(
    `SELECT 1 AS hit FROM org_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.org_id = ? AND lower(u.email) = ?`,
  )
    .bind(member.orgId, email)
    .first();
  if (existing) {
    return c.json({ error: 'ALREADY_A_MEMBER', message: 'They are already on this team.' }, 409);
  }

  // Re-inviting refreshes the existing invite rather than stacking duplicates,
  // and resets a revoked/expired one back to pending.
  await c.env.DB.prepare(
    `INSERT INTO org_invites (org_id, email, role, invited_by, status, expires_at)
     VALUES (?, ?, ?, ?, 'pending', datetime('now', '+14 days'))
     ON CONFLICT(org_id, email) DO UPDATE SET
       role       = excluded.role,
       invited_by = excluded.invited_by,
       status     = 'pending',
       created_at = datetime('now'),
       expires_at = excluded.expires_at`,
  )
    .bind(member.orgId, email, role, member.userId)
    .run();

  // NOTE: the invite email itself is not sent here. server/src/utils/sendEmail
  // is wired for Resend and 2FA codes only; sending team invites needs a
  // verified sending domain, which is still an open production TODO.
  return c.json({ invited: true, email, role, email_sent: false }, 201);
});

// DELETE /orgs/:orgId/invites/:inviteId -- revoke a pending invite (admin only).
orgRoutes.delete('/:orgId/invites/:inviteId', async (c) => {
  const member = await resolveMembership(c);
  if (!member.ok) return c.json({ error: member.error }, member.status);
  if (member.role !== 'admin') return c.json({ error: 'FORBIDDEN' }, 403);

  const inviteId = parseInt(c.req.param('inviteId'), 10);
  if (Number.isNaN(inviteId)) return c.json({ error: 'INVALID_INVITE_ID' }, 400);

  await c.env.DB.prepare("UPDATE org_invites SET status = 'revoked' WHERE id = ? AND org_id = ?")
    .bind(inviteId, member.orgId)
    .run();

  return c.json({ revoked: true });
});

// POST /orgs/:orgId/leave -- "Leave Organization", pinned at the bottom of the
// Members tab.
orgRoutes.post('/:orgId/leave', async (c) => {
  const member = await resolveMembership(c);
  if (!member.ok) return c.json({ error: member.error }, member.status);

  // Same last-admin guard as the demote path: an org with zero admins is
  // unrecoverable through the UI.
  if (member.role === 'admin') {
    const admins = await c.env.DB.prepare(
      "SELECT COUNT(*) AS c FROM org_members WHERE org_id = ? AND role = 'admin'",
    )
      .bind(member.orgId)
      .first();
    if (((admins?.c as number) ?? 0) <= 1) {
      return c.json(
        {
          error: 'LAST_ADMIN',
          message: 'Promote another member to admin before leaving.',
        },
        409,
      );
    }
  }

  await c.env.DB.prepare('DELETE FROM org_members WHERE org_id = ? AND user_id = ?')
    .bind(member.orgId, member.userId)
    .run();

  return c.json({ left: true });
});

// GET /orgs/:orgId/analytics -- Analytics tab.
//
// Query params: event_id (filter to one event; "all" or omitted = every event).
//
// Returns the weekly engagement series (Mon-Sun line chart) and per-event
// performance cards.
orgRoutes.get('/:orgId/analytics', async (c) => {
  const member = await resolveMembership(c);
  if (!member.ok) return c.json({ error: member.error }, member.status);

  const eventFilter = c.req.query('event_id');
  const eventId = eventFilter && eventFilter !== 'all' ? parseInt(eventFilter, 10) : null;
  if (eventFilter && eventFilter !== 'all' && Number.isNaN(eventId)) {
    return c.json({ error: 'INVALID_EVENT_ID' }, 400);
  }

  const scopeSql = eventId !== null ? 'AND e.id = ?' : '';
  const scopeParams = eventId !== null ? [eventId] : [];

  // Daily engagement over the trailing 7 days. Views, RSVPs and saves each
  // carry their own created_at, so they're unioned into one stream and then
  // grouped — one query instead of three round trips.
  const { results: series } = await c.env.DB.prepare(
    `SELECT day,
            SUM(CASE WHEN kind = 'view'  THEN 1 ELSE 0 END) AS views,
            SUM(CASE WHEN kind = 'rsvp'  THEN 1 ELSE 0 END) AS going,
            SUM(CASE WHEN kind = 'saved' THEN 1 ELSE 0 END) AS saved
     FROM (
       SELECT date(v.created_at) AS day, 'view' AS kind
         FROM event_views v JOIN events e ON e.id = v.event_id
        WHERE e.host_organization_id = ? ${scopeSql}
          AND v.created_at >= datetime('now', '-7 days')
       UNION ALL
       SELECT date(r.created_at) AS day, 'rsvp' AS kind
         FROM event_rsvps r JOIN events e ON e.id = r.event_id
        WHERE e.host_organization_id = ? ${scopeSql}
          AND r.created_at >= datetime('now', '-7 days')
       UNION ALL
       SELECT date(s.created_at) AS day, 'saved' AS kind
         FROM saved_events s JOIN events e ON e.id = s.event_id
        WHERE e.host_organization_id = ? ${scopeSql}
          AND s.created_at >= datetime('now', '-7 days')
     )
     GROUP BY day
     ORDER BY day ASC`,
  )
    .bind(member.orgId, ...scopeParams, member.orgId, ...scopeParams, member.orgId, ...scopeParams)
    .all();

  const { results: events } = await c.env.DB.prepare(
    `SELECT id, title, start_datetime, end_datetime, image_url,
            view_count, rsvp_count, save_count
     FROM events e
     WHERE e.host_organization_id = ? ${scopeSql}
     ORDER BY COALESCE(e.end_datetime, e.start_datetime) DESC
     LIMIT 50`,
  )
    .bind(member.orgId, ...scopeParams)
    .all();

  return c.json({
    weekly: series,
    events: (events as Record<string, unknown>[]).map((e) => {
      const views = Number(e.view_count ?? 0);
      const going = Number(e.rsvp_count ?? 0);
      return {
        ...e,
        // "Conv. %" in the design = what share of viewers said they're going.
        // Guard the divide: an event with no views yet is 0%, not NaN.
        conversion_rate: views > 0 ? Number(((going / views) * 100).toFixed(1)) : 0,
      };
    }),
  });
});

// GET /orgs/:orgId/notification-settings -- Figma Frame 470.
orgRoutes.get('/:orgId/notification-settings', async (c) => {
  const member = await resolveMembership(c);
  if (!member.ok) return c.json({ error: member.error }, member.status);

  const row = await c.env.DB.prepare(
    'SELECT new_rsvps, new_followers, event_reports, org_team_invites FROM org_notification_settings WHERE org_id = ?',
  )
    .bind(member.orgId)
    .first();

  // No row yet means nobody has changed the defaults — return them rather
  // than writing a row on a read.
  return c.json({
    settings: {
      new_rsvps: row ? Number(row.new_rsvps) === 1 : true,
      new_followers: row ? Number(row.new_followers) === 1 : true,
      event_reports: row ? Number(row.event_reports) === 1 : true,
      org_team_invites: row ? Number(row.org_team_invites) === 1 : true,
    },
  });
});

// PATCH /orgs/:orgId/notification-settings -- admin only.
orgRoutes.patch('/:orgId/notification-settings', async (c) => {
  const member = await resolveMembership(c);
  if (!member.ok) return c.json({ error: member.error }, member.status);
  if (member.role !== 'admin') return c.json({ error: 'FORBIDDEN' }, 403);

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ error: 'INVALID_BODY' }, 400);

  const keys = ['new_rsvps', 'new_followers', 'event_reports', 'org_team_invites'] as const;
  const current = await c.env.DB.prepare(
    'SELECT new_rsvps, new_followers, event_reports, org_team_invites FROM org_notification_settings WHERE org_id = ?',
  )
    .bind(member.orgId)
    .first();

  // Merge over defaults so a PATCH of one toggle doesn't reset the rest.
  const merged = keys.map((key) => {
    if (typeof (body as Record<string, unknown>)[key] === 'boolean') {
      return (body as Record<string, boolean>)[key] ? 1 : 0;
    }
    return current ? Number(current[key]) : 1;
  });

  await c.env.DB.prepare(
    `INSERT INTO org_notification_settings
       (org_id, new_rsvps, new_followers, event_reports, org_team_invites, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(org_id) DO UPDATE SET
       new_rsvps        = excluded.new_rsvps,
       new_followers    = excluded.new_followers,
       event_reports    = excluded.event_reports,
       org_team_invites = excluded.org_team_invites,
       updated_at       = datetime('now')`,
  )
    .bind(member.orgId, ...merged)
    .run();

  return c.json({
    settings: Object.fromEntries(keys.map((key, i) => [key, merged[i] === 1])),
  });
});
