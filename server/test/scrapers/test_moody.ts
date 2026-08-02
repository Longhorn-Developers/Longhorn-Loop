import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  extractCategories,
  extractEventCards,
  extractSchemaEvent,
  hasNextPage,
  parseListingCard,
  parseListingDatetime,
  parseMoodyEvent,
} from '../../src/scrapers/moody';

function loadFixture(name: string): string {
  return readFileSync(
    join(__dirname, '..', '..', 'src', 'scrapers', '__fixtures__', 'moody', name),
    'utf-8',
  );
}

const NOW = new Date('2027-01-01T00:00:00Z').getTime();

describe('Moody listing parser', () => {
  it('extracts listing fields from saved Moody markup', () => {
    const cards = extractEventCards(loadFixture('listing-page.html'));
    expect(cards).toHaveLength(1);

    const listing = parseListingCard(cards[0]);
    expect(listing).toEqual({
      slug: 'student-screenwriting-festival',
      title: 'Student Screenwriting Festival',
      description: 'A two-day festival for student filmmakers & writers.',
      startDatetime: '2027-03-25T17:00:00-05:00',
      eventUrl: 'https://events.moody.utexas.edu/events/student-screenwriting-festival',
      imageUrl:
        'https://events.moody.utexas.edu/sites/default/files/styles/large/public/2027-03/festival.png?itok=abc',
      categories: ['Screening'],
    });
  });

  it('handles a listing card with no image', () => {
    const [card] = extractEventCards(loadFixture('last-page.html'));
    expect(parseListingCard(card)?.imageUrl).toBeNull();
  });

  it('detects listing pagination', () => {
    expect(hasNextPage(loadFixture('listing-page.html'))).toBe(true);
    expect(hasNextPage(loadFixture('last-page.html'))).toBe(false);
  });
});

describe('Moody detail parser', () => {
  const detail = loadFixture('detail-page.html');
  const listing = parseListingCard(extractEventCards(loadFixture('listing-page.html'))[0])!;

  it('extracts structured event data and all rendered categories', () => {
    expect(extractSchemaEvent(detail)?.endDate).toBe('2027-03-25T20:00:00-05:00');
    expect(extractCategories(detail)).toEqual([
      'Guest Speaker',
      'Panel Discussion',
      'Screening',
      'Social',
    ]);
  });

  it('maps the event into the shared schema', () => {
    const event = parseMoodyEvent(listing, detail, NOW);
    expect(event).not.toBeNull();
    expect(event?.source).toBe('moody');
    expect(event?.sourceEventId).toBe('student-screenwriting-festival::2027-03-25T17:00:00-05:00');
    expect(event?.description).toBe('A two-day festival for student filmmakers and writers.');
    expect(event?.startDatetime).toBe('2027-03-25T17:00:00-05:00');
    expect(event?.endDatetime).toBe('2027-03-25T20:00:00-05:00');
    expect(event?.locationFull).toBe('CMB 4.122 Studio 4C');
    expect(event?.organization.name).toBe('Moody College of Communication');
    expect(event?.rsvpUrl).toBe('https://example.com/register');
    expect(event?.imageWidth).toBe(480);
    expect(event?.imageHeight).toBe(480);
    expect(event?.imageAspectRatio).toBe('square');
    expect(event?.imageMimeType).toBe('image/png');
    expect(event?.imageAltText).toBe('Students discussing screenplays');
    expect(event?.categories).toEqual([
      { id: 'guest-speaker', name: 'Guest Speaker' },
      { id: 'panel-discussion', name: 'Panel Discussion' },
      { id: 'screening', name: 'Screening' },
      { id: 'social', name: 'Social' },
    ]);
  });

  it('uses the occurrence start in the dedupe key for recurring events', () => {
    const secondOccurrence = {
      ...listing,
      startDatetime: '2027-04-01T17:00:00-05:00',
    };
    const event = parseMoodyEvent(secondOccurrence, detail, NOW);
    expect(event?.sourceEventId).toBe('student-screenwriting-festival::2027-04-01T17:00:00-05:00');
    expect(event?.endDatetime).toBe('2027-04-02T01:00:00.000Z');
  });

  it('falls back to listing data when a detail page cannot be read', () => {
    const event = parseMoodyEvent(listing, '', NOW);
    expect(event?.description).toBe('A two-day festival for student filmmakers & writers.');
    expect(event?.endDatetime).toBeNull();
    expect(event?.categories).toEqual([{ id: 'screening', name: 'Screening' }]);
  });

  it('skips an occurrence that has already ended', () => {
    expect(parseMoodyEvent(listing, detail, new Date('2028-01-01T00:00:00Z').getTime())).toBeNull();
  });
});

describe('parseListingDatetime', () => {
  it('applies CST and CDT based on the event date', () => {
    expect(parseListingDatetime('January 8th, 2027 - 9:00 am')).toBe('2027-01-08T09:00:00-06:00');
    expect(parseListingDatetime('July 8th, 2027 - 5:00 pm')).toBe('2027-07-08T17:00:00-05:00');
  });

  it('returns null for an invalid date label', () => {
    expect(parseListingDatetime('Date TBA')).toBeNull();
  });
});
