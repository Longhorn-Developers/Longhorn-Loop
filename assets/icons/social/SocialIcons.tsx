// Brand glyphs for the Linked Socials picker (LOOP-181) and the profile row.
//
// Hand-authored rather than imported from a brand kit so the app doesn't ship
// third-party logo assets.
//
// EACH ICON'S viewBox IS ITS OWN GLYPH'S BOUNDING BOX, squared and padded by
// one unit -- not a shared "0 0 24 24". That is deliberate, and it is what
// fixes two bugs at once.
//
// A viewBox does not scale to fit its contents, it CROPS them. LinkedIn's path
// ran to x = 25.09 and Discord's to x = 24.00 on a 24-wide box, so both lost
// their outer edge at every size they rendered -- silently, and worst on the
// large picker tiles where a fraction of a unit becomes several pixels.
//
// The same shared box also made them different optical sizes, because the
// glyphs were drawn to different extents inside it: 16.3 units across for
// Linktree against 24.0 for Slack, so the row read as ragged even where
// nothing was clipped. Framing each glyph by its own bounds and letting
// preserveAspectRatio (xMidYMid meet, the default) fit it to the square means
// every icon fills the same amount of its tile.
//
// IF YOU ADD OR EDIT A GLYPH, recompute its viewBox from the path's bounding
// box -- including half the stroke width and any round caps for stroked icons.
// Do not eyeball it: an overflow of one unit is invisible at 20pt in review
// and obvious at 54pt in the picker, which is exactly how both of these
// shipped.

import * as React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export interface SocialIconProps {
  size?: number;
  color?: string;
}

export function LinkedInIcon({ size = 24, color = '#09090B' }: SocialIconProps) {
  // Redrawn: the previous path ran to x = 25.09 and had its "n" stem cropped.
  // Glyph 19.06 x 18.00.
  return (
    <Svg width={size} height={size} viewBox="1.94 1.47 21.06 21.06" fill="none">
      <Path
        fill={color}
        d="M6.94 5a2 2 0 1 1-4-.002 2 2 0 0 1 4 .002zM7 8.48H3V21h4V8.48zm6.32 0H9.34V21h3.94v-6.57c0-3.66 4.77-4 4.77 0V21H22v-7.93c0-6.17-7.06-5.94-8.72-2.91l.04-1.68z"
      />
    </Svg>
  );
}

export function InstagramIcon({ size = 24, color = '#09090B' }: SocialIconProps) {
  // Glyph 20.40 square, including the 1.9 stroke on the rounded square.
  return (
    <Svg width={size} height={size} viewBox="0.80 0.80 22.40 22.40" fill="none">
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
  // Glyph 16.30 x 20.10 with stroke and round caps counted -- the narrowest of
  // the six, which is why it looked undersized on a shared 24 box.
  return (
    <Svg width={size} height={size} viewBox="0.95 0.95 22.10 22.10" fill="none">
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
  // REDRAWN. The old path was a hand-approximated outline that did not close
  // across the top of the head, so the crown read as sliced off -- reported as
  // "cropped out in the top left". This is the real mark: a closed face with
  // the two eyes punched out of it. Glyph 24.00 x 18.29, so it needs the wider
  // box below or it loses both ears.
  return (
    <Svg width={size} height={size} viewBox="-1 -1 26 26" fill="none">
      <Path
        fill={color}
        d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.198.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"
      />
    </Svg>
  );
}

export function SlackIcon({ size = 24, color = '#09090B' }: SocialIconProps) {
  // REDRAWN. The old path's eight lozenges did not meet at the corners, so the
  // pinwheel read as scattered pieces rather than a mark. Glyph 24.00 square,
  // which touched all four edges of a 24 box.
  return (
    <Svg width={size} height={size} viewBox="-1 -1 26 26" fill="none">
      <Path
        fill={color}
        d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"
      />
    </Svg>
  );
}

export function GenericLinkIcon({ size = 24, color = '#09090B' }: SocialIconProps) {
  // Glyph 16.61 x 15.21 with stroke and caps -- the smallest of the six, so on
  // the old shared box it sat noticeably inside its tile.
  return (
    <Svg width={size} height={size} viewBox="2.69 2.69 18.61 18.61" fill="none">
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
