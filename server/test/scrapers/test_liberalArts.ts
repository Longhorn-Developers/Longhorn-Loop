import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  centralUtcOffset,
  decodeHtmlEntities,
  getNextPageUrl,
  parseApiEvent,
  type ColaApiEvent,
} from '../../src/scrapers/liberalArts';

interface Fixture {
  data: ColaApiEvent[];
  links?: { next?: string };
}

function loadFixture(name: string): Fixture {
  return JSON.parse(
    readFileSync(
      join(__dirname, '..', '..', 'src', 'scrapers', '__fixtures__', 'liberalArts', name),
      'utf-8',
    ),
  ) as Fixture;
}

const NOW = new Date('2026-01-01T00:00:00Z').getTime();

describe('parseApiEvent', () => {
  const events = loadFixture('listing-page.json').data;

  it('maps all fields from a sponsored event with an image', () => {
    const parsed = parseApiEvent(events[0], NOW);

    expect(parsed).not.toBeNull();
    expect(parsed?.source).toBe('cola');
    expect(parsed?.sourceEventId).toBe('61021');
    expect(parsed?.title).toBe(
      'Opening Lecture with Professor Devin Stauffer, "Reading the Great Books in the Age of AI"',
    );
    expect(parsed?.description).toBe(
      'This lecture will be followed by a Pizza and Pool party at the Outdoor Rec Pool at Gregory Gym.',
    );
    expect(parsed?.startDatetime).toBe('2026-08-27T17:00:00-05:00');
    expect(parsed?.endDatetime).toBe('2026-08-27T21:00:00-05:00');
    expect(parsed?.locationShort).toBe('Avaya Auditorium POB 2.302');
    expect(parsed?.organization.name).toBe(
      'Thomas Jefferson Center for the Study of Core Texts and Ideas',
    );
    expect(parsed?.eventUrl).toBe(
      'https://liberalarts.utexas.edu/events/opening-lecture-with-professor-devin-stauffer-nbsp-reading-the-great-books-in-the-age-of-ai-2',
    );
    expect(parsed?.imageUrl).toBe(
      'https://minio.la.utexas.edu/colaweb-prod/event_images/6/61021/opening_lecture.jpg',
    );
    expect(parsed?.imageAltText).toBe('Professor Devin Stauffer at a lectern');
    expect(parsed?.categories).toEqual([
      {
        id: 'sponsor-thomas-jefferson-center-for-the-study-of-core-texts-and-ideas',
        name: 'Thomas Jefferson Center for the Study of Core Texts and Ideas',
      },
    ]);
  });

  it('handles missing optional fields without treating the image base URL as an image', () => {
    const parsed = parseApiEvent(events[1], NOW);

    expect(parsed).not.toBeNull();
    expect(parsed?.title).toBe('Talk: Alexandra Clark');
    expect(parsed?.description).toBeNull();
    expect(parsed?.locationShort).toBeNull();
    expect(parsed?.organization.name).toBe('College of Liberal Arts');
    expect(parsed?.imageUrl).toBeNull();
    expect(parsed?.imageAspectRatio).toBe('none');
    expect(parsed?.categories).toEqual([]);
  });

  it('uses summary before body content', () => {
    const event = loadFixture('last-page.json').data[0];
    const parsed = parseApiEvent(event, NOW);
    expect(parsed?.description).toBe('A discussion of the Constitution.');
  });

  it('skips ended and malformed events', () => {
    expect(parseApiEvent(events[0], new Date('2027-01-01T00:00:00Z').getTime())).toBeNull();
    expect(
      parseApiEvent(
        { ...events[0], attributes: { ...events[0].attributes, begin_time: null } },
        NOW,
      ),
    ).toBeNull();
  });
});

describe('pagination', () => {
  it('follows the next link and stops on the last page', () => {
    expect(getNextPageUrl(loadFixture('listing-page.json'))).toContain('page%5Bnumber%5D=2');
    expect(getNextPageUrl(loadFixture('last-page.json'))).toBeNull();
  });
});

describe('centralUtcOffset', () => {
  it('uses standard and daylight-saving offsets at the US Central boundaries', () => {
    expect(centralUtcOffset(2026, 1, 15)).toBe('-06:00');
    expect(centralUtcOffset(2026, 3, 7)).toBe('-06:00');
    expect(centralUtcOffset(2026, 3, 8)).toBe('-05:00');
    expect(centralUtcOffset(2026, 11, 1)).toBe('-06:00');
  });
});

describe('decodeHtmlEntities', () => {
  it('decodes named, decimal, and hexadecimal entities', () => {
    expect(decodeHtmlEntities('A&amp;M &#8212; M&#xFC;ller')).toBe('A&M — Müller');
  });
});
