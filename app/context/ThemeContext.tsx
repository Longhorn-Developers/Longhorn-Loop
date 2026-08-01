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

export function ThemeProvider({
  children,
  initialDark = false,
}: {
  children: React.ReactNode;
  initialDark?: boolean;
}) {
  const [isDark, setIsDark] = useState(initialDark);

  const setDarkMode = useCallback((value: boolean) => {
    setIsDark(value);
    // NativeWind keeps its own module-level scheme; keep them in lockstep so
    // `dark:` classes and this context can never disagree.
    colorScheme.set(value ? 'dark' : 'light');
  }, []);

  // Apply whatever the server said on first render (and if it changes after a
  // late-arriving settings fetch).
  useEffect(() => {
    colorScheme.set(initialDark ? 'dark' : 'light');
    setIsDark(initialDark);
  }, [initialDark]);

  const value = useMemo(() => ({ isDark, setDarkMode }), [isDark, setDarkMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  return useContext(ThemeContext);
}
