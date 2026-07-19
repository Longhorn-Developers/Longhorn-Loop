// =====================================================================
// RSVP store — backed by the real API.
//
// Endpoints used:
//   POST   /events/:id/rsvp   (auth-gated, idempotent)
//   DELETE /events/:id/rsvp   (auth-gated)
//
// `is_rsvped` on GET /events/:id is the authoritative source for initial
// RSVP state — callers should prefer reading that field from the event
// query rather than calling isRsvped() as a separate request.
//
// All functions accept an optional `token` parameter. When omitted or
// null (unauthenticated), writes are silently skipped and reads return
// false / empty, so the UI degrades gracefully.
// =====================================================================

import { api } from './api';

export async function getRsvpedIds(_token?: string | null): Promise<number[]> {
  // No batch endpoint exists yet. Callers that need per-event state should
  // read `is_rsvped` from the GET /events/:id response instead.
  return [];
}

export async function isRsvped(eventId: number, token?: string | null): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await api.get<{ is_rsvped?: boolean }>(`/events/${eventId}`, { token });
    return res.is_rsvped ?? false;
  } catch {
    return false;
  }
}

export async function addRsvp(eventId: number, token?: string | null): Promise<void> {
  if (!token) return;
  await api.post(`/events/${eventId}/rsvp`, { token });
}

export async function removeRsvp(eventId: number, token?: string | null): Promise<void> {
  if (!token) return;
  await api.delete(`/events/${eventId}/rsvp`, { token });
}
