/**
 * Parser tests for the HornsLink org directory scraper (LOOP-241).
 *
 * NOTE ON FIXTURES. Every other scraper test in this folder loads a real
 * captured payload out of src/scrapers/__fixtures__. These inputs are
 * SYNTHETIC — utexas.campuslabs.com disallows automated fetching, so no live
 * directory response or org page was available when this was written.
 *
 * That changes what these tests are worth, and it is worth being blunt about
 * it. They pin the parser's *behaviour* — which key spellings it accepts,
 * which email it picks when several are present, what it refuses to guess —
 * and those are the parts that encode real decisions. They do NOT prove the
 * parser handles the actual HornsLink markup, because nobody has seen it here.
 *
 * When someone captures a real directory page and a real org page, drop them
 * in __fixtures__/hornslinkOrgs/ and add cases that load them. At that point
 * the multi-spelling tolerance in parseDirectoryPage can probably be deleted
 * in favour of the real key names, and these synthetic cases become redundant
 * with better ones.
 */

import { describe, expect, it } from 'vitest';
import {
  extractContactEmail,
  orgDetailUrl,
  parseDirectoryCount,
  parseDirectoryPage,
} from '../../src/scrapers/hornslinkOrgs';

describe('parseDirectoryPage', () => {
  it('reads camelCase keys', () => {
    const orgs = parseDirectoryPage({
      value: [
        {
          id: 12345,
          name: 'Texas Rowing',
          websiteKey: 'texasrowing',
          profilePicture: 'abc-123.jpg',
        },
      ],
    });

    expect(orgs).toHaveLength(1);
    expect(orgs[0]).toEqual({
      id: 12345,
      name: 'Texas Rowing',
      websiteKey: 'texasrowing',
      profilePicture: 'https://se-images.campuslabs.com/clink/images/abc-123.jpg',
    });
  });

  it('reads the PascalCase spelling Engage uses in OData-flavoured responses', () => {
    const orgs = parseDirectoryPage({
      Value: [{ Id: 999, Name: 'Longhorn Band', WebsiteKey: 'lhb', ProfilePicture: 'x.png' }],
    });

    expect(orgs).toHaveLength(1);
    expect(orgs[0].id).toBe(999);
    expect(orgs[0].name).toBe('Longhorn Band');
    expect(orgs[0].websiteKey).toBe('lhb');
  });

  it('coerces a numeric id delivered as a string', () => {
    const orgs = parseDirectoryPage({ value: [{ id: '4242', name: 'Chess Club' }] });
    expect(orgs[0].id).toBe(4242);
  });

  it('DROPS a row whose id is not numeric rather than inventing one', () => {
    // organizations.id IS the HornsLink id. A row keyed on a made-up id can
    // never be matched back up by a later scrape, and would show up in search
    // as an org nobody can ever claim.
    const orgs = parseDirectoryPage({
      value: [
        { id: 'a3f9c1e2-guid-shaped', name: 'Ghost Org' },
        { id: 7, name: 'Real Org' },
      ],
    });

    expect(orgs.map((o) => o.name)).toEqual(['Real Org']);
  });

  it('drops rows with no name and survives non-object entries', () => {
    const orgs = parseDirectoryPage({ value: [{ id: 1 }, null, 'nope', { id: 2, name: 'Ok' }] });
    expect(orgs.map((o) => o.id)).toEqual([2]);
  });

  it('returns [] rather than throwing on a shape it does not recognise', () => {
    expect(parseDirectoryPage(null)).toEqual([]);
    expect(parseDirectoryPage({})).toEqual([]);
    expect(parseDirectoryPage({ value: 'not an array' })).toEqual([]);
  });

  it('leaves websiteKey and profilePicture null when absent', () => {
    const orgs = parseDirectoryPage({ value: [{ id: 5, name: 'Bare Org' }] });
    expect(orgs[0].websiteKey).toBeNull();
    expect(orgs[0].profilePicture).toBeNull();
  });
});

describe('parseDirectoryCount', () => {
  it('reads the OData count', () => {
    expect(parseDirectoryCount({ '@odata.count': 1042 })).toBe(1042);
  });

  it('accepts alternative spellings and string numbers', () => {
    expect(parseDirectoryCount({ totalItems: '77' })).toBe(77);
  });

  it('returns null when absent, so paging falls back to "until empty"', () => {
    expect(parseDirectoryCount({ value: [] })).toBeNull();
  });
});

describe('extractContactEmail', () => {
  it('prefers a keyed field inside an embedded JSON blob', () => {
    const html = `
      <html><body>
        <script id="__NEXT_DATA__" type="application/json">
          {"props":{"org":{"name":"Chess Club","contactEmail":"President@utexas.edu"}}}
        </script>
      </body></html>`;

    expect(extractContactEmail(html)).toBe('president@utexas.edu');
  });

  it('reads a window assignment as well as a bare JSON script', () => {
    const html = `<script>window.__PRELOADED_STATE__ = {"contact":{"email":"chair@utexas.edu"}};</script>`;
    expect(extractContactEmail(html)).toBe('chair@utexas.edu');
  });

  it('IGNORES emails under keys that are not contact-ish', () => {
    // This is the case that protects us from mailing a verification code to
    // a Campus Labs support address that happens to sit in the same payload.
    const html = `
      <script type="application/json">
        {"supportEmail":"help@campuslabs.com","webmaster":"webmaster@utexas.edu"}
      </script>`;

    expect(extractContactEmail(html)).toBeNull();
  });

  it('falls back to a mailto: link', () => {
    const html = `<p>Contact: <a href="mailto:officers@utexas.edu?subject=Hi">email us</a></p>`;
    expect(extractContactEmail(html)).toBe('officers@utexas.edu');
  });

  it('falls back to the "E:" label, across intervening tags', () => {
    const html = `<div class="contact"><span>E:</span> <span>pres@utexas.edu</span></div>`;
    expect(extractContactEmail(html)).toBe('pres@utexas.edu');
  });

  it('decodes entity-obfuscated addresses', () => {
    const html = `<a href="mailto:pres&#64;utexas.edu">mail</a>`;
    expect(extractContactEmail(html)).toBe('pres@utexas.edu');
  });

  it('rejects template placeholder addresses', () => {
    expect(extractContactEmail(`<a href="mailto:noreply@utexas.edu">x</a>`)).toBeNull();
    expect(extractContactEmail(`<a href="mailto:someone@example.com">x</a>`)).toBeNull();
  });

  it('returns null rather than grabbing any email on the page', () => {
    // The deliberate absence of a "find any address" fallback. A wrong address
    // hands the org to whoever owns it and locks out the people who run it,
    // and neither failure is visible to us. null is recoverable; wrong is not.
    const html = `
      <footer>Questions? Write to campus-help@utexas.edu or dev@campuslabs.com</footer>`;

    expect(extractContactEmail(html)).toBeNull();
  });

  it('is safe on empty and junk input', () => {
    expect(extractContactEmail('')).toBeNull();
    expect(extractContactEmail('<html></html>')).toBeNull();
    expect(extractContactEmail('<script>{not json at all</script>')).toBeNull();
  });
});

describe('orgDetailUrl', () => {
  it('builds the public org page url', () => {
    expect(orgDetailUrl('texasrowing')).toBe(
      'https://utexas.campuslabs.com/engage/organization/texasrowing',
    );
  });

  it('encodes a slug that needs it', () => {
    expect(orgDetailUrl('a b/c')).toContain('a%20b%2Fc');
  });
});
