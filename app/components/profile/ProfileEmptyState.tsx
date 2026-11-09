// Empty state for one profile tab (LOOP-312 step 7).
//
// PER TAB, NOT PER SCREEN. A user with three Saved events and nothing they're
// Going to should see "nothing here yet" under Going and their three events
// under Saved -- one global "No events" would be wrong on two tabs out of
// three. The caller renders this inside the tab's own list slot, below the tab
// row and filters, so the header and the tab row never move when a tab turns
// out to be empty.
//
// The "No Events" Figma frame was exported with cards still in it under a dim
// overlay, so it gives no copy or artwork for this state. The copy below is
// the per-tab copy the screens already shipped; the layout follows the V4
// type scale (SemiBold 14 title, Regular 14 body, a 36pt brand button).

import { MIN_TAP_TARGET } from '@/app/lib/tapTarget';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

export interface ProfileEmptyStateProps {
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
}

export default function ProfileEmptyState({ title, body, action }: ProfileEmptyStateProps) {
  return (
    <View className="w-full items-center rounded-[20px] border border-lhlBorderSoft bg-lhlSurface px-[24px] py-[28px]">
      <Text className="font-roboto-semibold text-center text-[14px] leading-[18px] text-lhlInk">
        {title}
      </Text>
      {body ? (
        <Text className="font-roboto mt-[6px] text-center text-[14px] leading-[18px] text-lhlSecondaryTextGrey">
          {body}
        </Text>
      ) : null}
      {action ? (
        <Pressable
          accessibilityRole="button"
          onPress={action.onPress}
          className="mt-[16px] items-center justify-center rounded-[8px] bg-lhlBurntOrange px-[20px]"
          style={{ minHeight: MIN_TAP_TARGET }}
        >
          {/* theme-exempt: white on the filled brand button in both themes. */}
          <Text className="font-roboto-semibold text-[14px] text-white">{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
