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
};

// Org Management console (/orgs/*). `mine` backs the Manage Organizations
// list on Settings; the rest are per-org console tabs.
export const org = {
  all: ['org'] as const,
  mine: () => [...org.all, 'mine'] as const,
  detail: (id: number | string) => [...org.all, 'detail', String(id)] as const,
  members: (id: number | string) => [...org.all, 'members', String(id)] as const,
  analytics: (id: number | string, eventFilter = 'all') =>
    [...org.all, 'analytics', String(id), eventFilter] as const,
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
