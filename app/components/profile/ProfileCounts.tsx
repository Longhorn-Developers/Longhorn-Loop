// Events / Followers / Following, as three stacked number-over-label columns
// (LOOP-312, Figma "Frame 868"). Replaces the inline "N followers · N
// following" sentence, which had no room for an event count and gave no
// obvious place to tap.
//
// Columns are a FIXED width rather than sized to their number. Counts arrive
// from two different queries at two different times, and a column that grows
// from "0" to "102" when the second one lands shifts its neighbours sideways --
// exactly the header jitter LOOP-312 asks to be rid of.
//
// Followers and Following are tappable only where the caller says so. On your
// own profile they open the follower sheet; on someone else's they are plain
// text until LOOP-307 settles who may see another person's follower list.

import { hitSlopFor } from '@/app/lib/tapTarget';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

const COLUMN_WIDTH = 64;
/** Number (20) + label (14) + the 3pt between them, per the frame. */
const COLUMN_HEIGHT = 37;

export interface ProfileCountsProps {
  /** Undefined while the first response is in flight; renders as an en dash. */
  events?: number;
  followers: number;
  following: number;
  onPressFollowers?: () => void;
  onPressFollowing?: () => void;
}

function Column({
  value,
  label,
  onPress,
}: {
  value: number | undefined;
  label: string;
  onPress?: () => void;
}) {
  const body = (
    <>
      <Text className="font-roboto-bold text-[18px] leading-[20px] text-lhlInk">
        {value ?? '–'}
      </Text>
      <Text className="font-roboto mt-[3px] text-[12px] leading-[14px] text-lhlSecondaryTextGrey">
        {label}
      </Text>
    </>
  );

  if (!onPress) {
    return (
      <View
        className="items-center"
        style={{ width: COLUMN_WIDTH }}
        accessible
        accessibilityLabel={`${value ?? 0} ${label}`}
      >
        {body}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${value ?? 0} ${label}. Show list`}
      onPress={onPress}
      hitSlop={hitSlopFor(COLUMN_HEIGHT, COLUMN_WIDTH)}
      className="items-center"
      style={{ width: COLUMN_WIDTH }}
    >
      {body}
    </Pressable>
  );
}

export default function ProfileCounts({
  events,
  followers,
  following,
  onPressFollowers,
  onPressFollowing,
}: ProfileCountsProps) {
  return (
    <View className="mt-[8px] flex-row items-start justify-center gap-[30px]">
      <Column value={events} label="Events" />
      <Column value={followers} label="Followers" onPress={onPressFollowers} />
      <Column value={following} label="Following" onPress={onPressFollowing} />
    </View>
  );
}
