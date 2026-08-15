// HornsLink ORGANIZATION directory scraper (LOOP-241).
//
// This is deliberately NOT the event scraper in ./hornslink.ts, and it must
// never become one. That scraper is commented out of the registry because
// HornsLink's event firehose is too noisy for the feed; this one exists
// because HornsLink is simultaneously the only usable directory of UT student
// orgs. Orgs in, events not.
//
// WHY THIS EXISTS AT ALL
//
// Before this file, `organizations` rows were only ever created as a side
// effect of event ingestion (src/events/ingest.ts, upsertOrganization), which
// fires only for scrapers that supply a numeric `sourceOrgId`. HornsLink is
// the only one of the eleven that does. With it disabled, no new org ever
// entered the table, so:
//   - GET /orgs/search had nothing to find, and
//   - `president_email` was never written by anything at all, so every claim
//     in POST /orgs/register/verify-president failed on a null.
//
// ============================================================================
// UNVERIFIED: the exact shape of Campus Labs Engage's responses
// ============================================================================
//
// The event API (see ./hornslink.ts) returns camelCase keys. The organization
// endpoints were NOT confirmed against a live response while this was written
// -- utexas.campuslabs.com disallows automated fetching, so the payload could
// not be inspected. Two things are therefore written defensively:
//
//   1. parseDirectoryPage() accepts several key spellings per field
//      (camelCase, PascalCase, and the "Id"/"WebsiteKey" variants Engage uses
//      in its OData-flavoured search responses). If a field is missing under
//      every spelling it comes back null rather than throwing.
//   2. extractContactEmail() tries three strategies against the org's detail
//      page, in descending order of trustworthiness.
//
// FIRST THING TO DO when running this for real: hit ORG_DIRECTORY_ENDPOINT in
// a browser, look at one object in `value`, and replace the multi-spelling
// lookups below with the real key names. Then do the same for one org detail
// page and delete whichever extraction strategies turn out to be dead code.
// Leaving the tolerant version in forever is how a scraper rots silently.

import type { Env } from '../worker';
import { fetchWithRetry, sleep } from '../events/polite-fetch';
import { buildAbsoluteUrl } from '../events/normalize';

// Constants

const ENGAGE_BASE = 'https://utexas.campuslabs.com/engage';

/** Paged directory listing. Same discovery API family as the event search. */
export const ORG_DIRECTORY_ENDPOINT = `${ENGAGE_BASE}/api/discovery/search/organizations`;

/** Public org page, keyed by websiteKey. Where the "E:" contact email lives. */
export const ORG_DETAIL_BASE = `${ENGAGE_BASE}/organization`;

const IMAGE_BASE_URL = 'https://se-images.campuslabs.com/clink/images/';

/** Engage caps `top`; 100 is under every documented ceiling. */
const DIRECTORY_PAGE_SIZE = 100;

/** Hard stop so a malformed count can't loop us into the request cap. */
const MAX_DIRECTORY_PAGES = 40;

/** Pause between directory pages. */
const DIRECTORY_PAGE_DELAY_MS = 500;

/** Pause between org detail pages. These are HTML, so they are heavier. */
const DETAIL_FETCH_DELAY_MS = 1000;

/**
 * Detail pages fetched per cron run.
 *
 * The directory gives us ~1000+ orgs but no contact email, so the email needs
 * one HTML fetch per org. Doing all of them in a single run would be a
 * thousand-request burst at Campus Labs from one Worker invocation, and would
 * blow the Workers subrequest limit besides. Instead each run tops up the
 * orgs that still have no email, so the table fills in over several days and
 * stays filled. A claimant who does not want to wait has POST /orgs/:id/refresh.
 */
const DETAIL_FETCHES_PER_RUN = 150;

// Types

export interface HornsLinkOrgSummary {
  /** HornsLink's numeric org id. Same key space as organizations.id. */
  id: number;
  name: string;
  /** URL slug for the public org page; null if the payload omitted it. */
  websiteKey: string | null;
  profilePicture: string | null;
}

