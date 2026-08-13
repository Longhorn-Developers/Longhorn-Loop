// Upcoming / Past segmented toggle for a PUBLIC profile (LOOP-180).
//
// Figma: "Profile Main" frame, reviewed 2026-06-08 — the control that sits
// under "Not Todd Events" on a user profile and under "Organization account"
// on an org one.
//
// It is deliberately a different control from the Going / Saved / Posted
// segmented control on app/(tabs)/profile.tsx, even though the two look
// identical. That one switches between three RELATIONSHIPS the owner has to an
// event, two of which are private; this one splits the single public
// collection — what the account posted — by time. Sharing one component would
// have meant a union tab type and a prop deciding which half of it was legal,
// which is more coupling than two small toggles are worth. The shape of the
// labels is shared instead, in shared/profileEventFilters.ts, so the client
// and the server agree on the query-string values.
//
// Counts come from the same response as the events, so the toggle can label
// both halves after one round trip rather than firing a query per tab. They're
// optional: on first paint there is no response yet, and a toggle that reads
// "Upcoming (0)" before the data lands is worse than one that reads "Upcoming"
// and then gains a number.

import React from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  PUBLIC_PROFILE_TABS,
  PUBLIC_PROFILE_TAB_LABELS,
  type PublicProfileTab,
} from '@/shared/profileEventFilters';

export interface UpcomingPastToggleProps {
  value: PublicProfileTab;
  onChange: (tab: PublicProfileTab) => void;
  /** Per-tab totals. Omit while the first response is still in flight. */
  counts?: Record<PublicProfileTab, number>;
}

export default function UpcomingPastToggle({ value, onChange, counts }: UpcomingPastToggleProps) {
  return (
    <View className="mt-[10px] flex-row gap-[6px]">
      {PUBLIC_PROFILE_TABS.map((tab) => {
        const isActive = tab === value;
        const count = counts?.[tab];

        return (
          <Pressable
            key={tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={`${PUBLIC_PROFILE_TAB_LABELS[tab]} events`}
            onPress={() => onChange(tab)}
            className={`flex-1 flex-row items-center justify-center rounded-full border py-[7px] ${
              isActive ? 'border-lhlInk bg-lhlSurface' : 'border-lhlMutedBorder bg-lhlSurfaceGrey'
            }`}
          >
            <Text
              className={`font-['Roboto-Flex'] text-[11px] ${
                isActive ? 'font-semibold text-lhlInk' : 'text-lhlSecondaryTextGrey'
              }`}
            >
              {PUBLIC_PROFILE_TAB_LABELS[tab]}
              {count !== undefined ? ` (${count})` : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
