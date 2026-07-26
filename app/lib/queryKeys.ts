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

// Phase 3 personalized feed endpoints (/feed/*).
export const feed = {
  all: ['feed'] as const,
  home: () => [...feed.all, 'home'] as const,
  explore: (params: Record<string, string | undefined> = {}) =>
    [...feed.all, 'explore', params] as const,
  bucket: (id: string) => [...feed.all, 'bucket', id] as const,
};
