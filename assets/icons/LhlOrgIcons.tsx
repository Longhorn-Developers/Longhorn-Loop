// Glyphs for the Organization Management console (LOOP-183 / LOOP-240 polish).
//
// Figma: "Organization Management" frame draws an icon beside every stat tile
// and every tab label. Three of the six already ship as SVG assets
// (assets/images/eye.svg, bookmark.svg, pencil.svg, trash.svg); the rest —
// a people glyph, a bar chart, a calendar-list and the role-swap arrows —
// did not exist anywhere in the repo.
//
// Hand-drawn on a 16x16 grid rather than pulled from an icon set, matching how
// assets/icons/Lhl*.tsx already work, so the app doesn't gain an icon
// dependency for four glyphs. Every one takes `size` and `color` and paints
// with strokes only, so a caller can pass a theme colour and get a glyph that
// survives the dark-mode swap.
//
// Stroke width is 1.3 for the same reason LhlProfileMetaIcons uses it: these
// sit next to 11-13px text, and 2 (the width the exported assets use at 20px)
// reads as a blob once scaled down to 14.

import * as React from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

export interface OrgIconProps {
  size?: number;
  color?: string;
}

/** Two figures — the Members tab, and the "Going" stat tile. */
export function PeopleIcon({ size = 14, color = '#485656' }: OrgIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path
        d="M6.2 7.6a2.35 2.35 0 1 0 0-4.7 2.35 2.35 0 0 0 0 4.7Z"
        stroke={color}
        strokeWidth={1.3}
        strokeLinejoin="round"
      />
      <Path
        d="M1.9 13.4c0-2.1 1.9-3.6 4.3-3.6s4.3 1.5 4.3 3.6"
        stroke={color}
        strokeWidth={1.3}
        strokeLinecap="round"
      />
      {/* The second figure is a partial: shoulder and head only, tucked behind
          the first. Drawing it whole at this size just makes two overlapping
          circles with no readable depth. */}
      <Path
        d="M10.7 3.3a2.1 2.1 0 0 1 0 4.1M11.6 10.2c1.6.4 2.5 1.6 2.5 3.2"
        stroke={color}
        strokeWidth={1.3}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Three ascending bars — the Analytics tab. */
export function BarChartIcon({ size = 14, color = '#485656' }: OrgIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Rect x={2.2} y={9.2} width={3} height={4.6} rx={0.8} stroke={color} strokeWidth={1.3} />
      <Rect x={6.5} y={6.2} width={3} height={7.6} rx={0.8} stroke={color} strokeWidth={1.3} />
      <Rect x={10.8} y={2.6} width={3} height={11.2} rx={0.8} stroke={color} strokeWidth={1.3} />
    </Svg>
  );
}

/** A calendar with a ruled body — the Events tab. */
export function CalendarListIcon({ size = 14, color = '#485656' }: OrgIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Rect x={2} y={3.4} width={12} height={10.6} rx={1.6} stroke={color} strokeWidth={1.3} />
      <Path d="M5 2v2.6M11 2v2.6M2 7h12" stroke={color} strokeWidth={1.3} strokeLinecap="round" />
      <Path d="M4.8 9.8h3.4M4.8 11.8h5.6" stroke={color} strokeWidth={1.3} strokeLinecap="round" />
    </Svg>
  );
}

/**
 * Two arrows swapping places — the role toggle on a member row.
 *
 * Replaces the word "Swap", which the Figma does not have room for and which
 * read as a label rather than a control. The accessibility label still spells
 * out which direction the press moves the member, since the glyph alone can't.
 */
export function SwapRoleIcon({ size = 14, color = '#485656' }: OrgIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path
        d="M2.4 5.6h9.4M9.4 3.2l2.4 2.4-2.4 2.4"
        stroke={color}
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M13.6 10.4H4.2M6.6 8l-2.4 2.4L6.6 12.8"
        stroke={color}
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** A plus in a circle — the "Invite" pill in the Team header. */
export function InvitePlusIcon({ size = 14, color = '#FFFFFF' }: OrgIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path d="M8 2.4a5.6 5.6 0 1 0 0 11.2A5.6 5.6 0 0 0 8 2.4Z" stroke={color} strokeWidth={1.3} />
      <Path d="M8 5.4v5.2M5.4 8h5.2" stroke={color} strokeWidth={1.3} strokeLinecap="round" />
    </Svg>
  );
}
