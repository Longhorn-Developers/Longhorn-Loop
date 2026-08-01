// App theme (LOOP-184, build step 3 — the Dark Mode toggle in Preferences).
//
// Wraps NativeWind's colorScheme so a single provider owns "is the app dark",
// and Settings can flip it without every screen threading a prop.
//
// Scope, stated plainly: this makes the switch real — the preference persists
// server-side, is applied on launch, and drives NativeWind's `dark:` variant.
// It does NOT restyle existing screens. Those were written with hardcoded
// light colours (BG = '#F9F8F5' and friends) and each needs `dark:` variants
// added before the app actually looks dark. That's mechanical but broad, and
// it belongs in its own change rather than buried in a Settings ticket.

import { useOnboarding } from '@/app/context/OnboardingContext';
import { api } from '@/app/lib/api';
import { settings as settingsKeys } from '@/app/lib/queryKeys';
import { useQuery } from '@tanstack/react-query';
import { colorScheme } from 'nativewind';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

interface ThemeContextValue {
  isDark: boolean;
  setDarkMode: (value: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  isDark: false,
  setDarkMode: () => {},
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
 */
function applyColorScheme(dark: boolean): void {
  try {
    colorScheme.set(dark ? 'dark' : 'light');
  } catch (err) {
    console.warn('[theme] could not apply color scheme; check darkMode in tailwind.config.js', err);
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [isDark, setIsDark] = useState(false);
  const { data: onboarding } = useOnboarding();
  const token = onboarding.token || null;

  const setDarkMode = useCallback((value: boolean) => {
    setIsDark(value);
    // NativeWind keeps its own module-level scheme; keep them in lockstep so
    // `dark:` classes and this context can never disagree.
    applyColorScheme(value);
  }, []);

  // Restore the saved preference on launch.
  //
  // Without this the toggle only lasted until the app restarted: the value was
  // persisted server-side but nothing ever read it back. ThemeProvider sits
  // inside both QueryClientProvider and OnboardingProvider, so it can do the
  // fetch itself rather than needing a prop threaded down from the root.
  const { data } = useQuery({
    queryKey: settingsKeys.mine(),
    queryFn: () => api.get<{ settings: { dark_mode: boolean } }>('/settings', { token }),
    enabled: !!token,
    // The Settings screen writes the authoritative value into this same cache
    // key on save, so a refetch here would only ever confirm what we have.
    staleTime: Infinity,
  });

  const savedDark = data?.settings?.dark_mode;
  useEffect(() => {
    if (typeof savedDark !== 'boolean') return;
    setIsDark(savedDark);
    applyColorScheme(savedDark);
  }, [savedDark]);

  // Signing out clears the query cache, so drop back to light rather than
  // leaving the previous account's theme applied at the login screen.
  useEffect(() => {
    if (!token) {
      setIsDark(false);
      applyColorScheme(false);
    }
  }, [token]);

  const value = useMemo(() => ({ isDark, setDarkMode }), [isDark, setDarkMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  return useContext(ThemeContext);
}
