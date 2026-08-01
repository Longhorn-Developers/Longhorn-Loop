// "Leave without saving?" — shown when the user backs out of Edit Profile with
// unsaved changes (LOOP-182, consumed by LOOP-181).
//
// Figma: node 2793:3596 ("leave modo"), reviewed 2026-06-08.

import React from 'react';

import ProfileModal, { ModalAction } from './ProfileModal';

export interface LeaveWithoutSavingModalProps {
  visible: boolean;
  /** Discard edits and leave. */
  onDiscard: () => void;
  /** Persist edits, then leave. Caller owns the save + navigation. */
  onSave: () => void;
  /** Disables both actions while a save is in flight. */
  isSaving?: boolean;
  /** Android back / scrim. Defaults to staying on the page (no data loss). */
  onDismiss?: () => void;
}

export default function LeaveWithoutSavingModal({
  visible,
  onDiscard,
  onSave,
  isSaving = false,
  onDismiss,
}: LeaveWithoutSavingModalProps) {
  // Dismissing must never discard: the safe outcome is "stay and keep editing".
  const handleDismiss = onDismiss ?? (() => {});

  return (
    <ProfileModal
      visible={visible}
      onDismiss={handleDismiss}
      dismissOnBackdropPress={Boolean(onDismiss)}
      title="Leave without saving?"
      body="You're about to leave the editing page without saving."
      actions={
        <>
          <ModalAction
            label="Don't save"
            variant="outline"
            onPress={onDiscard}
            disabled={isSaving}
          />
          <ModalAction label="Save changes" variant="brand" onPress={onSave} disabled={isSaving} />
        </>
      }
    />
  );
}
