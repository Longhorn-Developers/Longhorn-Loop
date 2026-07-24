/**
 * Validates the structure of the shared taxonomy module (shared/taxonomy.ts),
 * which both the app and server import. Guards structural invariants (unique
 * ids, non-empty tags, the expected 16 buckets).
 */

import { describe, it, expect } from 'vitest';
import { TAXONOMY_BUCKETS, BUCKET_ID_SET, ALL_TAXONOMY_TAGS } from '../../shared/taxonomy';

describe('server taxonomy module', () => {
  it('exports a non-empty bucket list', () => {
    expect(TAXONOMY_BUCKETS.length).toBeGreaterThan(0);
  });

  it('every bucket has a non-empty id, label, and tags array', () => {
    for (const bucket of TAXONOMY_BUCKETS) {
      expect(bucket.id).toBeTruthy();
      expect(bucket.label).toBeTruthy();
      expect(bucket.tags.length).toBeGreaterThan(0);
    }
  });

  it('bucket IDs are unique', () => {
    const ids = TAXONOMY_BUCKETS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('BUCKET_ID_SET matches the bucket list', () => {
    for (const bucket of TAXONOMY_BUCKETS) {
      expect(BUCKET_ID_SET.has(bucket.id)).toBe(true);
    }
    expect(BUCKET_ID_SET.size).toBe(TAXONOMY_BUCKETS.length);
  });

  it('ALL_TAXONOMY_TAGS is the flat union of all bucket tags', () => {
    const expected = TAXONOMY_BUCKETS.flatMap((b) => b.tags);
    expect(ALL_TAXONOMY_TAGS).toEqual(expected);
  });

  it('contains the expected bucket IDs (spot-check)', () => {
    expect(BUCKET_ID_SET.has('music')).toBe(true);
    expect(BUCKET_ID_SET.has('tech')).toBe(true);
    expect(BUCKET_ID_SET.has('sports')).toBe(true);
    expect(BUCKET_ID_SET.has('food')).toBe(true);
    expect(BUCKET_ID_SET.has('education')).toBe(true);
  });

  it('has exactly the 16 buckets from the shared taxonomy', () => {
    // Source of truth: shared/taxonomy.ts (imported by both app and server).
    const expected = [
      'music',
      'performing',
      'spirituality',
      'arts',
      'sports',
      'food',
      'tech',
      'science',
      'education',
      'outdoors',
      'gaming',
      'social',
      'health',
      'business',
      'travel',
      'nightlife',
    ];
    expect(TAXONOMY_BUCKETS.map((b) => b.id)).toEqual(expected);
  });
});
