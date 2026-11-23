// A short message pill that fades in, holds, and fades itself out.
//
// It started as the event screen's share/RSVP pill, which popped in and out
// with no animation. That was fine for "Link copied", but the same pill now
// also answers taps on people's faces ("User view not available right now"),
// and a message that blinks out mid-read looks like a glitch. A fade reads as
// "this went away on purpose".
//
// The caller owns the message: pass a string to show it, and clear it in
// onHide. Passing a NEW string while one is showing restarts the timer with the
// new text, so back-to-back errors don't cut each other off.
//
// Built on RN Animated rather than Reanimated to match RsvpSuccessToast, the
// other transient overlay on the event screen.

import type { ThemeColors } from '@/app/lib/themeColors';
import { useThemeColors } from '@/app/lib/themeColors';
import { useAnimatedValue } from '@/app/lib/useAnimatedValue';
import React, { useEffect, useMemo } from 'react';
import { Animated, Easing } from 'react-native';

const FADE_IN_MS = 180;
const FADE_OUT_MS = 400;
/** How long the message sits at full opacity before fading. */
const DEFAULT_HOLD_MS = 2200;

interface FadingNoticeProps {
  message: string | null;
  /** Called once the fade-out finishes. Clear the message here. */
  onHide: () => void;
  /** Distance from the bottom of the parent. Clear any bottom action bar. */
  bottom?: number;
  holdMs?: number;
}

export default function FadingNotice({
  message,
  onHide,
  bottom = 96,
  holdMs = DEFAULT_HOLD_MS,
}: FadingNoticeProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const opacity = useAnimatedValue(0);

  useEffect(() => {
    if (!message) {
      opacity.setValue(0);
      return;
    }

    const animation = Animated.sequence([
      Animated.timing(opacity, {
        toValue: 1,
        duration: FADE_IN_MS,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.delay(holdMs),
      Animated.timing(opacity, {
        toValue: 0,
        duration: FADE_OUT_MS,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }),
    ]);
    // `finished` is false when a new message (or unmount) stopped this run.
    // Only a fade that actually completed should clear the message, or a
    // replacement message would be wiped the moment it arrived.
    animation.start(({ finished }) => {
      if (finished) onHide();
    });
    return () => animation.stop();
  }, [message, holdMs, opacity, onHide]);

  if (!message) return null;

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[styles.wrapper, { bottom, opacity }]}
    >
      <Animated.Text accessibilityRole="alert" style={styles.text}>
        {message}
      </Animated.Text>
    </Animated.View>
  );
}

const makeStyles = (c: ThemeColors) => ({
  wrapper: {
    position: 'absolute' as const,
    left: 16,
    right: 16,
    alignItems: 'center' as const,
    zIndex: 100,
  },
  // Inverted colours (ink on surface) so it stands off the page in both themes.
  text: {
    backgroundColor: c.ink,
    color: c.surface,
    fontSize: 13,
    fontWeight: '600' as const,
    textAlign: 'center' as const,
    borderRadius: 999,
    overflow: 'hidden' as const,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
});
