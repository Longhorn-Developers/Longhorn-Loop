/**
 * Validates the shared social-link rules (shared/socialPlatforms.ts) that both
 * the Edit Profile screen and POST /users/me/socials depend on (LOOP-181).
 *
 * The client uses validateSocialUrl() to enable/disable the Add button and the
 * Worker uses it to reject bad input, so a divergence here is a bug on both
 * sides at once. These tests pin the behaviour that matters:
 *   - schemeless input (what users actually type) is accepted
 *   - non-http schemes are rejected, since the result reaches Linking.openURL
 *   - host matching is per-platform, with `link` as the unrestricted escape hatch
 *   - normalization is stable, so the same profile can't be linked twice
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_LINKED_SOCIALS,
  SOCIAL_PLATFORMS,
  getSocialPlatform,
  isSocialPlatformId,
  validateSocialUrl,
} from '../../shared/socialPlatforms';

describe('social platform registry', () => {
  it('exposes unique, non-empty platform ids', () => {
    const ids = SOCIAL_PLATFORMS.map((p) => p.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const platform of SOCIAL_PLATFORMS) {
      expect(platform.id).toBeTruthy();
      expect(platform.label).toBeTruthy();
      expect(platform.placeholder).toBeTruthy();
    }
  });

  it('caps linked socials at the number the design specifies', () => {
    expect(MAX_LINKED_SOCIALS).toBe(3);
  });

  it('recognizes every registered id and nothing else', () => {
    for (const platform of SOCIAL_PLATFORMS) {
      expect(isSocialPlatformId(platform.id)).toBe(true);
      expect(getSocialPlatform(platform.id)?.label).toBe(platform.label);
    }
    expect(isSocialPlatformId('myspace')).toBe(false);
    expect(getSocialPlatform('myspace')).toBeUndefined();
  });

  it('keeps `link` as the only unrestricted platform', () => {
    for (const platform of SOCIAL_PLATFORMS) {
      if (platform.id === 'link') expect(platform.hosts).toHaveLength(0);
      else expect(platform.hosts.length).toBeGreaterThan(0);
    }
  });
});

describe('validateSocialUrl', () => {
  it('accepts the schemeless form users actually type', () => {
    const result = validateSocialUrl('instagram', 'www.instagram.com/toddjenkins');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe('https://www.instagram.com/toddjenkins');
  });

  it('upgrades http to https so stored links are consistent', () => {
    const result = validateSocialUrl('instagram', 'http://instagram.com/toddjenkins');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url.startsWith('https://')).toBe(true);
  });

  it('normalizes away a trailing slash so one profile cannot be linked twice', () => {
    const withSlash = validateSocialUrl('linktree', 'linktr.ee/todd/');
    const without = validateSocialUrl('linktree', 'linktr.ee/todd');
    expect(withSlash.ok && without.ok).toBe(true);
    if (withSlash.ok && without.ok) expect(withSlash.url).toBe(without.url);
  });

  it('accepts regional and short-link subdomains for a platform', () => {
    expect(validateSocialUrl('linkedin', 'uk.linkedin.com/in/todd').ok).toBe(true);
    expect(validateSocialUrl('linkedin', 'lnkd.in/abc123').ok).toBe(true);
  });

  it('rejects a URL pointed at the wrong platform', () => {
    const result = validateSocialUrl('instagram', 'https://linkedin.com/in/todd');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('WRONG_HOST');
  });

  it('rejects non-http schemes, which would reach Linking.openURL', () => {
    for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi']) {
      const result = validateSocialUrl('link', bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('UNSUPPORTED_SCHEME');
    }
  });

  it('rejects empty and hostless input', () => {
    expect(validateSocialUrl('instagram', '')).toEqual({ ok: false, error: 'EMPTY' });
    expect(validateSocialUrl('instagram', '   ')).toEqual({ ok: false, error: 'EMPTY' });

    // No dot in the hostname -- "instagram" alone is a typo, not a URL.
    const bare = validateSocialUrl('link', 'instagram');
    expect(bare.ok).toBe(false);
    if (!bare.ok) expect(bare.error).toBe('MALFORMED');
  });

  it('rejects an unknown platform outright', () => {
    const result = validateSocialUrl('myspace', 'https://myspace.com/todd');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('UNKNOWN_PLATFORM');
  });

  it('lets the generic `link` platform accept any host', () => {
    expect(validateSocialUrl('link', 'example.com/todd').ok).toBe(true);
    expect(validateSocialUrl('link', 'https://some.university.edu/~todd').ok).toBe(true);
  });
});
