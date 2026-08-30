/** @type {import('tailwindcss').Config} */
module.exports = {
  // NOTE: Update this to include the paths to all files that contain Nativewind classes.
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  // Required for the Dark Mode toggle in Settings (LOOP-184). NativeWind
  // defaults to 'media', which follows the OS and makes colorScheme.set()
  // throw "Cannot manually set color scheme, as dark mode is type 'media'".
  // 'class' hands control to the app so the user's saved preference wins.
  darkMode: 'class',
  theme: {
    extend: {
      // Every colour resolves through a CSS variable defined in
      // app/globals.css (:root for light, .dark for dark). Because the
      // existing token NAMES are preserved, the ~290 class usages already in
      // the codebase gain dark mode without any of those files changing.
      //
      // <alpha-value> keeps opacity modifiers working (bg-lhlSurface/50).
      colors: {
        // Page background.
        lhlBackgroundColor: 'rgb(var(--lhl-background) / <alpha-value>)',
        // Cards / inputs / anything raised off the page. Prefer this over
        // bg-white, which cannot theme.
        lhlSurface: 'rgb(var(--lhl-surface) / <alpha-value>)',
        // Inset fills: search fields, disabled tiles.
        lhlSurfaceGrey: 'rgb(var(--lhl-surface-muted) / <alpha-value>)',

        lhlInk: 'rgb(var(--lhl-ink) / <alpha-value>)',
        lhlSecondaryTextGrey: 'rgb(var(--lhl-ink-secondary) / <alpha-value>)',
        // Tertiary text — timestamps, counts, inactive icons.
        lhlMutedText: 'rgb(var(--lhl-ink-muted) / <alpha-value>)',

        lhlMutedBorder: 'rgb(var(--lhl-border) / <alpha-value>)',
        // Legacy alias — was a near-black hairline, now the themed border.
        lhlBorderColor: 'rgb(var(--lhl-border) / <alpha-value>)',
        // Hairline rules between sections; softer than the control border.
        lhlDivider: 'rgb(var(--lhl-divider) / <alpha-value>)',
        lhlPlaceholderGrey: 'rgb(var(--lhl-placeholder) / <alpha-value>)',
        // Segmented-control groove; the selected pill uses lhlBackgroundColor.
        lhlSegmentTrack: 'rgb(var(--lhl-segment-track) / <alpha-value>)',

        // Filled buttons; white text sits on this in both themes.
        lhlBurntOrange: 'rgb(var(--lhl-brand) / <alpha-value>)',
        // Accent TEXT — links, "Edit"/"Done". Differs from the button colour
        // because it has to clear 4.5:1 against the page in both themes.
        lhlAccent: 'rgb(var(--lhl-accent) / <alpha-value>)',
        // Tinted fill behind a selected card / saved state.
        lhlBrandSoft: 'rgb(var(--lhl-brand-soft) / <alpha-value>)',

        lhlDestructiveRed: 'rgb(var(--lhl-destructive) / <alpha-value>)',
        lhlDestructiveFill: 'rgb(var(--lhl-destructive-fill) / <alpha-value>)',
        // Tinted fill behind an inline error.
        lhlDestructiveSoft: 'rgb(var(--lhl-destructive-soft) / <alpha-value>)',
        // Informational, non-brand: the "Going" badge.
        lhlInfo: 'rgb(var(--lhl-info) / <alpha-value>)',
        lhlScrim: 'rgb(var(--lhl-scrim) / <alpha-value>)',
      },
      // Each weight is its own registered family (see app/_layout.tsx) because
      // React Native can't pick a weight off a single variable font. Use these
      // font-* utilities instead of pairing font-['Roboto-Flex'] with a
      // font-bold/semibold weight class, which only renders bold on web.
      fontFamily: {
        roboto: ['Roboto-Flex'],
        'roboto-medium': ['Roboto-Flex-Medium'],
        'roboto-semibold': ['Roboto-Flex-SemiBold'],
        'roboto-bold': ['Roboto-Flex-Bold'],
      },
    },
  },
  plugins: [],
};
