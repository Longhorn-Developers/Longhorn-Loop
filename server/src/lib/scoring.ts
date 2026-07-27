/**
 * Each event gets a score from four independent terms, combined with fixed weights:
 *
 *   score = INTEREST*interest + POPULARITY*popularity
 *         + TIMELINESS*timeliness + FEATURED*featured
 *
 * Every term is normalized to roughly [0, 1] so the weights below are the only
 * knobs that matter
 */

// Raw signals a scorer needs about one event. Maps to columns on `events`.
export type ScorableEvent = {
  id: number;
  start_datetime: string;
  is_featured: number | boolean;
  save_count: number;
  rsvp_count: number;
  view_count: number;
  tags: string[];
  bucketIds: string[];
};

// The viewer's interest profile, from user_tags / selected buckets
export type UserInterest = {
  tags: ReadonlySet<string>;
  bucketIds: ReadonlySet<string>;
};

// Tunable weights. We want interest to dominate and
export const WEIGHTS = {
  interest: 0.5,
  popularity: 0.25,
  timeliness: 0.2,
  featured: 0.05,
} as const;

// Popularity is a weighted blend of the three signals (RSVP > save > view),
// then squashed by log so a few viral events don't dwarf everything else.
const POPULARITY_SIGNAL_WEIGHTS = { rsvp: 3, save: 2, view: 1 } as const;
// ~ score of 0.5 at this many weighted points; tuned on real data in phase 7.
const POPULARITY_MIDPOINT = 20;

// Timeliness half-life: an event this many hours out scores ~0.5.
const TIMELINESS_HALFLIFE_HOURS = 72;

/**
 * Interest term in [0, 1]. A direct tag match is the strong signal; a
 * bucket-only match (same bucket, different tag) counts for less. Saturates so
 * matching 3 tags isn't required to rank well.
 */
export function interestScore(event: ScorableEvent, user: UserInterest): number {
  const tagMatches = event.tags.filter((t) => user.tags.has(t)).length;
  const bucketMatches = event.bucketIds.filter((b) => user.bucketIds.has(b)).length;

  // First tag match is worth the most; extra matches add with diminishing value.
  const tagTerm = tagMatches > 0 ? 0.7 + 0.1 * Math.min(tagMatches - 1, 3) : 0;
  // Bucket-only affinity (no exact tag hit) is a weaker signal.
  const bucketTerm = tagMatches === 0 && bucketMatches > 0 ? 0.3 : 0;

  return Math.min(1, tagTerm + bucketTerm);
}

/** Popularity term in [0, 1] from the denormalized signal counters. */
export function popularityScore(event: ScorableEvent): number {
  const points =
    Math.max(0, event.rsvp_count) * POPULARITY_SIGNAL_WEIGHTS.rsvp +
    Math.max(0, event.save_count) * POPULARITY_SIGNAL_WEIGHTS.save +
    Math.max(0, event.view_count) * POPULARITY_SIGNAL_WEIGHTS.view;

  if (points <= 0) return 0;
  // log1p ratio → smooth 0..~1 curve that hits ~0.5 at POPULARITY_MIDPOINT.
  return Math.log1p(points) / (Math.log1p(POPULARITY_MIDPOINT) * 2);
}

/**
 * Timeliness term in [0, 1]. Soonest upcoming events score highest; already-
 * started/past events score 0. Exponential decay with a 72h half-life.
 * `nowMs` is injected so scoring stays deterministic and testable.
 */
export function timelinessScore(event: ScorableEvent, nowMs: number): number {
  const startMs = new Date(event.start_datetime).getTime();
  if (!Number.isFinite(startMs)) return 0;

  const hoursOut = (startMs - nowMs) / (1000 * 60 * 60);
  if (hoursOut <= 0) return 0; // started or in the past

  return Math.pow(0.5, hoursOut / TIMELINESS_HALFLIFE_HOURS);
}

function featuredScore(event: ScorableEvent): number {
  return event.is_featured ? 1 : 0;
}

/** Combined weighted score. Higher = ranked earlier. */
export function scoreEvent(event: ScorableEvent, user: UserInterest, nowMs: number): number {
  return (
    WEIGHTS.interest * interestScore(event, user) +
    WEIGHTS.popularity * popularityScore(event) +
    WEIGHTS.timeliness * timelinessScore(event, nowMs) +
    WEIGHTS.featured * featuredScore(event)
  );
}

/**
 * Sort a list of events by descending score (stable: ties fall back to sooner
 * start time, then lower id). Returns a new array; does not mutate the input.
 */
export function rankEvents<T extends ScorableEvent>(
  events: T[],
  user: UserInterest,
  nowMs: number,
): T[] {
  return [...events]
    .map((event) => ({ event, score: scoreEvent(event, user, nowMs) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aStart = new Date(a.event.start_datetime).getTime();
      const bStart = new Date(b.event.start_datetime).getTime();
      if (aStart !== bStart) return aStart - bStart;
      return a.event.id - b.event.id;
    })
    .map((entry) => entry.event);
}
