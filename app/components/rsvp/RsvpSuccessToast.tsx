// "You're going!" toast shown after a successful RSVP.
// Auto-dismisses after 3 seconds. X button dismisses early.

import CelebrationIcon from '@/assets/images/celebration.svg';
import XCloseIcon from '@/assets/images/x-close.svg';
import type { ThemeColors } from '@/app/lib/themeColors';
import { useThemeColors } from '@/app/lib/themeColors';
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';

interface RsvpSuccessToastProps {
  visible: boolean;
  eventTitle: string;
  onClose: () => void;
}

const AUTO_DISMISS_MS = 3000;

export default function RsvpSuccessToast({ visible, eventTitle, onClose }: RsvpSuccessToastProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    if (!visible) return;

    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 200,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();

    const timer = setTimeout(() => {
      onClose();
    }, AUTO_DISMISS_MS);

    return () => clearTimeout(timer);
  }, [visible, opacity, translateY, onClose]);

  // Reset values when hidden so the next show animates fresh.
  useEffect(() => {
    if (!visible) {
      opacity.setValue(0);
      translateY.setValue(20);
    }
  }, [visible, opacity, translateY]);

  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrapper,
        {
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <View style={styles.card}>
        <Pressable onPress={onClose} hitSlop={12} style={styles.closeButton}>
          <XCloseIcon width={14} height={15} color={colors.inkSecondary} />
        </Pressable>

        <View style={styles.headlineRow}>
          <Text style={styles.headline}>You&rsquo;re going!</Text>
          <View style={{ marginLeft: 6 }}>
            <CelebrationIcon width={26} height={26} />
          </View>
        </View>

        <Text style={styles.body}>You&rsquo;re RSVP&rsquo;d to &ldquo;{eventTitle}&rdquo;.</Text>

        <Text style={styles.subtext}>
          You&rsquo;ll receive notifications if there are updates, reminders, or important changes
          before the event.
        </Text>
      </View>
    </Animated.View>
  );
}

const makeStyles = (c: ThemeColors) => ({
  wrapper: {
    position: 'absolute' as const,
    left: 16,
    right: 16,
    top: 60,
    zIndex: 100,
  },
  card: {
    backgroundColor: c.brandSoft,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 18,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  closeButton: {
    position: 'absolute' as const,
    top: 12,
    right: 14,
    width: 28,
    height: 28,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  headlineRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginBottom: 8,
    paddingRight: 28,
  },
  headline: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: c.ink,
  },
  body: {
    fontSize: 16,
    color: c.ink,
    lineHeight: 22,
    marginBottom: 12,
  },
  subtext: {
    fontSize: 13,
    color: c.inkSecondary,
    lineHeight: 18,
  },
});
