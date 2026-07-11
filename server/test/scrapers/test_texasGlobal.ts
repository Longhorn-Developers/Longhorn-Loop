import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  categoryIdFromHref,
  decodeHtmlEntities,
  extractDateRange,
  extractDescription,
  extractEventCards,
  extractSlug,
  hasNextPage,
  isMeetingLink,
  parseEventCard,
  upgradeImageUrl,
} from '../../src/scrapers/texasGlobal';

function loadFixture(name: string): string {
  return readFileSync(
    join(__dirname, '..', '..', 'src', 'scrapers', '__fixtures__', 'texasGlobal', name),
    'utf-8',
  );
}

// Cards in listing-page.html use 2026 dates; parse "now" as before all of them.
const NOW = new Date('2026-01-01T00:00:00Z').getTime();

describe('extractEventCards + parseEventCard', () => {
  const cards = extractEventCards(loadFixture('listing-page.html'));

  it('extracts every teaser card from a listing page', () => {
    expect(cards).toHaveLength(5);
  });

  it('parses a single-day, single-time event with a physical location', () => {
    const parsed = parseEventCard(cards[3], NOW);
    expect(parsed).not.toBeNull();
    expect(parsed?.source).toBe('texas_global');
    expect(parsed?.sourceEventId).toBe(
      'qa-session-myio-new-student-check-0::2026-07-16T09:00:00-05:00',
    );
    expect(parsed?.title).toBe('Q&A Session: myIO New Student Check-In');
    expect(parsed?.startDatetime).toBe('2026-07-16T09:00:00-05:00');
    expect(parsed?.endDatetime).toBe('2026-07-16T10:00:00-05:00');
    expect(parsed?.locationShort).toBe('Virtual');
    expect(parsed?.rsvpUrl).toBe('https://utexas.zoom.us/s/87653419124');
    expect(parsed?.organization.name).toBe('International Student and Scholar Services');
    expect(parsed?.categories).toEqual([
      { id: 'topic-30', name: 'Orientation' },
      { id: 'unit-2493', name: 'International Student and Scholar Services' },
    ]);
  });

  it('parses a multi-day all-day event and keeps the maps link out of rsvpUrl', () => {
    const parsed = parseEventCard(cards[0], NOW);
    expect(parsed).not.toBeNull();
    expect(parsed?.startDatetime).toBe('2026-03-08');
    expect(parsed?.endDatetime).toBe('2026-08-02');
    expect(parsed?.locationShort).toBe('Blanton Museum of Art');
    expect(parsed?.rsvpUrl).toBeNull();
    expect(parsed?.organization.name).toBe('Texas Global'); // no unit category -> default
    expect(parsed?.imageUrl).toBe(
      'https://global.utexas.edu/sites/default/files/2026-05/events-art-oil-charles-sheeler-2220x890.jpg',
    );
  });

  it('gives two recurring instances of the same event distinct dedup keys', () => {
    const first = parseEventCard(cards[1], NOW);
    const second = parseEventCard(cards[2], NOW);
    expect(first?.eventUrl).toBe(second?.eventUrl);
    expect(first?.sourceEventId).not.toBe(second?.sourceEventId);
    expect(first?.sourceEventId).toBe('education-abroad-live-qa-22::2026-07-14T14:00:00-05:00');
    expect(second?.sourceEventId).toBe('education-abroad-live-qa-22::2026-07-21T14:00:00-05:00');
  });

  it('handles a card with no image', () => {
    const parsed = parseEventCard(cards[3], NOW);
    expect(parsed?.imageUrl).toBeNull();
    expect(parsed?.imageAspectRatio).toBe('none');
  });

  it('handles a card with no categories', () => {
    const parsed = parseEventCard(cards[4], NOW);
    expect(parsed?.categories).toEqual([]);
    expect(parsed?.organization.name).toBe('Texas Global');
  });

  it('handles a card with no location div', () => {
    const lastPageCards = extractEventCards(loadFixture('last-page.html'));
    const parsed = parseEventCard(lastPageCards[0], NOW);
    expect(parsed).not.toBeNull();
    expect(parsed?.locationShort).toBeNull();
    expect(parsed?.locationFull).toBeNull();
    expect(parsed?.rsvpUrl).toBeNull();
  });

  it('skips events whose start time has already passed', () => {
    const future = new Date('2026-12-01T00:00:00Z').getTime();
    expect(parseEventCard(cards[3], future)).toBeNull();
  });
});

describe('extractDateRange', () => {
  it('returns null when there is no time block', () => {
    expect(extractDateRange('<article></article>')).toBeNull();
  });
});

describe('hasNextPage', () => {
  it('detects a next-page link', () => {
    expect(hasNextPage(loadFixture('listing-page.html'))).toBe(true);
  });

  it('returns false on the last page', () => {
    expect(hasNextPage(loadFixture('last-page.html'))).toBe(false);
  });
});

describe('extractDescription', () => {
  it('pulls the meta description from a detail page', () => {
    expect(extractDescription(loadFixture('detail-page.html'))).toBe(
      'Speak with a Peer Mentor about your education abroad opportunities across all program types, including exchange, affiliate, faculty-led, and internships. Drop in and bring your questions!',
    );
  });

  it('returns null when there is no meta description', () => {
    expect(extractDescription('<html><head></head><body></body></html>')).toBeNull();
  });
});

describe('upgradeImageUrl', () => {
  it('strips the Drupal image style path and query string', () => {
    expect(
      upgradeImageUrl(
        '/sites/default/files/styles/event_detail_banner_views_2x_628x252_/public/2026-05/foo.jpg?itok=abc&fp=1110x445',
      ),
    ).toBe('/sites/default/files/2026-05/foo.jpg');
  });

  it('returns null for a missing src', () => {
    expect(upgradeImageUrl(null)).toBeNull();
    expect(upgradeImageUrl(undefined)).toBeNull();
  });
});

describe('isMeetingLink', () => {
  it('recognizes Zoom, Teams, and Meet links', () => {
    expect(isMeetingLink('https://utexas.zoom.us/j/123')).toBe(true);
    expect(isMeetingLink('https://teams.microsoft.com/l/meetup/abc')).toBe(true);
    expect(isMeetingLink('https://meet.google.com/abc-defg-hij')).toBe(true);
  });

  it('rejects a Google Maps link', () => {
    expect(isMeetingLink('https://maps.app.goo.gl/Xv7hApeYrdP5C83fA')).toBe(false);
  });
});

describe('categoryIdFromHref', () => {
  it('slugifies the query string', () => {
    expect(categoryIdFromHref('/events/search?unit=2170')).toBe('unit-2170');
    expect(categoryIdFromHref('/events/search?continent=North+America')).toBe(
      'continent-north-america',
    );
  });
});

describe('extractSlug', () => {
  it('extracts the path segment after /events/', () => {
    expect(extractSlug('https://global.utexas.edu/events/education-abroad-live-qa-22')).toBe(
      'education-abroad-live-qa-22',
    );
  });

  it('returns null when there is no /events/ segment', () => {
    expect(extractSlug('https://global.utexas.edu/about')).toBeNull();
  });
});

describe('decodeHtmlEntities', () => {
  it('decodes common HTML entities', () => {
    expect(decodeHtmlEntities('Q&amp;A')).toBe('Q&A');
  });
});
