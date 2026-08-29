// Writes NormalizedEvent[] into D1. Only place that knows the schema.

import { writeEventTags } from '../lib/classifier';
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

  const statements = organizations.map((org) =>
    db
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
      ),
  );

  await db.batch(statements);
}

// Only event sources with a numeric org id write an event host into
// organizations. See docs/org-profiles.md.
async function upsertEventOrganization(db: D1Database, event: NormalizedEvent): Promise<void> {
  if (event.organization.sourceOrgId === null) return;

  await upsertOrganizations(db, [
    {
      id: event.organization.sourceOrgId,
      name: event.organization.name,
      slug: null,
      profilePicture: event.organization.profilePicture,
      contactEmail: null,
      source: event.source,
    },
  ]);
}

async function upsertEvent(
  db: D1Database,
  event: NormalizedEvent,
): Promise<{ eventId: number; isNew: boolean }> {
  const expiresAt = computeExpiresAt(event.endDatetime, event.startDatetime);
  const hostOrgId = event.organization.sourceOrgId;
  const hostOrgName = event.organization.name.trim();

  const existing = await db
    .prepare(`SELECT id FROM events WHERE source = ? AND source_event_id = ?`)
    .bind(event.source, event.sourceEventId)
    .first();

  if (existing) {
    await db
      .prepare(
        `UPDATE events SET
          title = ?, description = ?, start_datetime = ?, end_datetime = ?,
          venue_type = ?, location_short = ?, location_full = ?, latitude = ?, longitude = ?,
          host_organization_id = ?, host_organization_name = ?,
          event_url = ?, rsvp_url = ?,
          image_url = ?, image_width = ?, image_height = ?,
          image_aspect_ratio = ?, image_mime_type = ?, image_alt_text = ?,
          theme = ?, visibility = ?, rsvp_total = ?, expires_at = ?,
          status = 'active', updated_at = datetime('now')
        WHERE source = ? AND source_event_id = ?`,
      )
      .bind(
        event.title,
        event.description,
        event.startDatetime,
        event.endDatetime,
        event.venueType,
        event.locationShort,
        event.locationFull,
        event.latitude,
        event.longitude,
        hostOrgId,
        hostOrgName,
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
        expiresAt,
        event.source,
        event.sourceEventId,
      )
      .run();

    return { eventId: existing.id as number, isNew: false };
  }

  const result = await db
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
      )`,
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
      hostOrgId,
      hostOrgName,
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
      expiresAt,
    )
    .run();

  return { eventId: result.meta.last_row_id as number, isNew: true };
}

async function replaceCategoriesAndBenefits(
  db: D1Database,
  eventId: number,
  event: NormalizedEvent,
): Promise<void> {
  await db.prepare(`DELETE FROM event_categories WHERE event_id = ?`).bind(eventId).run();
  await db.prepare(`DELETE FROM event_benefits WHERE event_id = ?`).bind(eventId).run();

  for (const cat of event.categories) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO event_categories (event_id, category_id, category_name)
         VALUES (?, ?, ?)`,
      )
      .bind(eventId, cat.id, cat.name)
      .run();
  }

  for (const benefit of event.benefits) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO event_benefits (event_id, benefit_name)
         VALUES (?, ?)`,
      )
      .bind(eventId, benefit)
      .run();
  }
}

// Per-event errors are isolated so one bad row doesn't sink the batch.
// Takes the whole env (not just db) because tagging now needs Workers AI.
export async function ingestEvents(env: Env, events: NormalizedEvent[]): Promise<IngestResult> {
  const db = env.DB;
  const result: IngestResult = { inserted: 0, updated: 0, errors: [] };

  // Classify all events up front in one batched LLM pass. tagsByIndex[i]
  // lines up with events[i].
  const tagsByIndex = await classifyEventsBatch(
    env,
    events.map((e) => ({ title: e.title, description: e.description })),
  );

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    try {
      await upsertEventOrganization(db, event);
      const { eventId, isNew } = await upsertEvent(db, event);
      await replaceCategoriesAndBenefits(db, eventId, event);
      await writeEventTags(db, eventId, tagsByIndex[i]);
      if (isNew) result.inserted++;
      else result.updated++;
    } catch (err) {
      const msg = `Failed to ingest event ${event.source}:${event.sourceEventId} ("${event.title}"): ${err}`;
      console.error(`[ingest] ${msg}`);
      result.errors.push(msg);
    }
  }

  return result;
}