export interface OrgScrapeResult {
  orgsProcessed: number;
  orgsInserted: number;
  emailsFound: number;
  detailPagesFetched: number;
  errors: string[];
  durationMs: number;
}

// Parsing -- pure functions, unit tested in test/scrapers/test_hornslinkOrgs.ts

/**
 * Read the first present key out of several candidate spellings.
 *
 * Exists only because the live payload's casing is unconfirmed (see the header
 * comment). Once the real keys are known this should collapse to plain
 * property access.
 */
function pick(raw: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    const value = raw[name];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  return null;
}

function asOrgId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  // Engage sometimes returns ids as strings. A non-numeric id (a GUID) is not
  // usable as organizations.id, so it is dropped rather than coerced to NaN.
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

/**
 * Normalize one page of the directory response into org summaries.
 *
 * Rows without a usable numeric id are skipped, not defaulted: organizations.id
 * IS the HornsLink id, and inventing one would create a row that no future
 * scrape can ever match back up.
 */
export function parseDirectoryPage(payload: unknown): HornsLinkOrgSummary[] {
  const container = (payload ?? {}) as Record<string, unknown>;
  const rawList = pick(container, 'value', 'Value', 'items', 'Items', 'results');
  if (!Array.isArray(rawList)) return [];

  const orgs: HornsLinkOrgSummary[] = [];

  for (const entry of rawList) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;

    const id = asOrgId(pick(raw, 'id', 'Id', 'organizationId', 'OrganizationId'));
    const name = asString(pick(raw, 'name', 'Name', 'organizationName', 'OrganizationName'));
    if (id === null || name === null) continue;

    const websiteKey = asString(pick(raw, 'websiteKey', 'WebsiteKey', 'slug', 'Slug'));
    const rawPicture = asString(
      pick(raw, 'profilePicture', 'ProfilePicture', 'organizationProfilePicture'),
    );

    orgs.push({
      id,
      name,
      websiteKey,
      profilePicture: rawPicture ? buildAbsoluteUrl(IMAGE_BASE_URL, rawPicture) : null,
    });
  }

  return orgs;
}

/** Total org count reported by the directory, or null if absent. */
export function parseDirectoryCount(payload: unknown): number | null {
  const container = (payload ?? {}) as Record<string, unknown>;
  const raw = pick(container, '@odata.count', 'count', 'Count', 'totalItems', 'TotalItems');
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return Number(raw);
  return null;
}

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#64;': '@',
  '&#x40;': '@',
};

