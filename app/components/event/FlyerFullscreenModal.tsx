// Full-screen look at an event's flyer, opened from the expand button on the
// detail screen's hero.
//
// Flyers are posters with small print — dates, rooms, QR codes — and the hero
// shows one at under half the screen width, which is not enough to read them.
//
// Pinch-to-zoom comes from the native ScrollView (maximumZoomScale), which is
// iOS-only: Android ignores the prop and simply shows the flyer full-size. There
// is no image-zoom library in the app, and pulling one in for the platform that
// already fills the screen with the image was not worth the dependency.

import CloseIcon from '@/assets/images/modal-close.svg';
import React from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// theme-exempt: a media viewer is black in both themes, so the flyer is never
// framed by a light surface, and the controls on it are white for the same reason.
const BACKDROP = '#000000';
const CONTROL_FILL = 'rgba(255,255,255,0.18)';
const CONTROL_ICON = '#FFFFFF';

interface FlyerFullscreenModalProps {
  visible: boolean;
  uri: string;
  onClose: () => void;
}

export default function FlyerFullscreenModal({ visible, uri, onClose }: FlyerFullscreenModalProps) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      supportedOrientations={['portrait', 'landscape']}
    >
      <View style={styles.backdrop}>
        <ScrollView
          maximumZoomScale={4}
          minimumZoomScale={1}
          bouncesZoom
          centerContent
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ width, height }}
        >
          <Image
            source={{ uri }}
            style={{ width, height }}
            resizeMode="contain"
            accessibilityLabel="Event flyer"
          />
        </ScrollView>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close flyer"
          onPress={onClose}
          hitSlop={8}
          style={[styles.close, { top: insets.top + 12 }]}
        >
          <CloseIcon width={14} height={14} color={CONTROL_ICON} />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: BACKDROP,
  },
  close: {
    position: 'absolute',
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: CONTROL_FILL,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
