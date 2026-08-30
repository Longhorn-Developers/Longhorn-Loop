import DiscoveryBucket from '@/app/components/create-event/DiscoveryBucket';
import EventPreview from '@/app/components/create-event/EventPreview';
import EventDetails from '@/app/components/create-event/EventDetails';
import InterestTags from '@/app/components/create-event/InterestTags';
import OptionalExtras from '@/app/components/create-event/OptionalExtras';
import WhenIsIt from '@/app/components/create-event/WhenIsIt';
import WhosPosting from '@/app/components/create-event/WhosPosting';
import {
  CREATE_EVENT_STEPS,
  useCreateEvent,
  type CreateEventStep,
} from '@/app/context/CreateEventContext';
import { useThemeColors } from '@/app/lib/themeColors';
import React, { useCallback, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

const STEP_SCREENS: Record<CreateEventStep, React.ComponentType> = {
  whosPosting: WhosPosting,
  discoveryBucket: DiscoveryBucket,
  interestTags: InterestTags,
  eventDetails: EventDetails,
  whenIsIt: WhenIsIt,
  optionalExtras: OptionalExtras,
};

/** How far in from the left edge a drag must start to count as a back swipe. */
const EDGE_WIDTH = 28;
/** Drag past this share of the screen, or flick faster, and the step commits. */
const COMMIT_FRACTION = 0.35;
const COMMIT_VELOCITY = 800;
const SPRING = { damping: 26, stiffness: 260, mass: 0.9 };

/** iOS's rubber band, for the step-1 case where there is nothing behind. */
function resist(overshoot: number, dimension: number): number {
  'worklet';
  return (1 - 1 / ((overshoot * 0.55) / dimension + 1)) * dimension;
}

// The create tab shows one step at a time. Because it lives under (tabs), the
// tab bar stays mounted, and the step index lives in CreateEventContext, so
// switching tabs and coming back lands on the same step with data intact.
export default function CreateEventTab() {
  const { step, stepIndex, goBack, previewing } = useCreateEvent();
  const colors = useThemeColors();
  const { width } = useWindowDimensions();

  const dragX = useSharedValue(0);
  /** Whether this particular touch began in the edge strip. */
  const fromEdge = useSharedValue(false);
  /**
   * Mounts the previous step behind the current one, but only while a back
   * swipe is actually in flight. Keeping it mounted the whole time would mean
   * two step screens live at once for the entire flow, and OptionalExtras
   * alone carries an image picker and a geocoder.
   */
  const [dragging, setDragging] = useState(false);

  const canGoBack = stepIndex > 0 && !previewing;

  const beginDrag = useCallback(() => setDragging(true), []);
  const endDrag = useCallback(() => setDragging(false), []);

  /**
   * Commit, and why there is no flash here.
   *
   * The previous screen is already rendered behind at rest. When this runs,
   * goBack() makes the FRONT layer render that same component, and dragX
   * returns to 0 in the same tick -- so even if the swap and the transform
   * land a frame apart, both layers are showing identical content and the
   * seam is invisible. Parallaxing the back layer would break exactly that.
   */
  const commitBack = useCallback(() => {
    goBack();
    dragX.value = 0;
    setDragging(false);
  }, [goBack, dragX]);

  const edgeSwipe = Gesture.Pan()
    // Claim only clear rightward drags, and let vertical scrolling win first.
    .activeOffsetX([20, 9999])
    .failOffsetY([-18, 18])
    .onBegin((e) => {
      // The gesture spans the whole screen rather than a 28pt strip laid over
      // it, because such a strip swallows every tap in the left margin --
      // including the header's back arrow. So the edge test happens here, on
      // where the finger actually landed, and everything else no-ops.
      fromEdge.value = e.x < EDGE_WIDTH;
      if (fromEdge.value) {
        // Mount the layer behind NOW, on touch-down, not on activation. The
        // pan needs 20pt of travel to activate, which buys the frames the
        // mount costs -- start it later and the first half of the drag reveals
        // an empty screen.
        runOnJS(beginDrag)();
      }
    })
    .onUpdate((e) => {
      if (!fromEdge.value) return;
      const raw = Math.max(0, e.translationX);
      // On step 1 there is nothing behind, so the screen resists instead of
      // sliding. That answers the gesture -- it says "this does move, just not
      // here" -- where ignoring it entirely reads as the app being frozen.
      dragX.value = canGoBack ? raw : resist(raw, width);
    })
    .onEnd((e) => {
      if (!fromEdge.value) return;
      const far = dragX.value > width * COMMIT_FRACTION;
      const fast = e.velocityX > COMMIT_VELOCITY;
      if (canGoBack && (far || fast)) {
        dragX.value = withTiming(width, { duration: 180 }, (finished) => {
          if (finished) runOnJS(commitBack)();
        });
      } else {
        dragX.value = withSpring(0, SPRING, (finished) => {
          if (finished) runOnJS(endDrag)();
        });
      }
    })
    .onFinalize(() => {
      // Covers the touch that never became a drag: onBegin already mounted the
      // layer behind, and without this it would sit there until the next one.
      if (fromEdge.value && dragX.value === 0) runOnJS(endDrag)();
    });

  const frontStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value }],
  }));

  // The preview replaces the step rather than stacking over it, so the tab bar
  // stays put and Back lands exactly where you left off — the step index never
  // moved. It takes no swipe: its own Back button is the way out, and a step
  // index that never moved has nothing to swipe between.
  if (previewing) return <EventPreview />;

  const StepScreen = STEP_SCREENS[step];
  const PreviousScreen = stepIndex > 0 ? STEP_SCREENS[CREATE_EVENT_STEPS[stepIndex - 1]] : null;

  return (
    <GestureHandlerRootView style={styles.fill}>
      <GestureDetector gesture={edgeSwipe}>
        <View style={styles.fill}>
          {dragging && PreviousScreen ? (
            <View style={StyleSheet.absoluteFill}>
              <PreviousScreen />
            </View>
          ) : null}

          {/* Opaque on purpose: the layer behind is a whole other screen, and
              a translucent front would show both at once through the drag. */}
          <Animated.View
            style={[styles.fill, { backgroundColor: colors.background }, frontStyle]}
          >
            <StepScreen />
          </Animated.View>
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
