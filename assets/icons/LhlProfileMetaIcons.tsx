// Small inline icons for the profile metadata row.
//
// Hand-drawn on a 16x16 grid rather than pulled from an icon set, matching
// how assets/icons/Lhl*.tsx already work, so the app doesn't gain a
// dependency for two glyphs. Sized to sit on a 13px text baseline.

import * as React from 'react';
import Svg, { Path } from 'react-native-svg';

export interface MetaIconProps {
  size?: number;
  color?: string;
}

/** Academic identity — classification and majors. */
export function GraduationCapIcon({ size = 14, color = '#485656' }: MetaIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path
        d="M8 2 1.5 5.3 8 8.6l6.5-3.3z"
        stroke={color}
        strokeWidth={1.3}
        strokeLinejoin="round"
      />
      <Path
        d="M4.2 6.9v3.4c0 .9 1.7 1.7 3.8 1.7s3.8-.8 3.8-1.7V6.9"
        stroke={color}
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M14.2 5.6v3.6" stroke={color} strokeWidth={1.3} strokeLinecap="round" />
    </Svg>
  );
}

/** Unique classification — International, First Generation, Transfer. */
export function GlobeIcon({ size = 14, color = '#485656' }: MetaIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path d="M8 1.9a6.1 6.1 0 1 0 0 12.2A6.1 6.1 0 0 0 8 1.9Z" stroke={color} strokeWidth={1.3} />
      <Path d="M1.9 8h12.2" stroke={color} strokeWidth={1.3} strokeLinecap="round" />
      <Path
        d="M8 1.9c1.6 1.7 2.5 3.9 2.5 6.1S9.6 12.4 8 14.1C6.4 12.4 5.5 10.2 5.5 8S6.4 3.6 8 1.9Z"
        stroke={color}
        strokeWidth={1.3}
        strokeLinejoin="round"
      />
    </Svg>
  );
}
