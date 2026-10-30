import { describe, expect, it } from 'vitest';
import {
  buildDatetime,
  chicagoOffset,
  decodeHtmlEntities,
  htmlToText,
  parseTime12h,
} from '../../src/scrapers/helpers';

describe('decodeHtmlEntities', () => {
  it('decodes common named entities', () => {
    expect(decodeHtmlEntities('Q&amp;A')).toBe('Q&A');
    expect(decodeHtmlEntities('&amp; Juliet')).toBe('& Juliet');
    expect(decodeHtmlEntities('AT&amp;T &lt;tag&gt; &quot;quote&quot; &#39;s&#39;')).toBe(
      `AT&T <tag> "quote" 's'`,
    );
    expect(decodeHtmlEntities('it&apos;s&nbsp;here')).toBe("it's here");
  });

  it('decodes decimal and hexadecimal numeric entities', () => {
    expect(decodeHtmlEntities('A&amp;M &#8212; M&#xFC;ller')).toBe('A&M — Müller');
    expect(decodeHtmlEntities('Data&#8211;Driven')).toBe('Data–Driven');
    expect(decodeHtmlEntities('Master&#8217;s')).toBe('Master’s');
  });

  it('decodes the typographic named entities WP and Drupal emit', () => {
    expect(decodeHtmlEntities('&ldquo;Hi&rdquo; &ndash; it&rsquo;s &mdash; ok')).toBe(
      '“Hi” – it’s — ok',
    );
  });

  it('decodes the accented and symbol entities UT content uses', () => {
    expect(decodeHtmlEntities('caf&eacute; &hellip; &copy; &uuml;ber')).toBe('café … © über');
  });

  it('matches the core entities case-insensitively', () => {
    expect(decodeHtmlEntities('A &AMP; B &LT;')).toBe('A & B <');
  });

  // HTML names are case-sensitive: "&Ntilde;" is Ñ, not ñ, so lowercasing it
  // would decode it to the wrong letter. Unlisted capitals are left alone.
  it('does not fold the case of other entities', () => {
    expect(decodeHtmlEntities('&Ntilde; &Eacute;')).toBe('&Ntilde; &Eacute;');
    expect(decodeHtmlEntities('&ntilde;')).toBe('ñ');
  });

  it('decodes once, so an escaped entity stays text', () => {
    expect(decodeHtmlEntities('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;');
  });

  it('leaves unknown named entities alone instead of dropping them', () => {
    expect(decodeHtmlEntities('a &bogus; b')).toBe('a &bogus; b');
  });

  it('leaves a numeric entity outside the Unicode range alone instead of throwing', () => {
    expect(decodeHtmlEntities('x &#99999999; y')).toBe('x &#99999999; y');
    expect(decodeHtmlEntities('x &#x110000; y')).toBe('x &#x110000; y');
  });

  it('leaves a NUL entity alone instead of putting a NUL byte in the text', () => {
    expect(decodeHtmlEntities('a&#0;b')).toBe('a&#0;b');
    expect(decodeHtmlEntities('a&#x0;b')).toBe('a&#x0;b');
  });

  it('passes text with no entities through unchanged', () => {
    expect(decodeHtmlEntities('plain text')).toBe('plain text');
    expect(decodeHtmlEntities('')).toBe('');
  });
});

describe('htmlToText', () => {
  it('strips tags and decodes entities', () => {
    expect(htmlToText('<p>Learn <strong>more</strong> &amp; join us</p>')).toBe(
      'Learn more & join us',
    );
  });

  it('keeps neighbouring blocks apart instead of gluing them together', () => {
    expect(htmlToText('<p>First</p><p>Second</p>')).toBe('First Second');
    expect(htmlToText('Line one<br />Line two')).toBe('Line one Line two');
  });

  it('collapses whitespace, including a decoded &nbsp;', () => {
    expect(htmlToText('  a \n\n b&nbsp;&nbsp;c  ')).toBe('a b c');
  });

  it('decodes exactly once, so escaped entities and markup stay text', () => {
    expect(htmlToText('Q&amp;amp;A')).toBe('Q&amp;A');
    expect(htmlToText('x &lt;3 y &gt; z')).toBe('x <3 y > z');
    expect(htmlToText('use &lt;b&gt;bold&lt;/b&gt;')).toBe('use <b>bold</b>');
  });

  it('returns an empty string for empty or tag-only input', () => {
    expect(htmlToText('')).toBe('');
    expect(htmlToText('<p></p>\n')).toBe('');
  });
});

describe('chicagoOffset', () => {
  it('returns CST in winter', () => {
    expect(chicagoOffset('2026-01-08')).toBe('-06:00');
  });

  it('returns CDT in summer', () => {
    expect(chicagoOffset('2026-07-08')).toBe('-05:00');
  });

  // Sites label every time "CST" all year, but events on either side of the
  // Nov 1 2026 fall-back are not on the same offset.
  it('flips offset across the November daylight-saving boundary', () => {
    expect(chicagoOffset('2026-10-31')).toBe('-05:00');
    expect(chicagoOffset('2026-11-01')).toBe('-06:00');
  });

  it('flips offset across the March daylight-saving boundary', () => {
    expect(chicagoOffset('2026-03-07')).toBe('-06:00');
    expect(chicagoOffset('2026-03-08')).toBe('-05:00');
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

  it('returns null for a time that is the right shape but impossible', () => {
    expect(parseTime12h('13:00 pm')).toBeNull();
    expect(parseTime12h('0:30 am')).toBeNull();
    expect(parseTime12h('9:99 am')).toBeNull();
    expect(parseTime12h('12:59 pm')).toEqual({ hours: 12, minutes: 59 });
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

  it('falls back to the bare date when the time cannot be read', () => {
    expect(buildDatetime('2026-07-08', 'noon')).toBe('2026-07-08');
    expect(buildDatetime('2026-07-08', '9:99 am')).toBe('2026-07-08');
  });
});
