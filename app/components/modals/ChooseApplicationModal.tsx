// "Choose Application" — the app picker behind the "+" on the Linked Socials
// row of Edit Profile (LOOP-181).
//
// Figma: Edit Profile frame, "add socials" (node 2723:3741), reviewed
// 2026-06-08.
//
// States covered:
//   - grid of the six supported apps, title carries the progress count
//   - already-connected apps rendered greyed out and non-selectable
//   - tapping one anyway surfaces "<App> has already been linked" inline

import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  MAX_LINKED_SOCIALS,
  SOCIAL_PLATFORMS_UI,
  type SocialPlatformId,
} from '@/app/lib/socialPlatforms';

import ProfileModal, { ModalAction } from './ProfileModal';

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
  const [error, setError] = useState<string | null>(null);

  // Clear the "already linked" message each time the picker reopens.
  useEffect(() => {
    if (visible) setError(null);
  }, [visible]);

  const connectedSet = new Set(connected);

  const handlePress = (platformId: SocialPlatformId, label: string) => {
    if (connectedSet.has(platformId)) {
      // Figma keeps the user in the picker and explains why nothing happened,
      // rather than silently swallowing the tap.
      setError(`${label} has already been linked`);
      return;
    }
    setError(null);
    onSelect(platformId);
  };

  return (
    <ProfileModal
      visible={visible}
      onDismiss={onClose}
      title="Choose Application"
      body={`${connected.length}/${MAX_LINKED_SOCIALS} connected`}
      actions={<ModalAction label="Cancel" variant="outline" fullWidth onPress={onClose} />}
    >
      <View className="w-full flex-row flex-wrap justify-center gap-[10px]">
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
              className={`w-[68px] items-center rounded-[8px] border px-[4px] py-[8px] ${
                isConnected
                  ? 'border-lhlMutedBorder bg-lhlSurfaceGrey opacity-40'
                  : 'border-lhlMutedBorder bg-white'
              }`}
            >
              <Icon size={26} color={isConnected ? '#B4B2B2' : '#09090B'} />
              <Text
                numberOfLines={1}
                className={`font-['Roboto-Flex'] mt-[6px] text-[10px] font-medium ${
                  isConnected ? 'text-lhlSecondaryTextGrey' : 'text-lhlInk'
                }`}
              >
                {platform.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {error ? (
        <Text className="font-['Roboto-Flex'] mt-[10px] text-center text-[11px] text-lhlDestructiveRed">
          {error}
        </Text>
      ) : null}
    </ProfileModal>
  );
}
