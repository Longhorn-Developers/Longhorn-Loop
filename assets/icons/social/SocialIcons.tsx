// Brand glyphs for the Linked Socials picker (LOOP-181).
//
// Hand-authored rather than imported from a brand kit so the app doesn't ship
// third-party logo assets. Each is a single-colour path on a 24x24 grid, drawn
// to read correctly at the 32px chip size the Figma frame uses.
//
// EVERY PATH MUST FIT INSIDE 0..24 ON BOTH AXES. A viewBox does not scale to
// fit its contents -- it crops them -- so a path that strays past 24 loses
// whatever hangs over, silently, at every size the icon is used. LinkedIn was
// doing exactly that (see below). If you add or edit a glyph, check its
// bounding box rather than trusting the eye: at 20pt an overflow of one unit
// is under a pixel of missing stroke, invisible in review and obvious on a
// 54pt tile.
//
// Keyed by the platform ids in shared/socialPlatforms.ts -- see
// app/lib/socialPlatforms.ts for the id -> icon map.

import * as React from 'react';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

export interface SocialIconProps {
  size?: number;
  color?: string;
}

export function LinkedInIcon({ size = 24, color = '#09090B' }: SocialIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/*
        REDRAWN because the old path ran to x = 25.09 on a 24-wide viewBox, so
        the right-hand stem of the "n" was cropped at every size it rendered --
        the picker tiles, the profile row, everywhere. It also made the glyph
        22.7 units wide against Discord's 19.4 and Slack's 20.8, so it read as
        oversized as well as broken.

        This one measures 19.1 x 18.0, in line with its neighbours, and sits
        inside the box with room to spare. translateX centres it: the path's
        own margins are 2.94 left and 2.00 right, and half a unit of drift is
        visible when six tiles sit in a grid together.
      */}
      <G translateX={-0.47}>
        <Path
          fill={color}
          d="M6.94 5a2 2 0 1 1-4-.002 2 2 0 0 1 4 .002zM7 8.48H3V21h4V8.48zm6.32 0H9.34V21h3.94v-6.57c0-3.66 4.77-4 4.77 0V21H22v-7.93c0-6.17-7.06-5.94-8.72-2.91l.04-1.68z"
        />
      </G>
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
