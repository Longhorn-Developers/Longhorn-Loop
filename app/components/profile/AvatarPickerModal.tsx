// "Edit photo" — preset avatar picker for Edit Profile (Figma "Edit Profile"
// frame).
//
// LOOP-130 left preset-vs-upload open. This answers it with presets, because
// the six Bevo avatars already ship in assets/images/avatars and onboarding
// already makes users pick one — an upload path would need image picking,
// cropping, R2 storage and moderation, none of which exist. Swapping to
// uploads later only changes what sits behind this button.
//
// The chosen avatar is stored as users.avatar (an integer id), the same column
// onboarding writes.

import React, { useEffect, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import ProfileModal, { ModalAction } from '@/app/components/modals/ProfileModal';

/** Ids match app/(onboarding)/Avatar.tsx — changing one changes the other. */
export const PRESET_AVATARS: { id: number; label: string; image: number }[] = [
  { id: 1, label: 'Hungry Bevo', image: require('@/assets/images/avatars/hungry-bevo.png') },
  { id: 2, label: 'Silly Bevo', image: require('@/assets/images/avatars/silly-bevo.png') },
  { id: 3, label: 'Smart Bevo', image: require('@/assets/images/avatars/smart-bevo.png') },
  { id: 4, label: 'Happy Bevo', image: require('@/assets/images/avatars/happy-bevo.png') },
  { id: 5, label: 'Sad Bevo', image: require('@/assets/images/avatars/sad-bevo.png') },
  { id: 6, label: 'Sporty Bevo', image: require('@/assets/images/avatars/sporty-bevo.png') },
];

export function getAvatarSource(avatarId: number | null | undefined) {
  return PRESET_AVATARS.find((a) => a.id === avatarId)?.image;
}

export interface AvatarPickerModalProps {
  visible: boolean;
  /** Currently saved avatar id, or null if the user has never picked one. */
  value: number | null;
  onSelect: (avatarId: number) => void;
  onClose: () => void;
}

export default function AvatarPickerModal({
  visible,
  value,
  onSelect,
  onClose,
}: AvatarPickerModalProps) {
  const [pending, setPending] = useState<number | null>(value);

  // Reopening after a cancel should show what's actually saved, not the
  // selection the user abandoned last time.
  useEffect(() => {
    if (visible) setPending(value);
  }, [visible, value]);

  return (
    <ProfileModal
      visible={visible}
      onDismiss={onClose}
      title="Edit photo"
      body="Pick an avatar"
      actions={
        <>
          <ModalAction label="Cancel" variant="outline" onPress={onClose} />
          <ModalAction
            label="Choose"
            variant="brand"
            disabled={pending === null}
            onPress={() => {
              if (pending !== null) onSelect(pending);
              onClose();
            }}
          />
        </>
      }
    >
      <View className="w-full flex-row flex-wrap justify-center gap-[10px]">
        {PRESET_AVATARS.map((avatar) => {
          const isSelected = pending === avatar.id;
          return (
            <Pressable
              key={avatar.id}
              accessibilityRole="button"
              accessibilityLabel={avatar.label}
              accessibilityState={{ selected: isSelected }}
              onPress={() => setPending(avatar.id)}
              className={`h-[62px] w-[62px] items-center justify-center overflow-hidden rounded-full border-2 ${
                isSelected ? 'border-lhlBurntOrange' : 'border-lhlMutedBorder'
              }`}
            >
              <Image source={avatar.image} style={{ width: '100%', height: '100%' }} />
            </Pressable>
          );
        })}
      </View>

      {pending !== null ? (
        <Text className="font-['Roboto-Flex'] mt-[8px] text-center text-[11px] text-lhlSecondaryTextGrey">
          {PRESET_AVATARS.find((a) => a.id === pending)?.label}
        </Text>
      ) : null}
    </ProfileModal>
  );
}
