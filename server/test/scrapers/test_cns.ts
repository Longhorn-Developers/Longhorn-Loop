import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildLocationFull,
  buildLocationShort,
  parseEvent,
  parseEventInstance,
  upgradeImageUrl,
  type LocalistRawEvent,
} from '../../src/scrapers/cns';

function loadFixture(name: string): LocalistRawEvent {
  return JSON.parse(
    readFileSync(
      join(__dirname, '..', '..', 'src', 'scrapers', '__fixtures__', 'cns', name),
      'utf-8',
    ),
  );
}

// Fixtures mix a 2026 event with an intentionally past 2020 instance; parse
// "now" as just before all the 2026 dates.
const NOW = new Date('2026-01-01T00:00:00Z').getTime();

describe('parseEvent + parseEventInstance', () => {
  it('parses a standard single-instance event and prefers the CNS department entry', () => {
    const raw = loadFixture('standard-event.json');
    const results = parseEvent(raw, NOW);
    expect(results).toHaveLength(1);
    const parsed = results[0];
    expect(parsed.source).toBe('cns');
    expect(parsed.sourceEventId).toBe('52878283067328');
    expect(parsed.title).toBe('Texas Area Planetary Sciences Conference');
    expect(parsed.startDatetime).toBe('2026-08-20T08:00:00-05:00');
    expect(parsed.endDatetime).toBeNull();
    expect(parsed.organization.name).toBe('College of Natural Sciences');
    expect(parsed.eventUrl).toBe(
      'https://calendar.utexas.edu/event/texas-area-planetary-sciences-conference',
    );
    expect(parsed.imageUrl).toBe(
      'https://localist-images.azureedge.net/photos/52878283172806/huge/95a931360422d4c5a1062fa299a7315ef9e06e69.jpg',
    );
    expect(parsed.categories).toEqual([
      { id: 'planetary-science', name: 'planetary science' },
      { id: 'science-&-technology', name: 'Science & Technology' },
    ]);
  });

  it('emits one instance per future occurrence and drops past ones', () => {
    const raw = loadFixture('recurring-event.json');
    const results = parseEvent(raw, NOW);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.sourceEventId)).toEqual(['60000000000011', '60000000000012']);
  });

  it('falls back to the default org name when there are no departments', () => {
    const raw = loadFixture('recurring-event.json');
    const results = parseEvent(raw, NOW);
    expect(results[0].organization.name).toBe('College of Natural Sciences');
    expect(results[0].imageUrl).toBeNull();
    expect(results[0].imageAspectRatio).toBe('none');
  });

  it('returns [] when the event has no instances', () => {
    const raw = loadFixture('standard-event.json');
    const broken = { event: { ...raw.event, event_instances: [] } };
    expect(parseEvent(broken, NOW)).toEqual([]);
  });

  it('returns null from parseEventInstance when the instance has no start', () => {
    const raw = loadFixture('standard-event.json');
    const badInstance = {
      event_instance: { ...raw.event.event_instances[0].event_instance, start: '' },
    };
    expect(parseEventInstance(raw, badInstance)).toBeNull();
  });
});

describe('buildLocationShort', () => {
  it('strips a trailing street address', () => {
    expect(buildLocationShort('Gregory Gym (GRE), 2101 Speedway')).toBe('Gregory Gym (GRE)');
  });

  it('returns null for missing location', () => {
    expect(buildLocationShort(null)).toBeNull();
    expect(buildLocationShort(undefined)).toBeNull();
  });

  it('truncates long locations', () => {
    const long = 'A'.repeat(50);
    expect(buildLocationShort(long)).toBe('A'.repeat(37) + '...');
  });
});

describe('buildLocationFull', () => {
  it('joins location and address', () => {
    expect(buildLocationFull('Commons Conference Center', '2901 Read Granberry Trail')).toBe(
      'Commons Conference Center, 2901 Read Granberry Trail',
    );
  });

  it('returns null when both are missing', () => {
    expect(buildLocationFull(null, null)).toBeNull();
  });

  it('uses whichever single part is present', () => {
    expect(buildLocationFull('Commons Conference Center', null)).toBe('Commons Conference Center');
  });
});

describe('upgradeImageUrl', () => {
  it('upgrades thumb/medium/small to huge', () => {
    expect(upgradeImageUrl('https://example.com/photos/1/thumb/foo.jpg')).toBe(
      'https://example.com/photos/1/huge/foo.jpg',
    );
    expect(upgradeImageUrl('https://example.com/photos/1/medium/foo.jpg')).toBe(
      'https://example.com/photos/1/huge/foo.jpg',
    );
  });

  it('returns null for a missing url', () => {
    expect(upgradeImageUrl(null)).toBeNull();
    expect(upgradeImageUrl(undefined)).toBeNull();
  });
});
