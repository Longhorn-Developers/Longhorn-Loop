// Generic two-button modal used by the RSVP flow:
//   - "Open external link?"
//   - "Did you RSVP?"
//   - "Cancel RSVP?"
//
// Layout follows the Figma:
//   - Large bold title
//   - Optional body paragraph (regular weight)
//   - Optional emphasised line (bold), after the body by default or before it
//     with `emphasisFirst` — see the prop
//   - Secondary button on top (outlined / safe option)
//   - Primary button on bottom (filled; red when destructive)

import type { ThemeColors } from '@/app/lib/themeColors';
import { useThemeColors } from '@/app/lib/themeColors';
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

interface ConfirmModalProps {
  visible: boolean;
  title: string;
  body?: string;
  emphasis?: string;
  /**
   * Put the bold line ABOVE the paragraph.
   *
   * The RSVP flow reads "here is what will happen" then asks "did you RSVP?",
   * so its emphasis is a closing question and belongs last. Delete Event runs
   * the other way: it names what you are about to do, then explains the
   * consequences. Same two slots, opposite order, so this is a flag rather
   * than a second component.
   */
  emphasisFirst?: boolean;
  primaryLabel: string;
  secondaryLabel: string;
  onPrimary: () => void;
  onSecondary: () => void;
  primaryDestructive?: boolean;
}

/**
 * Pressed fills, pinned rather than derived.
 *
 * Both are ~12% darker than the resting colour and are the same in light and
 * dark: these sit on a filled button carrying a white label, so lightening
 * them in dark mode would push the label's contrast down at exactly the moment
 * the user is committing to something irreversible.
 */
const DESTRUCTIVE_PRESSED = '#8F0303'; // theme-exempt: white label, 9.62:1
const BRAND_PRESSED = '#7C3B05'; // theme-exempt: white label, 8.45:1

export default function ConfirmModal({
  visible,
  title,
  body,
  emphasis,
  emphasisFirst = false,
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
  primaryDestructive = false,
}: ConfirmModalProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  /**
   * Pressed state as component state, not a `({ pressed }) => ...` callback.
   * Every element here goes through NativeWind's jsx runtime and a
   * function-valued style is silently dropped by it -- see the note in
   * components/profile/ProfileEventCard, which cost two rounds to find.
   */
  const [pressed, setPressed] = useState<'primary' | 'secondary' | null>(null);

  // `destructiveFill`, not `destructive`: the label on this button is white, and
  // `destructive` lightens to #FF6B63 in dark, where white on it is 2.79:1.
  const primaryBg = primaryDestructive ? colors.destructiveFill : colors.brand;

  /**
   * Pressed feedback that CHANGES COLOUR rather than fading.
   *
   * These two buttons are the whole decision, and they are full-width -- under
   * a thumb, most of the one being pressed is hidden. An opacity dip is read
   * through the finger covering it; a colour that deepens and holds for the
   * frames after the finger lifts is not.
   *
   * The destructive one deepens toward its own red rather than going grey, so
   * the feedback still says "this is the delete" at the moment of commitment.
   * Keep Event fills with the muted surface, the same press language as the
   * Manage Event rows behind this modal.
   */
  const primaryPressedBg = primaryDestructive ? DESTRUCTIVE_PRESSED : BRAND_PRESSED;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onSecondary}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>

          {emphasisFirst && emphasis ? <Text style={styles.emphasis}>{emphasis}</Text> : null}
          {body ? <Text style={styles.body}>{body}</Text> : null}
          {!emphasisFirst && emphasis ? <Text style={styles.emphasis}>{emphasis}</Text> : null}

          <Pressable
            onPress={onSecondary}
            onPressIn={() => setPressed('secondary')}
            onPressOut={() => setPressed(null)}
            accessibilityRole="button"
            style={[
              styles.secondaryButton,
              pressed === 'secondary'
                ? { backgroundColor: colors.surfaceMuted, borderColor: colors.inkSecondary }
                : null,
            ]}
          >
            <Text style={styles.secondaryText}>{secondaryLabel}</Text>
          </Pressable>

          <Pressable
            onPress={onPrimary}
            onPressIn={() => setPressed('primary')}
            onPressOut={() => setPressed(null)}
            accessibilityRole="button"
            style={[
              styles.primaryButton,
              { backgroundColor: pressed === 'primary' ? primaryPressedBg : primaryBg },
            ]}
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
