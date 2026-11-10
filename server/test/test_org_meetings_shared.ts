// shared/orgMeetings.ts (LOOP-319): the time parsing the meeting form relies
// on, and the display format the landing page shows.

import { describe, expect, it } from 'vitest';
import { formatMeetingWhen, formatTime, parseTimeInput } from '../../shared/orgMeetings';

describe('parseTimeInput', () => {
  it('reads the ways people type a time', () => {
    expect(parseTimeInput('7pm')).toBe('19:00');
    expect(parseTimeInput('7:30 PM')).toBe('19:30');
    expect(parseTimeInput('7.30pm')).toBe('19:30');
    expect(parseTimeInput('19:30')).toBe('19:30');
    expect(parseTimeInput('12pm')).toBe('12:00');
    expect(parseTimeInput('12am')).toBe('00:00');
    expect(parseTimeInput('9a')).toBe('09:00');
  });

  it('rejects things that are not times', () => {
    for (const bad of ['', 'noon', '25:00', '13pm', '7:75', '0am']) {
      expect(parseTimeInput(bad)).toBeNull();
    }
  });
});

describe('display', () => {
  it('formats 12-hour and the weekly line', () => {
    expect(formatTime('00:05')).toBe('12:05 AM');
    expect(formatTime('12:00')).toBe('12:00 PM');
    expect(formatMeetingWhen({ day_of_week: 2, start_time: '19:00', end_time: '20:30' })).toBe(
      'Tuesdays · 7:00 PM – 8:30 PM',
    );
    expect(formatMeetingWhen({ day_of_week: 0, start_time: '13:00', end_time: null })).toBe(
      'Sundays · 1:00 PM',
    );
  });
});
