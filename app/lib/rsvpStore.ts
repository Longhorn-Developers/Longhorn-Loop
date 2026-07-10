// =====================================================================
// TEMPORARY IN-MEMORY RSVP STORE
//
// This module is a stand-in until the backend RSVP work lands. It only
// remembers RSVPs for the lifetime of the running app — close the app
// and the list is gone.
//
// TODO(backend): replace the bodies of these functions with real API
// calls once the following exist on the server:
//   - `event_rsvps(user_id, event_id, created_at)` table in D1
//   - `POST   /events/:id/rsvp`   (auth-gated, adds row)
//   - `DELETE /events/:id/rsvp`   (auth-gated, removes row)
//   - `is_rsvped` field on the GET /events/:id response
//
// Public function signatures (names + Promise return types) are chosen
// to match the eventual fetch-based implementation, so callers won't
// need to change.
// =====================================================================

const rsvpedIds = new Set<number>();

export async function getRsvpedIds(): Promise<number[]> {
  return Array.from(rsvpedIds);
}

export async function isRsvped(eventId: number): Promise<boolean> {
  return rsvpedIds.has(eventId);
}

export async function addRsvp(eventId: number): Promise<void> {
  rsvpedIds.add(eventId);
}

export async function removeRsvp(eventId: number): Promise<void> {
  rsvpedIds.delete(eventId);
}
