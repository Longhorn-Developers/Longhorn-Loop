// Instagram-style bio block for the profile header.
//
// Left-aligned rather than centred (centred text wraps badly the moment a bio
// runs past one line), line breaks preserved, and clamped to COLLAPSED_LINES
// with a "more" / "less" toggle so a full 150-character bio can't push My
// Events off the first screen.
//
// On your own profile the block always carries an edit affordance: "Edit" next
// to a bio that exists, "+ Add a bio" when there isn't one yet. The text itself
// is deliberately not tappable -- tap-to-expand and tap-to-edit on the same
// target makes both feel broken.

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
  /** True on the owner's own profile, where the bio is editable. */
  editable?: boolean;
}

export default function ProfileBio({ bio, editable = false }: ProfileBioProps) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  const text = typeof bio === 'string' ? bio.trim() : '';
  const goToEdit = () => router.push('/profile/edit');

  if (!text) {
    if (!editable) return null;
    return (
      <View className="mt-[10px] w-full">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a bio"
          onPress={goToEdit}
          hitSlop={6}
        >
          <Text className="font-['Roboto-Flex'] text-[13px] leading-[18px] text-lhlSecondaryTextGrey">
            + Add a bio
          </Text>
        </Pressable>
      </View>
    );
  }

  const mayOverflow =
    text.length > LIKELY_OVERFLOW_CHARS || text.split('\n').length > COLLAPSED_LINES;

  return (
    <View className="mt-[10px] w-full">
      <Text
        numberOfLines={expanded ? undefined : COLLAPSED_LINES}
        className="font-['Roboto-Flex'] text-[13px] leading-[18px] text-lhlInk"
      >
        {text}
      </Text>

      <View className="mt-[3px] flex-row items-center gap-[12px]">
        {mayOverflow ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            onPress={() => setExpanded((v) => !v)}
            hitSlop={6}
          >
            <Text className="font-['Roboto-Flex'] text-[12px] font-medium text-lhlSecondaryTextGrey">
              {expanded ? 'less' : 'more'}
            </Text>
          </Pressable>
        ) : null}

        {editable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit bio"
            onPress={goToEdit}
            hitSlop={6}
          >
            <Text className="font-['Roboto-Flex'] text-[12px] font-medium text-lhlSecondaryTextGrey">
              Edit
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
