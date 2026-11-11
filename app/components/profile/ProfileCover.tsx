// The cover band at the top of every profile variant, with the avatar sitting
// across its bottom edge (LOOP-312, Figma "Profile - My Events V4", "Public
// User View", "Org Page").
//
// GEOMETRY. The Figma frame is 402 x 874 and includes a 62pt status bar. Inside
// it the cover is 165 tall, the gear disc sits at y=70 (33pt) and the 115pt
// avatar's top is at y=102. Measured from the frame top, those numbers only
// hold on that one phone. So everything here is measured from the SAFE-AREA
// TOP instead -- cover = inset + 103, gear centre = inset + 24.5, avatar top =
// inset + 40 -- which reproduces the frame exactly on a 62pt-inset iPhone and
// keeps the same relationships on a notchless Android or an iPad.
//
// The band is drawn UNDER the status bar (the screen does not use a top
// SafeAreaView edge), because that is what "full-bleed" means in the frame: a
// cream gap above a peach band reads as a rendering bug.
//
// It scrolls with the page rather than pinning. The frames show it as part of
// the page, and a pinned 165pt band would eat a fifth of the screen on every
// scroll position.
//
// The cover controls (back, gear) sit on a surface-coloured disc so they read
// on the peach in light mode and the brown in dark, and each is a 44pt target
// even though the disc is drawn at 33 -- the gear was one of the controls beta
// testers were missing.

import { MIN_TAP_TARGET } from '@/app/lib/tapTarget';
import React from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Cover height below the safe-area inset: 165 in the frame, minus its 62 inset. */
const COVER_BELOW_INSET = 103;
/** Avatar diameter, per the frame. */
export const PROFILE_AVATAR_SIZE = 115;
/** How far the avatar's top sits below the safe-area inset (102 - 62). */
const AVATAR_TOP_BELOW_INSET = 40;
/** Where the 33pt control discs are centred below the inset (70 + 16.5 - 62). */
const CONTROL_CENTER_BELOW_INSET = 24.5;
const CONTROL_DISC = 33;

export interface ProfileCoverProps {
  /** The avatar graphic. Wrapped here in the circular frame. */
  avatar: React.ReactNode;
  /** Top-left control, e.g. Back on a pushed profile. */
  left?: React.ReactNode;
  /** Top-right control, e.g. the settings gear. */
  right?: React.ReactNode;
}

export default function ProfileCover({ avatar, left, right }: ProfileCoverProps) {
  const insets = useSafeAreaInsets();
  const coverHeight = insets.top + COVER_BELOW_INSET;
  const controlTop = insets.top + CONTROL_CENTER_BELOW_INSET - MIN_TAP_TARGET / 2;

  return (
    <View>
      <View className="w-full bg-lhlCover" style={{ height: coverHeight }} />

      {left ? (
        <View className="absolute left-[14px]" style={{ top: controlTop }}>
          {left}
        </View>
      ) : null}
      {right ? (
        <View className="absolute right-[14px]" style={{ top: controlTop }}>
          {right}
        </View>
      ) : null}

      {/* Negative margin rather than absolute positioning, so the avatar still
          takes up its share of the flow and the identity block below it
          doesn't need to know how much of it hangs off the cover. */}
      <View
        className="items-center"
        style={{ marginTop: insets.top + AVATAR_TOP_BELOW_INSET - coverHeight }}
      >
        <View
          className="overflow-hidden rounded-full border border-lhlInk bg-lhlPlaceholderGrey"
          style={{ width: PROFILE_AVATAR_SIZE, height: PROFILE_AVATAR_SIZE }}
        >
          {avatar}
        </View>
      </View>
    </View>
  );
}

export interface CoverIconButtonProps {
  accessibilityLabel: string;
  onPress: () => void;
  accessibilityState?: { expanded?: boolean };
  children: React.ReactNode;
}

/**
 * A 33pt surface disc inside a 44pt touch box. The box is the Pressable, not a
 * hitSlop, so the target is exactly the measured 44 x 44 and its edge can't be
 * clipped by the cover's own bounds.
 */
export function CoverIconButton({
  accessibilityLabel,
  onPress,
  accessibilityState,
  children,
}: CoverIconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      onPress={onPress}
      className="items-center justify-center"
      style={{ width: MIN_TAP_TARGET, height: MIN_TAP_TARGET }}
    >
      <View
        className="items-center justify-center rounded-full bg-lhlSurface"
        style={{ width: CONTROL_DISC, height: CONTROL_DISC }}
      >
        {children}
      </View>
    </Pressable>
  );
}
