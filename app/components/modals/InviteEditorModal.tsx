// "Invite Editor?" — search a UT user by email and invite them as an editor of
// an organization, then swap to the "Invite sent!" confirmation (LOOP-182).
//
// Figma: node 2723:5645 ("Jayna Invite editor"), reviewed 2026-06-08.
//
// BACKEND: there is no invite endpoint on the Worker yet (server/src/routes has
// no org routes as of this commit). The modal therefore takes an `onInvite`
// callback so the screen owns the mutation; wire it to the real endpoint when
// the org-editor API lands and delete this note.

import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { isAllowedUTEmail } from '@/shared/utEmail';
import LhlSearchIcon from '@/assets/icons/LhlSearchIcon';
import TextInputField from '@/app/components/inputs/TextInputField';

import ProfileModal, { ModalAction } from './ProfileModal';

/** Editors must be UT people, so only utexas.edu addresses are invitable. */
// LOOP-255: replaced a local any-subdomain regex with the shared allow-list.
// Inviting an address that can't receive a sign-in code would create a
// membership row nobody can ever claim.

export function isUtEmail(value: string): boolean {
  return isAllowedUTEmail(value);
}

export interface InviteEditorModalProps {
  visible: boolean;
  /** Sends the invite. Reject to surface an inline error and stay on the form. */
  onInvite: (email: string) => Promise<void>;
  onClose: () => void;
}

export default function InviteEditorModal({ visible, onInvite, onClose }: InviteEditorModalProps) {
  const [email, setEmail] = useState('');
  const [stage, setStage] = useState<'form' | 'sent'>('form');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset every time the modal opens so a previous invite never leaks through.
  useEffect(() => {
    if (visible) {
      setEmail('');
      setStage('form');
      setIsSending(false);
      setError(null);
    }
  }, [visible]);

  const handleSend = useCallback(async () => {
    const trimmed = email.trim();
    if (!isUtEmail(trimmed)) {
      setError('Enter a valid UT email address.');
      return;
    }

    setIsSending(true);
    setError(null);
    try {
      await onInvite(trimmed);
      setStage('sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That invite could not be sent.');
    } finally {
      setIsSending(false);
    }
  }, [email, onInvite]);

  if (stage === 'sent') {
    return (
      <ProfileModal
        visible={visible}
        onDismiss={onClose}
        title="Invite Editor?"
        showIconPlaceholder
        actions={
          <ModalAction label="Done" variant="ink" size="large" fullWidth onPress={onClose} />
        }
      >
        <View className="flex-row items-center gap-[10px]">
          <View className="h-[32px] w-[32px] rounded-full bg-lhlPlaceholderGrey" />
          <View className="flex-1">
            <Text className="font-['Roboto-Flex'] text-[11px] font-semibold text-lhlInk">
              Invite sent!
            </Text>
            <Text className="font-['Roboto-Flex'] mt-[2px] text-[11px] text-lhlSecondaryTextGrey">
              They&apos;ll receive an email with next steps.
            </Text>
          </View>
        </View>
      </ProfileModal>
    );
  }

  return (
    <ProfileModal
      visible={visible}
      onDismiss={onClose}
      dismissOnBackdropPress={!isSending}
      title="Invite Editor?"
      showIconPlaceholder
      body="Search for a user to invite as an editor to your organization"
      actions={
        <>
          <ModalAction label="Cancel" variant="outline" onPress={onClose} disabled={isSending} />
          <ModalAction
            label={isSending ? 'Sending…' : 'Send'}
            variant="ink"
            onPress={handleSend}
            disabled={isSending || email.trim().length === 0}
          />
        </>
      }
    >
      <TextInputField
        value={email}
        onChangeText={(text) => {
          setEmail(text);
          if (error) setError(null);
        }}
        placeholder="Search by UT email"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        borderRadius={8}
        editable={!isSending}
        onSubmitEditing={handleSend}
        leftIcon={<LhlSearchIcon size={15} color="#000000" />}
      />

      {error ? (
        <Text className="font-['Roboto-Flex'] mt-[6px] text-center text-[11px] text-lhlDestructiveRed">
          {error}
        </Text>
      ) : null}
    </ProfileModal>
  );
}
