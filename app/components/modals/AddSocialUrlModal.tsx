// "add <App> url" — step two of the connection flow, after the user picks an
// app in ChooseApplicationModal (LOOP-181).
//
// Figma: Edit Profile frame, "add socials" (node 2723:3741), reviewed
// 2026-06-08.
//
// States covered:
//   - Add button inactive while the field is empty or the URL is malformed,
//     burnt orange once it validates
//   - "<App> link was not found" + Try again when the server rejects it
//
// Format validation runs locally through the same shared/socialPlatforms.ts
// rules the Worker uses, so a typo disables the button instantly instead of
// costing a round trip. The server still re-validates — this is UX, not trust.

import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import TextInputField from '@/app/components/inputs/TextInputField';
import {
  getSocialPlatformUI,
  validateSocialUrl,
  type SocialPlatformId,
} from '@/app/lib/socialPlatforms';

import ProfileModal, { ModalAction } from './ProfileModal';

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

  // The error state replaces the form with a Try again affordance, matching
  // the dedicated error frame in the design.
  if (error) {
    return (
      <ProfileModal
        visible={visible}
        onDismiss={onClose}
        title={error}
        body="Check the link and try again."
        icon={meta ? <meta.icon size={40} color="#B30404" /> : undefined}
        actions={
          <>
            <ModalAction label="Cancel" variant="outline" onPress={onClose} />
            <ModalAction label="Try again" variant="brand" onPress={() => setError(null)} />
          </>
        }
      />
    );
  }

  return (
    <ProfileModal
      visible={visible}
      onDismiss={onClose}
      dismissOnBackdropPress={!isSaving}
      title={`add ${label} url`}
      icon={meta ? <meta.icon size={40} /> : undefined}
      actions={
        <>
          <ModalAction
            label="Back"
            variant="outline"
            onPress={onBack ?? onClose}
            disabled={isSaving}
          />
          <ModalAction
            label={isSaving ? 'Adding…' : 'Add'}
            // Inactive until the URL parses; orange the moment it does.
            variant={isValid ? 'brand' : 'outline'}
            onPress={handleAdd}
            disabled={!isValid || isSaving}
          />
        </>
      }
    >
      <View className="w-full">
        <TextInputField
          value={url}
          onChangeText={setUrl}
          placeholder={meta?.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          borderRadius={8}
          editable={!isSaving}
          onSubmitEditing={handleAdd}
        />
        {url.trim().length > 0 && !isValid ? (
          <Text className="font-['Roboto-Flex'] mt-[6px] text-center text-[11px] text-lhlSecondaryTextGrey">
            {`That doesn't look like a ${label} link yet.`}
          </Text>
        ) : null}
      </View>
    </ProfileModal>
  );
}
