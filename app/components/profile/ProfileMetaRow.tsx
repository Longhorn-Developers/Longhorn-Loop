// A single icon + value line in the profile metadata block.
//
// Modelled on the metadata row X and LinkedIn use under a profile bio: a muted
// icon followed by comma-separated values. It replaced a "Details and
// Interests" heading over a row of grey chips, which read as filler — an icon
// carries the category so the label doesn't have to, and the row scales to
// however many values exist without another heading.
//
// Renders nothing when it has no values, so the block collapses cleanly for a
// profile that hasn't filled everything in.

import React from 'react';
import { Text, View } from 'react-native';

export interface ProfileMetaRowProps {
  icon: React.ReactNode;
  /** Empty / nullish entries are dropped before joining. */
  values: (string | null | undefined)[];
  /** Accessibility label for the icon, which is otherwise decorative. */
  label: string;
}

export default function ProfileMetaRow({ icon, values, label }: ProfileMetaRowProps) {
  const shown = values.filter((v): v is string => !!v && v.trim().length > 0);
  if (shown.length === 0) return null;

  return (
    <View className="mt-[6px] flex-row items-center gap-[7px]" accessibilityLabel={label}>
      {icon}
      <Text
        numberOfLines={1}
        className="font-['Roboto-Flex'] flex-1 text-[13px] text-lhlSecondaryTextGrey"
      >
        {shown.join(', ')}
      </Text>
    </View>
  );
}
