/**
 * Shared avatar model: the single source of truth for how a customized Bevo is
 * described, coloured, and validated.
 *
 * Dependency-free by design (no React, no SVGs, no server-only APIs) so BOTH
 * sides import it directly — the client to render, the server to validate the
 * config before it hits the database. Mirrors the pattern in taxonomy.ts.
 *
 * Storage model: an avatar is a *recipe*, not a picture. A user's Bevo is one
 * small JSON object — a palette key plus optional accessory ids — persisted in
 * a single TEXT column (`users.avatar_config`). 6 colours today, plus room for
 * hats/glasses/etc., all stay ~40 bytes no matter how many combinations exist.
 * The artwork is one recolourable SVG composed at render time, so no new image
 * asset ships per colour or per combination.
 */

// The six body-colour palettes from the design. Each recolours three roles;
// the outline, eyes, and nostrils are always BEVO_INK and never vary.
export type BevoPalette = 'orange' | 'beige' | 'brown' | 'cyan' | 'pink' | 'grey';

export const BEVO_PALETTES = ['orange', 'beige', 'brown', 'cyan', 'pink', 'grey'] as const;

/** Fixed ink used for the outline, eyes, and nostrils across every palette. */
export const BEVO_INK = '#331400';

/** Role → fill for each palette, pulled straight from the design frames. */
export const BEVO_PALETTE_COLORS: Record<BevoPalette, { body: string; horns: string; snout: string }> = {
  orange: { body: '#CC742A', horns: '#F2E0BA', snout: '#E29E50' },
  beige: { body: '#F2E0BA', horns: '#E29E50', snout: '#E29E50' },
  brown: { body: '#936546', horns: '#9D4A06', snout: '#9D4A06' },
  cyan: { body: '#A9E0E0', horns: '#81B3D2', snout: '#81B3D2' },
  pink: { body: '#E9BBE6', horns: '#DB7BD4', snout: '#DB7BD4' },
  grey: { body: '#8D8D8D', horns: '#766868', snout: '#766868' },
};

// Body-surface patterns: a decorative tile clipped to the body silhouette.
// Each id maps to a tile asset in BevoAvatar. 'none' is the plain body.
export type BevoPattern = 'none' | 'heart' | 'scales' | 'stars' | 'dots' | 'honey';

export const BEVO_PATTERNS = ['none', 'heart', 'scales', 'stars', 'dots', 'honey'] as const;

// Head accessories: a vector layer positioned on the head. Each id maps to
// artwork in BevoAvatar. 'none' is bare-headed.
export type BevoHat = 'none' | 'cap' | 'headphones' | 'topHat' | 'cowboyHat' | 'ribbon';

export const BEVO_HATS = ['none', 'cap', 'headphones', 'topHat', 'cowboyHat', 'ribbon'] as const;

/** A fully-described avatar. Serialized to JSON in `users.avatar_config`. */
export interface AvatarConfig {
  palette: BevoPalette;
  pattern?: BevoPattern;
  hat?: BevoHat;
}

/** The starter Bevo shown before a user customizes. */
export const DEFAULT_AVATAR_CONFIG: AvatarConfig = { palette: 'orange', pattern: 'none', hat: 'none' };

function isPalette(v: unknown): v is BevoPalette {
  return typeof v === 'string' && (BEVO_PALETTES as readonly string[]).includes(v);
}

function inList<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v);
}

/**
 * Coerce arbitrary input (a parsed JSON body, a DB TEXT column, a legacy value)
 * into a valid AvatarConfig, falling back to the default for anything unknown.
 * Total by design so neither a malformed request nor a stale row can throw —
 * the worst case is a user rendered as the default orange Bevo.
 */
export function normalizeAvatarConfig(raw: unknown): AvatarConfig {
  let obj: unknown = raw;

  // Accept a JSON string (how it comes out of the DB) as well as an object.
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_AVATAR_CONFIG };
    }
  }

  if (!obj || typeof obj !== 'object') return { ...DEFAULT_AVATAR_CONFIG };

  const candidate = obj as Record<string, unknown>;
  const palette = isPalette(candidate.palette) ? candidate.palette : DEFAULT_AVATAR_CONFIG.palette;

  // Accessories validate against their id lists; an unknown id drops to 'none'
  // so a client on a newer build can't wedge a value the renderer can't draw.
  const pattern = inList(BEVO_PATTERNS, candidate.pattern) ? candidate.pattern : 'none';
  const hat = inList(BEVO_HATS, candidate.hat) ? candidate.hat : 'none';

  return { palette, pattern, hat };
}

/**
 * Parse `users.avatar_config` for an API response, preserving NULL rather
 * than normalizing it to DEFAULT_AVATAR_CONFIG.
 *
 * Most accounts predate Bevo customization and have never set this column.
 * Clients render avatars with a fallback chain (photo -> avatar_config ->
 * legacy `avatar` preset); an always-present default object here would mask
 * every one of those legacy presets behind an unwanted default Bevo.
 */
export function parseStoredAvatarConfig(raw: unknown): AvatarConfig | null {
  return raw ? normalizeAvatarConfig(raw) : null;
}

/** Serialize for the DB TEXT column. Normalizes first so only valid JSON lands. */
export function serializeAvatarConfig(config: unknown): string {
  return JSON.stringify(normalizeAvatarConfig(config));
}
