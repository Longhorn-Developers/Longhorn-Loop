import ArrowRightIcon from '@/assets/images/arrow-right-cta.svg';
import CelebrationIcon from '@/assets/images/celebration.svg';
import ModalCloseIcon from '@/assets/images/modal-close.svg';
import type { ThemeColors } from '@/app/lib/themeColors';
import { useThemeColors } from '@/app/lib/themeColors';
import React, { useMemo } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';

interface Props {
  visible: boolean;
  onClose: () => void;
  onViewInProfile: () => void;
}

// Shown on the home screen after the user posts an event. Styled as a
// small card overlay, not a fullscreen modal.
//
// Figma: High Fidelity › "Confirmation Modal" (node 4058:13648). LOOP-268
// flagged the old card as off-design; the differences were all here:
//   - surface, not the orange tint. The tint is the RSVP toast's look; a
//     second orange card made "posted" and "going" read as the same message.
//   - a hairline secondary-grey border rather than a 1px ink one
//   - the celebration glyph beside the title (same asset the RSVP toast uses)
//   - a line of body copy saying what just happened, so the card is not a
//     headline and a button with nothing between them
//   - a smaller, medium-weight CTA label
// Colours stay on tokens: the design's #9D4B06 is the brand burnt orange,
// which `brand` already carries per theme.
export default function EventPostedModal({ visible, onClose, onViewInProfile }: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop}>
          {/* Stopping propagation on the card so backdrop taps still close
              but card taps don't. Using TouchableWithoutFeedback is the
              canonical RN pattern for "modal card with dismissible
              backdrop" — Pressable competes for the responder in a way
              that suppresses child TouchableOpacity taps. */}
          <TouchableWithoutFeedback>
            <View style={styles.card} accessibilityRole="alert">
              <TouchableOpacity
                style={styles.close}
                onPress={onClose}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <ModalCloseIcon width={12} height={11} color={colors.ink} />
              </TouchableOpacity>

              <View style={styles.copy}>
                <View style={styles.titleRow}>
                  <Text style={styles.title}>Event Posted Successfully!</Text>
                  <CelebrationIcon width={20} height={20} />
                </View>
                <Text style={styles.body}>
                  Your event is now live and ready for Longhorns to discover.
                </Text>
              </View>

              <TouchableOpacity
                onPress={onViewInProfile}
                activeOpacity={0.85}
                style={styles.cta}
                accessibilityRole="button"
              >
                <Text style={styles.ctaText}>View Event in Profile</Text>
                <ArrowRightIcon width={14} height={11} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      // A light translucent black, not the heavier `scrim`: this is a
      // non-blocking card overlay, not a modal sheet.
      backgroundColor: 'rgba(0,0,0,0.25)', // theme-exempt: translucent black composites over either theme
      justifyContent: 'flex-start',
      paddingTop: 120,
      paddingHorizontal: 7,
    },
    card: {
      backgroundColor: c.surface,
      borderRadius: 6,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.inkSecondary,
      paddingTop: 15,
      paddingBottom: 15,
      paddingHorizontal: 14,
      gap: 21,
    },
    close: {
      position: 'absolute',
      top: 12,
      right: 12,
      width: 24,
      height: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    copy: {
      gap: 3,
      // Clear the close button, which sits over the top-right corner.
      paddingRight: 28,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    title: {
      // LHL H3 — Roboto Flex SemiBold 20.
      fontFamily: 'Roboto-Flex-SemiBold',
      fontSize: 20,
      color: c.ink,
      flexShrink: 1,
    },
    body: {
      fontFamily: 'Roboto-Flex',
      fontSize: 16,
      color: c.ink,
    },
    cta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      backgroundColor: c.brand,
      borderRadius: 8,
      height: 32,
      paddingHorizontal: 12,
      alignSelf: 'flex-start',
    },
    ctaText: {
      fontFamily: 'Roboto-Flex-Medium',
      fontSize: 14,
      color: '#FFFFFF', // theme-exempt: label on the filled brand button, white in both themes
    },
  });
