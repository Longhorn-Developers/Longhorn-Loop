// The settings panel that pulls in from the right edge, TikTok-style.
//
// WHAT IT REPLACES. The profile's hamburger opened a 220pt dropdown with two
// links, each of which pushed a full screen. Three taps and two screen
// transitions to reach a toggle, and the only way in was hitting a 28pt target
// in the corner. Nothing about it responded to the gesture people now expect
// from a right-hand menu.
//
// This wraps the profile's content rather than sitting over it, for the same
// reason the create wizard's back-swipe does: an overlay big enough to catch
// an edge gesture is also big enough to swallow every tap underneath it. As a
// wrapper the gesture sees the touch first and passes it on when it isn't a
// drag.
//
// The panel holds the real settings hub, not a copy of it. SettingsEntryScreen
// takes an onBack prop so the same component serves the /settings route and
// this drawer, and the org list inside it stays one implementation.

import SettingsEntryScreen from '@/app/settings/index';
import { useThemeColors } from '@/app/lib/themeColors';
import React, { useCallback, useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

/** How far in from the right edge a drag must start to open the drawer. */
const EDGE_WIDTH = 28;
/** Travel before the pan takes over, so a tap is never a drag. */
const DRAG_SLOP = 8;
/** Past this share of the panel, or a fast enough flick, the drawer commits. */
const COMMIT_FRACTION = 0.4;
const COMMIT_VELOCITY = 700;
const SPRING = { damping: 26, stiffness: 260, mass: 0.9 };
/** Scrim at full open. */
const SCRIM_OPACITY = 0.45;

export interface SettingsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export default function SettingsDrawer({ open, onOpenChange, children }: SettingsDrawerProps) {
  const colors = useThemeColors();
  const { width } = useWindowDimensions();

  // Wide enough to read a settings row, narrow enough that the profile stays
  // visible behind it — the sliver of page is what says this is a drawer over
  // your profile rather than a new screen.
  const panelWidth = Math.min(width * 0.86, 380);

  /**
   * ONE VALUE FOR EVERYTHING: 0 is fully open, panelWidth is closed.
   *
   * Drag, spring and the scrim all read it, so a half-dragged drawer is a real
   * state rather than an animation playing over a boolean. Starting CLOSED
   * (not 0) matters for the same reason it did on the Manage Event sheet:
   * effects run after paint, so a value of 0 would paint one frame of the open
   * drawer before anything animated it.
   */
  const x = useSharedValue(panelWidth);
  const startX = useSharedValue(0);
  const dragging = useSharedValue(false);

  const setOpen = useCallback((next: boolean) => onOpenChange(next), [onOpenChange]);

  // Follows the prop, so the hamburger still works and so does anything else
  // that wants to open it.
  useEffect(() => {
    x.value = withSpring(open ? 0 : panelWidth, SPRING);
  }, [open, panelWidth, x]);

  const pan = Gesture.Pan()
    .activeOffsetX([-DRAG_SLOP, DRAG_SLOP])
    .failOffsetY([-20, 20])
    .onBegin((e) => {
      // Open: a drag anywhere on the panel can push it back. Closed: only a
      // drag that starts within EDGE_WIDTH of the right edge counts, so the
      // rest of the profile keeps its taps and its vertical scroll.
      dragging.value = open || e.x > width - EDGE_WIDTH;
    })
    .onStart(() => {
      startX.value = x.value;
    })
    .onUpdate((e) => {
      if (!dragging.value) return;
      // Clamped both ways: the panel cannot be dragged past open, and cannot
      // be pushed further right than gone.
      const next = startX.value + e.translationX;
      x.value = Math.min(Math.max(next, 0), panelWidth);
    })
    .onEnd((e) => {
      if (!dragging.value) return;
      // Decided on the projected throw, not the raw position, so a short fast
      // flick commits the same way a long slow drag does.
      const projected = x.value + e.velocityX * 0.12;
      const shouldOpen =
        e.velocityX < -COMMIT_VELOCITY
          ? true
          : e.velocityX > COMMIT_VELOCITY
            ? false
            : projected < panelWidth * (1 - COMMIT_FRACTION);
      x.value = withSpring(shouldOpen ? 0 : panelWidth, SPRING);
      runOnJS(setOpen)(shouldOpen);
    });

  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  const scrimStyle = useAnimatedStyle(() => {
    const progress = 1 - x.value / panelWidth;
    return {
      opacity: progress * SCRIM_OPACITY,
      // Untouchable while closed, so the profile underneath keeps every tap.
      pointerEvents: progress > 0.01 ? ('auto' as const) : ('none' as const),
    };
  });

  const close = useCallback(() => {
    x.value = withTiming(panelWidth, { duration: 180 });
    setOpen(false);
  }, [panelWidth, setOpen, x]);

  return (
    <GestureHandlerRootView style={styles.fill}>
      <GestureDetector gesture={pan}>
        <View style={styles.fill}>
          {children}

          <Animated.View
            style={[
              StyleSheet.absoluteFillObject,
              // theme-exempt: a scrim is black over both themes.
              { backgroundColor: '#000' },
              scrimStyle,
            ]}
            onTouchEnd={close}
          />

          <Animated.View
            style={[
              styles.panel,
              { width: panelWidth, backgroundColor: colors.background },
              panelStyle,
            ]}
          >
            <SettingsEntryScreen onBack={close} />
          </Animated.View>
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    // A left edge, because the panel's right side is the screen's.
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: 'rgba(0,0,0,0.15)', // theme-exempt: hairline over both
  },
});
