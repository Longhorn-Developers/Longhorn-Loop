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
// effect of event ingestion (src/events/ingest.ts), which
// fires only for scrapers that supply a numeric `sourceOrgId`. HornsLink is
// the only one of the eleven that does. With it disabled, no new org ever
// entered the table, so:
//   - GET /orgs/search had nothing to find, and
//   - `president_email` was never written by anything at all, so every claim
//     in POST /orgs/register/verify-president failed on a null.
//
// ============================================================================
// Campus Labs Engage response handling
// ============================================================================
//
// The directory and public roster page have now been checked against live
// HornsLink responses. The parser is still intentionally tolerant about key
// casing so a small Engage response-shape change does not immediately break
// the directory import.
//
// Contact email comes from the anonymous roster page's
// `window.initialAppState.preFetchedData.organization.primaryContact` object.
// The database column is still named `president_email` for compatibility with
// the existing verification flow, but the value stored here is the HornsLink
// PRIMARY CONTACT email and is not guaranteed to belong to the president.

import { upsertOrganizations } from '../events/ingest';
import { buildAbsoluteUrl } from '../events/normalize';
import { fetchWithRetry, sleep } from '../events/polite-fetch';
import type { Env } from '../worker';

// Constants

const MAX_DIRECTORY_BATCH_SIZE = 100;
const DETAIL_FETCH_CONCURRENCY = 5;
const DETAIL_CHUNK_DELAY_MS = 250;

const ENGAGE_BASE = 'https://utexas.campuslabs.com/engage';

/** Paged directory listing. Same discovery API family as the event search. */
export const ORG_DIRECTORY_ENDPOINT = `${ENGAGE_BASE}/api/discovery/search/organizations`;

/** Public org page, keyed by websiteKey. */
export const ORG_DETAIL_BASE = `${ENGAGE_BASE}/organization`;

const IMAGE_BASE_URL = 'https://se-images.campuslabs.com/clink/images/';

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
  nextSkip: number | null;
  done: boolean;
  total: number | null;
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
 * Strategies, in descending order of how much they can be trusted:
 *
 *   1. `window.initialAppState.preFetchedData.organization.primaryContact`.
 *      This is present on the anonymous roster page and is the source we want.
 *   2. Another embedded JSON blob with a contact-email-ish key.
 *   3. A `mailto:` link.
 *   4. The literal "E:" label rendered next to a contact address.
 *
 * There is deliberately NO "any email anywhere in the page" fallback. A wrong
 * address is worse than no address: it hands the org to whoever owns it and
 * locks out the people who actually run the org, and neither failure is
 * visible to us. Returning null is the safe answer, and the flow already
 * handles it (PRESIDENT_EMAIL_NOT_ON_FILE).
 */
export function extractContactEmail(html: string): string | null {
  if (!html) return null;

  // First try hornslink anonymous app state
  const stateMatch = html.match(/window\.initialAppState\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);

  if (stateMatch) {
    try {
      const state = JSON.parse(stateMatch[1]);

      const email = state?.preFetchedData?.organization?.primaryContact?.primaryEmailAddress;

      const normalized = normalizeEmail(email);

      if (normalized) {
        return normalized;
      }
    } catch {
      // If parsing fails, fall through to the older strategies below.
    }
  }

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

function directoryPageUrl(skip: number, take: number): string {
  const params = new URLSearchParams({
    top: String(take),
    skip: String(skip),
    'orderBy[0]': 'UpperName asc',
  });

  return `${ORG_DIRECTORY_ENDPOINT}?${params.toString()}`;
}

/** Fetch one org's public roster page and extract its primary-contact email. */
export async function fetchOrgContactEmail(websiteKey: string): Promise<string | null> {
  const url = `${ORG_DETAIL_BASE}/${encodeURIComponent(websiteKey)}/roster`;

  const res = await fetchWithRetry(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
    },
  });

  return extractContactEmail(await res.text());
}

// Persistence

