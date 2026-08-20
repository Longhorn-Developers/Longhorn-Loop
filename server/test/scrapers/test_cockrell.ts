import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildDatetime,
  chicagoOffset,
  decodeHtmlEntities,
  parseTime12h,
  parseWpEvent,
  type WpEvent,
} from '../../src/scrapers/cockrell';

function loadFixture(): WpEvent[] {
  return JSON.parse(
    readFileSync(
      join(__dirname, '..', '..', 'src', 'scrapers', '__fixtures__', 'cockrell', 'events.json'),
      'utf-8',
    ),
  );
}

// Fixture events span 2026; parse "now" as before all of them (except the
// intentionally-past one).
const NOW = new Date('2026-01-01T00:00:00Z').getTime();

describe('parseWpEvent', () => {
  const events = loadFixture();

  it('parses a multi-day all-day event with no times', () => {
    const parsed = parseWpEvent(events[0], NOW);
    expect(parsed).not.toBeNull();
    expect(parsed?.source).toBe('cockrell');
    expect(parsed?.sourceEventId).toBe('44287');
    expect(parsed?.title).toBe('Run the Code: Data–Driven Art Decoded');
    expect(parsed?.startDatetime).toBe('2026-03-08');
    expect(parsed?.endDatetime).toBe('2026-08-02');
    expect(parsed?.locationShort).toBe('Blanton Museum of Art');
    expect(parsed?.organization.name).toBe('Cockrell School of Engineering');
    expect(parsed?.imageUrl).toBe(
      'https://cockrell.utexas.edu/wp-content/uploads/2026/03/Blanton-Grounds-HERO-1440x846-1.jpg',
    );
    expect(parsed?.categories).toEqual([
      { id: 'cockrell_event_type-3538', name: 'In Person' },
      { id: 'cockrell_event_category-3536', name: 'Public Event' },
    ]);
  });

  it('parses a single-day timed event with no end_date and strips <br> from location', () => {
    const parsed = parseWpEvent(events[1], NOW);
    expect(parsed).not.toBeNull();
    expect(parsed?.startDatetime).toBe('2026-08-28T14:00:00-05:00');
    expect(parsed?.endDatetime).toBe('2026-08-28T16:00:00-05:00');
    expect(parsed?.locationFull).toBe('"HQ" Room, Floor 1 North Tower, EER Building');
  });

  it('handles an event with no image and no taxonomy terms', () => {
    const parsed = parseWpEvent(events[2], NOW);
    expect(parsed).not.toBeNull();
    expect(parsed?.imageUrl).toBeNull();
    expect(parsed?.imageAspectRatio).toBe('none');
    expect(parsed?.categories).toEqual([]);
    expect(parsed?.startDatetime).toBe('2026-09-09T10:00:00-05:00');
    expect(parsed?.endDatetime).toBe('2026-09-10T16:00:00-05:00');
  });

  it('skips events that have already ended', () => {
    expect(parseWpEvent(events[3], NOW)).toBeNull();
  });

  it('returns null when the event has no start date', () => {
    const broken = { ...events[2], meta: { ...events[2].meta, cockrell_event_date: '' } };
    expect(parseWpEvent(broken, NOW)).toBeNull();
  });
});

describe('buildDatetime', () => {
  it('returns a bare date string when there is no time', () => {
    expect(buildDatetime('2026-03-08', '')).toBe('2026-03-08');
  });

  it('combines a date and 12h time with the Chicago offset', () => {
    expect(buildDatetime('2026-01-08', '9:00 am')).toBe('2026-01-08T09:00:00-06:00');
    expect(buildDatetime('2026-07-08', '5:00 pm')).toBe('2026-07-08T17:00:00-05:00');
  });
});

describe('parseTime12h', () => {
  it('converts 12h times to 24h', () => {
    expect(parseTime12h('9:00 am')).toEqual({ hours: 9, minutes: 0 });
    expect(parseTime12h('5:00 pm')).toEqual({ hours: 17, minutes: 0 });
    expect(parseTime12h('12:00 pm')).toEqual({ hours: 12, minutes: 0 });
    expect(parseTime12h('12:00 am')).toEqual({ hours: 0, minutes: 0 });
  });

  it('returns null for unparseable input', () => {
    expect(parseTime12h('')).toBeNull();
    expect(parseTime12h('noon')).toBeNull();
  });
});

describe('chicagoOffset', () => {
  it('returns CST in winter', () => {
    expect(chicagoOffset('2026-01-08')).toBe('-06:00');
  });

  it('returns CDT in summer', () => {
    expect(chicagoOffset('2026-07-08')).toBe('-05:00');
  });
});

describe('decodeHtmlEntities', () => {
  it('decodes numeric and named entities', () => {
    expect(decodeHtmlEntities('Data&#8211;Driven')).toBe('Data–Driven');
    expect(decodeHtmlEntities('Fun &amp; Games')).toBe('Fun & Games');
  });
});
