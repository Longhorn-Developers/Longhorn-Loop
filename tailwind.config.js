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
      colors: {
        lhlBorderColor: 'hsla(0,0%,7%,1)',
        lhlBurntOrange: 'hsla(27, 100%, 37%, 1)',
        lhlSecondaryTextGrey: 'hsla(180, 9%, 31%, 1)',
        lhlBackgroundColor: 'hsla(45, 25%, 97%, 1)',
        // Added for the Profile modals (LOOP-182), mapped from the Figma
        // "LHJ" styles on the Modals frame.
        lhlInk: 'hsla(240, 10%, 4%, 1)', // #09090B - modal titles, filled dark buttons
        lhlMutedBorder: 'hsla(0, 1%, 70%, 1)', // #B4B2B2 - outline button border
        lhlSurfaceGrey: 'hsla(30, 31%, 96%, 1)', // #F8F5F2 - inset field / card fill
        lhlPlaceholderGrey: 'hsla(0, 0%, 85%, 1)', // #D9D9D9 - avatar placeholders
        lhlDestructiveRed: 'hsla(0, 93%, 36%, 1)', // #B30404 - inline errors, Delete
      },
      fontFamily: {
        roboto: ['Roboto-Flex'],
      },
    },
  },
  plugins: [],
};
