// Instagram-style bio block for the profile header.
//
// Left-aligned rather than centred (centred text wraps badly once a bio runs
// past one line), line breaks preserved, and clamped to COLLAPSED_LINES with a
// "more" / "less" toggle so a full 150-character bio can't push My Events off
// the first screen. An owner with no bio gets a prompt into Edit Profile
// instead of the block silently rendering nothing.

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

  const text = bio?.trim() ?? '';

  if (!text) {
    if (!editable) return null;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add a bio"
        onPress={() => router.push('/profile/edit')}
        hitSlop={6}
        className="mt-[12px] w-full"
      >
        <Text className="font-['Roboto-Flex'] text-[12px] leading-[18px] text-lhlSecondaryTextGrey">
          + Add a bio
        </Text>
      </Pressable>
    );
  }

  const mayOverflow =
    text.length > LIKELY_OVERFLOW_CHARS || text.split('\n').length > COLLAPSED_LINES;

  return (
    <View className="mt-[12px] w-full">
      <Text
        numberOfLines={expanded ? undefined : COLLAPSED_LINES}
        className="font-['Roboto-Flex'] text-[12px] leading-[18px] text-lhlInk"
      >
        {text}
      </Text>

      {mayOverflow ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((v) => !v)}
          hitSlop={6}
        >
          <Text className="font-['Roboto-Flex'] mt-[2px] text-[12px] font-medium text-lhlSecondaryTextGrey">
            {expanded ? 'less' : 'more'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
