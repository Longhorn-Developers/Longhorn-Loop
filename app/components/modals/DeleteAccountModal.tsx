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
//
// TYPE YOUR EMAIL TO ENABLE THE BUTTON, the way GitHub gates repository
// deletion. This is not the security control — the emailed code is, and it is
// the thing a stolen session cannot get past. This is the ATTENTION control,
// and the two guard different failures: a code stops someone else deleting
// your account, and typing the address stops YOU deleting it by reflex.
//
// Which matters here specifically, because the button that follows "Are you
// sure?" is the one people press without reading, and the next screen after
// this asks for a code that is already sitting in their inbox. Without this
// gate the whole flow is two taps and a paste.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { useThemeColors } from '@/app/lib/themeColors';
import ProfileModal, { ModalAction } from './ProfileModal';

export interface DeleteAccountModalProps {
  visible: boolean;
  /** The signed-in address. Deletion stays disabled until it is typed back. */
  email: string;
  /**
   * Requests the emailed confirmation code. Resolve to advance (the caller
   * navigates); reject to show the reason and stay put.
   */
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

export default function DeleteAccountModal({
  visible,
  email,
  onConfirm,
  onClose,
}: DeleteAccountModalProps) {
  const colors = useThemeColors();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');

  // Reset on open so a failure from a previous attempt never greets the next
  // one — same guard as InviteEditorModal.
  useEffect(() => {
    if (visible) {
      setIsSubmitting(false);
      setError(null);
      setTyped('');
    }
  }, [visible]);

  /**
   * Case- and whitespace-insensitive. The point is to make you read your own
   * address and type it, not to test your shift key -- and iOS autocapitalises
   * the first letter of a text field by default, so a strict compare would
   * reject the very first character most people type.
   */
  const matches = useMemo(
    () => typed.trim().toLowerCase() === email.trim().toLowerCase() && email.trim().length > 0,
    [typed, email],
  );

  const handleConfirm = useCallback(async () => {
    if (isSubmitting || !matches) return;
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
  }, [isSubmitting, matches, onConfirm]);

  return (
    <ProfileModal
      visible={visible}
      onDismiss={onClose}
      // An accidental backdrop tap mid-request would leave a code sent and the
      // user with no screen explaining it.
      dismissOnBackdropPress={!isSubmitting}
      // The one dialog in this shell that holds an input. At the shared 266pt
      // the field is narrower than the address it is asking you to type.
      wide
      title="Delete Account?"
      body="This cannot be undone. Your profile, events, RSVPs and saved events are permanently removed."
      actions={
        <>
          <ModalAction label="Cancel" variant="outline" onPress={onClose} disabled={isSubmitting} />
          <ModalAction
            label={isSubmitting ? 'Sending…' : 'Yes, Delete'}
            variant="destructive"
            onPress={handleConfirm}
            disabled={isSubmitting || !matches}
          />
        </>
      }
    >
      <View className="mb-[4px] w-full">
        <Text className="font-['Roboto-Flex'] mb-[6px] text-[11px] text-lhlSecondaryTextGrey">
          Type <Text className="font-semibold text-lhlInk">{email}</Text> to confirm.
        </Text>
        <TextInput
          value={typed}
          onChangeText={setTyped}
          editable={!isSubmitting}
          placeholder="your email"
          placeholderTextColor={colors.inkMuted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="none"
          // No autofill. The whole gate is defeated by a keyboard suggestion
          // that fills the address in one tap.
          autoComplete="off"
          accessibilityLabel="Type your email address to confirm deletion"
          style={{
            height: 38,
            borderRadius: 8,
            borderWidth: 1,
            // Turns destructive only once it matches, so the field itself says
            // whether the button below is live.
            borderColor: matches ? colors.destructive : colors.border,
            paddingHorizontal: 10,
            fontSize: 13,
            color: colors.ink,
            backgroundColor: colors.surface,
          }}
        />
      </View>

      {error ? (
        <Text className="font-['Roboto-Flex'] mt-[6px] text-center text-[11px] text-lhlDestructiveRed">
          {error}
        </Text>
      ) : null}
    </ProfileModal>
  );
}
