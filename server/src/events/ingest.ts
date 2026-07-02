// Writes NormalizedEvent[] into D1. Only place that knows the schema.

import type { IngestResult, NormalizedEvent } from './types';

// LOOP-150 retention window. Purge job uses expires_at.
const EXPIRES_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function computeExpiresAt(endDatetime: string | null, startDatetime: string): string {
  const base = endDatetime ?? startDatetime;
  return new Date(new Date(base).getTime() + EXPIRES_AFTER_MS).toISOString();
}

// Only sources with a numeric org id write to organizations. See
// docs/org-profiles.md.
async function upsertOrganization(db: D1Database, event: NormalizedEvent): Promise<void> {
  if (event.organization.sourceOrgId === null) return;
  await db
    .prepare(
      `INSERT INTO organizations (id, name, profile_picture, source, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         profile_picture = excluded.profile_picture,
         updated_at = datetime('now')`,
    )
    .bind(
      event.organization.sourceOrgId,
      event.organization.name.trim(),
      event.organization.profilePicture,
      event.source,
    )
    .run();
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
          location_short = ?, location_full = ?, latitude = ?, longitude = ?,
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
        start_datetime, end_datetime, location_short, location_full,
        latitude, longitude, host_organization_id, host_organization_name,
        event_url, rsvp_url,
        image_url, image_width, image_height,
        image_aspect_ratio, image_mime_type, image_alt_text,
        theme, visibility, rsvp_total, expires_at, status
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?, ?,
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
export async function ingestEvents(
  db: D1Database,
  events: NormalizedEvent[],
): Promise<IngestResult> {
  const result: IngestResult = { inserted: 0, updated: 0, errors: [] };

  for (const event of events) {
    try {
      await upsertOrganization(db, event);
      const { eventId, isNew } = await upsertEvent(db, event);
      await replaceCategoriesAndBenefits(db, eventId, event);
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
