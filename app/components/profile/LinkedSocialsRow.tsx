// "Linked Socials (3 max)" row on Edit Profile (LOOP-181).
//
// Figma: Edit Profile frame, reviewed 2026-06-08.
//
// Renders each connected app as an icon chip with a removable (x) badge, plus
// a "+" button that opens the app picker. The "+" disappears at 3 connected,
// which is why the picker never has to handle a full-house case.

import React from 'react';
import { Pressable, Text, View } from 'react-native';

import LhlPillCross from '@/assets/icons/LhlPillCross';
import {
  MAX_LINKED_SOCIALS,
  getSocialPlatformUI,
  type LinkedSocial,
} from '@/app/lib/socialPlatforms';

export interface LinkedSocialsRowProps {
  socials: LinkedSocial[];
  /** Opens ChooseApplicationModal. Hidden once MAX_LINKED_SOCIALS is reached. */
  onAdd: () => void;
  onRemove: (social: LinkedSocial) => void;
  /** Tapping a chip previews the link — routed through the Open Link warning. */
  onPreview?: (social: LinkedSocial) => void;
  disabled?: boolean;
}

export default function LinkedSocialsRow({
  socials,
  onAdd,
  onRemove,
  onPreview,
  disabled = false,
}: LinkedSocialsRowProps) {
  const isFull = socials.length >= MAX_LINKED_SOCIALS;

  return (
    <View>
      <Text className="font-['Roboto-Flex'] text-[14px] font-semibold text-lhlInk">
        Linked Socials{' '}
        <Text className="text-[12px] font-normal text-lhlSecondaryTextGrey">
          ({MAX_LINKED_SOCIALS} max)
        </Text>
      </Text>

      <View className="mt-[10px] flex-row flex-wrap items-center gap-[14px]">
        {socials.map((social) => {
          const meta = getSocialPlatformUI(social.platform);
          if (!meta) return null;
          const Icon = meta.icon;

          return (
            <View key={social.platform} className="h-[46px] w-[46px]">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${meta.label} link`}
                disabled={disabled || !onPreview}
                onPress={() => onPreview?.(social)}
                className="h-[42px] w-[42px] items-center justify-center rounded-full border border-lhlMutedBorder bg-lhlSurface"
              >
                <Icon size={22} />
              </Pressable>

              {/* x badge, overlapping the chip's top-right per the design. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${meta.label}`}
                disabled={disabled}
                onPress={() => onRemove(social)}
                // Enlarges the touch target well past the 16px visual badge.
                hitSlop={10}
                className="absolute right-0 top-0 h-[16px] w-[16px] items-center justify-center rounded-full bg-lhlInk"
              >
                <LhlPillCross size={7} color="#FFFFFF" />
              </Pressable>
            </View>
          );
        })}

        {!isFull ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a linked social"
            disabled={disabled}
            onPress={onAdd}
            className="h-[42px] w-[42px] items-center justify-center rounded-full border border-dashed border-lhlMutedBorder bg-lhlSurfaceGrey"
          >
            <Text className="font-['Roboto-Flex'] text-[22px] leading-[24px] text-lhlSecondaryTextGrey">
              +
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
