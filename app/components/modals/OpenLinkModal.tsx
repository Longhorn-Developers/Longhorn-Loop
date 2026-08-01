// "Open Link?" — shown before the app hands a user off to an external site,
// e.g. a linked social on a user or org profile (LOOP-182).
//
// Figma: node 2723:5334 ("Jayna open link"), reviewed 2026-06-08.

import React, { useCallback, useState } from 'react';
import { Linking } from 'react-native';

import ProfileModal, { ModalAction } from './ProfileModal';

export interface OpenLinkModalProps {
  visible: boolean;
  /** URL the user tapped. Opened only after they confirm. */
  url: string | null;
  onClose: () => void;
  /** Fires after a successful hand-off, for analytics. */
  onOpened?: (url: string) => void;
  /** Fires when the URL can't be opened at all. */
  onError?: (url: string, error: unknown) => void;
}

export default function OpenLinkModal({
  visible,
  url,
  onClose,
  onOpened,
  onError,
}: OpenLinkModalProps) {
  const handleContinue = useCallback(async () => {
    // Close first so the user never sees the dialog behind the browser sheet.
    onClose();
    if (!url) return;
    try {
      await Linking.openURL(url);
      onOpened?.(url);
    } catch (error) {
      // A malformed or unsupported URL shouldn't take the profile screen down.
      onError?.(url, error);
    }
  }, [url, onClose, onOpened, onError]);

  return (
    <ProfileModal
      visible={visible}
      onDismiss={onClose}
      titleSize={24}
      showIconPlaceholder
      title="Open Link?"
      body="Do you trust this link? You are about to leave the app and open an external website."
      actions={
        <>
          <ModalAction label="No, Stay" variant="outline" onPress={onClose} />
          <ModalAction label="Yes, Continue" variant="ink" onPress={handleContinue} />
        </>
      }
    />
  );
}

/**
 * Wires the modal to its trigger point with two lines at the call site:
 *
 *   const openLink = useOpenLinkGuard();
 *   <Pressable onPress={() => openLink.request(socialUrl)} />
 *   <OpenLinkModal {...openLink.modalProps} />
 *
 * Every external link on the Profile surface should go through this rather than
 * calling Linking.openURL directly, so the warning can't be bypassed.
 */
export function useOpenLinkGuard(options?: Pick<OpenLinkModalProps, 'onOpened' | 'onError'>) {
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);

  const request = useCallback((url: string) => setPendingUrl(url), []);
  const close = useCallback(() => setPendingUrl(null), []);

  return {
    request,
    close,
    modalProps: {
      visible: pendingUrl !== null,
      url: pendingUrl,
      onClose: close,
      onOpened: options?.onOpened,
      onError: options?.onError,
    } satisfies OpenLinkModalProps,
  };
}
