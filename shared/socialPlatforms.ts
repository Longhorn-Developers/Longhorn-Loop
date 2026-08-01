/**
 * Shared social-platform registry: single source of truth for the "Linked
 * Socials" feature (LOOP-181).
 *
 * Dependency-free by design (no React, no SVGs, no server-only APIs) so BOTH
 * sides can import it directly, mirroring shared/taxonomy.ts:
 *   - app/lib/socialPlatforms.ts decorates these with icons for the UI
 *   - server/src/lib/socialLinks.ts uses them to validate submitted URLs
 *
 * `id` is stored in user_socials.platform, so renaming one is a migration.
 */

export type SocialPlatformId = 'linkedin' | 'instagram' | 'linktree' | 'discord' | 'slack' | 'link';

export type SocialPlatform = {
  id: SocialPlatformId;
  /** Shown in the Choose Application grid and the add-URL title. */
  label: string;
  /**
   * Hostnames this platform accepts, without a leading "www.". A submitted
   * URL matches when its hostname equals one of these or ends with
   * "." + one of these (so uk.linkedin.com passes for linkedin.com).
   *
   * `link` is the generic escape hatch and accepts any host, so its list
   * is empty and MUST be treated as "no host restriction".
   */
  hosts: string[];
  /** Ghost text in the add-URL field, straight from the Figma frame. */
  placeholder: string;
};

export const SOCIAL_PLATFORMS: SocialPlatform[] = [
  {
    id: 'linkedin',
    label: 'LinkedIn',
    hosts: ['linkedin.com', 'lnkd.in'],
    placeholder: 'www.linkedin.com/in/toddjenkins',
  },
  {
    id: 'instagram',
    label: 'Instagram',
    hosts: ['instagram.com', 'instagr.am'],
    placeholder: 'www.instagram.com/toddjenkins',
  },
  {
    id: 'linktree',
    label: 'Linktree',
    hosts: ['linktr.ee', 'linktree.com'],
    placeholder: 'linktr.ee/toddjenkins',
  },
  {
    id: 'discord',
    label: 'Discord',
    hosts: ['discord.gg', 'discord.com', 'discordapp.com'],
    placeholder: 'discord.gg/longhornloop',
  },
  {
    id: 'slack',
    label: 'Slack',
    hosts: ['slack.com'],
    placeholder: 'longhornloop.slack.com',
  },
  {
    id: 'link',
    label: 'Link',
    hosts: [],
    placeholder: 'www.example.com',
  },
];

/** Figma caps a user at three connected socials. */
export const MAX_LINKED_SOCIALS = 3;

const PLATFORM_BY_ID = new Map<string, SocialPlatform>(SOCIAL_PLATFORMS.map((p) => [p.id, p]));

export function getSocialPlatform(id: string): SocialPlatform | undefined {
  return PLATFORM_BY_ID.get(id);
}

export function isSocialPlatformId(value: string): value is SocialPlatformId {
  return PLATFORM_BY_ID.has(value);
}

/**
 * Users type "instagram.com/todd", not "https://instagram.com/todd", so add
 * the scheme before parsing. Anything that already carries a scheme is left
 * alone so we can reject non-http schemes rather than silently rewriting them.
 *
 * Matching on the bare "scheme:" rather than "scheme://" matters: opaque
 * schemes like javascript:alert(1) and data:text/html,x have no slashes, and
 * prefixing them with https:// would disguise them as a malformed host and
 * lose the reason they were rejected.
 *
 * The digit check keeps "linktr.ee:8080/todd" a host:port rather than a
 * "linktr.ee:" scheme — no real URL scheme is followed by a bare number.
 */
export function withScheme(raw: string): string {
  const trimmed = raw.trim();
  const schemeMatch = /^([a-z][a-z0-9+.-]*):(.*)$/is.exec(trimmed);
  if (schemeMatch && !/^\d/.test(schemeMatch[2])) return trimmed;
  return `https://${trimmed}`;
}

export type SocialUrlError =
  'EMPTY' | 'MALFORMED' | 'UNSUPPORTED_SCHEME' | 'WRONG_HOST' | 'UNKNOWN_PLATFORM';

export type SocialUrlResult =
  { ok: true; url: string; host: string } | { ok: false; error: SocialUrlError };

/**
 * Format-check a submitted social URL and normalize it for storage.
 *
 * This is deliberately only a *shape* check — it says nothing about whether
 * the page exists. Reachability is a separate, best-effort probe on the
 * server (see server/src/lib/socialLinks.ts), because a format error should
 * block the Add button instantly while a 404 check needs a network round trip.
 */
export function validateSocialUrl(platformId: string, raw: string): SocialUrlResult {
  const platform = getSocialPlatform(platformId);
  if (!platform) return { ok: false, error: 'UNKNOWN_PLATFORM' };

  if (!raw || !raw.trim()) return { ok: false, error: 'EMPTY' };

  let parsed: URL;
  try {
    parsed = new URL(withScheme(raw));
  } catch {
    return { ok: false, error: 'MALFORMED' };
  }

  // Block javascript:, data:, file: and friends outright — these end up in
  // Linking.openURL on the client.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'UNSUPPORTED_SCHEME' };
  }

  // A bare "instagram" with no dot parses as a valid URL with an empty-ish
  // host, so require at least one dot in the hostname.
  if (!parsed.hostname.includes('.')) return { ok: false, error: 'MALFORMED' };

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');

  if (platform.hosts.length > 0) {
    const matches = platform.hosts.some((h) => host === h || host.endsWith(`.${h}`));
    if (!matches) return { ok: false, error: 'WRONG_HOST' };
  }

  // Always store https. Trailing slashes are dropped so the same profile
  // typed two ways can't be linked twice.
  parsed.protocol = 'https:';
  const normalized = parsed.toString().replace(/\/$/, '');

  return { ok: true, url: normalized, host };
}
