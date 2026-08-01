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

import type { ThemeColors } from '@/app/lib/themeColors';
import { useThemeColors } from '@/app/lib/themeColors';
import React, { useMemo } from 'react';
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
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const primaryBg = primaryDestructive ? colors.destructive : colors.brand;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onSecondary}>
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

const makeStyles = (c: ThemeColors) => ({
  backdrop: {
    flex: 1,
    backgroundColor: c.scrim,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingHorizontal: 24,
  },
  card: {
    width: '100%' as const,
    // `surface`, not `background`: the sheet is raised off the page and needs
    // to separate from it, which same-as-page would not do in dark.
    backgroundColor: c.surface,
    borderRadius: 18,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 22,
  },
  title: {
    fontSize: 28,
    fontWeight: '800' as const,
    color: c.ink,
    marginBottom: 18,
  },
  body: {
    fontSize: 17,
    color: c.ink,
    lineHeight: 24,
    marginBottom: 18,
  },
  emphasis: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: c.ink,
    lineHeight: 24,
    marginBottom: 26,
  },
  secondaryButton: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center' as const,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    marginBottom: 12,
  },
  secondaryText: {
    color: c.inkSecondary,
    fontSize: 17,
    fontWeight: '700' as const,
  },
  primaryButton: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center' as const,
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700' as const,
  },
});
