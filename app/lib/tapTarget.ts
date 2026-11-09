// Minimum touch target, and the hitSlop that gets a smaller control there.
//
// Beta testers missed small controls roughly two taps in three (LOOP-312), and
// the profile was the worst of it: a 28pt hamburger, 26pt chips, 30pt social
// squares. 44 is Apple's HIG floor and sits just above Material's 48dp in
// practice once density is accounted for.
//
// Many of these controls are DRAWN smaller on purpose -- the Figma's 30pt tab
// row, 28pt filter chips and 30pt Follow Back buttons are what keep the
// profile from reading as a wall of buttons. hitSlop grows the touchable area
// without growing the drawing, so the design and the finger both get what they
// need. Computed rather than hand-typed so a control that changes height can't
// quietly fall back under the floor.

import type { Insets } from 'react-native';

export const MIN_TAP_TARGET = 44;

/**
 * hitSlop that brings a `width` x `height` control up to MIN_TAP_TARGET in
 * each direction it falls short. Pass only `height` for controls that are
 * already wide enough (tabs, pills with a label).
 */
export function hitSlopFor(height: number, width: number = MIN_TAP_TARGET): Insets {
  const v = Math.max(0, Math.ceil((MIN_TAP_TARGET - height) / 2));
  const h = Math.max(0, Math.ceil((MIN_TAP_TARGET - width) / 2));
  return { top: v, bottom: v, left: h, right: h };
}
