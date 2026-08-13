// Organization management console routes (LOOP-183, Events tab LOOP-136).
//
// Covers all three console tabs plus the shared header. Per-event engagement
// counters are LOOP-129 — this file deliberately reads the denormalized
// counters that ticket maintains (events.view_count / rsvp_count /
// save_count) rather than recomputing them.
//
// One boundary worth naming: the Events tab READS from here but WRITES through
// PATCH /events/:id in events.worker.ts. Editing an event is an event
// operation that happens to have been reached from an org screen, and putting
// it here would mean a second copy of the create path's validators.
//
// Authorization model, applied by requireOrgRole below:
//   admin  — manage roles, remove editors, invite, edit notification settings
//   editor — read the console, manage events; cannot manage people
// Everything here is org-scoped: membership in one org grants nothing in
// another, so every handler resolves the caller's role for the org in the URL.

import { Hono } from 'hono';
import {
  bucketsForFilter,
  isProfileEventFilter,
  isPublicProfileTab,
  PROFILE_EVENT_FILTERS,
  PUBLIC_PROFILE_TABS,
} from '../../../shared/profileEventFilters';
import { getAuthUser, getUserId } from '../lib/utils';
// "Has this event ended?" is answered in exactly one place in the codebase.
// These are SQL fragments assuming the events table is aliased `e`; they were
// module-private until LOOP-240 needed the same answer over here.
import { PAST_EVENT_CONDITION, UPCOMING_CONDITION } from './users.worker';
import type { Env } from '../worker';
import {
  ORG_SEARCH_LIMIT,
  ORG_SEARCH_MAX_LIMIT,
  ORG_SEARCH_MIN_QUERY,
  isOrgCategory,
  type OrgClaimState,
} from '../../../shared/orgRegistration';

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
// Organization registration — search + claim (LOOP-141), verification tail
// (LOOP-185)
// ---------------------------------------------------------------------------
//
// The whole flow now lives here: find the org, check it is still claimable,
// check the president's email, confirm the code. Generic UT email verification
// is still LOOP-134.
//
// These are registered above /:orgId for the same reason /mine is: Hono
// matches in definition order and "search" / "register" would otherwise be
// read as an org id.

/**
 * Escape a user-typed string for use inside a LIKE pattern.
 *
 * Without this, a query of "100%" matches every org and "a_b" matches "axb" —
 * the two LIKE wildcards are ordinary characters in an org name. Paired with
 * ESCAPE '\' in the query below.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Collapse the claim signals into the state the UI shows.
 *
 * Order matters. `verified` wins outright because only a human approval sets
 * it. Then pending_review, because after a successful /register/confirm BOTH
 * that status and an admin row exist, and "awaiting our team's review" is the
 * more useful thing to tell someone than "already claimed". An admin row on
 * its own still counts: someone who accepted an admin invite controls the org
 * without verification_status ever moving.
 */
function claimStateOf(row: {
  verified: unknown;
  verification_status: unknown;
  admin_count: unknown;
}): OrgClaimState {
  if (Number(row.verified) === 1) return 'claimed';
  if (String(row.verification_status ?? '') === 'pending_review') return 'pending_review';
  if (Number(row.admin_count ?? 0) > 0) return 'claimed';
  // 'rejected' lands here deliberately — see OrgClaimState.
  return 'available';
}

// GET /orgs/search?q=&limit= -- "Find your organization" (LOOP-141).
//
// MUST stay above /:orgId (see above).
//
// KNOWN LIMITATION, and the reason the "skip for now" affordance on the client
// is a real branch rather than decoration: `organizations` is populated as a
// side effect of event ingestion (src/events/ingest.ts), so an org that has
// never posted an event is not in the table and cannot be found here. This
// endpoint searches what we have; it is not a HornsLink directory lookup.
orgRoutes.get('/search', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const q = (c.req.query('q') ?? '').trim();

  // Nothing rather than everything: the field is empty on first paint, and a
  // bare "" must not return the directory. See ORG_SEARCH_MIN_QUERY.
  if (q.length < ORG_SEARCH_MIN_QUERY) return c.json({ query: q, organizations: [] });

  const rawLimit = Number(c.req.query('limit'));
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), ORG_SEARCH_MAX_LIMIT)
    : ORG_SEARCH_LIMIT;

  const lowered = q.toLowerCase();
  const needle = escapeLike(lowered);

  // lower() on both sides rather than relying on LIKE's default ASCII
  // case-folding, so the exact-match and prefix comparisons in ORDER BY use
  // the same rule as the WHERE clause.
  //
  // Ranking: exact name, then names that START with the query, then anything
  // containing it. Shortest first inside a tier, because "Texas Rowing" is a
  // better answer for "rowing" than "Texas Rowing Alumni Social Committee".
  const { results } = await c.env.DB.prepare(
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
    .bind(`%${needle}%`, lowered, `${needle}%`, limit)
    .all();

  return c.json({
    query: q,
    organizations: (results as Record<string, unknown>[]).map((o) => {
      const claim_state = claimStateOf(
        o as { verified: unknown; verification_status: unknown; admin_count: unknown },
      );
      return {
        id: o.id,
        name: o.name,
        profile_picture: o.profile_picture,
        category: o.category,
        verified: Number(o.verified) === 1,
        verification_status: o.verification_status,
        claim_state,
        // The client disables Send Email on this; the two register routes
        // below enforce it again, because a disabled button is not a check.
        claimable: claim_state === 'available',
      };
    }),
  });
});

