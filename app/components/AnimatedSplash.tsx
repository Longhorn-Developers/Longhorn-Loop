// Launch animation: the orange scribble clip, washed to the page colour, then
// dissolved into whatever screen index.tsx routed to.

import { useThemeColors } from '@/app/lib/themeColors';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useCallback, useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

type AnimatedSplashProps = {
  onFinish: () => void;
};

/** Skips a few frames of empty orange at the head. The clip is 3.0s @ 30fps. */
const VIDEO_START_S = 0.1;

// Video time at which the wash starts; rides the zoom-in, which accelerates
// from ~2.4s. WASH_MS lands it right as the clip ends.
const WASH_START_S = 2.45;
const WASH_MS = 480;
const DISSOLVE_MS = 420;

// If the video fails to decode, neither timeUpdate nor playToEnd ever fires and
// the splash would sit there forever.
const SAFETY_TIMEOUT_MS = 6000;

export default function AnimatedSplash({ onFinish }: AnimatedSplashProps) {
  const colors = useThemeColors();

  const splashOpacity = useRef(new Animated.Value(1)).current;
  const washOpacity = useRef(new Animated.Value(0)).current;

  // Three triggers below; the outro must only run once.
  const hasStartedOutro = useRef(false);

  const runOutro = useCallback(() => {
    if (hasStartedOutro.current) return;
    hasStartedOutro.current = true;

    Animated.sequence([
      // Orange -> page colour. Ease out so the screen is flat and settled
      // before the dissolve starts.
      Animated.timing(washOpacity, {
        toValue: 1,
        duration: WASH_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      // Both sides are the page colour, so what you see is the first screen's
      // content arriving, not the fade itself.
      Animated.timing(splashOpacity, {
        toValue: 0,
        duration: DISSOLVE_MS,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) onFinish();
    });
  }, [onFinish, splashOpacity, washOpacity]);

  const player = useVideoPlayer(
    require('../../assets/videos/loopSplashAnimation3.mov'),
    (player) => {
      player.loop = false;
      player.muted = true;
      player.audioMixingMode = 'mixWithOthers';
      player.playbackRate = 1.0;
      player.currentTime = VIDEO_START_S;

      // This interval is the jitter on WASH_START_S; at 0.1 the wash can start
      // three frames late and get clipped by the clip ending.
      player.timeUpdateEventInterval = 0.05;

      player.play();
    },
  );

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (currentTime >= WASH_START_S) runOutro();
  });

  // Backstop for a throttled timeUpdate that skips past the trigger.
  useEventListener(player, 'playToEnd', runOutro);

  useEffect(() => {
    const timer = setTimeout(runOutro, SAFETY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [runOutro]);

  return (
    <Animated.View pointerEvents="none" style={[styles.container, { opacity: splashOpacity }]}>
      <View style={[StyleSheet.absoluteFillObject, styles.orangeBackground]} />

      <VideoView player={player} style={styles.video} contentFit="contain" nativeControls={false} />

      {/* Last, so it covers the video and not just the bars. */}
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          { backgroundColor: colors.background, opacity: washOpacity },
        ]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Absolute, not flex:1 — it floats above the navigator rather than replacing it.
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },

  // The clip's own background, so the letterbox is invisible.
  orangeBackground: {
    backgroundColor: '#9B4905',
  },

  video: {
    width: '100%',
    height: '100%',
  },
});
