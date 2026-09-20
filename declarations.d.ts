declare module '*.svg' {
  import React from 'react';
  import { SvgProps } from 'react-native-svg';
  const content: React.FC<SvgProps>;
  export default content;
}

// NativeWind's Tailwind entrypoint, imported for its side effect only in
// app/_layout.tsx. TypeScript 5.9 (Expo SDK 57) added TS2882, which rejects a
// side-effect import of any extension it has no declaration for — SDK 54's
// compiler let it through silently. Metro resolves the file via the NativeWind
// transformer, so there is nothing to type: the module has no exports and this
// declaration exists purely to say "this import is legitimate".
declare module '*.css';
