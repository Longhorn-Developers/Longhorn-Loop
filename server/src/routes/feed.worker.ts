// Ranks upcoming events with server/src/lib/scoring.ts and groups them into carousels
//   Endpoints:
//   GET /feed/home        Upcoming + one carousel per user-selected bucket
//   GET /feed/explore     single ranked list across all buckets
//   GET /feed/bucket/:id  single bucket, ranked

import { Hono } from 'hono';
import { BUCKET_ID_SET, TAXONOMY_BUCKETS } from '../../../shared/taxonomy';
import {
  rankEvents,
  type ScorableEvent,
  type ScorableTag,
  type UserInterest,
} from '../lib/scoring';
import { blockedAuthorFilter } from '../lib/blocks';
import { getAuthUser, getUserId } from '../lib/utils';
import type { Env } from '../worker';

export const feedRoutes = new Hono<{ Bindings: Env }>();

const REPORT_HIDE_THRESHOLD = 5;
// Cap the candidate pool we score in-memory. Well above the current event
// volume; revisit with pagination if the catalog grows past this.
const MAX_CANDIDATES = 500;
const HOME_CAROUSEL_SIZE = 12;
const MIN_CAROUSEL_SIZE = 3; // hide near-empty personalized rows

// D1 caps bound parameters at 100 per statement. Chunk conservatively so an
// optional leading param (userId) still fits.
const ID_CHUNK_SIZE = 90;

/**
 * Run `${baseSql} WHERE [user_id = ? AND] event_id IN (...)` across the event
 * id list in chunks and return the concatenated rows. Pass `userId` to prepend
 * the `user_id = ?` filter (for saved_events / event_rsvps).
 */
async function queryByEventIds(
  db: D1Database,
  baseSql: string,
  ids: number[],
  userId?: number,
): Promise<Record<string, unknown>[]> {
  const chunkParamBudget = userId === undefined ? ID_CHUNK_SIZE : ID_CHUNK_SIZE - 1;
  const out: Record<string, unknown>[] = [];

  for (let i = 0; i < ids.length; i += chunkParamBudget) {
    const chunk = ids.slice(i, i + chunkParamBudget);
    const placeholders = chunk.map(() => '?').join(',');
    const where =
      userId === undefined
        ? `WHERE event_id IN (${placeholders})`
        : `WHERE user_id = ? AND event_id IN (${placeholders})`;
    const binds = userId === undefined ? chunk : [userId, ...chunk];

    const res = await db
      .prepare(`${baseSql} ${where}`)
      .bind(...binds)
      .all();
    out.push(...(res.results as Record<string, unknown>[]));
  }

  return out;
}

// A feed event = the full events row + org picture, enriched with the derived
// arrays the app expects, plus is_saved/is_rsvped and the scoring fields.
type FeedEvent = Record<string, unknown> &
  ScorableEvent & {
    tags: string[]; // app-facing tag names (scoredTags carries scores for ranking)
    categories: { id: string; name: string }[];
    benefits: string[];
    is_saved: boolean;
    is_rsvped: boolean;
    org_profile_picture: string | null;
  };

/**
 * Load the event pool once: all active, upcoming, visible events plus the
 * per-event tag/category/benefit arrays and the caller's saved/rsvp state.
 * Batched (a handful of queries total)
 */
