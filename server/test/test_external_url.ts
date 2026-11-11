/**
 * shared/externalUrl.ts — the guard in front of every hand-off to the platform
 * browser (LOOP-278).
 *
 * Two testers lost the app to a tap on an externally ticketed event's RSVP:
 * frozen on iPhone, hard crash on iPad. Half of that was a presentation race
 * (see app/lib/externalLink.ts); the other half was that nothing checked the
 * stored link first. `rsvp_url` is validated on POST /events/create but NOT in
 * events/ingest.ts, so a scraped row can hold anything a link regex grabbed.
 *
 * The cases below are the shapes that actually reach this function, and the
 * two named ones are the reported crashes. There is no client test runner, so
 * this suite is the only executable check on the coercion — which is why the
 * function lives in shared/ rather than in app/lib.
 */

import { describe, expect, it } from 'vitest';
import {
  checkExternalUrlInput,
  MAX_EXTERNAL_URL_LENGTH,
  toExternalHttpUrl,
} from '../../shared/externalUrl';

describe('checkExternalUrlInput (LOOP-282)', () => {
  it('treats blank input as empty, not invalid — the field is optional', () => {
    expect(checkExternalUrlInput('')).toEqual({ kind: 'empty' });
    expect(checkExternalUrlInput('   ')).toEqual({ kind: 'empty' });
    expect(checkExternalUrlInput(null)).toEqual({ kind: 'empty' });
  });

  it('normalises a scheme-less host to https', () => {
    expect(checkExternalUrlInput('texasperformingarts.evenue.net')).toEqual({
      kind: 'valid',
      url: 'https://texasperformingarts.evenue.net',
    });
  });

  it('gives a reason a creator can act on for each kind of refusal', () => {
    const reason = (raw: string) => {
      const result = checkExternalUrlInput(raw);
      return result.kind === 'invalid' ? result.reason : null;
    };
    expect(reason('mailto:a@utexas.edu')).toBe('Use a web link (https://…)');
    expect(reason('RSVP at the door')).toBe('Links can’t contain spaces');
    expect(reason('rsvp')).toBe('That doesn’t look like a web address');
  });
});

describe('toExternalHttpUrl (LOOP-278)', () => {
  it('passes through http and https URLs unchanged', () => {
    expect(toExternalHttpUrl('https://texasperformingarts.org/events')).toBe(
      'https://texasperformingarts.org/events',
    );
    expect(toExternalHttpUrl('http://utexas.edu')).toBe('http://utexas.edu');
  });

  it('adds https:// to a scheme-less host — the reported crash case', () => {
    // The tester pasted the ticket page straight out of the address bar.
    expect(toExternalHttpUrl('texasperformingarts.evenue.net')).toBe(
      'https://texasperformingarts.evenue.net',
    );
    expect(toExternalHttpUrl('bit.ly/mha-concert?ref=loop')).toBe(
      'https://bit.ly/mha-concert?ref=loop',
    );
  });

  it('trims surrounding whitespace and newlines a paste leaves behind', () => {
    expect(toExternalHttpUrl('  https://utexas.edu  ')).toBe('https://utexas.edu');
    expect(toExternalHttpUrl('\nhttps://utexas.edu\n')).toBe('https://utexas.edu');
  });

  it('rejects schemes SFSafariViewController raises on rather than declines', () => {
    expect(toExternalHttpUrl('mailto:events@utexas.edu')).toBeNull();
    expect(toExternalHttpUrl('tel:+15124710000')).toBeNull();
    expect(toExternalHttpUrl('javascript:alert(1)')).toBeNull();
    expect(toExternalHttpUrl('longhornloop://event/12')).toBeNull();
    expect(toExternalHttpUrl('file:///etc/passwd')).toBeNull();
    expect(toExternalHttpUrl('ftp://utexas.edu')).toBeNull();
  });

  it('rejects prose a scraper mistook for a link', () => {
    expect(toExternalHttpUrl('RSVP at the door')).toBeNull();
    expect(toExternalHttpUrl('see https://utexas.edu for details')).toBeNull();
  });

  it('rejects anything without a real host', () => {
    // "https://rsvp" would open a browser on nothing and report success.
    expect(toExternalHttpUrl('rsvp')).toBeNull();
    expect(toExternalHttpUrl('https://')).toBeNull();
    expect(toExternalHttpUrl('https://.')).toBeNull();
    expect(toExternalHttpUrl('https://utexas.')).toBeNull();
    expect(toExternalHttpUrl('https://.edu')).toBeNull();
  });

  it('rejects empty and non-string values', () => {
    expect(toExternalHttpUrl(null)).toBeNull();
    expect(toExternalHttpUrl(undefined)).toBeNull();
    expect(toExternalHttpUrl('')).toBeNull();
    expect(toExternalHttpUrl('   ')).toBeNull();
    // The column is TEXT, but a JSON body can put anything in it.
    expect(toExternalHttpUrl(42 as unknown as string)).toBeNull();
  });

  it('rejects a URL longer than the column allows', () => {
    const host = `https://utexas.edu/${'a'.repeat(MAX_EXTERNAL_URL_LENGTH)}`;
    expect(toExternalHttpUrl(host)).toBeNull();
  });

  it('keeps ports, userinfo, paths, queries and fragments intact', () => {
    expect(toExternalHttpUrl('https://utexas.edu:8443/rsvp')).toBe('https://utexas.edu:8443/rsvp');
    expect(toExternalHttpUrl('https://user@utexas.edu/rsvp')).toBe('https://user@utexas.edu/rsvp');
    expect(toExternalHttpUrl('https://utexas.edu/a?b=c#d')).toBe('https://utexas.edu/a?b=c#d');
  });
});