function decodeEntities(value: string): string {
  return value.replace(
    /&(?:amp|lt|gt|quot|#39|#64|#x40);/gi,
    (m) => HTML_ENTITIES[m.toLowerCase()] ?? m,
  );
}

/** RFC-ish, deliberately narrow. Anything exotic is not worth guessing at. */
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

function normalizeEmail(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  const match = decodeEntities(String(candidate)).match(EMAIL_PATTERN);
  if (!match) return null;
  const email = match[0].toLowerCase();
  // Engage templates ship placeholder addresses in some themes. Storing one
  // would let literally anyone claim the org, so they are treated as absent.
  if (/^(no-?reply|do-?not-?reply|example|test)@/.test(email)) return null;
  if (/(example\.com|domain\.com|yourdomain)$/.test(email)) return null;
  return email;
}

/** Keys worth trusting inside an embedded JSON blob, most specific first. */
const EMAIL_KEY_PATTERN =
  /^(primary)?contact(_?e?mail)?$|^e?mail$|^contactEmail$|^primaryContactEmail$/i;

/**
 * Walk a parsed JSON value looking for a contact-email-ish key.
 *
 * Key-directed rather than "find any email in the blob": Engage payloads carry
 * support addresses, template sender addresses and campus webmaster contacts
 * that are emphatically not the org's president. Matching on the key name is
 * what keeps us from emailing a verification code to the wrong person.
 */
function findEmailInJson(value: unknown, depth = 0): string | null {
  if (depth > 8 || value === null || typeof value !== 'object') return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findEmailInJson(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const record = value as Record<string, unknown>;

  for (const [key, child] of Object.entries(record)) {
    if (typeof child === 'string' && EMAIL_KEY_PATTERN.test(key)) {
      const email = normalizeEmail(child);
      if (email) return email;
    }
  }

  for (const child of Object.values(record)) {
    const found = findEmailInJson(child, depth + 1);
    if (found) return found;
  }

  return null;
}

/**
 * Pull the org's contact email out of its public HornsLink page.
 *
 * Three strategies, in descending order of how much they can be trusted:
 *
 *   1. An embedded JSON blob (__NEXT_DATA__ / __PRELOADED_STATE__ / any
 *      application/json script). Engage is client-rendered, so this is where
 *      the data usually is, and a key named "contactEmail" is unambiguous.
 *   2. A `mailto:` link. Also unambiguous -- someone deliberately marked that
 *      address as the thing to write to.
 *   3. The literal "E:" label the org profile renders next to the contact
 *      address, matched only within a short window after the label.
 *
 * There is deliberately NO "any email anywhere in the page" fallback. A wrong
 * address is worse than no address: it hands the org to whoever owns it and
 * locks out the people who actually run the org, and neither failure is
 * visible to us. Returning null is the safe answer, and the flow already
 * handles it (PRESIDENT_EMAIL_NOT_ON_FILE).
 */
export function extractContactEmail(html: string): string | null {
  if (!html) return null;

  // 1. Embedded JSON.
  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let script: RegExpExecArray | null;
  while ((script = scriptPattern.exec(html)) !== null) {
    const body = script[1];
    if (!body || !body.includes('@')) continue;

    // Either a bare JSON document (type="application/json") or an assignment
    // like `window.__PRELOADED_STATE__ = {...};`.
    const jsonText = body.trim().startsWith('{')
      ? body.trim()
      : (body.match(/=\s*(\{[\s\S]*\})\s*;?\s*$/)?.[1] ?? null);
    if (!jsonText) continue;

    try {
      const found = findEmailInJson(JSON.parse(jsonText));
      if (found) return found;
    } catch {
      // Not valid JSON on its own -- fall through to the other strategies
      // rather than trying to repair it.
    }
  }

  // 2. mailto:
  const mailto = html.match(/href\s*=\s*["']mailto:([^"'?]+)/i);
  const fromMailto = normalizeEmail(mailto?.[1]);
  if (fromMailto) return fromMailto;

  // 3. The "E:" label, within a short window so we don't wander into the
  //    page footer and pick up a campus-wide support address.
  const labelled = html.match(/\bE:\s*(?:<[^>]+>\s*){0,3}([^<\s]{3,120})/);
  const fromLabel = normalizeEmail(labelled?.[1]);
  if (fromLabel) return fromLabel;

  return null;
}

/** Public URL for an org's HornsLink page. */
export function orgDetailUrl(websiteKey: string): string {
  return `${ORG_DETAIL_BASE}/${encodeURIComponent(websiteKey)}`;
}

// Fetching

function directoryPageUrl(skip: number): string {
  const params = new URLSearchParams({
    top: String(DIRECTORY_PAGE_SIZE),
    skip: String(skip),
    'orderBy[0]': 'UpperName asc',
  });
  return `${ORG_DIRECTORY_ENDPOINT}?${params.toString()}`;
}

/** Fetch one org's detail page and extract its contact email. */
export async function fetchOrgContactEmail(websiteKey: string): Promise<string | null> {
  const res = await fetchWithRetry(orgDetailUrl(websiteKey), {
    headers: { Accept: 'text/html,application/xhtml+xml' },
  });
  return extractContactEmail(await res.text());
}

// Persistence

/**
 * Upsert an org.
 *
 * COALESCE on president_email, category and slug rather than plain assignment:
 * a directory page that omits a field must not blank one we already have --
 * a live claim may be resting on the stored email. The name and picture DO
 * overwrite, because the directory is authoritative for those and an org that
 * renames should not stay stale in search.
 */
async function upsertOrg(
  db: D1Database,
  org: HornsLinkOrgSummary,
  presidentEmail: string | null,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO organizations (id, name, slug, profile_picture, president_email, source, updated_at)
       VALUES (?, ?, ?, ?, ?, 'hornslink', datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         name            = excluded.name,
         slug            = COALESCE(excluded.slug, slug),
         profile_picture = COALESCE(excluded.profile_picture, profile_picture),
         president_email = COALESCE(excluded.president_email, president_email),
         updated_at      = datetime('now')`,
    )
    .bind(org.id, org.name, org.websiteKey, org.profilePicture, presidentEmail)
    .run();
}

/**
 * Overwrite president_email for one org.
 *
 * Distinct from the COALESCE in upsertOrg on purpose. This is the path taken
 * when we deliberately went and looked at the org's page: if the president
 * changed the address on HornsLink, the whole point is that the new one wins.
 * That is the answer to "if they haven't updated it, will it rescrape?" --
 * yes, but only through here.
 */
async function writePresidentEmail(
  db: D1Database,
  orgId: number,
  email: string | null,
): Promise<void> {
  if (email === null) return;
  await db
    .prepare(
      `UPDATE organizations
          SET president_email = ?, updated_at = datetime('now')
        WHERE id = ?`,
    )
    .bind(email, orgId)
    .run();
}

/**
 * Re-fetch a single org's contact email on demand.
 *
 * Backs POST /orgs/:orgId/refresh, so a claimant who just added their email to
 * HornsLink does not have to wait for the next cron tick. Returns enough for
 * the route to tell "found it, try again" from "still nothing there".
 */
export async function refreshOrgContactEmail(
  db: D1Database,
  orgId: number,
): Promise<{ found: boolean; changed: boolean; reason?: 'NO_SLUG' | 'FETCH_FAILED' }> {
  const row = await db
    .prepare('SELECT slug, president_email FROM organizations WHERE id = ?')
    .bind(orgId)
    .first();

  const slug = typeof row?.slug === 'string' ? row.slug : null;
  // An org whose row predates this scraper has no slug, so there is no page to
  // go and read. The next directory sweep backfills it.
  if (!slug) return { found: false, changed: false, reason: 'NO_SLUG' };

  const previous = typeof row?.president_email === 'string' ? row.president_email : null;

  let email: string | null;
  try {
    email = await fetchOrgContactEmail(slug);
  } catch (err) {
    console.error(`[hornslinkOrgs] refresh failed for org ${orgId}:`, err);
    return { found: false, changed: false, reason: 'FETCH_FAILED' };
  }

  if (email === null) {
    // Touch updated_at even though nothing was found. The refresh route reads
    // it as "when did we last go and look", and if a fruitless attempt left it
    // untouched the caller could retry in a loop with the throttle never
    // engaging — which is exactly the case (org has no email yet) where an
    // impatient claimant is most likely to keep tapping.
    await db
      .prepare("UPDATE organizations SET updated_at = datetime('now') WHERE id = ?")
      .bind(orgId)
      .run();
    return { found: false, changed: false };
  }

  await writePresidentEmail(db, orgId, email);
  return { found: true, changed: email !== previous };
}

// Entrypoints

export interface ScrapeOrgsOptions {
  /** Skip the detail-page pass. Directory only -- names and pictures. */
  skipDetails?: boolean;
  /** Override how many detail pages this run may fetch. */
  detailLimit?: number;
  /** Parse and log without writing to D1. */
  dryRun?: boolean;
}

/**
 * Full org directory sweep, plus a bounded top-up of missing contact emails.
 *
 * Phase 1 pages the directory and upserts every org. Phase 2 picks orgs that
 * still have no president_email and reads their detail page, capped at
 * DETAIL_FETCHES_PER_RUN so one invocation cannot turn into a thousand-request
 * burst. Successive runs work through the backlog.
 */
export async function scrapeHornsLinkOrgs(
  env: Env,
  options: ScrapeOrgsOptions = {},
): Promise<OrgScrapeResult> {
  const startedAt = Date.now();
  const result: OrgScrapeResult = {
    orgsProcessed: 0,
    orgsInserted: 0,
    emailsFound: 0,
    detailPagesFetched: 0,
    errors: [],
    durationMs: 0,
  };

  const dryRun = options.dryRun === true;

  // Phase 1: the directory.
  let skip = 0;
  let total: number | null = null;

  for (let page = 0; page < MAX_DIRECTORY_PAGES; page++) {
    let payload: unknown;
    try {
      const res = await fetchWithRetry(directoryPageUrl(skip));
      payload = await res.json();
    } catch (err) {
      result.errors.push(`directory page at skip=${skip}: ${String(err)}`);
      break;
    }

    if (total === null) total = parseDirectoryCount(payload);

    const orgs = parseDirectoryPage(payload);
    if (orgs.length === 0) break;

    for (const org of orgs) {
      result.orgsProcessed++;
      if (dryRun) {
        console.log(`[DRY RUN] ${org.id} ${org.name} (${org.websiteKey ?? 'no slug'})`);
        continue;
      }
      try {
        await upsertOrg(env.DB, org, null);
        result.orgsInserted++;
      } catch (err) {
        result.errors.push(`upsert org ${org.id}: ${String(err)}`);
      }
    }

    skip += orgs.length;
    if (total !== null && skip >= total) break;
    await sleep(DIRECTORY_PAGE_DELAY_MS);
  }

  // Phase 2: top up missing contact emails.
  if (!options.skipDetails && !dryRun) {
    const limit = options.detailLimit ?? DETAIL_FETCHES_PER_RUN;
    const { results } = await env.DB.prepare(
      `SELECT id, slug FROM organizations
        WHERE president_email IS NULL
          AND slug IS NOT NULL
          AND source = 'hornslink'
        ORDER BY updated_at ASC
        LIMIT ?`,
    )
      .bind(limit)
      .all();

    for (const row of results as { id: number; slug: string }[]) {
      try {
        const email = await fetchOrgContactEmail(row.slug);
        result.detailPagesFetched++;
        if (email) {
          await writePresidentEmail(env.DB, row.id, email);
          result.emailsFound++;
        } else {
          // Touch updated_at so the ORDER BY rotates past this org next run
          // instead of retrying the same emailless orgs forever.
          await env.DB.prepare("UPDATE organizations SET updated_at = datetime('now') WHERE id = ?")
            .bind(row.id)
            .run();
        }
      } catch (err) {
        result.errors.push(`detail for org ${row.id}: ${String(err)}`);
      }
      await sleep(DETAIL_FETCH_DELAY_MS);
    }
  }

  result.durationMs = Date.now() - startedAt;
  console.log(
    `[hornslinkOrgs] ${result.orgsProcessed} orgs, ${result.emailsFound} emails from ` +
      `${result.detailPagesFetched} detail pages, ${result.errors.length} errors, ${result.durationMs}ms`,
  );
  return result;
}

/** Cron entrypoint. Matches the ScraperEntry.run signature in registry.ts. */
export async function run(env: Env): Promise<void> {
  await scrapeHornsLinkOrgs(env);
}

/** Manual entrypoint for POST /events/scrape/hornslinkOrgs. Testing only. */
export async function manual(env: Env, options: Record<string, unknown>): Promise<unknown> {
  return scrapeHornsLinkOrgs(env, {
    skipDetails: options.skipDetails === true,
    dryRun: options.dryRun === true,
    detailLimit:
      typeof options.detailLimit === 'number' && Number.isFinite(options.detailLimit)
        ? Math.max(0, Math.trunc(options.detailLimit))
        : undefined,
  });
}