async function loadCandidates(db: D1Database, userId: number | null): Promise<FeedEvent[]> {
  const params: unknown[] = [REPORT_HIDE_THRESHOLD];
  let visibilitySql = `
    AND (SELECT COUNT(*) FROM event_reports er WHERE er.event_id = e.id) < ?
  `;
  if (userId !== null) {
    visibilitySql += `
      AND NOT EXISTS (
        SELECT 1 FROM event_reports er2 WHERE er2.event_id = e.id AND er2.user_id = ?
      )
    `;
    params.push(userId);
  }

  // Blocking (LOOP-180) hides a blocked user's events from the feed in BOTH
  // directions. Applied to the candidate pool rather than after ranking, so a
  // blocked author's event can't occupy a slot in a carousel and then be
  // filtered out, leaving the row short. Scraped events (created_by_user_id
  // NULL) belong to no user and are never hidden.
  const blocked = blockedAuthorFilter(userId);
  visibilitySql += blocked.sql;
  params.push(...blocked.params);

  const rows = await db
    .prepare(
      `SELECT e.*, o.profile_picture as org_profile_picture
       FROM events e
       LEFT JOIN organizations o ON e.host_organization_id = o.id
       WHERE e.status = 'active'
         AND e.is_archived = 0
         -- COALESCE, not a bare end_datetime compare. end_datetime is nullable
         -- (EventInput.endDatetime is string | null) and in SQL, NULL > x is
         -- NULL, so every event a scraper could not find an end time for was
         -- silently dropped from all three feeds -- while still appearing under
         -- Profile > My Events, which already coalesces.
         AND COALESCE(e.end_datetime, e.start_datetime) > datetime('now')
         ${visibilitySql}
       ORDER BY e.start_datetime ASC
       LIMIT ?`,
    )
    .bind(...params, MAX_CANDIDATES)
    .all();

  const events = rows.results as Record<string, unknown>[];
  if (events.length === 0) return [];

  const ids = events.map((e) => e.id as number);

  // Batch-fetch the per-event arrays for the whole pool. D1 caps bound params
  // at 100 per statement, so IN-list queries are chunked (see queryByEventIds).
  const [tagRows, catRows, benefitRows, savedRows, rsvpRows] = await Promise.all([
    queryByEventIds(db, 'SELECT event_id, bucket_id, tag, score FROM event_tags', ids),
    queryByEventIds(db, 'SELECT event_id, category_id, category_name FROM event_categories', ids),
    queryByEventIds(db, 'SELECT event_id, benefit_name FROM event_benefits', ids),
    userId === null
      ? Promise.resolve([] as Record<string, unknown>[])
      : queryByEventIds(db, 'SELECT event_id FROM saved_events', ids, userId),
    userId === null
      ? Promise.resolve([] as Record<string, unknown>[])
      : queryByEventIds(db, 'SELECT event_id FROM event_rsvps', ids, userId),
  ]);

  // Index the arrays by event_id. We keep two tag shapes: `tags` (plain names)
  // for the app response, and `scoredTags` (name + confidence) for the ranker.
  const tagsByEvent = new Map<number, string[]>();
  const scoredTagsByEvent = new Map<number, ScorableTag[]>();
  const bucketsByEvent = new Map<number, Set<string>>();
  for (const r of tagRows as any[]) {
    const eid = r.event_id as number;
    const tag = r.tag as string;
    if (!tagsByEvent.has(eid)) tagsByEvent.set(eid, []);
    tagsByEvent.get(eid)!.push(tag);
    if (!scoredTagsByEvent.has(eid)) scoredTagsByEvent.set(eid, []);
    scoredTagsByEvent.get(eid)!.push({ tag, score: (r.score as number | null) ?? null });
    if (!bucketsByEvent.has(eid)) bucketsByEvent.set(eid, new Set());
    bucketsByEvent.get(eid)!.add(r.bucket_id as string);
  }

  const catsByEvent = new Map<number, { id: string; name: string }[]>();
  for (const r of catRows as any[]) {
    const eid = r.event_id as number;
    if (!catsByEvent.has(eid)) catsByEvent.set(eid, []);
    catsByEvent.get(eid)!.push({ id: r.category_id as string, name: r.category_name as string });
  }

  const benefitsByEvent = new Map<number, string[]>();
  for (const r of benefitRows as any[]) {
    const eid = r.event_id as number;
    if (!benefitsByEvent.has(eid)) benefitsByEvent.set(eid, []);
    benefitsByEvent.get(eid)!.push(r.benefit_name as string);
  }

  const savedSet = new Set((savedRows as any[]).map((r) => r.event_id as number));
  const rsvpSet = new Set((rsvpRows as any[]).map((r) => r.event_id as number));

  const enriched: FeedEvent[] = events.map((e) => {
    const id = e.id as number;
    return {
      ...e,
      id,
      start_datetime: e.start_datetime as string,
      is_featured: (e.is_featured as number) ?? 0,
      save_count: (e.save_count as number) ?? 0,
      rsvp_count: (e.rsvp_count as number) ?? 0,
      view_count: (e.view_count as number) ?? 0,
      tags: tagsByEvent.get(id) ?? [],
      scoredTags: scoredTagsByEvent.get(id) ?? [],
      bucketIds: Array.from(bucketsByEvent.get(id) ?? []),
      categories: catsByEvent.get(id) ?? [],
      benefits: benefitsByEvent.get(id) ?? [],
      is_saved: savedSet.has(id),
      is_rsvped: rsvpSet.has(id),
      org_profile_picture: (e.org_profile_picture as string | null) ?? null,
    };
  });

  return dedupeRecurring(enriched);
}

/**
 * Collapse recurring series to their next-upcoming occurrence.
 *
 * Scrapers emit each occurrence of a recurring event as its own row (e.g.
 * "Bowden Fellows Speaker Series" 7x). Key on title + host org: same title AND
 * org is a series we collapse; same title across DIFFERENT orgs (four clubs'
 * "General Meeting") stays distinct. Input is sorted soonest-first, so the
 * first occurrence per key is the next upcoming.
 */
