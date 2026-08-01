// "Add <App> url" — step two of the connection flow, after the user picks an
// app in ChooseApplicationModal (LOOP-181).
//
// Figma: "Edit Profile" frame, connection apps modal, reviewed 2026-08-01.
//
// States covered:
//   - header row: back arrow, orange platform tile, "Add Instagram url"
//   - Add button white/outline while the URL is empty or malformed, burnt
//     orange the moment it parses
//   - "<App> link was not found" + a Try again button when the server rejects
//
// Format validation runs locally through the same shared/socialPlatforms.ts
// rules the Worker uses, so a typo disables the button instantly instead of
// costing a round trip. The server still re-validates — this is UX, not trust.

import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';

import {
  getSocialPlatformUI,
  validateSocialUrl,
  type SocialPlatformId,
} from '@/app/lib/socialPlatforms';

const BORDER = 'rgba(0,0,0,0.20)';

export interface AddSocialUrlModalProps {
  visible: boolean;
  /** Which app the user picked. Null closes the modal. */
  platform: SocialPlatformId | null;
  /**
   * Persists the link. Reject with an Error to surface its message as the
   * "not found" state — the caller maps API error codes to copy.
   */
  onAdd: (platform: SocialPlatformId, url: string) => Promise<void>;
  onClose: () => void;
  /** Returns to the app picker instead of dismissing the whole flow. */
  onBack?: () => void;
}

export default function AddSocialUrlModal({
  visible,
  platform,
  onAdd,
  onClose,
  onBack,
}: AddSocialUrlModalProps) {
  const [url, setUrl] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset whenever a different app is picked, so a rejected Instagram URL
  // doesn't linger in the LinkedIn field.
  useEffect(() => {
    if (visible) {
      setUrl('');
      setIsSaving(false);
      setError(null);
    }
  }, [visible, platform]);

  const meta = platform ? getSocialPlatformUI(platform) : undefined;
  const label = meta?.label ?? 'app';
  const Icon = meta?.icon;

  const isValid = platform ? validateSocialUrl(platform, url).ok : false;

  const handleAdd = useCallback(async () => {
    if (!platform || !isValid) return;

    setIsSaving(true);
    setError(null);
    try {
      await onAdd(platform, url.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${label} link was not found`);
    } finally {
      setIsSaving(false);
    }
  }, [platform, isValid, url, onAdd, onClose, label]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        style={{ backgroundColor: 'rgba(9, 9, 11, 0.5)' }}
        className="flex-1 items-center justify-center px-6"
        onPress={isSaving ? undefined : onClose}
      >
        <Pressable
          onPress={() => {}}
          className="w-full max-w-[320px] rounded-[10px] bg-lhlBackgroundColor px-[20px] py-[18px]"
        >
          {error ? (
            // Dedicated error frame: the form is replaced by the failure and a
            // Try again that returns to the field with the URL still typed.
            <View className="items-center py-[10px]">
              <Text className="font-['Roboto-Flex'] text-center text-[14px] text-lhlInk">
                {error}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Try again"
                onPress={() => setError(null)}
                className="mt-[16px] rounded-[6px] bg-lhlPlaceholderGrey px-[22px] py-[8px]"
              >
                <Text className="font-['Roboto-Flex'] text-[13px] font-medium text-lhlInk">
                  Try again
                </Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View className="flex-row items-center gap-[10px]">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Back"
                  hitSlop={10}
                  disabled={isSaving}
                  onPress={onBack ?? onClose}
                >
                  <Text className="font-['Roboto-Flex'] text-[17px] text-lhlInk">←</Text>
                </Pressable>

                {Icon ? (
                  <View className="h-[30px] w-[30px] items-center justify-center rounded-[8px] bg-lhlBurntOrange">
                    <Icon size={16} color="#FFFFFF" />
                  </View>
                ) : null}

                <Text className="font-['Roboto-Flex'] text-[14px] font-medium text-lhlInk">
                  Add {label} url
                </Text>
              </View>

              <TextInput
                value={url}
                onChangeText={setUrl}
                placeholder="Enter url here"
                placeholderTextColor="#9A9A9A"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                editable={!isSaving}
                onSubmitEditing={handleAdd}
                className="font-['Roboto-Flex'] mt-[16px] rounded-[6px] border bg-lhlSurface px-[12px] py-[10px] text-[13px] text-lhlInk"
                style={{ borderColor: BORDER }}
              />

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add"
                accessibilityState={{ disabled: !isValid || isSaving }}
                disabled={!isValid || isSaving}
                onPress={handleAdd}
                // Outline until the URL parses, then burnt orange.
                className={`mt-[14px] items-center justify-center rounded-[8px] border py-[12px] ${
                  isValid
                    ? 'border-lhlBurntOrange bg-lhlBurntOrange'
                    : 'border-lhlMutedBorder bg-lhlSurface'
                }`}
              >
                <Text
                  className={`font-['Roboto-Flex'] text-[15px] font-semibold ${
                    isValid ? 'text-white' : 'text-lhlSecondaryTextGrey'
                  }`}
                >
                  {isSaving ? 'Adding…' : 'Add'}
                </Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
