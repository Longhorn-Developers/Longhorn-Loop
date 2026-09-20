// App theme: System / Light / Dark (LOOP-184, extended).
//
// One provider owns "is the app dark", so Settings can change it without every
// screen threading a prop, and app/lib/themeColors.ts can read it from a hook.
//
// ---------------------------------------------------------------------------
// SYSTEM IS THE DEFAULT, AND IT IS A REAL OPTION RATHER THAN A STARTING VALUE.
//
// The preference is one of three, not a boolean:
//
//   system  follow the OS, and keep following it — a phone switched to dark at
//           sunset switches the app at sunset too, with no relaunch
//   light   always light, whatever the OS says
//   dark    always dark, whatever the OS says
//
// `useColorScheme()` is what makes the first one live: it re-renders when iOS
// changes appearance, including on the automatic sunrise/sunset schedule. A
// one-off read at launch would have given "follows the system" that only holds
// until the system next changes, which is the version of this feature people
// complain about.
//
// Storage is device-local — see app/lib/themePreference.ts for why appearance
// stopped being an account setting once System existed.

import { useOnboarding } from '@/app/context/OnboardingContext';
import { api } from '@/app/lib/api';
import { settings as settingsKeys } from '@/app/lib/queryKeys';
import {
  loadThemePreference,
  saveThemePreference,
  type ThemePreference,
} from '@/app/lib/themePreference';
import { useQuery } from '@tanstack/react-query';
import { colorScheme } from 'nativewind';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';

interface ThemeContextValue {
  /** What is actually on screen right now, OS included. */
  isDark: boolean;
  /** What the user chose. 'system' means isDark is following the OS. */
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  isDark: false,
  preference: 'system',
  setPreference: () => {},
});

/**
 * Apply the scheme to NativeWind, but never let it take the app down.
 *
 * colorScheme.set() throws when tailwind.config.js has darkMode 'media'
 * (NativeWind's default) — and because this runs from a provider effect at the
 * root, an uncaught throw crashes the whole app on launch. `darkMode: 'class'`
 * is set in tailwind.config.js so this should not fire, but a cosmetic
 * preference must not be able to brick startup if that config is ever changed
 * back or a NativeWind upgrade shifts the rules.
 *
 * Always given the RESOLVED scheme, never 'system'. NativeWind can follow the
 * OS itself, but then two things would be deciding what dark means — this
 * context and NativeWind — and any disagreement shows up as `dark:` classes
 * fighting the colours from useThemeColors on the same screen.
 */
function applyColorScheme(dark: boolean): void {
  try {
    colorScheme.set(dark ? 'dark' : 'light');
  } catch (err) {
    console.warn('[theme] could not apply color scheme; check darkMode in tailwind.config.js', err);
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const { data: onboarding } = useOnboarding();
  const token = onboarding.token || null;

  /**
   * null means "this device has never chosen", which is NOT 'system'.
   *
   * The distinction is the whole upgrade path: only a device with no stored
   * choice may adopt the legacy server value below. Collapsing null into
   * 'system' would quietly reset everyone who had dark mode on.
   */
  const [stored, setStored] = useState<ThemePreference | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadThemePreference().then((value) => {
      if (cancelled) return;
      setStored(value);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The legacy server boolean, read once to carry existing users over.
   *
   * Only `true` is worth adopting. A stored `false` is indistinguishable from
   * the column's own default — it means "never turned dark mode on", not "chose
   * light" — so treating it as an explicit light choice would opt everyone who
   * ignored the old switch OUT of following their phone, which is the opposite
   * of what this change is for.
   */
  const { data } = useQuery({
    queryKey: settingsKeys.mine(),
    queryFn: () => api.get<{ settings: { dark_mode: boolean } }>('/settings', { token }),
    enabled: !!token,
    staleTime: Infinity,
  });

  const legacyDark = data?.settings?.dark_mode;
  useEffect(() => {
    if (!loaded || stored !== null || legacyDark !== true) return;
    setStored('dark');
    saveThemePreference('dark');
  }, [loaded, stored, legacyDark]);

  const preference: ThemePreference = stored ?? 'system';

  /**
   * `useColorScheme()` returns null before the OS has reported, and on web
   * where nothing has. Light is the safer guess: a flash of light on a dark
   * phone is a blink, where a flash of dark on a light one in daylight is
   * genuinely unpleasant.
   */
  const isDark = preference === 'system' ? systemScheme === 'dark' : preference === 'dark';

  // Keep NativeWind in lockstep, so `dark:` classes and this context can never
  // disagree. Runs on OS changes too, because isDark moves with them.
  useEffect(() => {
    applyColorScheme(isDark);
  }, [isDark]);

  const setPreference = useCallback((next: ThemePreference) => {
    setStored(next);
    // Applied by the effect above off the derived value, rather than here,
    // so there is exactly one place that decides what NativeWind is told.
    saveThemePreference(next);
  }, []);

  /**
   * Signing out no longer resets the theme.
   *
   * It used to snap back to light, because the preference belonged to the
   * account and leaving the previous user's theme on the login screen was
   * wrong. It belongs to the device now, so keeping it is correct: the login
   * screen should look the way this phone looks.
   */

  const value = useMemo(
    () => ({ isDark, preference, setPreference }),
    [isDark, preference, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  return useContext(ThemeContext);
}
