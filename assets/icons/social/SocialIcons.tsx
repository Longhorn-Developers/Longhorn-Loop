// Brand glyphs for the Linked Socials picker (LOOP-181).
//
// Hand-authored rather than imported from a brand kit so the app doesn't ship
// third-party logo assets. Each is a single-colour path on a 24x24 grid, drawn
// to read correctly at the 32px chip size the Figma frame uses.
//
// Keyed by the platform ids in shared/socialPlatforms.ts -- see
// app/lib/socialPlatforms.ts for the id -> icon map.

import * as React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export interface SocialIconProps {
  size?: number;
  color?: string;
}

export function LinkedInIcon({ size = 24, color = '#09090B' }: SocialIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        fill={color}
        d="M4.98 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5M2.4 21.5h5.16V9.75H2.4zM10.4 9.75V21.5h5.16v-6.2c0-1.64.31-3.22 2.34-3.22 2 0 2.03 1.87 2.03 3.32v6.1h5.16v-7.13c0-4.47-.97-7.2-5.19-7.2-2.03 0-3.39 1.11-3.95 2.17h-.07V9.75z"
      />
    </Svg>
  );
}

export function InstagramIcon({ size = 24, color = '#09090B' }: SocialIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect
        x={2.75}
        y={2.75}
        width={18.5}
        height={18.5}
        rx={5.25}
        stroke={color}
        strokeWidth={1.9}
      />
      <Circle cx={12} cy={12} r={4.25} stroke={color} strokeWidth={1.9} />
      <Circle cx={17.4} cy={6.6} r={1.25} fill={color} />
    </Svg>
  );
}

export function LinktreeIcon({ size = 24, color = '#09090B' }: SocialIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 2.9v8.4M12 11.3 6.4 6.1M12 11.3l5.6-5.2M4.8 11.3h14.4M12 13.9v7.2"
      />
    </Svg>
  );
}

export function DiscordIcon({ size = 24, color = '#09090B' }: SocialIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        fill={color}
        d="M19.3 5.9a15.6 15.6 0 0 0-3.9-1.2l-.24.48c1.28.31 2.4.83 3.42 1.5a12.6 12.6 0 0 0-9.16 0c1.02-.67 2.14-1.19 3.42-1.5l-.24-.48c-1.4.24-2.7.65-3.9 1.2C2.9 10.1 2.06 14.2 2.4 18.2a15.7 15.7 0 0 0 4.8 2.4l.97-1.5c-.53-.2-1.03-.44-1.5-.73l.37-.28a11.2 11.2 0 0 0 9.92 0l.37.28c-.47.29-.97.53-1.5.73l.97 1.5a15.7 15.7 0 0 0 4.8-2.4c.4-4.63-.68-8.7-3.3-12.3M8.9 15.6c-.94 0-1.72-.86-1.72-1.92s.76-1.93 1.72-1.93c.97 0 1.75.87 1.73 1.93 0 1.06-.76 1.92-1.73 1.92m6.2 0c-.94 0-1.72-.86-1.72-1.92s.76-1.93 1.72-1.93c.97 0 1.75.87 1.73 1.93 0 1.06-.76 1.92-1.73 1.92"
      />
    </Svg>
  );
}

export function SlackIcon({ size = 24, color = '#09090B' }: SocialIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        fill={color}
        d="M5.6 14.6a2 2 0 1 1-2-2h2zm1 0a2 2 0 0 1 4 0v5a2 2 0 1 1-4 0zM9.4 5.6a2 2 0 1 1 2-2v2zm0 1a2 2 0 0 1 0 4h-5a2 2 0 1 1 0-4zM18.4 9.4a2 2 0 1 1 2 2h-2zm-1 0a2 2 0 0 1-4 0v-5a2 2 0 1 1 4 0zM14.6 18.4a2 2 0 1 1-2 2v-2zm0-1a2 2 0 0 1 0-4h5a2 2 0 1 1 0 4z"
      />
    </Svg>
  );
}

export function GenericLinkIcon({ size = 24, color = '#09090B' }: SocialIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
        d="M10.1 13.9a3.6 3.6 0 0 0 5.4.4l2.8-2.8a3.6 3.6 0 0 0-5.1-5.1l-1.6 1.6"
      />
      <Path
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
        d="M13.9 10.1a3.6 3.6 0 0 0-5.4-.4l-2.8 2.8a3.6 3.6 0 0 0 5.1 5.1l1.6-1.6"
      />
    </Svg>
  );
}
