// Bio block for the profile header, centred under the Edit Profile button.
// Body style per the LOOP-312 V4 frames: Regular 14, secondary text.
//
// Line breaks are preserved and the text is clamped to COLLAPSED_LINES with a
// "more" / "less" toggle, so a full 150-character bio can't push My Events off
// the first screen. Editing happens through the Edit Profile button directly
// above; the only affordance here is the "+ Add a bio" prompt shown on your own
// profile when there's nothing to display yet.

import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

const COLLAPSED_LINES = 3;

// Whether to offer "more". onTextLayout would measure this exactly but doesn't
// fire consistently on react-native-web, and being slightly wrong only costs a
// redundant tap, so a heuristic beats a per-platform measurement pass.
const LIKELY_OVERFLOW_CHARS = 110;

interface ProfileBioProps {
  bio?: string | null;
  /** True on the owner's own profile, where an empty bio is actionable. */
  editable?: boolean;
}

export default function ProfileBio({ bio, editable = false }: ProfileBioProps) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  const text = typeof bio === 'string' ? bio.trim() : '';

  if (!text) {
    if (!editable) return null;
    return (
      <View className="mt-[14px] w-full items-center">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a bio"
          onPress={() => router.push('/profile/edit')}
          // 6 left these short of 44; 14 clears it for the 16pt text line (LOOP-312).
          hitSlop={14}
        >
          <Text className="font-roboto text-center text-[14px] leading-[18px] text-lhlSecondaryTextGrey">
            + Add a bio
          </Text>
        </Pressable>
      </View>
    );
  }

  const mayOverflow =
    text.length > LIKELY_OVERFLOW_CHARS || text.split('\n').length > COLLAPSED_LINES;

  return (
    <View className="mt-[14px] w-full items-center">
      <Text
        numberOfLines={expanded ? undefined : COLLAPSED_LINES}
        className="font-roboto text-center text-[14px] leading-[18px] text-lhlSecondaryTextGrey"
      >
        {text}
      </Text>

      {mayOverflow ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((v) => !v)}
          // 6 left these short of 44; 14 clears it for the 16pt text line (LOOP-312).
          hitSlop={14}
          className="mt-[3px]"
        >
          <Text className="font-roboto-medium text-center text-[12px] text-lhlSecondaryTextGrey">
            {expanded ? 'less' : 'more'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
