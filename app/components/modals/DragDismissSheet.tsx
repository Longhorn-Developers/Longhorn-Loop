// The bottom-sheet shell: spring up, drag down to dismiss, scrim that fades
// with the drag.
//
// Extracted from ManageEventSheet, which is where all of this was worked out
// and where every comment below was earned. It moved here verbatim rather than
// being rewritten, because the behaviour is the part that cost the debugging —
// see the notes on Fabric, on the entrance flash, and on the dismiss
// afterimage. A second hand-rolled copy in ExploreFilterSheet would have
// re-learned all three the hard way.
//
// ---------------------------------------------------------------------------
// TWO SHEETS, TWO DRAG REGIONS. `dragFrom` is the only thing the two callers
// disagree about, and it exists because of what is inside them:
//
//   'sheet'  (ManageEventSheet) — four action rows, no scrolling. The pan owns
//            the whole surface, the way a system sheet with static content
//            does. activeOffsetY keeps the rows tappable.
//
//   'header' (ExploreFilterSheet) — a scrolling list of filter chips. A pan on
//            the whole sheet would be in a fight with that ScrollView for every
//            vertical gesture, and the loser is usually the list: you flick to
//            see more interests and dismiss the sheet instead. Confining the
//            pan to the grabber and header leaves the scroll view's gestures
//            completely untouched, so there is no arbitration to get wrong.
//
// The alternative — drag from anywhere, but only while the list is scrolled to
// the top — needs the pan and the scroll to run simultaneously off a tracked
// offset. It feels better when it works and its failure mode is a list that
// will not scroll, which is a worse bug than a smaller drag target.

