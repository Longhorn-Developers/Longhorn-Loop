// The segmented step indicator, shared by onboarding and the create-event
// wizard.
//
// Onboarding got pills first, because a single continuous bar says how far
// along you are but not how much is left — nothing marks where the steps fall.
// The create wizard kept a continuous bar with a hardcoded percentage in each
// of its six screens ('33.33%', '66.66%', and so on), which is the same
// information rendered in a worse form, six times, with the arithmetic of the
// whole flow copied into every step.
//
// One component, one implementation. A step now says which number it is and
// how many there are, and nothing has to know how to turn that into a width.

import { useThemeColors } from '@/app/lib/themeColors';
import React, { useEffect } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const PILL_HEIGHT = 8;
const PILL_GAP = 6;

/**
 * One pill.
 *
 * Its own component so each can own its animation hooks — a `map` in the
 * parent would put hooks in a loop, which React only tolerates while the count
 * never changes.
 *
 * The initial value is the whole trick: pills behind the current one start
 * ALREADY full, and only the current one animates in. Every screen in both
 * flows is a separate mount, so without that the bar would replay the entire
 * flow from empty each time you advanced.
 */
function Pill({
  index,
  step,
  fillColor,
  trackColor,
}: {
  index: number;
  step: number;
  fillColor: string;
  trackColor: string;
}) {
  const fill = useSharedValue(index < step - 1 ? 1 : 0);

  useEffect(() => {
    fill.value = withTiming(index < step ? 1 : 0, {
      duration: 450,
      easing: Easing.out(Easing.cubic),
    });
  }, [index, step, fill]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: `${fill.value * 100}%`,
  }));

  return (
    <View
      style={{
        flex: 1,
        height: PILL_HEIGHT,
        borderRadius: 999,
        backgroundColor: trackColor,
        overflow: 'hidden',
      }}
    >
      <Animated.View
        style={[{ height: '100%', borderRadius: 999, backgroundColor: fillColor }, animatedStyle]}
      />
    </View>
  );
}

export interface StepPillsProps {
  /** 1-based position in the flow. Step 3 of 6 => step={3} totalSteps={6}. */
  step: number;
  totalSteps: number;
  style?: StyleProp<ViewStyle>;
}

export default function StepPills({ step, totalSteps, style }: StepPillsProps) {
  const colors = useThemeColors();
  const count = Math.max(totalSteps, 1);

  return (
    <View
      style={[{ width: '100%', flexDirection: 'row', gap: PILL_GAP }, style]}
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${step} of ${count}`}
      accessibilityValue={{ min: 0, max: count, now: step }}
    >
      {Array.from({ length: count }, (_, i) => (
        <Pill
          key={i}
          index={i}
          step={step}
          fillColor={colors.brand}
          trackColor={colors.placeholder}
        />
      ))}
    </View>
  );
}
