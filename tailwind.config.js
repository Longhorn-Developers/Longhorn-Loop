/** @type {import('tailwindcss').Config} */
module.exports = {
  // NOTE: Update this to include the paths to all files that contain Nativewind classes.
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        lhlBorderColor: 'hsla(0,0%,78%,1)',
        lhlBurntOrange: 'hsla(27, 93%, 32%, 1)',
        lhlSecondaryTextGrey: 'hsla(180, 9%, 31%, 1)',
      },
    },
  },
  plugins: [],
};
