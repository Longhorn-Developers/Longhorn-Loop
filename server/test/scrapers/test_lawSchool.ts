import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  icsDateToIso,
  parseFeed,
  parseIcsProperties,
  parseVevent,
  splitVevents,
  unescapeIcsText,
  unfoldIcs,
} from '../../src/scrapers/lawSchool';

function loadFixture(name: string): string {
  return readFileSync(
    join(__dirname, '..', '..', 'src', 'scrapers', '__fixtures__', 'lawSchool', name),
    'utf-8',
  );
}

// Far-future "now" so the fixture's dated events (2026/2027) all count as
// upcoming, while the 2020 event is always in the past.
const NOW_2026 = Date.parse('2026-07-01T00:00:00Z');

describe('unfoldIcs', () => {
  it('joins RFC 5545 folded continuation lines, consuming one leading space', () => {
    // The single space after the CRLF is the fold marker and is removed; the
    // real feed folds with two spaces so a content space survives.
    const folded = 'DESCRIPTION:Hello\r\n  world\r\nLOCATION:Room 1\r\n';
    expect(unfoldIcs(folded)).toBe('DESCRIPTION:Hello world\nLOCATION:Room 1\n');
  });

  it('handles LF-only folding too', () => {
    expect(unfoldIcs('A:one\n two')).toBe('A:onetwo');
  });
});

describe('unescapeIcsText', () => {
  it('reverses iCal TEXT escaping', () => {
    expect(unescapeIcsText('the Dean\\, hearing\\; and \\\\o/')).toBe(
      'the Dean, hearing; and \\o/',
    );
  });

  it('turns escaped newlines into real newlines', () => {
    expect(unescapeIcsText('line one\\nline two')).toBe('line one\nline two');
  });
});

describe('icsDateToIso', () => {
  it('applies CDT (-05:00) for a summer Central date', () => {
    expect(icsDateToIso('20260727T113000', 'America/Chicago')).toBe('2026-07-27T11:30:00-05:00');
  });

  it('applies CST (-06:00) for a winter Central date', () => {
    expect(icsDateToIso('20270115T090000', 'America/Chicago')).toBe('2027-01-15T09:00:00-06:00');
  });

  it('passes through an explicit UTC (Z) value', () => {
    expect(icsDateToIso('20260717T233000Z')).toBe('2026-07-17T23:30:00+00:00');
  });

  it('returns null for an unparseable value', () => {
    expect(icsDateToIso('not-a-date')).toBeNull();
  });
});

describe('parseIcsProperties', () => {
  it('parses NAME;PARAM:VALUE lines with params', () => {
    const block = 'DTSTART;VALUE=DATE-TIME;TZID=US/Central:20260727T113000\nSUMMARY:Hi';
    const props = parseIcsProperties(block);
    expect(props.DTSTART.value).toBe('20260727T113000');
    expect(props.DTSTART.params.TZID).toBe('US/Central');
    expect(props.SUMMARY.value).toBe('Hi');
  });
});

describe('splitVevents', () => {
  it('extracts each VEVENT block from the fixture', () => {
    const blocks = splitVevents(unfoldIcs(loadFixture('feed.ics')));
    expect(blocks.length).toBe(4);
  });
});

describe('parseVevent', () => {
  const blocks = splitVevents(unfoldIcs(loadFixture('feed.ics')));

  it('parses a standard event with a folded HTML description', () => {
    const parsed = parseVevent(blocks[0], NOW_2026);
    expect(parsed).not.toBeNull();
    expect(parsed?.source).toBe('ut_law');
    expect(parsed?.sourceEventId).toBe('20260727T113000-88639@law.utexas.edu');
    expect(parsed?.title).toBe('Drawing Board Luncheon: Avihay Dorfman');
    expect(parsed?.startDatetime).toBe('2026-07-27T11:30:00-05:00');
    expect(parsed?.endDatetime).toBe('2026-07-27T12:45:00-05:00');
    expect(parsed?.locationFull).toBe('TNH 2.111 - Sheffield-Massey Room');
    expect(parsed?.locationShort).toBe('TNH 2.111 - Sheffield-Massey Room');
    expect(parsed?.description).toContain('Drawing Board Luncheon');
    expect(parsed?.description).not.toContain('<p>');
    expect(parsed?.organization.name).toBe('The University of Texas School of Law');
    expect(parsed?.organization.sourceOrgId).toBeNull();
    expect(parsed?.imageUrl).toBeNull();
    expect(parsed?.imageAspectRatio).toBe('none');
    expect(parsed?.visibility).toBe('Public');
  });

  it('handles an event with an empty LOCATION and escaped commas', () => {
    const parsed = parseVevent(blocks[1], NOW_2026);
    expect(parsed).not.toBeNull();
    expect(parsed?.title).toBe('Alumni Breakfast at NBA');
    expect(parsed?.locationFull).toBeNull();
    expect(parsed?.locationShort).toBeNull();
    // "the Dean\, hearing" should unescape to a plain comma.
    expect(parsed?.description).toContain('the Dean, hearing');
  });

  it('skips events that have already ended', () => {
    const past = blocks.find((b) => b.includes('Should Be Skipped'))!;
    expect(parseVevent(past, NOW_2026)).toBeNull();
  });
});

describe('parseFeed', () => {
  it('returns only upcoming events from the fixture', () => {
    const events = parseFeed(loadFixture('feed.ics'), NOW_2026);
    expect(events.map((e) => e.title)).toEqual([
      'Drawing Board Luncheon: Avihay Dorfman',
      'Alumni Breakfast at NBA',
      'Spring Semester Kickoff',
    ]);
  });
});
