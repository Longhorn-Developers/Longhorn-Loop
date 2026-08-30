// The create wizard's step indicator: six segments, each labelled, with the
// completed ones tappable.
//
// This replaces a bare StepPills in all six screens. StepPills said how far
// along you were and nothing else -- six identical bars, no names, no way to
// get back to one except pressing the header arrow repeatedly. Onboarding
// still uses it, and should: that flow is linear and its steps have no names
// worth showing.
//
// Three states, and each is doing a job:
//   completed  filled bar + a tick above it, tappable
//   current    filled bar + a brand-coloured label
//   upcoming   track bar + a muted label
//
// The tick is what separates "done" from "here" -- both bars are filled, so
// without it the current step is only distinguishable by label colour, which
// is a thin signal at 10pt.
//
// No "Edit steps" button and no "tap a step to edit" hint. Six named,
// touchable columns already read as navigation; a caption explaining that
// would be admitting they don't.

import {
  CREATE_EVENT_STEPS,
  CREATE_EVENT_STEP_LABELS,
  useCreateEvent,
} from '@/app/context/CreateEventContext';
import type { ThemeColors } from '@/app/lib/themeColors';
import { useThemeColors } from '@/app/lib/themeColors';
import CheckIcon from '@/assets/images/segment-check.svg';
import React, { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const BAR_HEIGHT = 6;
const COLUMN_GAP = 6;
/** Platform minimum. The column is the target, not the 6pt bar inside it. */
const MIN_TAP_HEIGHT = 44;
/** Reserved above every bar so the rows stay aligned whether or not a tick shows. */
const TICK_SLOT = 14;

/**
 * One segment.
 *
 * Its own component so each can own its animation hooks -- a `map` in the
 * parent would put hooks in a loop, which React only tolerates while the count
 * never changes. Same reasoning as StepPills, which this is descended from.
 *
 * The initial value is the same trick, too: segments behind the current one
 * start ALREADY full and only the newly-reached one animates. Otherwise the
 * whole bar replays from empty on every step change, which reads as the flow
 * restarting rather than advancing.
 */
function Segment({
  index,
  stepIndex,
  direction,
  label,
  onPress,
  colors,
}: {
  index: number;
  stepIndex: number;
  direction: 'forward' | 'backward' | 'none';
  label: string;
  onPress?: () => void;
  colors: ThemeColors;
}) {
  const completed = index < stepIndex;
  const current = index === stepIndex;
  const filled = index <= stepIndex;

  /**
   * ONLY THE BAR YOU ARE ADVANCING ONTO ANIMATES IN. Everything else mounts
   * already at its final value.
   *
   * Every step is a separate mount, so a segment cannot see its own past --
   * it can only be told which way the flow just moved. Starting the current
   * bar at 0 unconditionally is what made tapping a completed step jitter: you
   * tap Poster from step 4, the indicator remounts, and the bar under Poster
   * -- which was full a frame ago and is full again a moment later -- empties
   * and refills in between.
   *
   * Forward is the one case where an entrance is honest, because that bar
   * really was empty before you pressed Continue.
   */
  const animatesIn = direction === 'forward' && current;
  const fill = useSharedValue(animatesIn ? 0 : filled ? 1 : 0);
  const [pressed, setPressed] = React.useState(false);

  useEffect(() => {
    fill.value = withTiming(filled ? 1 : 0, {
      duration: 450,
      easing: Easing.out(Easing.cubic),
    });
  }, [filled, fill]);

  const barStyle = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));

  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={
        completed
          ? `${label}, completed. Go back to this step`
          : current
            ? `${label}, current step`
            : `${label}, not reached yet`
      }
      // Plain object, never a `({ pressed }) => ...` callback: every element
      // here goes through NativeWind's jsx runtime and a function-valued style
      // is dropped by it.
      style={{
        flex: 1,
        justifyContent: 'center',
        minHeight: MIN_TAP_HEIGHT,
        opacity: pressed ? 0.55 : 1,
      }}
    >
      <View style={{ height: TICK_SLOT, alignItems: 'center', justifyContent: 'flex-end' }}>
        {completed ? <CheckIcon width={11} height={11} color={colors.brand} /> : null}
      </View>

      <View
        style={{
          height: BAR_HEIGHT,
          borderRadius: 999,
          backgroundColor: colors.placeholder,
          overflow: 'hidden',
          marginTop: 3,
        }}
      >
        <Animated.View
          style={[
            { height: '100%', borderRadius: 999, backgroundColor: colors.brand },
            barStyle,
          ]}
        />
      </View>

      <Text
        numberOfLines={1}
        style={{
          marginTop: 6,
          textAlign: 'center',
          fontSize: 10,
          lineHeight: 12,
          fontWeight: current ? '600' : '400',
          color: current ? colors.brand : completed ? colors.ink : colors.inkMuted,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export interface StepIndicatorProps {
  style?: StyleProp<ViewStyle>;
}

export default function StepIndicator({ style }: StepIndicatorProps) {
  const { stepIndex, goToStep, stepDirection } = useCreateEvent();
  const colors = useThemeColors();
  const steps = useMemo(() => CREATE_EVENT_STEPS, []);

  return (
    <View
      style={[styles.row, style]}
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${stepIndex + 1} of ${steps.length}`}
      accessibilityValue={{ min: 0, max: steps.length, now: stepIndex + 1 }}
    >
      {steps.map((key, i) => (
        <Segment
          key={key}
          index={i}
          stepIndex={stepIndex}
          direction={stepDirection}
          label={CREATE_EVENT_STEP_LABELS[key]}
          // Only completed steps are pressable. The current one has nowhere to
          // go, and an upcoming one would skip the validation that Continue
          // runs on the step you are standing on.
          onPress={i < stepIndex ? () => goToStep(i) : undefined}
          colors={colors}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: COLUMN_GAP,
  },
});
