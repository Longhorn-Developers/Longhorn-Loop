/**
 * Validates the structure of server/src/lib/taxonomy.ts.
 *
 * This file is a server-side copy of the bucket/tag data in
 * app/lib/interestCategories.ts. If you add or rename buckets/tags in either
 * place, update the other to match — this test will catch structural drift.
 */

import { describe, it, expect } from 'vitest';
import { TAXONOMY_BUCKETS, BUCKET_ID_SET, ALL_TAXONOMY_TAGS } from '../src/lib/taxonomy';

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

  it('has exactly the 16 buckets from the client taxonomy', () => {
    // Source of truth: app/lib/interestCategories.ts. Update both together.
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
