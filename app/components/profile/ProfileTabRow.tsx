// The underline tab row used across the profile (LOOP-312, Figma "Profile
// Event Toggles" / "User Event Toggle"): Going / Saved / Posted on your own
// profile, Upcoming / Past on a public user or org, Followers / Following in
// the follower sheet.
//
// WHY ONE COMPONENT NOW, when there used to be two. The Going/Saved/Posted
// segmented groove and UpcomingPastToggle were deliberately kept apart because
// they switch different KINDS of collection -- three private relationships vs
// one public list split by time -- and a shared component would have needed a
// union tab type. Generic keys solve that without the union: each caller
// passes its own key type and gets it back in onChange, so Going can never be
// handed to the public endpoint. What the two shared was always the look, and
// V4 makes all three rows the same underline control.
//
// GEOMETRY. 30pt tall per the frame (8 above and below a 14pt label), divided
// by a full-width hairline with the active tab's 2pt brand underline sitting
// on it. A 30pt row is under the 44pt floor, so each tab's hitSlop makes up the
// difference vertically; horizontally each tab is a third or half of 362,
// which is already plenty.
//
// The count is a separate, lighter Text rather than "(2)" glued onto the
// label, which is how the frame draws it and keeps the label from changing
// width when the number does.

import { hitSlopFor } from '@/app/lib/tapTarget';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

const TAB_HEIGHT = 30;

export interface ProfileTab<K extends string> {
  key: K;
  label: string;
  /** Omit while unknown; the tab shows no number rather than a fake 0. */
  count?: number;
}

export interface ProfileTabRowProps<K extends string> {
  tabs: ProfileTab<K>[];
  value: K;
  onChange: (key: K) => void;
}

export default function ProfileTabRow<K extends string>({
  tabs,
  value,
  onChange,
}: ProfileTabRowProps<K>) {
  return (
    <View accessibilityRole="tablist" className="flex-row border-b border-lhlDivider">
      {tabs.map((tab) => {
        const isActive = tab.key === value;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={tab.count !== undefined ? `${tab.label}, ${tab.count}` : tab.label}
            onPress={() => onChange(tab.key)}
            hitSlop={hitSlopFor(TAB_HEIGHT)}
            // -1 bottom margin drops the 2pt underline onto the row's hairline
            // instead of stacking under it.
            className={`mb-[-1px] flex-1 flex-row items-center justify-center gap-[4px] border-b-2 ${
              isActive ? 'border-lhlBurntOrange' : 'border-transparent'
            }`}
            style={{ height: TAB_HEIGHT }}
          >
            <Text
              className={`font-roboto-semibold text-[14px] leading-[16px] ${
                isActive ? 'text-lhlInk' : 'text-lhlSecondaryTextGrey'
              }`}
            >
              {tab.label}
            </Text>
            {tab.count !== undefined ? (
              <Text className="font-roboto text-[12px] leading-[14px] text-lhlSecondaryTextGrey">
                {tab.count}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