function dedupeRecurring(events: FeedEvent[]): FeedEvent[] {
  const seen = new Set<string>();
  const out: FeedEvent[] = [];
  for (const e of events) {
    const title = ((e.title as string) ?? '').trim().toLowerCase();
    const org = ((e.host_organization_name as string) ?? '').trim().toLowerCase();
    // Only dedup when we can key on a real (title, org) pair; otherwise keep.
    const key = title && org ? `${title} ${org}` : null;
    if (key !== null) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(e);
  }
  return out;
}

/** Build the caller's interest profile from user_tags + derived buckets. */
async function loadUserInterest(db: D1Database, userId: number | null): Promise<UserInterest> {
  if (userId === null) return { tags: new Set(), bucketIds: new Set() };

  const tagRows = await db
    .prepare('SELECT tag FROM user_tags WHERE user_id = ?')
    .bind(userId)
    .all();
  const tags = new Set((tagRows.results as any[]).map((r) => r.tag as string));

  // Derive the buckets those tags belong to, from the shared taxonomy.
  const bucketIds = new Set<string>();
  for (const bucket of TAXONOMY_BUCKETS) {
    if (bucket.tags.some((t) => tags.has(t))) bucketIds.add(bucket.id);
  }
  return { tags, bucketIds };
}

// GET /feed/home: Upcoming + one ranked carousel per user-selected bucket.
feedRoutes.get('/home', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  const userId = auth ? await getUserId(c.env.DB, auth.email) : null;

  const [candidates, interest] = await Promise.all([
    loadCandidates(c.env.DB, userId),
    loadUserInterest(c.env.DB, userId),
  ]);
  const nowMs = Date.now();

  // "Upcoming" is the soonest events, lightly ranked (timeliness dominates here
  // because they're already the nearest in time).
  const upcoming = rankEvents(candidates, interest, nowMs).slice(0, HOME_CAROUSEL_SIZE);

  // One carousel per bucket the user selected, ranked within the bucket.
  const carousels: { bucketId: string; label: string; events: FeedEvent[] }[] = [];
  for (const bucket of TAXONOMY_BUCKETS) {
    if (!interest.bucketIds.has(bucket.id)) continue;
    const inBucket = candidates.filter((e) => e.bucketIds.includes(bucket.id));
    if (inBucket.length < MIN_CAROUSEL_SIZE) continue; // don't show near-empty rows
    carousels.push({
      bucketId: bucket.id,
      label: bucket.label,
      events: rankEvents(inBucket, interest, nowMs).slice(0, HOME_CAROUSEL_SIZE),
    });
  }

  return c.json({
    sections: [
      { key: 'upcoming', label: 'Upcoming', events: upcoming },
      ...carousels.map((car) => ({
        key: `bucket:${car.bucketId}`,
        label: car.label,
        bucketId: car.bucketId,
        events: car.events,
      })),
    ],
  });
});

// GET /feed/explore: one ranked list across all buckets.
// TODO: Need to lower weight in interest and make sure it can filter
// per the different categories, organizations, and filters
feedRoutes.get('/explore', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  const userId = auth ? await getUserId(c.env.DB, auth.email) : null;
  const limit = Math.min(parseInt(c.req.query('limit') || '100'), MAX_CANDIDATES);

  const [candidates, interest] = await Promise.all([
    loadCandidates(c.env.DB, userId),
    loadUserInterest(c.env.DB, userId),
  ]);

  const ranked = rankEvents(candidates, interest, Date.now()).slice(0, limit);
  return c.json({ events: ranked, total: ranked.length });
});

// GET /feed/bucket/:id -- single bucket, ranked.
feedRoutes.get('/bucket/:id', async (c) => {
  const bucketId = c.req.param('id');
  if (!BUCKET_ID_SET.has(bucketId)) return c.json({ error: 'UNKNOWN_BUCKET' }, 404);

  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  const userId = auth ? await getUserId(c.env.DB, auth.email) : null;
  const limit = Math.min(parseInt(c.req.query('limit') || '100'), MAX_CANDIDATES);

  const [candidates, interest] = await Promise.all([
    loadCandidates(c.env.DB, userId),
    loadUserInterest(c.env.DB, userId),
  ]);

  const inBucket = candidates.filter((e) => e.bucketIds.includes(bucketId));
  const ranked = rankEvents(inBucket, interest, Date.now()).slice(0, limit);

  const label = TAXONOMY_BUCKETS.find((b) => b.id === bucketId)?.label ?? bucketId;
  return c.json({ bucketId, label, events: ranked, total: ranked.length });
});
