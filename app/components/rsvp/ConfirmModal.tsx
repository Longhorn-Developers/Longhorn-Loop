// Generic two-button modal used by the RSVP flow:
//   - "Open external link?"
//   - "Did you RSVP?"
//   - "Cancel RSVP?"
//
// Layout follows the Figma:
//   - Large bold title
//   - Optional body paragraph (regular weight)
//   - Optional emphasised question line (bold)
//   - Secondary button on top (outlined / safe option)
//   - Primary button on bottom (filled; red when destructive)

import React from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

interface ConfirmModalProps {
  visible: boolean;
  title: string;
  body?: string;
  emphasis?: string;
  primaryLabel: string;
  secondaryLabel: string;
  onPrimary: () => void;
  onSecondary: () => void;
  primaryDestructive?: boolean;
}

const BURNT_ORANGE = '#BF5700';
const DESTRUCTIVE_RED = '#B30404';
const TEXT_PRIMARY = '#000000';
const TEXT_SECONDARY = '#485656';
const CARD_BG = '#F9F8F5';
const BORDER_GREY = '#C7C7C7';
const ON_BRAND_WHITE = '#FFFFFF';

export default function ConfirmModal({
  visible,
  title,
  body,
  emphasis,
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
  primaryDestructive = false,
}: ConfirmModalProps) {
  const primaryBg = primaryDestructive ? DESTRUCTIVE_RED : BURNT_ORANGE;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onSecondary}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>

          {body ? <Text style={styles.body}>{body}</Text> : null}
          {emphasis ? <Text style={styles.emphasis}>{emphasis}</Text> : null}

          <Pressable onPress={onSecondary} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>{secondaryLabel}</Text>
          </Pressable>

          <Pressable
            onPress={onPrimary}
            style={[styles.primaryButton, { backgroundColor: primaryBg }]}
          >
            <Text style={styles.primaryText}>{primaryLabel}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = {
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingHorizontal: 24,
  },
  card: {
    width: '100%' as const,
    backgroundColor: CARD_BG,
    borderRadius: 18,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 22,
  },
  title: {
    fontSize: 28,
    fontWeight: '800' as const,
    color: TEXT_PRIMARY,
    marginBottom: 18,
  },
  body: {
    fontSize: 17,
    color: TEXT_PRIMARY,
    lineHeight: 24,
    marginBottom: 18,
  },
  emphasis: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: TEXT_PRIMARY,
    lineHeight: 24,
    marginBottom: 26,
  },
  secondaryButton: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center' as const,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: BORDER_GREY,
    marginBottom: 12,
  },
  secondaryText: {
    color: TEXT_SECONDARY,
    fontSize: 17,
    fontWeight: '700' as const,
  },
  primaryButton: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center' as const,
  },
  primaryText: {
    color: ON_BRAND_WHITE,
    fontSize: 17,
    fontWeight: '700' as const,
  },
};
