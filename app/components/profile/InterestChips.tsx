// Interest tags under the bio (LOOP-312, Figma "Frame 292"): 30pt pills,
// centred, with a trailing "+" on your own profile.
//
// The "+" still goes to Edit Profile rather than opening an inline picker, so
// interests keep exactly one place they are edited. It is drawn at the frame's
// 30 and given hitSlop to 44 -- it was a 26pt circle before, one of the small
// targets beta testers kept missing.
//
// Chips themselves are not interactive, so they are not held to 44.

import LhlPillPlus from '@/assets/icons/LhlPillPlus';
import { hitSlopFor } from '@/app/lib/tapTarget';
import { useThemeColors } from '@/app/lib/themeColors';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

const CHIP_HEIGHT = 30;

export interface InterestChipsProps {
  tags: string[];
  /** Shows the trailing "+"; omit on a profile that isn't yours. */
  onAdd?: () => void;
}

export default function InterestChips({ tags, onAdd }: InterestChipsProps) {
  const colors = useThemeColors();

  if (tags.length === 0 && !onAdd) return null;

  return (
    <View className="flex-row flex-wrap items-center justify-center gap-[6px]">
      {tags.map((tag) => (
        <View
          key={tag}
          className="justify-center rounded-full border border-lhlBorderSoft bg-lhlSurfaceGrey px-[10px]"
          style={{ height: CHIP_HEIGHT }}
        >
          <Text className="font-roboto-medium text-[12px] leading-[14px] text-lhlInk">{tag}</Text>
        </View>
      ))}
      {onAdd ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add interests"
          onPress={onAdd}
          hitSlop={hitSlopFor(CHIP_HEIGHT, CHIP_HEIGHT)}
          className="items-center justify-center rounded-full border border-lhlBorderSoft bg-lhlSurfaceGrey"
          style={{ width: CHIP_HEIGHT, height: CHIP_HEIGHT }}
        >
          <LhlPillPlus size={12} color={colors.ink} />
        </Pressable>
      ) : null}
    </View>
  );
}
