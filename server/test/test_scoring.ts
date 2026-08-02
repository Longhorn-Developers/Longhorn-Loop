import { describe, it, expect } from 'vitest';
import {
  interestScore,
  type ScorableEvent,
  type ScorableTag,
  type UserInterest,
} from '../src/lib/scoring';

// Minimal ScorableEvent factory; only the fields interestScore reads matter.
function ev(scoredTags: ScorableTag[], bucketIds: string[] = []): ScorableEvent {
  return {
    id: 1,
    start_datetime: '2026-01-01T00:00:00Z',
    is_featured: 0,
    save_count: 0,
    rsvp_count: 0,
    view_count: 0,
    scoredTags,
    bucketIds,
  };
}

function user(tags: string[], bucketIds: string[] = []): UserInterest {
  return { tags: new Set(tags), bucketIds: new Set(bucketIds) };
}

describe('interestScore confidence weighting', () => {
  it('a high-confidence matched tag scores much higher than a low-confidence one', () => {
    const strong = interestScore(
      ev([{ tag: 'AI & Machine Learning', score: 0.75 }]),
      user(['AI & Machine Learning']),
    );
    const weak = interestScore(
      ev([{ tag: 'AI & Machine Learning', score: 0.55 }]),
      user(['AI & Machine Learning']),
    );
    expect(strong).toBeGreaterThan(weak);
    // A floor-level tag should contribute ~nothing.
    expect(weak).toBeLessThan(0.1);
    expect(strong).toBeGreaterThan(0.4);
  });

  it('a tag at/below the confidence floor contributes zero', () => {
    const s = interestScore(
      ev([{ tag: 'Happy Hour Events', score: 0.55 }]),
      user(['Happy Hour Events']),
    );
    expect(s).toBe(0);
  });

  it('a tag at/above the confidence top gets full weight', () => {
    const s = interestScore(ev([{ tag: 'Board Games', score: 0.72 }]), user(['Board Games']));
    // One full-confidence match should reach roughly the 0.7 "one strong tag" level.
    expect(s).toBeCloseTo(0.7, 1);
  });

  it('keyword-fallback tags (null score) count as moderate confidence', () => {
    const s = interestScore(ev([{ tag: 'Team Sports', score: null }]), user(['Team Sports']));
    // KEYWORD_CONFIDENCE 0.6 -> partial, between zero and full.
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(0.5);
  });

  it('an unmatched tag never contributes', () => {
    const s = interestScore(ev([{ tag: 'Karaoke', score: 0.75 }]), user(['Team Sports']));
    expect(s).toBe(0);
  });

  it('extra matched tags add with diminishing returns', () => {
    const one = interestScore(ev([{ tag: 'A', score: 0.72 }]), user(['A', 'B']));
    const two = interestScore(
      ev([
        { tag: 'A', score: 0.72 },
        { tag: 'B', score: 0.72 },
      ]),
      user(['A', 'B']),
    );
    expect(two).toBeGreaterThan(one); // more matches rank higher
    expect(two - one).toBeLessThan(one); // but the second adds less than the first
  });

  it('bucket-only affinity is a weaker fallback when no tag matches', () => {
    const bucketOnly = interestScore(ev([], ['tech']), user([], ['tech']));
    expect(bucketOnly).toBeCloseTo(0.3, 5);
  });

  it('a confident tag match beats a bucket-only match', () => {
    const tagMatch = interestScore(
      ev([{ tag: 'A', score: 0.72 }], ['tech']),
      user(['A'], ['tech']),
    );
    const bucketOnly = interestScore(ev([], ['tech']), user([], ['tech']));
    expect(tagMatch).toBeGreaterThan(bucketOnly);
  });

  it('score saturates at 1', () => {
    const s = interestScore(
      ev([
        { tag: 'A', score: 0.76 },
        { tag: 'B', score: 0.76 },
        { tag: 'C', score: 0.76 },
      ]),
      user(['A', 'B', 'C']),
    );
    expect(s).toBeLessThanOrEqual(1);
  });
});
