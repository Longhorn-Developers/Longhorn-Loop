// "Choose Application" — the app picker behind the "+" on the Linked Socials
// row of Edit Profile (LOOP-181).
//
// Figma: "Edit Profile" frame, connection apps modal, reviewed 2026-08-01.
//
// States covered:
//   - 2x3 grid of orange app tiles, X to dismiss
//   - title carries the progress count once anything is connected ("(2/3)")
//   - connected apps render greyed out and non-selectable
//   - tapping one anyway shows the red "<App> has already been linked" banner

import React, { useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import {
  MAX_LINKED_SOCIALS,
  SOCIAL_PLATFORMS_UI,
  type SocialPlatformId,
} from '@/app/lib/socialPlatforms';
import { useThemeColors } from '@/app/lib/themeColors';

export interface ChooseApplicationModalProps {
  visible: boolean;
  /** Platform ids the user has already connected — greyed out in the grid. */
  connected: SocialPlatformId[];
  /** Called with the chosen platform; the caller then opens the add-URL step. */
  onSelect: (platform: SocialPlatformId) => void;
  onClose: () => void;
}

export default function ChooseApplicationModal({
  visible,
  connected,
  onSelect,
  onClose,
}: ChooseApplicationModalProps) {
  const colors = useThemeColors();
  const [error, setError] = useState<string | null>(null);

  // Clear the "already linked" message each time the picker reopens.
  useEffect(() => {
    if (visible) setError(null);
  }, [visible]);

  const connectedSet = new Set(connected);

  const handlePress = (platformId: SocialPlatformId, label: string) => {
    if (connectedSet.has(platformId)) {
      // The design keeps the user in the picker and explains why nothing
      // happened rather than swallowing the tap.
      setError(`${label} has already been linked`);
      return;
    }
    setError(null);
    onSelect(platformId);
  };

  // The count only appears once something is connected, matching the frame:
  // "Choose Application" on first open, "Choose Application (2/3)" after.
  const title =
    connected.length > 0
      ? `Choose Application (${connected.length}/${MAX_LINKED_SOCIALS})`
      : 'Choose Application';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        style={{ backgroundColor: colors.scrim }}
        className="flex-1 items-center justify-center px-6"
        onPress={onClose}
      >
        <Pressable
          onPress={() => {}}
          className="w-full max-w-[320px] rounded-[10px] bg-lhlBackgroundColor px-[20px] py-[18px]"
        >
          <View className="flex-row items-center">
            <Text className="font-['Roboto-Flex'] flex-1 text-center text-[15px] font-semibold text-lhlInk">
              {title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={10}
              onPress={onClose}
              className="absolute right-0"
            >
              <Text className="font-['Roboto-Flex'] text-[16px] text-lhlSecondaryTextGrey">✕</Text>
            </Pressable>
          </View>

          {error ? (
            <View className="mt-[12px] rounded-[6px] border border-lhlDestructiveRed bg-lhlDestructiveSoft px-[10px] py-[7px]">
              <Text className="font-['Roboto-Flex'] text-center text-[12px] text-lhlDestructiveRed">
                {error}
              </Text>
            </View>
          ) : null}

          <View className="mt-[16px] flex-row flex-wrap justify-center gap-[16px]">
            {SOCIAL_PLATFORMS_UI.map((platform) => {
              const isConnected = connectedSet.has(platform.id);
              const Icon = platform.icon;

              return (
                <Pressable
                  key={platform.id}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isConnected ? `${platform.label}, already linked` : `Connect ${platform.label}`
                  }
                  accessibilityState={{ disabled: isConnected }}
                  onPress={() => handlePress(platform.id, platform.label)}
                  // Filled orange tiles per the frame; connected ones drop to
                  // grey so "unavailable" reads without needing the error.
                  className={`h-[54px] w-[54px] items-center justify-center rounded-[12px] ${
                    isConnected ? 'bg-lhlPlaceholderGrey' : 'bg-lhlBurntOrange'
                  }`}
                >
                  <Icon size={27} color={isConnected ? colors.inkMuted : '#FFFFFF'} />
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
