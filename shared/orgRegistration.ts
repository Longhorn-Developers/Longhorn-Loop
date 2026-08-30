/**
 * Shared vocabulary for the org registration flow (LOOP-141).
 *
 * Dependency-free by design (no React, no Worker globals) so BOTH sides import
 * the same values, mirroring shared/socialPlatforms.ts:
 *   - app/org/register.tsx renders ORG_CATEGORIES in the dropdown and gates the
 *     search query on ORG_SEARCH_MIN_QUERY
 *   - server/src/routes/orgs.worker.ts validates the submitted category against
 *     the identical list and applies the identical minimum-query rule
 *
 * Keeping the list in one place matters because the category is persisted
 * (organizations.category): if the client offered an option the server rejected,
 * the user would fill in a valid-looking form and get a 400 on submit.
 */

/**
 * "What best describes this organization?" — the five options in the Figma
 * "Organization Registration" frame, screen 2, in the order they appear there.
 *
 * These describe the ORG, not its events. They deliberately do not reuse the
 * `categories` table, which is a HornsLink category-id lookup joined to events
 * through event_categories — a different axis with a different key space.
 */
export const ORG_CATEGORIES = [
  'Professional',
  'Sports',
  'Cultural',
  'Academic',
  'Media / Publication',
] as const;

export type OrgCategory = (typeof ORG_CATEGORIES)[number];

export function isOrgCategory(value: unknown): value is OrgCategory {
  return typeof value === 'string' && (ORG_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Below this many characters GET /orgs/search returns nothing at all.
 *
 * The search field is the first thing on the form, so it is empty on first
 * paint. Returning the whole directory for "" (or a near-whole-directory match
 * for "a") would read as a broken screen and costs a full scan of
 * `organizations` on every mount.
 */
export const ORG_SEARCH_MIN_QUERY = 2;

/** Default page size for GET /orgs/search; the dropdown shows a short list. */
export const ORG_SEARCH_LIMIT = 10;

/** Hard ceiling on ?limit=, so a caller can't ask for the whole table. */
export const ORG_SEARCH_MAX_LIMIT = 25;

/**
 * ?sort= options for GET /orgs/search (LOOP-264), in the order the Explore
 * "Orgs" toggle offers them.
 *
 *   trending -- most new org_followers rows in the past 7 days
 *   newest   -- most recently updated organizations first
 *   az       -- alphabetical by name
 *
 * 'trending' is the default: it's what a directory should open on when nobody
 * has typed a search yet.
 */
export const ORG_SORT_OPTIONS = ['trending', 'newest', 'az'] as const;

export type OrgSortOption = (typeof ORG_SORT_OPTIONS)[number];

export function isOrgSort(value: unknown): value is OrgSortOption {
  return typeof value === 'string' && (ORG_SORT_OPTIONS as readonly string[]).includes(value);
}

export const ORG_SEARCH_DEFAULT_SORT: OrgSortOption = 'trending';

/**
 * Whether an org can still be claimed, and if not, why.
 *
 * Derived server-side from two signals rather than one, because neither alone
 * is honest:
 *   - `verification_status = 'pending_review'` says a claim is mid-flight, but
 *     it is a column any future admin tool could set without anyone actually
 *     holding the org.
 *   - an `org_members` row with role 'admin' says somebody demonstrably
 *     controls the org today — including people who arrived by accepting an
 *     admin invite, a path that never touches verification_status.
 *
 * 'rejected' is deliberately NOT a state here: a turned-down claim must not
 * lock the org out forever, so a rejected org with no admin is claimable again.
 */
export type OrgClaimState = 'available' | 'pending_review' | 'claimed';

/**
 * Why a president-email check failed (LOOP-243).
 *
 * These were one error code until it became clear the two cases need
 * completely different answers from the user, and that the client cannot tell
 * them apart from the message text alone:
 *
 *   - NOT_ON_FILE  -- we hold no contact email for this org at all. Nothing the
 *     claimant types can ever match. The fix is on HornsLink: add a contact
 *     email to the org's page, then hit refresh.
 *   - MISMATCH     -- we hold one and it is not what they typed. Either they
 *     are not the contact, or HornsLink still lists last year's officer. Same
 *     fix on HornsLink, different explanation.
 *
 * Shared rather than duplicated so the screen's copy branches on the same
 * string the route emits; a typo here fails the build on both sides at once.
 */
export const ORG_EMAIL_NOT_ON_FILE = 'PRESIDENT_EMAIL_NOT_ON_FILE';
export const ORG_EMAIL_MISMATCH = 'PRESIDENT_EMAIL_MISMATCH';

/**
 * Minimum gap between POST /orgs/:orgId/refresh calls for one org.
 *
 * The endpoint reaches out to HornsLink on every call, so without a floor it
 * is an open proxy for hammering Campus Labs from our Worker. A minute is
 * generous next to how long it takes a human to edit an org page and come
 * back, and it is enforced server-side -- the client's disabled button is not
 * a rate limit.
 */
export const ORG_REFRESH_MIN_INTERVAL_MS = 60 * 1000;
