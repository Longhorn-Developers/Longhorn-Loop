// Top bar for a public profile: back arrow on the left, notifications bell on
// the right (LOOP-180).
//
// Figma: "Profile Main" frame, reviewed 2026-06-08. The frame draws the right
// icon as a megaphone; it ships as assets/images/bell.svg, the glyph every
// other notification entry point in the app already uses. Introducing a second
// icon for the same destination would make one screen's notifications look
// like a different feature.
//
// The owner's own profile has a hamburger here instead (org management +
// settings), which is why this is its own component rather than a prop on a
// shared header: the two bars share a height and nothing else.

import React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';

import ArrowLeftIcon from '@/assets/images/arrow-left.svg';
import BellIcon from '@/assets/images/bell.svg';
import { useThemeColors } from '@/app/lib/themeColors';

export interface PublicProfileTopBarProps {
  /**
   * Where the bell goes. Defaults to the notification inbox; the org profile
   * points it at the followed-org toggles instead (Frame 471), because from an
   * org page "notifications" means "what this org sends me".
   */
  bellHref?: string;
  bellLabel?: string;
}

export default function PublicProfileTopBar({
  bellHref = '/notifications',
  bellLabel = 'Notifications',
}: PublicProfileTopBarProps) {
  const router = useRouter();
  const colors = useThemeColors();

  return (
    <View className="flex-row items-center justify-between px-[20px] py-[10px]">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={() => router.back()}
        hitSlop={10}
      >
        <ArrowLeftIcon width={22} height={22} color={colors.ink} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={bellLabel}
        onPress={() => router.push(bellHref as never)}
        hitSlop={10}
      >
        {/* Icons take `accent`, never `brand` — brand is a fill colour and is
            only 3.4:1 as a foreground on a dark card. */}
        <BellIcon width={19} height={21} color={colors.accent} />
      </Pressable>
    </View>
  );
}
