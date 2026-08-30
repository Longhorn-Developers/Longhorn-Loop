// Theme colours for the places a Tailwind class can't reach.
//
// Most styling should use the lhl* classes, which resolve through the CSS
// variables in app/globals.css and theme themselves. This exists for the
// remainder: props that take a raw colour string — ActivityIndicator `color`,
// Switch `trackColor`/`thumbColor`, SVG icon `color`, TextInput
// `placeholderTextColor`, `blurRadius` overlays — where there is no class to
// apply.
//
// Values must stay in step with globals.css. They're duplicated because a
// React Native prop can't read a CSS variable; the test suite pins the two
// against each other so they can't drift silently.

import { useAppTheme } from '@/app/context/ThemeContext';

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceMuted: string;
  ink: string;
  inkSecondary: string;
  /** Tertiary text — timestamps, counts, inactive tab icons. */
  inkMuted: string;
  border: string;
  /** Hairline rules between sections; softer than `border`. */
  divider: string;
  placeholder: string;
  /** Recessed track behind a segmented control; the selected pill is `background`. */
  segmentTrack: string;
  brand: string;
  accent: string;
  /** Tinted fill behind a selected card / saved state. */
  brandSoft: string;
  destructive: string;
  /**
   * Fill behind a solid destructive BUTTON that carries a white label.
   *
   * Separate from `destructive` because that token is tuned to be read as TEXT
   * and lightens to #FF6B63 in dark so it clears 4.5:1 on the page — at which
   * point white sitting ON it is only 2.79:1. Pinned to the same deep red in
   * both themes, where white is 7.15:1.
   */
  destructiveFill: string;
  /** Tinted fill behind an inline error. */
  destructiveSoft: string;
  /** Informational, non-brand: the "Going" badge. */
  info: string;
  /** Modal scrim, already carrying its alpha. */
  scrim: string;
}

export const LIGHT_COLORS: ThemeColors = {
  background: '#F9F8F5',
  surface: '#FFFFFF',
  surfaceMuted: '#F8F5F2',
  ink: '#09090B',
  inkSecondary: '#485656',
  inkMuted: '#9A9A9A',
  border: '#C7C7C7',
  divider: '#D2DEE0',
  placeholder: '#D9D9D9',
  segmentTrack: '#E8E3DC',
  brand: '#9D4B06',
  accent: '#A84B00',
  brandSoft: '#FFF5E5',
  destructive: '#B30404',
  destructiveFill: '#B30404',
  destructiveSoft: '#FCE4E4',
  info: '#2591D4',
  scrim: 'rgba(9, 9, 11, 0.5)',
};

export const DARK_COLORS: ThemeColors = {
  background: '#14171C',
  surface: '#1D2128',
  surfaceMuted: '#262B33',
  ink: '#F2F4F7',
  inkSecondary: '#A4AEBB',
  inkMuted: '#909AA6',
  border: '#4F5661',
  divider: '#2E343D',
  placeholder: '#333942',
  segmentTrack: '#262B33',
  brand: '#BD5500',
  accent: '#F0975C',
  brandSoft: '#3A2612',
  destructive: '#FF6B63',
  // Lightened far less than `destructive`, and for the opposite reason: this is
  // a background, so it has to stay dark enough to carry a white label (4.98:1)
  // while still separating from the page (3.61:1) and the modal card (3.24:1).
  // #B30404 straight from light would hold the label but sink into the page.
  destructiveFill: '#D32F2F',
  destructiveSoft: '#42201E',
  info: '#5AB4EE',
  // Heavier in dark: a 50% scrim over an already-dark page doesn't separate
  // the modal from what's behind it.
  scrim: 'rgba(0, 0, 0, 0.7)',
};

/**
 * A token at partial opacity.
 *
 * Needed where a tint has to sit ON a themed fill and still read as its own
 * shape — the selected poster tile over a selected card, for instance. A
 * second opaque token would have to be re-picked every time the fill beneath
 * it moves; an alpha of the same token tracks it automatically.
 *
 * Tailwind classes get this for free via the `/50` modifier; this is the
 * equivalent for `style={{}}` and StyleSheet values.
 */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** The active palette. Re-renders when the Dark Mode toggle flips. */
export function useThemeColors(): ThemeColors {
  const { isDark } = useAppTheme();
  return isDark ? DARK_COLORS : LIGHT_COLORS;
}
