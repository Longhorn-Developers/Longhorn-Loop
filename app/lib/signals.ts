// Engagement signals for scoring
// Endpoints used:
// POST /events/:id/view   (auth-gated, idempotent, deduped per user)

import { api } from './api';

export async function recordView(eventId: number, token?: string | null): Promise<void> {
  if (!token) return;
  try {
    await api.post(`/events/${eventId}/view`, { token });
  } catch {
    // ignore failures
  }
}
