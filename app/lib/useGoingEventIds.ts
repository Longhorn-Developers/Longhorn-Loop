// Which events the signed-in user has RSVP'd to, as a Set of ids.
//
// Event LIST rows don't carry `is_rsvped` -- only GET /events/:id does (see
// rsvpStore.ts) -- so a list that wants "✓ Going" on the right rows has to
// learn the set some other way. GET /users/me/events?tab=going is the user's
// own Going list, one request, and already cached by the Profile tab.
//
// The query key is deliberately the Profile tab's default Going key, so the
// two share one cache entry: RSVPing from an event page invalidates
// user.myEventsAll(), and both screens pick the change up together.

import type { ApiEvent } from '@/app/components/EventCard';
import { api } from '@/app/lib/api';
import { user as userKeys } from '@/app/lib/queryKeys';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

interface MyEventsResponse {
  events: Pick<ApiEvent, 'id'>[];
}

export function useGoingEventIds(token: string | null): Set<number> {
  const query = useQuery({
    queryKey: userKeys.myEvents({ tab: 'going', q: '', filter: 'all', sort: 'date' }),
    queryFn: () =>
      api.get<MyEventsResponse>('/users/me/events?tab=going&filter=all&sort=date', { token }),
    enabled: !!token,
  });
  return useMemo(() => new Set((query.data?.events ?? []).map((e) => e.id)), [query.data]);
}
