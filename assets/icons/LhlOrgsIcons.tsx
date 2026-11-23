// Glyphs for the Orgs tab and the redesigned org page (LOOP-330 – LOOP-335).
//
// Figma: "Orgs - My Orgs Toggle", "Org Page" and its action sheet. The design
// pulls these from Akar / Mingcute; drawn by hand here on a 16x16 grid for the
// same reason LhlOrgIcons.tsx gives -- four or five glyphs don't justify an
// icon dependency, and every one has to take a theme colour so dark mode works.
//
// Strokes are 1.3 at this grid, matching LhlOrgIcons, because they sit beside
// 12-14px text. The tab glyph is the exception: it is drawn on the 42x38 tab
// artboard the other tab icons use, so it lines up with them in the bar.

import * as React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

export interface OrgsIconProps {
  size?: number;
  color?: string;
}

/**
 * The bottom-nav "Orgs" glyph: three figures, the middle one in front.
 *
 * Active is SOLID and inactive is an OUTLINE, the rule every other tab follows
 * (see app/(tabs)/_layout.tsx): weight reads at a glance where a hue shift on a
 * thin stroke does not.
 *
 * Only the glyph zone (y 0..18 of the 42x38 artboard) is drawn here; the word
 * underneath is real text, laid out by OrgsTabIcon.
 */
export function OrgsTabGlyph({ filled, color }: { filled: boolean; color: string }) {
  const fill = filled ? color : 'none';
  return (
    <Svg width={42} height={19} viewBox="0 0 42 19" fill="none">
      {/* Side figures first so the centre one overlaps them. */}
      <Circle cx={13.5} cy={6} r={2.4} stroke={color} strokeWidth={1.4} fill={fill} />
      <Path
        d="M9.2 15.2c0-2.6 1.9-4.4 4.3-4.4"
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap="round"
      />
      <Circle cx={28.5} cy={6} r={2.4} stroke={color} strokeWidth={1.4} fill={fill} />
      <Path
        d="M32.8 15.2c0-2.6-1.9-4.4-4.3-4.4"
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap="round"
      />
      <Circle cx={21} cy={4.6} r={3} stroke={color} strokeWidth={1.4} fill={fill} />
      <Path
        d="M15.6 17.2c0-3.3 2.4-5.6 5.4-5.6s5.4 2.3 5.4 5.6Z"
        stroke={color}
        strokeWidth={1.4}
        strokeLinejoin="round"
        fill={fill}
      />
    </Svg>
  );
}

/** "•••" — the org page's overflow button. */
export function DotsIcon({ size = 16, color = '#020B12' }: OrgsIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill={color}>
      <Circle cx={3.5} cy={8} r={1.4} />
      <Circle cx={8} cy={8} r={1.4} />
      <Circle cx={12.5} cy={8} r={1.4} />
    </Svg>
  );
}

/** Chain link — "Copy Link" in the action sheet. */
export function LinkIcon({ size = 16, color = '#020B12' }: OrgsIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path
        d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"
        stroke={color}
        strokeWidth={1.3}
        strokeLinecap="round"
      />
      <Path
        d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.9-.9"
        stroke={color}
        strokeWidth={1.3}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** ">" — row disclosure on Your Orgs and past-event rows. */
export function ChevronRightIcon({ size = 16, color = '#020B12' }: OrgsIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path
        d="M6 3.5 10.5 8 6 12.5"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** "↗" — the Trending card's "+142 this week" chip. */
export function TrendUpIcon({ size = 12, color = '#9D4B06' }: OrgsIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path
        d="M2.5 11.5 6.5 7.5l2.6 2.6 4.4-4.6M9.8 5.5h3.7v3.7"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
