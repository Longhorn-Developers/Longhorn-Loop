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
  border: string;
  placeholder: string;
  brand: string;
  accent: string;
  destructive: string;
  /** Modal scrim, already carrying its alpha. */
  scrim: string;
}

export const LIGHT_COLORS: ThemeColors = {
  background: '#F9F8F5',
  surface: '#FFFFFF',
  surfaceMuted: '#F8F5F2',
  ink: '#09090B',
  inkSecondary: '#485656',
  border: '#B4B2B2',
  placeholder: '#D9D9D9',
  brand: '#BD5500',
  accent: '#A84B00',
  destructive: '#B30404',
  scrim: 'rgba(9, 9, 11, 0.5)',
};

export const DARK_COLORS: ThemeColors = {
  background: '#1A1714',
  surface: '#232019',
  surfaceMuted: '#2B2721',
  ink: '#F3EFE8',
  inkSecondary: '#A9A29A',
  border: '#585047',
  placeholder: '#3F3A33',
  brand: '#BD5500',
  accent: '#F0975C',
  destructive: '#FF6B63',
  // Heavier in dark: a 50% scrim over an already-dark page doesn't separate
  // the modal from what's behind it.
  scrim: 'rgba(0, 0, 0, 0.7)',
};

/** The active palette. Re-renders when the Dark Mode toggle flips. */
export function useThemeColors(): ThemeColors {
  const { isDark } = useAppTheme();
  return isDark ? DARK_COLORS : LIGHT_COLORS;
}
