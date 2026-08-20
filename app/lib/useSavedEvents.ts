// One place where "save / unsave an event" lives.
//
// Five screens used to carry their own copy of this mutation and they
// disagreed about which caches a save touches: Profile invalidated My Events
// but not the saved list, while Home, Explore, View All and the event detail
// screen invalidated the saved list but not My Events. The result was that
// bookmarking anywhere left the *other* surface showing stale state — most
// visibly, saving from Home never appeared under Profile > Saved (and never
// bumped its count) until the app was reloaded from cold.
//
// Everything that renders a bookmark should use this hook so there is exactly
// one definition of what a save invalidates.

import type { ApiEvent } from '@/app/components/EventCard';
import { api } from '@/app/lib/api';
import { events as eventsKeys, saved as savedKeys, user as userKeys } from '@/app/lib/queryKeys';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import React from 'react';

export type SavedListResponse = { events: ApiEvent[] };

type MyEventsCache = {
  events: (ApiEvent & { is_saved?: boolean })[];
  counts?: Record<string, number>;
};

type ToggleVariables = { eventId: number; wasSaved: boolean };
type ToggleContext = { previous?: SavedListResponse };

// Flip is_saved on the profile's My Events grid in the same tick as the
// bookmark itself, so the icon doesn't wait for a round trip to change.
// Counts still come from the refetch in onSettled — they depend on server-side
// filtering (upcoming only) that we can't reproduce here.
function patchMyEventsCache(queryClient: QueryClient, eventId: number, isSaved: boolean) {
  queryClient.setQueriesData<MyEventsCache>({ queryKey: userKeys.myEventsAll() }, (old) => {
    if (!old?.events?.some((e) => e.id === eventId)) return old;
    return {
      ...old,
      events: old.events.map((e) => (e.id === eventId ? { ...e, is_saved: isSaved } : e)),
    };
  });
}

/**
 * Saved-event state plus the toggle. `token` may be null — the query stays
 * disabled and `toggleSave` becomes a no-op, so signed-out screens can call
 * this unconditionally.
 */
export function useSavedEvents(token: string | null) {
  const queryClient = useQueryClient();

  const savedQuery = useQuery({
    queryKey: savedKeys.list(),
    queryFn: () => api.get<SavedListResponse>('/saved', { token }),
    enabled: !!token,
  });

  const savedIds = React.useMemo(
    () => new Set((savedQuery.data?.events ?? []).map((e) => e.id)),
    [savedQuery.data],
  );

  const mutation = useMutation<void, unknown, ToggleVariables, ToggleContext>({
    mutationFn: async ({ eventId, wasSaved }) => {
      if (wasSaved) {
        await api.delete(`/saved/${eventId}`, { token });
      } else {
        await api.post(`/saved/${eventId}`, { token });
      }
    },
    onMutate: async ({ eventId, wasSaved }) => {
      await queryClient.cancelQueries({ queryKey: savedKeys.list() });
      const previous = queryClient.getQueryData<SavedListResponse>(savedKeys.list());

      queryClient.setQueryData<SavedListResponse>(savedKeys.list(), (old) => {
        const list = old?.events ?? [];
        if (wasSaved) return { events: list.filter((e) => e.id !== eventId) };
        // Double-tap guard: re-adding an id already in the list would leave a
        // duplicate that only a refetch clears.
        if (list.some((e) => e.id === eventId)) return { events: list };
        // Only the id is known here. Callers read this list as a set of ids
        // (see savedIds), and onSettled refetches the real rows, so an
        // id-only placeholder is enough to flip the bookmark immediately.
        return { events: [...list, { id: eventId } as ApiEvent] };
      });

      patchMyEventsCache(queryClient, eventId, !wasSaved);

      return { previous };
    },
    onError: (_err, variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(savedKeys.list(), context.previous);
      }
      // Put the profile grid back too, otherwise a failed save leaves a filled
      // bookmark behind on a screen we never rolled back.
      patchMyEventsCache(queryClient, variables.eventId, variables.wasSaved);
    },
    onSettled: (_data, _error, variables) => {
      // Every surface that renders a bookmark, a saved count or a saved list.
      queryClient.invalidateQueries({ queryKey: savedKeys.list() });
      queryClient.invalidateQueries({ queryKey: userKeys.myEventsAll() });
      queryClient.invalidateQueries({ queryKey: eventsKeys.detail(variables.eventId) });
    },
  });

  const { mutate } = mutation;

  const toggleSave = React.useCallback(
    (eventId: number, wasSaved?: boolean) => {
      if (!token) return;
      mutate({ eventId, wasSaved: wasSaved ?? savedIds.has(eventId) });
    },
    [mutate, savedIds, token],
  );

  const isSaved = React.useCallback((eventId: number) => savedIds.has(eventId), [savedIds]);

  return { savedQuery, savedIds, isSaved, toggleSave, isToggling: mutation.isPending };
}
