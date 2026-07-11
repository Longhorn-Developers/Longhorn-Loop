/** @type {import('tailwindcss').Config} */
module.exports = {
  // NOTE: Update this to include the paths to all files that contain Nativewind classes.
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        lhlBorderColor: 'hsla(0,0%,7%,1)',
        lhlBurntOrange: 'hsla(27, 100%, 37%, 1)',
        lhlSecondaryTextGrey: 'hsla(180, 9%, 31%, 1)',
        lhlBackgroundColor: 'hsla(45, 25%, 97%, 1)',
      },
      fontFamily: {
        roboto: ['Roboto-Flex'],
      },
    },
  },
  plugins: [],
};