import { useThemeColors } from '@/app/lib/themeColors';
import React, { useCallback, useEffect } from 'react';
import { Dimensions, Modal, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

/** Projected past this fraction of the sheet's own height and it closes. */
const DISMISS_FRACTION = 0.32;

/**
 * Dismissal is decided on where the drag was GOING, not where it stopped.
 * Distance and velocity as two separate tests feels wrong at both ends: a slow
 * deliberate 40% drag springs back, and a fast flick that only travelled 20pt
 * does nothing. Projecting the throw the way a scroll view does gives one
 * number both gestures agree on. Seconds, because gesture-handler reports
 * velocity in points per second.
 */
const VELOCITY_PROJECTION_S = 0.14;

/** Vertical travel before the drag takes over from a row's tap. */
const DRAG_SLOP = 8;

const SPRING = { damping: 26, stiffness: 260, mass: 0.9 };

/**
 * Where "offscreen" is before the sheet has ever been measured. Only ever a
 * fallback -- onLayout replaces it with the real height on the first frame --
 * but it has to be a real distance rather than 0, or the first open has
 * nowhere to travel from and simply appears.
 */
const OFFSCREEN = Dimensions.get('window').height;

/**
 * iOS's rubber band. Pulling UP past the top yields less and less,
 * asymptotically, so the sheet feels attached to the bottom edge rather than
 * rigid (reads as broken) or loose (peels off and shows the backdrop under it).
 */
function resist(overshoot: number, dimension: number): number {
  'worklet';
  return (1 - 1 / ((overshoot * 0.55) / dimension + 1)) * dimension;
}

export interface DragDismissSheetProps {
  visible: boolean;
  /** Called once the sheet has finished sliding out, never at the start of it. */
  onClose: () => void;
  /**
   * Where the pan lives. 'sheet' is the whole surface; 'header' is the grabber
   * plus whatever `header` renders. Use 'header' whenever the content scrolls.
   */
  dragFrom?: 'sheet' | 'header';
  /** Rendered under the grabber, inside the drag region when dragFrom='header'. */
  header?: React.ReactNode;
  children: React.ReactNode;
  /** Extra style for the sheet surface — padding, maxHeight, and the like. */
  sheetStyle?: ViewStyle;
}

export default function DragDismissSheet({
  visible,
  onClose,
  dragFrom = 'sheet',
  header,
  children,
  sheetStyle: sheetStyleOverride,
}: DragDismissSheetProps) {
  const colors = useThemeColors();

  /**
   * GESTURE-HANDLER AND REANIMATED, after two failed attempts with
   * PanResponder + Animated.
   *
   * app.json runs newArchEnabled. Under Fabric, once a native animated node
   * owns a view's transform, a setValue() from JS is not reliably delivered to
   * that view -- so the entrance spring played, and then every frame of the
   * drag wrote a value nothing read. The gesture was firing the whole time and
   * moving nothing, which is why the second attempt felt identical to the
   * first.
   *
   * Shared values do not have that failure mode: the drag and the springs are
   * the same value on the same (UI) thread. This mirrors the swipe in
   * app/notifications.tsx, which is the one gesture in this codebase already
   * proven to work on device.
   *
   * GestureHandlerRootView is REQUIRED here and is the usual reason a gesture
   * silently does nothing inside a Modal: a Modal is its own native view
   * hierarchy, so the root view at the top of the app does not cover it.
   */
  /**
   * STARTS OFFSCREEN, NOT AT REST, and that is the whole fix for the flash on
   * open.
   *
   * This was useSharedValue(0) -- the sheet's resting position. Effects run
   * AFTER paint, so the Modal mounted and painted one frame of the finished
   * sheet sitting exactly where it ends up, and only then did the effect yank
   * it down to spring back up. A single frame of the completed thing before it
   * animates in, which is what "freeze frame" describes precisely.
   */
  const translateY = useSharedValue(OFFSCREEN);
  const startY = useSharedValue(0);
  const sheetH = useSharedValue(0);

  const finishClose = useCallback(() => {
    // Deliberately does NOT reset translateY. It used to, and that was the
    // afterimage on dismiss: the slide-down finished with the sheet offscreen,
    // this snapped it back to fully visible, and the Modal only unmounted once
    // React had processed onClose -- painting the sheet back in place for those
    // frames in between. Parking it offscreen is the effect's job below.
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (visible) {
      translateY.value = sheetH.value || OFFSCREEN;
      translateY.value = withSpring(0, SPRING);
    } else {
      // Park it offscreen while hidden, so the next open cannot paint a frame
      // at rest before its effect runs. Without this the flash comes back on
      // every open after the first, because translateY is still 0 from
      // whatever closed it.
      translateY.value = sheetH.value || OFFSCREEN;
    }
  }, [visible, translateY, sheetH]);

  const closeWithSlide = useCallback(() => {
    translateY.value = withTiming(sheetH.value || 400, { duration: 180 }, (finished) => {
      if (finished) runOnJS(finishClose)();
    });
  }, [translateY, sheetH, finishClose]);

  /**
   * activeOffsetY is what lets the action rows keep their taps: the pan does
   * not activate until the finger has travelled 8pt vertically, so a press
   * never becomes a drag. failOffsetX gives up entirely on a clearly sideways
   * movement. This is the part PanResponder made hard and gesture-handler
   * makes declarative.
   *
   * activeOffsetY is what keeps a header-mode drag region usable as a header:
   * "Clear all" sits inside it, and without the 8pt threshold every press on it
   * would risk becoming a drag.
   */
  const pan = Gesture.Pan()
    .activeOffsetY([-DRAG_SLOP, DRAG_SLOP])
    .failOffsetX([-24, 24])
    .onStart(() => {
      // Catch a sheet mid-flight where it actually is, rather than snapping.
      startY.value = translateY.value;
    })
    .onUpdate((e) => {
      const raw = startY.value + e.translationY;
      // Down tracks the finger exactly; up resists.
      translateY.value = raw >= 0 ? raw : -resist(-raw, sheetH.value || 400);
    })
    .onEnd((e) => {
      const height = sheetH.value || 400;
      const projected = translateY.value + e.velocityY * VELOCITY_PROJECTION_S;
      if (projected > height * DISMISS_FRACTION) {
        translateY.value = withTiming(height, { duration: 180 }, (finished) => {
          if (finished) runOnJS(finishClose)();
        });
      } else {
        translateY.value = withSpring(0, SPRING);
      }
    });

  const animatedSheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  // The scrim fades with the drag, so a half-dismissed sheet looks half
  // dismissed rather than fully modal right up until it vanishes.
  const backdropStyle = useAnimatedStyle(() => {
    // Same fallback as the sheet. Reading a bare 1 before measurement made the
    // scrim snap to full black on the first open while the sheet was still
    // sliding, so the two halves of the entrance disagreed for a few frames.
    const height = sheetH.value || OFFSCREEN;
    return { opacity: Math.max(0, 1 - translateY.value / height) };
  });

  const grabber = (
    <View style={styles.grabberArea}>
      <View style={[styles.grabber, { backgroundColor: colors.ink }]} />
    </View>
  );

  // The grabber and header are the drag region in 'header' mode, so they are
  // wrapped together — a grabber you cannot drag from is the one thing this
  // must never render.
  const top =
    dragFrom === 'header' ? (
      <GestureDetector gesture={pan}>
        <View>
          {grabber}
          {header}
        </View>
      </GestureDetector>
    ) : (
      <>
        {grabber}
        {header}
      </>
    );

  const surface = (
    <Animated.View
      style={[
        styles.sheet,
        { backgroundColor: colors.surface },
        sheetStyleOverride,
        animatedSheetStyle,
      ]}
      onLayout={(e) => {
        sheetH.value = e.nativeEvent.layout.height;
      }}
    >
      {top}
      {children}
    </Animated.View>
  );

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={closeWithSlide}>
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        {/* Tapping the dimmed area closes, which is what a bottom sheet trains
            people to expect. */}
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={closeWithSlide}
            accessibilityLabel="Close"
          />
        </Animated.View>

        {dragFrom === 'sheet' ? (
          <GestureDetector gesture={pan}>{surface}</GestureDetector>
        ) : (
          surface
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    // absoluteFill: RN 0.83 (SDK 57) deleted absoluteFillObject at runtime,
    // so spreading it here contributed nothing and the backdrop was
    // unpositioned.
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.4)', // theme-exempt: scrim over both themes
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  grabberArea: {
    // 12 above + 13 below is the Figma's spacing around the pill.
    paddingTop: 12,
    paddingBottom: 13,
    alignItems: 'center',
  },
  grabber: {
    width: 81,
    height: 5,
    borderRadius: 999,
  },
});
