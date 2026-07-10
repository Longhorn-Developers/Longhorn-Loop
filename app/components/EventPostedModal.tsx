import ArrowRightIcon from '@/assets/images/arrow-right-cta.svg';
import ModalCloseIcon from '@/assets/images/modal-close.svg';
import React from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';

const BURNT_ORANGE = '#9D4A06';
const CARD_BG = '#FFF3E9';

interface Props {
  visible: boolean;
  onClose: () => void;
  onViewInProfile: () => void;
}

// Shown on the home screen after the user posts an event. Styled as a
// small card overlay, not a fullscreen modal.
export default function EventPostedModal({ visible, onClose, onViewInProfile }: Props) {
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
            <View style={styles.card}>
              <TouchableOpacity style={styles.close} onPress={onClose} hitSlop={12}>
                <ModalCloseIcon width={12} height={11} color="#000000" />
              </TouchableOpacity>
              <Text style={styles.title}>Event Posted Successfully!</Text>
              <TouchableOpacity onPress={onViewInProfile} activeOpacity={0.85} style={styles.cta}>
                <Text style={styles.ctaText}>View Event in Profile</Text>
                <ArrowRightIcon width={14} height={11} color="#F9F8F5" />
              </TouchableOpacity>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'flex-start',
    paddingTop: 120,
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#000000',
    paddingVertical: 16,
    paddingHorizontal: 16,
    gap: 13,
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
  title: {
    // LHJ h3 — Roboto Flex SemiBold 20.
    fontSize: 20,
    fontWeight: '600',
    color: '#000000',
    paddingRight: 20,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: BURNT_ORANGE,
    borderRadius: 8,
    padding: 5,
    paddingHorizontal: 10,
    alignSelf: 'flex-start',
  },
  ctaText: {
    // LHJ h4 — Roboto Flex SemiBold 16.
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
