// Centralized React Query keys so screens stay consistent.
//
// Each "domain" is a function that returns a tuple. The hierarchy lets
// `queryClient.invalidateQueries({ queryKey: events.all })` invalidate
// every events-related query at once.

export const events = {
  all: ['events'] as const,
  lists: () => [...events.all, 'list'] as const,
  list: (params: Record<string, string | undefined> = {}) => [...events.lists(), params] as const,
  details: () => [...events.all, 'detail'] as const,
  detail: (id: string | number) => [...events.details(), String(id)] as const,
  // Hangs off detail(id) so invalidating one event refreshes its attendees too.
  attendees: (id: string | number) => [...events.detail(id), 'attendees'] as const,
};

export const saved = {
  all: ['saved'] as const,
  list: () => [...saved.all, 'list'] as const,
};

export const notifications = {
  all: ['notifications'] as const,
  list: () => [...notifications.all, 'list'] as const,
};

// Current user's profile (/users/me). Linked socials and the past-events
// collections hang off the same root so one invalidate refreshes the profile.
export const user = {
  all: ['user'] as const,
  me: () => [...user.all, 'me'] as const,
  socials: () => [...user.all, 'socials'] as const,
  pastEvents: () => [...user.all, 'past-events'] as const,
  // My Events grid. The params object is part of the key so switching tab,
  // search, filter or sort is a distinct cache entry; myEventsAll() is the
  // prefix to invalidate after a save/RSVP changes any of them.
  myEventsAll: () => [...user.all, 'my-events'] as const,
  myEvents: (params: Record<string, string>) => [...user.myEventsAll(), params] as const,
};

// User settings (/settings). One row per user; `mine` is the whole thing.
export const settings = {
  all: ['settings'] as const,
  mine: () => [...settings.all, 'mine'] as const,
};

// Org Management console (/orgs/*). `mine` backs the Manage Organizations
// list on Settings; the rest are per-org console tabs.
export const org = {
  all: ['org'] as const,
  mine: () => [...org.all, 'mine'] as const,
  detail: (id: number | string) => [...org.all, 'detail', String(id)] as const,
  members: (id: number | string) => [...org.all, 'members', String(id)] as const,
  // Events tab (LOOP-136). Search/filter/sort are part of the key so each
  // combination caches separately; eventsAll() is the prefix to invalidate
  // after an edit, which has to refresh every one of them.
  eventsAll: (id: number | string) => [...org.all, 'events', String(id)] as const,
  events: (id: number | string, params: Record<string, string>) =>
    [...org.eventsAll(id), params] as const,
  // analyticsAll() is the prefix across every event-filter selection, so an
  // edit that renames an event can refresh all of them at once.
  analyticsAll: (id: number | string) => [...org.all, 'analytics', String(id)] as const,
  analytics: (id: number | string, eventFilter = 'all') =>
    [...org.analyticsAll(id), eventFilter] as const,
  notificationSettings: (id: number | string) =>
    [...org.all, 'notification-settings', String(id)] as const,
};

// Phase 3 personalized feed endpoints (/feed/*).
export const feed = {
  all: ['feed'] as const,
  home: () => [...feed.all, 'home'] as const,
  explore: (params: Record<string, string | undefined> = {}) =>
    [...feed.all, 'explore', params] as const,
  bucket: (id: string) => [...feed.all, 'bucket', id] as const,
};
