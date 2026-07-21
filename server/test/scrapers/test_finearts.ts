import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  decodeHtmlEntities,
  extractDateRange,
  extractEventRows,
  hasNextPage,
  orgNameForUrl,
  parseEventRow,
  upgradeImageUrl,
} from '../../src/scrapers/finearts';

function loadFixture(name: string): string {
  return readFileSync(
    join(__dirname, '..', '..', 'src', 'scrapers', '__fixtures__', 'finearts', name),
    'utf-8',
  );
}

// Fixture rows use 2026 dates (except the intentionally-past one); parse
// "now" as before all of them.
const NOW = new Date('2026-01-01T00:00:00Z').getTime();

describe('extractEventRows + parseEventRow', () => {
  const rows = extractEventRows(loadFixture('listing-page.html'));

  it('extracts every row from a listing page', () => {
    expect(rows).toHaveLength(5);
  });

  it('parses a multi-day date range and maps a known ticketing domain to its org', () => {
    const parsed = parseEventRow(rows[0], NOW);
    expect(parsed).not.toBeNull();
    expect(parsed?.source).toBe('cofa');
    expect(parsed?.title).toBe('Murals at VAC: Codex Two Thousand Twenty-Six');
    expect(parsed?.startDatetime).toBe('2026-01-23');
    expect(parsed?.endDatetime).toBe('2026-08-02');
    expect(parsed?.eventUrl).toBe(
      'https://utvac.org/event/murals-vac-codex-two-thousand-twenty-six?date=0',
    );
    expect(parsed?.sourceEventId).toBe(
      'https://utvac.org/event/murals-vac-codex-two-thousand-twenty-six?date=0::2026-01-23',
    );
    expect(parsed?.organization.name).toBe('Visual Arts Center');
    expect(parsed?.imageUrl).toBe(
      'https://finearts.utexas.edu/sites/default/files/2025-12/hero-murals-codex-1.jpg.webp',
    );
    expect(parsed?.imageWidth).toBe(600);
    expect(parsed?.imageHeight).toBe(535);
    expect(parsed?.imageAspectRatio).toBe('horizontal');
  });

  it('decodes entities in the title and strips a trailing (map) link from location', () => {
    const parsed = parseEventRow(rows[1], NOW);
    expect(parsed?.title).toBe('& Juliet');
    expect(parsed?.locationShort).toBe('Bass Concert Hall');
    expect(parsed?.organization.name).toBe('Texas Performing Arts');
  });

  it('parses a single date+time instant with no range', () => {
    const parsed = parseEventRow(rows[2], NOW);
    expect(parsed?.startDatetime).toBe('2026-09-18T19:30:00-05:00');
    expect(parsed?.endDatetime).toBeNull();
    expect(parsed?.organization.name).toBe('Butler School of Music');
    expect(parsed?.imageUrl).toBeNull();
    expect(parsed?.imageAspectRatio).toBe('none');
  });

  it('falls back to the default org for an unrecognized domain', () => {
    const parsed = parseEventRow(rows[3], NOW);
    expect(parsed?.organization.name).toBe('College of Fine Arts');
  });

  it('skips events that have already ended', () => {
    expect(parseEventRow(rows[4], NOW)).toBeNull();
  });
});

describe('extractDateRange', () => {
  it('returns null when there is no datetime block', () => {
    expect(extractDateRange('<div></div>')).toBeNull();
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

describe('upgradeImageUrl', () => {
  it('strips the Drupal image style path and query string', () => {
    expect(
      upgradeImageUrl(
        '/sites/default/files/styles/utexas_image_style_600w/public/2025-12/foo.jpg.webp?itok=abc',
      ),
    ).toBe('/sites/default/files/2025-12/foo.jpg.webp');
  });

  it('returns null for a missing src', () => {
    expect(upgradeImageUrl(null)).toBeNull();
  });
});

describe('orgNameForUrl', () => {
  it('maps known ticketing domains to their org name', () => {
    expect(orgNameForUrl('https://utvac.org/event/foo')).toBe('Visual Arts Center');
    expect(orgNameForUrl('https://texasperformingarts.org/event/foo')).toBe(
      'Texas Performing Arts',
    );
    expect(orgNameForUrl('https://music.utexas.edu/events/foo')).toBe('Butler School of Music');
  });

  it('falls back to the default org for unknown domains', () => {
    expect(orgNameForUrl('https://example.com/event/foo')).toBe('College of Fine Arts');
  });

  it('falls back to the default org for an unparseable URL', () => {
    expect(orgNameForUrl('not-a-url')).toBe('College of Fine Arts');
  });
});

describe('decodeHtmlEntities', () => {
  it('decodes common HTML entities', () => {
    expect(decodeHtmlEntities('&amp; Juliet')).toBe('& Juliet');
  });
});