/**
 * Refuse a claim on an org somebody else already holds.
 *
 * Returns null when `userId` may proceed. The caller's own admin row is an
 * explicit early exit rather than something the state machine has to reason
 * about: an admin who re-enters the flow on an org they already run is not
 * being blocked by a stranger, and telling them "already claimed" about their
 * own org would be nonsense.
 */
async function claimBlockedFor(
  db: Env['DB'],
  orgId: number,
  userId: number,
): Promise<{ error: string; message: string } | null> {
  const row = await db
    .prepare(
      `SELECT o.verified, o.verification_status,
              (SELECT COUNT(*) FROM org_members m
                WHERE m.org_id = o.id AND m.role = 'admin') AS admin_count,
              (SELECT COUNT(*) FROM org_members m
                WHERE m.org_id = o.id AND m.role = 'admin' AND m.user_id = ?) AS mine
         FROM organizations o
        WHERE o.id = ?`,
    )
    .bind(userId, orgId)
    .first();

  // A missing org is the caller's ORG_NOT_FOUND to report, not this helper's.
  if (!row) return null;
  if (Number(row.mine ?? 0) > 0) return null;

  const state = claimStateOf(
    row as { verified: unknown; verification_status: unknown; admin_count: unknown },
  );

  if (state === 'pending_review') {
    return {
      error: 'ORG_PENDING_REVIEW',
      message: 'This organization is already awaiting verification by our team.',
    };
  }
  if (state === 'claimed') {
    return {
      error: 'ORG_ALREADY_CLAIMED',
      message: 'This organization has already been claimed. Ask an admin to invite you.',
    };
  }
  return null;
}

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

  // LOOP-141: an org somebody already holds is not claimable, and the check
  // belongs here rather than only on the search response — the client picks
  // from a list that may be seconds stale, and a disabled button is not a
  // check. Runs before the president lookup so we never email a code for a
  // claim that cannot complete.
  const blocked = await claimBlockedFor(c.env.DB, orgId, userId);
  if (blocked) return c.json(blocked, 409);

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
// Body: { org_id, code, category? }. On success the caller becomes an admin of
// the org and the org is flagged as awaiting review.
//
// `category` (LOOP-141) is collected on the FIRST screen but only written
// here, once the code proves the submitter is the president. Writing it at
// verify-president time would let anyone who knows a president's address
// relabel a public org without ever holding a code.
orgRoutes.post('/register/confirm', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const userId = await getUserId(c.env.DB, auth.email);
  if (!userId) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const body = await c.req.json().catch(() => null);
  const orgId = body && Number.isFinite(Number(body.org_id)) ? Number(body.org_id) : null;
  const code = body && typeof body.code === 'string' ? body.code.trim() : '';
  const category = body && typeof body.category === 'string' ? body.category.trim() : '';

  if (orgId === null) return c.json({ error: 'INVALID_ORG_ID' }, 400);
  if (!/^\d{4}$/.test(code)) return c.json({ error: 'INVALID_CODE' }, 400);
  // Omitted is fine (the column is nullable); a value we don't recognise is
  // not, because it would be persisted and then rendered back as a label.
  if (category && !isOrgCategory(category)) return c.json({ error: 'INVALID_CATEGORY' }, 400);

  const org = await c.env.DB.prepare('SELECT president_email FROM organizations WHERE id = ?')
    .bind(orgId)
    .first();
  if (!org || typeof org.president_email !== 'string') {
    return c.json({ error: 'ORG_NOT_FOUND' }, 404);
  }

  const blocked = await claimBlockedFor(c.env.DB, orgId, userId);
  if (blocked) return c.json(blocked, 409);

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

  // COALESCE, not a plain assignment: a claimant who skipped the dropdown
  // must not blank a category the org already has.
  await c.env.DB.prepare(
    `UPDATE organizations
        SET verification_status = 'pending_review',
            category            = COALESCE(?, category),
            updated_at          = datetime('now')
      WHERE id = ?`,
  )
    .bind(category || null, orgId)
    .run();

  return c.json({ verified: true, status: 'pending_review', category: category || null });
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

// GET /orgs/:orgId/events -- Events tab (LOOP-136, list completed in LOOP-240).
//
// Query params mirror the profile's My Events section so the two chip rows
// behave identically and share shared/profileEventFilters.ts:
//   q      free-text over title / description / location
//   filter all | general | academic | social
//   sort   date | alpha    (default date)
//
// `alpha` replaced an earlier `recent` (created_at DESC) in LOOP-240: the
// signed-off Figma frame toggles Date <-> A-Z, and a console with a search
// field is a place you go looking for one named event. Newest-posted-first was
// never in the design. The client's label moved in the same change; the two
// only make sense together.
//
// Unlike the profile grid this does NOT hide past events. A console exists to
// fix things, and the event most likely to need fixing is the one that just
// happened. `date` therefore sorts upcoming-soonest-first and lets past events
// fall below in reverse-chronological order, so the top of the list is always
// the next thing out the door.
//
// Each row carries is_past so the client can split the list into Upcoming and
// Past sections (LOOP-132) without re-deriving "has this ended" in JavaScript
// — the fallback for a NULL end_datetime is the sort of detail that would
// drift the moment it existed twice. It is computed from PAST_EVENT_CONDITION,
// the same predicate the profile's history screen uses.
//
// Archived events stay hidden: is_archived is the cleanup job's soft delete
// (LOOP-150), not something a manager can act on. That means is_past reduces
// to "has ended" here, and an archived event lands in NEITHER section rather
// than silently falling into Past.
orgRoutes.get('/:orgId/events', async (c) => {
  const member = await resolveMembership(c);
  if (!member.ok) return c.json({ error: member.error }, member.status);

  const rawFilter = c.req.query('filter') ?? 'all';
  if (!isProfileEventFilter(rawFilter)) {
    return c.json({ error: 'INVALID_FILTER', valid: PROFILE_EVENT_FILTERS }, 400);
  }

  const sort = c.req.query('sort') === 'alpha' ? 'alpha' : 'date';
  const search = (c.req.query('q') ?? '').trim();

  const binds: unknown[] = [member.orgId];

  let searchClause = '';
  if (search) {
    // Escape LIKE wildcards, same as /users/me/events: searching for "50%"
    // should not match everything.
    const escaped = search.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    searchClause = ` AND (e.title LIKE ? ESCAPE '\\'
                          OR e.description LIKE ? ESCAPE '\\'
                          OR e.location_full LIKE ? ESCAPE '\\')`;
    binds.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`);
  }

  const buckets = bucketsForFilter(rawFilter);
  let bucketClause = '';
  if (buckets.length > 0) {
    bucketClause = ` AND EXISTS (
                       SELECT 1 FROM event_tags t
                       WHERE t.event_id = e.id
                         AND t.bucket_id IN (${buckets.map(() => '?').join(', ')})
                     )`;
    binds.push(...buckets);
  }

  // A-Z is a flat ordering on purpose: the client still splits the result into
  // Upcoming and Past, so each section reads alphabetically. Sorting upcoming
  // ahead of past here as well would be invisible in the UI and would make the
  // raw endpoint lie about what "alpha" means.
  //
  // COLLATE NOCASE so "apex" doesn't land after "Zeta" — SQLite's default
  // BINARY compare puts every uppercase letter before every lowercase one. The
  // id tiebreak keeps duplicate titles in a stable order across requests.
  const orderBy =
    sort === 'alpha'
      ? 'e.title COLLATE NOCASE ASC, e.id ASC'
      : `CASE WHEN ${UPCOMING_CONDITION} THEN 0 ELSE 1 END ASC,
         CASE WHEN ${UPCOMING_CONDITION} THEN e.start_datetime END ASC,
         e.start_datetime DESC`;

  const { results } = await c.env.DB.prepare(
    `SELECT e.id, e.title, e.description, e.start_datetime, e.end_datetime,
            e.location_short, e.location_full, e.image_url, e.theme,
            e.view_count, e.rsvp_count, e.save_count,
            CASE WHEN ${PAST_EVENT_CONDITION} THEN 1 ELSE 0 END AS is_past,
            -- The bucket the edit overlay's tag picker should open on. A
            -- user-created event has exactly one; a scraped one may carry
            -- several from the classifier, so the bucket holding the most of
            -- its tags wins (alphabetical tiebreak keeps the answer stable).
            -- Counted rather than read off event_tags.score because score
            -- arrives in migration 0012 and is not in schema.sql, which the
            -- test suite builds from.
            (SELECT t.bucket_id FROM event_tags t
              WHERE t.event_id = e.id
              GROUP BY t.bucket_id
              ORDER BY COUNT(*) DESC, t.bucket_id ASC
              LIMIT 1) AS discovery_bucket
       FROM events e
      WHERE e.host_organization_id = ?
        AND e.is_archived = 0
        ${searchClause}
        ${bucketClause}
      ORDER BY ${orderBy}
      LIMIT 100`,
  )
    .bind(...binds)
    .all();

  // Interest tags per event, so the overlay opens with the current selection
  // already ticked instead of looking like the event has none.
  const events = [];
  for (const event of results as Record<string, unknown>[]) {
    const { results: tags } = await c.env.DB.prepare(
      'SELECT DISTINCT tag FROM event_tags WHERE event_id = ? ORDER BY tag',
    )
      .bind(event.id)
      .all();
    events.push({
      ...event,
      // SQLite has no boolean, and the client branches on this to pick a
      // section — send a real boolean rather than a 0/1 that reads as truthy.
      is_past: Number(event.is_past) === 1,
      tags: (tags as { tag: string }[]).map((t) => t.tag),
    });
  }

  return c.json({
    events,
    role: member.role,
    // Both roles manage events — schema.sql: an editor "can post/manage
    // events, cannot manage people". This is deliberately NOT role === 'admin'
    // the way the Members tab's can_manage is.
    can_manage: member.role === 'admin' || member.role === 'editor',
  });
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

// ---------------------------------------------------------------------------
// Public org profile (LOOP-180)
// ---------------------------------------------------------------------------
//
// Figma: "Profile Main" frame, Org account profile, reviewed 2026-06-08.
//
// NOT the console. Everything above this line is the management surface and
// goes through resolveMembership(), which 403s a non-member — which is every
// single person this section exists for. The two screens share an org and a
// follower count and nothing else: one is "run this org", this is "look at
// this org". Reusing GET /orgs/:orgId by relaxing its membership check would
// have leaked the console's analytics totals to the public.
//
// Auth is still required, for symmetry with the public USER profile (which
// needs a caller to enforce blocking) and so `is_following` has a subject.
// Nothing here is user-to-user, so no block filter applies: blocks are between
// people, and an org is not a person. Events an org hosts stay visible even if
// a blocked person happens to have posted them, because on an org profile the
// org is the author — see the commit message.
//
// Declared at the very bottom, below /mine, /search and /register/*, for the
// route-ordering reason those carry in their own comments.

// GET /orgs/:orgId/profile -- header for the public org page.
orgRoutes.get('/:orgId/profile', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const viewerId = await getUserId(c.env.DB, auth.email);
  if (!viewerId) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const orgId = parseInt(c.req.param('orgId'), 10);
  if (Number.isNaN(orgId)) return c.json({ error: 'INVALID_ORG_ID' }, 400);

  const org = await c.env.DB.prepare(
    `SELECT id, name, slug, profile_picture, verified, category, bio
       FROM organizations WHERE id = ?`,
  )
    .bind(orgId)
    .first();
  if (!org) return c.json({ error: 'ORG_NOT_FOUND' }, 404);

  const followers = await c.env.DB.prepare(
    'SELECT COUNT(*) AS c FROM org_followers WHERE org_id = ?',
  )
    .bind(orgId)
    .first();

  const following = await c.env.DB.prepare('SELECT COUNT(*) AS c FROM org_follows WHERE org_id = ?')
    .bind(orgId)
    .first();

  const isFollowing = await c.env.DB.prepare(
    'SELECT 1 FROM org_followers WHERE org_id = ? AND user_id = ?',
  )
    .bind(orgId, viewerId)
    .first();

  // Members get a "Manage" affordance instead of being sent round to Settings
  // to find the console. Deliberately not a permission — the console re-checks
  // membership on every one of its own endpoints.
  const membership = await c.env.DB.prepare(
    'SELECT role FROM org_members WHERE org_id = ? AND user_id = ?',
  )
    .bind(orgId, viewerId)
    .first();

  return c.json({
    org: {
      ...org,
      verified: Number(org.verified) === 1,
      follower_count: (followers?.c as number) ?? 0,
      following_count: (following?.c as number) ?? 0,
    },
    is_following: !!isFollowing,
    is_member: !!membership,
    role: (membership?.role as string) ?? null,
  });
});

// GET /orgs/:orgId/profile/events?tab=upcoming|past
//
// The "Organization account" grid. Same shape as the public USER profile's
// events endpoint so one client component renders both.
//
// Distinct from GET /orgs/:orgId/events, which is the console's list: that one
// is member-gated, returns engagement counters and the tag selection an edit
// overlay needs, and deliberately shows past events inline rather than behind
// a toggle. This returns only what a poster tile draws.
//
// Archived events are excluded from BOTH tabs. is_archived is the cleanup
// job's soft delete (LOOP-150), not history — the same call orgs' console
// events list makes. Note this differs from the user profile grid, which
// reuses PAST_EVENT_CONDITION as-is and therefore does surface archived events
// under Past; that predicate is LOOP-200's definition of a user's own history
// and is not this ticket's to redefine.
orgRoutes.get('/:orgId/profile/events', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const viewerId = await getUserId(c.env.DB, auth.email);
  if (!viewerId) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const orgId = parseInt(c.req.param('orgId'), 10);
  if (Number.isNaN(orgId)) return c.json({ error: 'INVALID_ORG_ID' }, 400);

  const rawTab = c.req.query('tab') ?? 'upcoming';
  if (!isPublicProfileTab(rawTab)) {
    return c.json({ error: 'INVALID_TAB', valid: PUBLIC_PROFILE_TABS }, 400);
  }

  const org = await c.env.DB.prepare('SELECT 1 FROM organizations WHERE id = ?')
    .bind(orgId)
    .first();
  if (!org) return c.json({ error: 'ORG_NOT_FOUND' }, 404);

  const condition = rawTab === 'past' ? PAST_EVENT_CONDITION : UPCOMING_CONDITION;
  const order = rawTab === 'past' ? 'DESC' : 'ASC';

  const { results } = await c.env.DB.prepare(
    `SELECT e.*,
            o.profile_picture AS org_profile_picture,
            o.verified        AS org_verified
       FROM events e
       LEFT JOIN organizations o ON e.host_organization_id = o.id
      WHERE e.host_organization_id = ?
        AND e.is_archived = 0
        AND ${condition}
      ORDER BY COALESCE(e.start_datetime, e.end_datetime) ${order}
      LIMIT 100`,
  )
    .bind(orgId)
    .all();

  const countRow = await c.env.DB.prepare(
    `SELECT
       SUM(CASE WHEN ${UPCOMING_CONDITION} THEN 1 ELSE 0 END) AS upcoming,
       SUM(CASE WHEN ${PAST_EVENT_CONDITION} THEN 1 ELSE 0 END) AS past
     FROM events e
     WHERE e.host_organization_id = ? AND e.is_archived = 0`,
  )
    .bind(orgId)
    .first();

  return c.json({
    tab: rawTab,
    events: (results as Record<string, unknown>[]).map((e) => ({
      ...e,
      org_verified: Number(e.org_verified) === 1,
    })),
    counts: {
      upcoming: Number(countRow?.upcoming ?? 0),
      past: Number(countRow?.past ?? 0),
    },
  });
});

// POST /orgs/:orgId/follow -- the Follow button on the public org profile.
//
// org_followers has existed since migration 0008 and the console has been
// reading a count off it, but nothing ever wrote a row: there was no screen
// with a Follow button on it until this one. Idempotent.
orgRoutes.post('/:orgId/follow', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const userId = await getUserId(c.env.DB, auth.email);
  if (!userId) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const orgId = parseInt(c.req.param('orgId'), 10);
  if (Number.isNaN(orgId)) return c.json({ error: 'INVALID_ORG_ID' }, 400);

  const org = await c.env.DB.prepare('SELECT 1 FROM organizations WHERE id = ?')
    .bind(orgId)
    .first();
  if (!org) return c.json({ error: 'ORG_NOT_FOUND' }, 404);

  await c.env.DB.prepare(
    `INSERT INTO org_followers (org_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING`,
  )
    .bind(orgId, userId)
    .run();

  return c.json({ following: true });
});

// DELETE /orgs/:orgId/follow -- unfollow. Idempotent.
orgRoutes.delete('/:orgId/follow', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const userId = await getUserId(c.env.DB, auth.email);
  if (!userId) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const orgId = parseInt(c.req.param('orgId'), 10);
  if (Number.isNaN(orgId)) return c.json({ error: 'INVALID_ORG_ID' }, 400);

  await c.env.DB.prepare('DELETE FROM org_followers WHERE org_id = ? AND user_id = ?')
    .bind(orgId, userId)
    .run();

  return c.json({ following: false });
});
