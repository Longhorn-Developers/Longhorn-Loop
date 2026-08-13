// "Delete Account?" — the point of no return on Settings (LOOP-131).
//
// Figma: "Modals" frame, "Jayna delete account", reviewed 2026-06-08. Same
// shell as the Log Out confirm two rows above it, so the two destructive
// actions in the Account section read as siblings rather than as two
// unrelated dialogs.
//
// SCOPE. This modal only *asks*. Confirming it sends a code to the user's
// email and hands off to app/settings/delete-account.tsx, which collects the
// code and performs the delete. The split is not decoration: the six-digit
// OtpInput is 288pt wide and the ProfileModal card is 266pt, so the code step
// physically cannot live in here without either shrinking the boxes below a
// usable touch target or widening a card that four other modals share.
//
// The one thing this file must never do is close optimistically. If the
// request fails — offline, or a code was already sent within the cooldown —
// the modal stays open with the reason on it, because a dialog that dismisses
// itself and navigates nowhere reads as "deleted" to the person who tapped it.

import React, { useCallback, useEffect, useState } from 'react';
import { Text } from 'react-native';

import ProfileModal, { ModalAction } from './ProfileModal';

export interface DeleteAccountModalProps {
  visible: boolean;
  /**
   * Requests the emailed confirmation code. Resolve to advance (the caller
   * navigates); reject to show the reason and stay put.
   */
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

export default function DeleteAccountModal({
  visible,
  onConfirm,
  onClose,
}: DeleteAccountModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on open so a failure from a previous attempt never greets the next
  // one — same guard as InviteEditorModal.
  useEffect(() => {
    if (visible) {
      setIsSubmitting(false);
      setError(null);
    }
  }, [visible]);

  const handleConfirm = useCallback(async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start that. Try again.');
      setIsSubmitting(false);
    }
    // Deliberately no `finally`: on success the caller navigates away and
    // clearing the spinner would flash the button back to "Yes, Delete"
    // underneath the transition.
  }, [isSubmitting, onConfirm]);

  return (
    <ProfileModal
      visible={visible}
      onDismiss={onClose}
      // An accidental backdrop tap mid-request would leave a code sent and the
      // user with no screen explaining it.
      dismissOnBackdropPress={!isSubmitting}
      title="Delete Account?"
      body="Are you sure you want to Delete your account? This action cannot be undone and all your data will be permanently removed"
      actions={
        <>
          <ModalAction label="Cancel" variant="outline" onPress={onClose} disabled={isSubmitting} />
          <ModalAction
            label={isSubmitting ? 'Sending…' : 'Yes, Delete'}
            variant="destructive"
            onPress={handleConfirm}
            disabled={isSubmitting}
          />
        </>
      }
    >
      {error ? (
        <Text className="font-['Roboto-Flex'] text-center text-[11px] text-lhlDestructiveRed">
          {error}
        </Text>
      ) : null}
    </ProfileModal>
  );
}