/**
 * Overwrite president_email for one org.
 *
 * Distinct from the shared ingest upsert on purpose. This is the path taken
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

  // Directory pagination
  skip?: number;
  take?: number;
}

/**
 * Process one HornsLink directory batch and enrich that same batch.
 *
 * Phase 1 fetches at most MAX_DIRECTORY_BATCH_SIZE organizations and sends
 * them through the shared organization upsert in events/ingest.ts.
 * Phase 2 reads the public roster page only for organizations from that batch
 * whose stored contact email is still null.
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
    nextSkip: null,
    done: false,
    total: null,
  };

  const dryRun = options.dryRun === true;

  // Keep the exact directory page around so Phase 2 only enriches orgs from
  // this invocation instead of pulling unrelated old rows from the database.
  let currentBatch: HornsLinkOrgSummary[] = [];

  // Phase 1: fetch one directory batch, then hand normalized orgs to ingest.
  const skip = Math.max(0, Math.trunc(options.skip ?? 0));
  const take = Math.min(
    MAX_DIRECTORY_BATCH_SIZE,
    Math.max(1, Math.trunc(options.take ?? MAX_DIRECTORY_BATCH_SIZE)),
  );

  try {
    const res = await fetchWithRetry(directoryPageUrl(skip, take));
    const payload = await res.json();

    result.total = parseDirectoryCount(payload);
    currentBatch = parseDirectoryPage(payload);
    result.orgsProcessed = currentBatch.length;

    if (dryRun) {
      for (const org of currentBatch) {
        console.log(`[DRY RUN] ${org.id} ${org.name} (${org.websiteKey ?? 'no slug'})`);
      }
    } else if (currentBatch.length > 0) {
      try {
        await upsertOrganizations(
          env.DB,
          currentBatch.map((org) => ({
            id: org.id,
            name: org.name,
            slug: org.websiteKey,
            profilePicture: org.profilePicture,
            contactEmail: null,
            source: 'hornslink',
          })),
        );
        result.orgsInserted = currentBatch.length;
      } catch (err) {
        result.errors.push(`batch org upsert: ${String(err)}`);
      }
    }

    const nextSkip = skip + currentBatch.length;
    result.done = currentBatch.length === 0 || (result.total !== null && nextSkip >= result.total);
    result.nextSkip = result.done ? null : nextSkip;
  } catch (err) {
    result.errors.push(`directory page at skip=${skip}: ${String(err)}`);
    result.nextSkip = null;
    result.done = false;
  }

  // Phase 2: enrich only organizations from the directory batch we just read.
  if (!options.skipDetails && !dryRun && currentBatch.length > 0) {
    const ids = currentBatch.filter((org) => org.websiteKey !== null).map((org) => org.id);

    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');

      try {
        const { results } = await env.DB.prepare(
          `SELECT id, slug
               FROM organizations
              WHERE id IN (${placeholders})
                AND president_email IS NULL
                AND slug IS NOT NULL
                AND source = 'hornslink'
              ORDER BY id`,
        )
          .bind(...ids)
          .all();

        let rows = results as { id: number; slug: string }[];

        // detailLimit is mainly useful for testing. If omitted, every missing
        // primary contact in this directory batch is attempted.
        if (typeof options.detailLimit === 'number' && Number.isFinite(options.detailLimit)) {
          rows = rows.slice(0, Math.max(0, Math.trunc(options.detailLimit)));
        }

        for (let i = 0; i < rows.length; i += DETAIL_FETCH_CONCURRENCY) {
          const chunk = rows.slice(i, i + DETAIL_FETCH_CONCURRENCY);

          const fetched = await Promise.all(
            chunk.map(async (row) => {
              try {
                const email = await fetchOrgContactEmail(row.slug);
                return { row, email, error: null as string | null };
              } catch (err) {
                return {
                  row,
                  email: null,
                  error: String(err),
                };
              }
            }),
          );

          const updates = [];

          for (const item of fetched) {
            if (item.error) {
              result.errors.push(`detail for org ${item.row.id}: ${item.error}`);
              continue;
            }

            result.detailPagesFetched++;

            if (!item.email) continue;

            result.emailsFound++;

            updates.push(
              env.DB.prepare(
                `UPDATE organizations
                      SET president_email = ?,
                          updated_at = datetime('now')
                    WHERE id = ?`,
              ).bind(item.email, item.row.id),
            );
          }

          if (updates.length > 0) {
            try {
              await env.DB.batch(updates);
            } catch (err) {
              result.errors.push(`batch email update: ${String(err)}`);
            }
          }

          if (i + DETAIL_FETCH_CONCURRENCY < rows.length) {
            await sleep(DETAIL_CHUNK_DELAY_MS);
          }
        }
      } catch (err) {
        result.errors.push(`load current-batch contacts: ${String(err)}`);
      }
    }
  }

  result.durationMs = Date.now() - startedAt;

  console.log(
    `[hornslinkOrgs] ${result.orgsProcessed} orgs, ${result.emailsFound} emails from ` +
      `${result.detailPagesFetched} roster pages, ${result.errors.length} errors, ` +
      `${result.durationMs}ms; nextSkip=${result.nextSkip ?? 'done'}`,
  );

  return result;
}

/** Cron entrypoint. Matches the ScraperEntry.run signature in registry.ts. */
export async function run(env: Env): Promise<void> {
  await scrapeHornsLinkOrgs(env);
}

/** Manual entrypoint for POST /events/scrape/hornslinkOrgs. */
export async function manual(env: Env, options: Record<string, unknown>): Promise<unknown> {
  if (typeof options.refreshOrgId === 'number' && Number.isFinite(options.refreshOrgId)) {
    const orgId = Math.trunc(options.refreshOrgId);

    return refreshOrgContactEmail(env.DB, orgId);
  }

  if (typeof options.testContactSlug === 'string') {
    const slug = options.testContactSlug;

    try {
      const email = await fetchOrgContactEmail(slug);

      return {
        ok: true,
        slug,
        email,
      };
    } catch (err) {
      return {
        ok: false,
        slug,
        error: String(err),
      };
    }
  }

  return scrapeHornsLinkOrgs(env, {
    skipDetails: options.skipDetails === true,
    dryRun: options.dryRun === true,

    skip:
      typeof options.skip === 'number' && Number.isFinite(options.skip)
        ? Math.max(0, Math.trunc(options.skip))
        : 0,

    take:
      typeof options.take === 'number' && Number.isFinite(options.take)
        ? Math.min(MAX_DIRECTORY_BATCH_SIZE, Math.max(1, Math.trunc(options.take)))
        : MAX_DIRECTORY_BATCH_SIZE,

    detailLimit:
      typeof options.detailLimit === 'number' && Number.isFinite(options.detailLimit)
        ? Math.max(0, Math.trunc(options.detailLimit))
        : undefined,
  });
}
