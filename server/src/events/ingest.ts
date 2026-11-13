// Writes NormalizedEvent[] into D1. Only place that knows the schema.

import { eventIdSql, eventTagStatements, type ClassifierMatch } from '../lib/classifier';
import { isNonPhysicalLocation, resolveBuilding } from '../lib/utBuildings';
import { classifyEventsBatch } from '../lib/semanticTags';
import type { Env } from '../worker';
import type { IngestResult, NormalizedEvent } from './types';

// LOOP-150 retention window. Purge job uses expires_at.
const EXPIRES_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function computeExpiresAt(endDatetime: string | null, startDatetime: string): string {
  const base = endDatetime ?? startDatetime;
  return new Date(new Date(base).getTime() + EXPIRES_AFTER_MS).toISOString();
}

/**
 * Shared organization shape for anything that needs to write to the
 * organizations table.
 *
 * HornsLink calls the stored contact the primary contact. The database column
 * is still named president_email for compatibility with the existing claim
 * flow, so callers pass it here as contactEmail.
 */
export interface OrganizationUpsertInput {
  id: number;
  name: string;
  slug?: string | null;
  profilePicture?: string | null;
  contactEmail?: string | null;
  source: string;
}

/**
 * Upsert one or more organizations.
 *
 * Keeping this here means scrapers only normalize/fetch organization data;
 * ingest remains the place that knows the organizations table schema.
 */
export async function upsertOrganizations(
  db: D1Database,
  organizations: OrganizationUpsertInput[],
): Promise<void> {
  if (organizations.length === 0) return;
  await db.batch(organizations.map((org) => organizationUpsertStatement(db, org)));
}

