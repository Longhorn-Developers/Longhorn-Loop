/**
 * Category filter chips on the profile's My Events section (Figma "Profile
 * Main" frame): All / General / Academic / Social.
 *
 * These are NOT the 16 interest buckets in shared/taxonomy.ts — they're a
 * coarser grouping the design uses to keep the chip row to four items. Each
 * chip maps to a set of bucket ids, so the filter is expressed against the
 * classifier's existing event_tags rows rather than needing new data.
 *
 * Dependency-free so both the client (chip state) and the Worker (the SQL
 * filter) derive from the same mapping and can't drift.
 */

import { TAXONOMY_BUCKETS } from './taxonomy';

export type ProfileEventFilter = 'all' | 'general' | 'academic' | 'social';

export const PROFILE_EVENT_FILTERS: ProfileEventFilter[] = ['all', 'general', 'academic', 'social'];

export const PROFILE_EVENT_FILTER_LABELS: Record<ProfileEventFilter, string> = {
  all: 'All',
  general: 'General',
  academic: 'Academic',
  social: 'Social',
};

/** Buckets that read as "academic" to a student browsing their own events. */
const ACADEMIC_BUCKETS = ['science', 'education', 'tech', 'business'];

/** Buckets that read as "social". */
const SOCIAL_BUCKETS = ['social', 'nightlife', 'food', 'gaming'];

/**
 * Bucket ids a filter matches.
 *
 * `general` is the complement of the other two rather than its own list, so a
 * bucket added to shared/taxonomy.ts lands somewhere automatically instead of
 * silently disappearing from every chip but All.
 */
export function bucketsForFilter(filter: ProfileEventFilter): string[] {
  switch (filter) {
    case 'academic':
      return ACADEMIC_BUCKETS;
    case 'social':
      return SOCIAL_BUCKETS;
    case 'general': {
      const claimed = new Set([...ACADEMIC_BUCKETS, ...SOCIAL_BUCKETS]);
      return TAXONOMY_BUCKETS.map((b) => b.id).filter((id) => !claimed.has(id));
    }
    case 'all':
    default:
      return [];
  }
}

export function isProfileEventFilter(value: string): value is ProfileEventFilter {
  return (PROFILE_EVENT_FILTERS as string[]).includes(value);
}

/** Which collection of the user's events a tab shows. */
export type ProfileEventTab = 'going' | 'saved' | 'posted';

export const PROFILE_EVENT_TABS: ProfileEventTab[] = ['going', 'saved', 'posted'];

export function isProfileEventTab(value: string): value is ProfileEventTab {
  return (PROFILE_EVENT_TABS as string[]).includes(value);
}

/**
 * The segmented toggle on a PUBLIC profile — someone else's, or an org's
 * (LOOP-180).
 *
 * Deliberately a different axis from ProfileEventTab above. Going / Saved /
 * Posted are three relationships the OWNER has to an event, and two of them
 * are nobody else's business: showing a stranger what you have saved would
 * turn a bookmark into a broadcast. A visitor gets the one collection that was
 * already public — what this account posted — split by time instead.
 */
export type PublicProfileTab = 'upcoming' | 'past';

export const PUBLIC_PROFILE_TABS: PublicProfileTab[] = ['upcoming', 'past'];

export const PUBLIC_PROFILE_TAB_LABELS: Record<PublicProfileTab, string> = {
  upcoming: 'Upcoming',
  past: 'Past',
};

export function isPublicProfileTab(value: string): value is PublicProfileTab {
  return (PUBLIC_PROFILE_TABS as string[]).includes(value);
}
