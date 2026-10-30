import { type OrgCategory } from '@/shared/orgRegistration';

/**
 * The filters Explore's org results can actually honour (LOOP-293).
 *
 * Separate from shared/exploreFilters.ts on purpose. Those filters run over
 * events in memory and three of their four groups (interests, time, perks)
 * mean nothing for an org — an org has no start time and no taxonomy bucket.
 * These three map one-to-one onto query parameters GET /orgs/search already
 * accepts (LOOP-264), so the server does the filtering and pagination stays
 * honest: a filtered page is still a full page.
 *
 * The design's "Organization size" group is absent because nothing backs it:
 * follower counts are real but tiny while following is new, so any size
 * bucket would put every org in "Small". Add it when the numbers mean something.
 */
export interface OrgFilters {
  verifiedOnly: boolean;
  categories: OrgCategory[];
  hasUpcomingEvents: boolean;
}

export const EMPTY_ORG_FILTERS: OrgFilters = {
  verifiedOnly: false,
  categories: [],
  hasUpcomingEvents: false,
};

/**
 * Active GROUPS, not selected chips — the same rule the event badge follows
 * (see ExploreToggles), so "2" means two kinds of narrowing on either tab.
 */
export function activeOrgFilterCount(filters: OrgFilters): number {
  return (
    (filters.verifiedOnly ? 1 : 0) +
    (filters.categories.length > 0 ? 1 : 0) +
    (filters.hasUpcomingEvents ? 1 : 0)
  );
}

/** Appends the filters to a GET /orgs/search query string. */
export function applyOrgFilterParams(params: URLSearchParams, filters: OrgFilters): void {
  if (filters.verifiedOnly) params.set('verified', 'true');
  if (filters.hasUpcomingEvents) params.set('hasUpcomingEvents', 'true');
  for (const category of filters.categories) params.append('category', category);
}
