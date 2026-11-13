// Org meeting times (LOOP-319). Queries only; who may call them is decided
// in routes/orgs.worker.ts: members READ, admins WRITE. The member check for
// reads is the whole point -- non-members must not get these rows from the
// API, not merely have them hidden by the app.

import type { OrgMeeting, OrgMeetingInput } from '../../../shared/orgMeetings';

const COLUMNS = 'id, label, day_of_week, start_time, end_time, location, notes';

export async function listMeetings(db: D1Database, orgId: number): Promise<OrgMeeting[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COLUMNS} FROM org_meetings
        WHERE org_id = ?
        ORDER BY day_of_week, start_time, id`,
    )
    .bind(orgId)
    .all<OrgMeeting>();
  return results ?? [];
}

export async function countMeetings(db: D1Database, orgId: number): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS c FROM org_meetings WHERE org_id = ?')
    .bind(orgId)
    .first<{ c: number }>();
  return Number(row?.c ?? 0);
}

export async function createMeeting(
  db: D1Database,
  orgId: number,
  m: OrgMeetingInput,
): Promise<OrgMeeting | null> {
  return db
    .prepare(
      `INSERT INTO org_meetings (org_id, label, day_of_week, start_time, end_time, location, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING ${COLUMNS}`,
    )
    .bind(orgId, m.label, m.day_of_week, m.start_time, m.end_time, m.location, m.notes)
    .first<OrgMeeting>();
}

/**
 * Scoped to the org as well as the id, so an admin of one org can't edit
 * another org's meeting by guessing its id. Null when no such meeting.
 */
export async function updateMeeting(
  db: D1Database,
  orgId: number,
  meetingId: number,
  m: OrgMeetingInput,
): Promise<OrgMeeting | null> {
  return db
    .prepare(
      `UPDATE org_meetings
          SET label = ?, day_of_week = ?, start_time = ?, end_time = ?,
              location = ?, notes = ?, updated_at = datetime('now')
        WHERE id = ? AND org_id = ?
        RETURNING ${COLUMNS}`,
    )
    .bind(m.label, m.day_of_week, m.start_time, m.end_time, m.location, m.notes, meetingId, orgId)
    .first<OrgMeeting>();
}

/** Same org scoping as updateMeeting. True when a row was deleted. */
export async function deleteMeeting(
  db: D1Database,
  orgId: number,
  meetingId: number,
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM org_meetings WHERE id = ? AND org_id = ?')
    .bind(meetingId, orgId)
    .run();
  return Number(result.meta?.changes ?? 0) > 0;
}