function organizationUpsertStatement(
  db: D1Database,
  org: OrganizationUpsertInput,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO organizations (
        id,
        name,
        slug,
        profile_picture,
        president_email,
        source,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        name            = excluded.name,
        slug            = COALESCE(excluded.slug, slug),
        profile_picture = COALESCE(excluded.profile_picture, profile_picture),
        president_email = COALESCE(excluded.president_email, president_email),
        updated_at      = datetime('now')`,
    )
    .bind(
      org.id,
      org.name.trim(),
      org.slug ?? null,
      org.profilePicture ?? null,
      org.contactEmail ?? null,
      org.source,
    );
}

// ---------------------------------------------------------------------------
// BULK INGEST AND THE D1 PER-INVOCATION QUERY CAP (LOOP-309).
//
// D1 allows 1,000 queries per Worker invocation on Workers Paid and 50 on
// Free. Every scraper runs its whole ingest inside one invocation (the cron
// dispatches POST /events/scrape/:name), and the old loop spent 8-10 queries
// per event: a SELECT for the id, the INSERT/UPDATE, two DELETEs, one INSERT
// per category, benefit and tag. That caps a run at ~100-120 events on Paid
// and ~5 on Free, with every event past the cap thrown away as an error --
// and since the cap hits in feed order, the same first events land every run
// and the rest never do. Probing the scrapers live (dry run) found every one
// of them fetching and parsing fine: law parsed 129 events while prod held 11.
//
// A db.batch() counts as ONE query however many statements it holds, so:
//   * one lookup per LOOKUP_CHUNK events finds which already exist,
//   * the writes for WRITE_CHUNK events go out as one batch, the event row
//     and its children together -- children find their parent through the
//     (source, source_event_id) natural key, because a new row's id isn't
//     known until the batch runs.
// ~720 Texas Today events now cost ~45 queries, not ~6,000.
//
// A batch is a transaction, so one bad row would roll back its whole chunk.
// A failed chunk is therefore retried one event per batch, which keeps the
// old guarantee that one bad row doesn't sink the others.
// ---------------------------------------------------------------------------

/** IN-list size per lookup. D1 binds at most 100 params per statement; +1 for source. */
const LOOKUP_CHUNK = 90;
/** Events per write batch. */
const WRITE_CHUNK = 20;

interface ExistingEvent {
  title: string;
  description: string | null;
  hasTags: boolean;
}

function eventKey(event: Pick<NormalizedEvent, 'source' | 'sourceEventId'>): string {
  return `${event.source}\u0000${event.sourceEventId}`;
}

/** What is already stored for these events, keyed by eventKey. */
async function loadExistingEvents(
  db: D1Database,
  events: NormalizedEvent[],
): Promise<Map<string, ExistingEvent>> {
  const bySource = new Map<string, string[]>();
  for (const e of events) {
    const ids = bySource.get(e.source) ?? [];
    ids.push(e.sourceEventId);
    bySource.set(e.source, ids);
  }

  const existing = new Map<string, ExistingEvent>();
  for (const [source, allIds] of bySource) {
    const ids = [...new Set(allIds)];
    for (let i = 0; i < ids.length; i += LOOKUP_CHUNK) {
      const chunk = ids.slice(i, i + LOOKUP_CHUNK);
      const { results } = await db
        .prepare(
          `SELECT source_event_id, title, description,
                  EXISTS (SELECT 1 FROM event_tags t WHERE t.event_id = events.id) AS has_tags
             FROM events
            WHERE source = ? AND source_event_id IN (${chunk.map(() => '?').join(', ')})`,
        )
        .bind(source, ...chunk)
        .all<{
          source_event_id: string;
          title: string;
          description: string | null;
          has_tags: number;
        }>();
      for (const row of results ?? []) {
        existing.set(eventKey({ source, sourceEventId: row.source_event_id }), {
          title: row.title,
          description: row.description,
          hasTags: !!row.has_tags,
        });
      }
    }
  }
  return existing;
}

/**
 * Every write for one event, in dependency order: host org, the event row,
 * then its categories, benefits and (when given) tags.
 *
 * The event is an upsert on UNIQUE(source, source_event_id). The UPDATE half
 * sets exactly the columns the old explicit UPDATE did -- created_at is left
 * alone -- and re-activates the row, as before.
 *
 * `tags` null means "leave the stored tags alone": the event's title and
 * description are unchanged since it was last tagged, so re-running the paid
 * Workers AI classifier on it would only reproduce the same answer.
 */
function eventStatements(
  db: D1Database,
  event: NormalizedEvent,
  tags: ClassifierMatch[] | null,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];

  // Only event sources with a numeric org id write an event host into
  // organizations. See docs/org-profiles.md.
  if (event.organization.sourceOrgId !== null) {
    statements.push(
      organizationUpsertStatement(db, {
        id: event.organization.sourceOrgId,
        name: event.organization.name,
        slug: null,
        profilePicture: event.organization.profilePicture,
        contactEmail: null,
        source: event.source,
      }),
    );
  }

  statements.push(
    db
      .prepare(
        `INSERT INTO events (
          source, source_event_id, title, description,
          start_datetime, end_datetime, venue_type, location_short, location_full,
          latitude, longitude, host_organization_id, host_organization_name,
          event_url, rsvp_url,
          image_url, image_width, image_height,
          image_aspect_ratio, image_mime_type, image_alt_text,
          theme, visibility, rsvp_total, expires_at, status
        ) VALUES (
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?, 'active'
        )
        ON CONFLICT(source, source_event_id) DO UPDATE SET
          title = excluded.title, description = excluded.description,
          start_datetime = excluded.start_datetime, end_datetime = excluded.end_datetime,
          venue_type = excluded.venue_type, location_short = excluded.location_short,
          location_full = excluded.location_full,
          latitude = excluded.latitude, longitude = excluded.longitude,
          host_organization_id = excluded.host_organization_id,
          host_organization_name = excluded.host_organization_name,
          event_url = excluded.event_url, rsvp_url = excluded.rsvp_url,
          image_url = excluded.image_url, image_width = excluded.image_width,
          image_height = excluded.image_height,
          image_aspect_ratio = excluded.image_aspect_ratio,
          image_mime_type = excluded.image_mime_type,
          image_alt_text = excluded.image_alt_text,
          theme = excluded.theme, visibility = excluded.visibility,
          rsvp_total = excluded.rsvp_total, expires_at = excluded.expires_at,
          status = 'active', updated_at = datetime('now')`,
      )
      .bind(
        event.source,
        event.sourceEventId,
        event.title,
        event.description,
        event.startDatetime,
        event.endDatetime,
        event.venueType,
        event.locationShort,
        event.locationFull,
        event.latitude,
        event.longitude,
        event.organization.sourceOrgId,
        event.organization.name.trim(),
        event.eventUrl,
        event.rsvpUrl,
        event.imageUrl,
        event.imageWidth,
        event.imageHeight,
        event.imageAspectRatio,
        event.imageMimeType,
        event.imageAltText,
        event.theme,
        event.visibility,
        event.rsvpTotal,
        computeExpiresAt(event.endDatetime, event.startDatetime),
      ),
  );

  const ref = { source: event.source, sourceEventId: event.sourceEventId };
  const id = eventIdSql(ref);

  statements.push(
    db.prepare(`DELETE FROM event_categories WHERE event_id = ${id.sql}`).bind(...id.binds),
    db.prepare(`DELETE FROM event_benefits WHERE event_id = ${id.sql}`).bind(...id.binds),
    ...event.categories.map((cat) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO event_categories (event_id, category_id, category_name)
           VALUES (${id.sql}, ?, ?)`,
        )
        .bind(...id.binds, cat.id, cat.name),
    ),
    ...event.benefits.map((benefit) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO event_benefits (event_id, benefit_name)
           VALUES (${id.sql}, ?)`,
        )
        .bind(...id.binds, benefit),
    ),
  );

  if (tags) statements.push(...eventTagStatements(db, ref, tags));

  return statements;
}

/**
 * Fill in coordinates for events whose scraper could not.
 *
 * HERE, not in each scraper and not on the client.
 *
 * Ten of the twelve scrapers hardcode `latitude: null` -- they get a location
 * string from their feed and nothing more. Doing this in each of them would be
 * the same code ten times and would miss the eleventh the day someone adds it.
 * ingestEvents is the one place every scraped event passes through.
 *
 * Server-side rather than in the map for the same reason: resolved coordinates
 * land in D1, so the Explore pins, the event detail's location modal and
 * anything built later all read them from the row. On the client it would be
 * recomputed on every render and would only ever fix the map.
 *
 * A scraper that DID supply coordinates keeps them. HornsLink and Pharmacy
 * publish real ones, and a building centroid is a worse answer than the point
 * the organiser actually gave.
 */
function attachBuildingCoordinates(events: NormalizedEvent[]): void {
  // One warning per distinct location per run. Without this a single
  // unrecognised building produces a line for every event held in it, which on
  // a busy scrape is hundreds of identical lines.
  const warned = new Set<string>();

  for (const event of events) {
    if (event.latitude != null && event.longitude != null) continue;
    if (event.venueType === 'online') continue;

    const location = event.locationFull ?? event.locationShort;
    if (isNonPhysicalLocation(location)) continue;

    const building = resolveBuilding(location);
    if (!building) {
      const key = (location ?? '').trim().toUpperCase();
      if (key && !warned.has(key)) {
        warned.add(key);
        console.warn('[ingest] unresolved event location', {
          source: event.source,
          sourceEventId: event.sourceEventId,
          location,
        });
      }
      continue;
    }

    event.latitude = building.latitude;
    event.longitude = building.longitude;
    // locationShort carries the code so a pin's card can say GSB rather than
    // repeating the full address, and so the resolution is visible in the data
    // rather than only in the coordinates.
    if (!event.locationShort) event.locationShort = building.code;
  }
}

// Per-event errors are isolated so one bad row doesn't sink the others (see the
// BULK INGEST note above for how that survives batching). Takes the whole env
// (not just db) because tagging needs Workers AI.
export async function ingestEvents(env: Env, events: NormalizedEvent[]): Promise<IngestResult> {
  const db = env.DB;
  const result: IngestResult = { inserted: 0, updated: 0, errors: [] };
  if (events.length === 0) return result;

  attachBuildingCoordinates(events);

  const existing = await loadExistingEvents(db, events);

  // Classify only what is new, changed, or was never tagged. Every run used to
  // re-send every event to Workers AI -- ~720 Texas Today events, every six
  // hours -- to get back the tags it already had. tags[i] lines up with
  // events[i]; null means keep what's stored.
  const tags: (ClassifierMatch[] | null)[] = events.map(() => null);
  const toClassify: number[] = [];
  events.forEach((event, i) => {
    const row = existing.get(eventKey(event));
    const unchanged =
      row &&
      row.hasTags &&
      row.title === event.title &&
      (row.description ?? null) === (event.description ?? null);
    if (!unchanged) toClassify.push(i);
  });
  if (toClassify.length > 0) {
    const classified = await classifyEventsBatch(
      env,
      toClassify.map((i) => ({ title: events[i].title, description: events[i].description })),
    );
    toClassify.forEach((eventIndex, j) => {
      tags[eventIndex] = classified[j];
    });
  }

  // A key seen earlier in this same run is an update the second time, even
  // though the lookup ran before either was written.
  const seen = new Set(existing.keys());
  const countWrite = (event: NormalizedEvent) => {
    const key = eventKey(event);
    if (seen.has(key)) result.updated++;
    else {
      result.inserted++;
      seen.add(key);
    }
  };
  const failure = (event: NormalizedEvent, err: unknown) => {
    const msg = `Failed to ingest event ${event.source}:${event.sourceEventId} ("${event.title}"): ${err}`;
    console.error(`[ingest] ${msg}`);
    result.errors.push(msg);
  };

  for (let i = 0; i < events.length; i += WRITE_CHUNK) {
    const chunk = events.slice(i, i + WRITE_CHUNK).map((event, j) => ({
      event,
      tags: tags[i + j],
    }));

    try {
      await db.batch(chunk.flatMap(({ event, tags: t }) => eventStatements(db, event, t)));
      chunk.forEach(({ event }) => countWrite(event));
    } catch (chunkErr) {
      // The whole chunk rolled back. Retry each event alone so the bad one is
      // named and the rest still land.
      console.warn(
        `[ingest] write batch of ${chunk.length} failed, retrying per event: ${chunkErr}`,
      );
      for (const { event, tags: t } of chunk) {
        try {
          await db.batch(eventStatements(db, event, t));
          countWrite(event);
        } catch (err) {
          failure(event, err);
        }
      }
    }
  }

  return result;
}
