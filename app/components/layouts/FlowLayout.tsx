import { useThemeColors } from '@/app/lib/themeColors';
import { ArrowLeftIcon } from 'phosphor-react-native';
import React, { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

interface FlowLayoutProps {
  title?: string;
  subTitle?: string;
  showProgressBar?: boolean;
  /** 1-based position in the flow. Step 3 of 4 => step={3} totalSteps={4}. */
  step?: number;
  totalSteps?: number;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  onBackPress?: () => void;
}

const SEGMENT_HEIGHT = 8;
const SEGMENT_GAP = 6;

/**
 * One notch of the step indicator.
 *
 * Its own component so each segment can own its animation hooks — a `map` over
 * segments inside the parent would put hooks in a loop, which React only
 * tolerates while the count never changes.
 *
 * The initial value is the whole trick: segments behind the current one start
 * ALREADY full, and only the current one animates in. Each onboarding screen is
 * a separate mount (they are pushed onto a stack), so without that the bar would
 * replay the entire flow from empty on every screen.
 */
function ProgressSegment({
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
        height: SEGMENT_HEIGHT,
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

export default function FlowLayout({
  title,
  subTitle,
  showProgressBar = false,
  step = 1,
  totalSteps = 4,
  children,
  footer,
  onBackPress = () => {},
}: FlowLayoutProps) {
  const colors = useThemeColors();

  // A single continuous bar told you how far along you were but not how much
  // was left, because nothing marked where the steps fell. Segments answer
  // "three more screens" at a glance, which is the question people actually
  // have when they are deciding whether to finish now or later.
  const segments = Array.from({ length: Math.max(totalSteps, 1) }, (_, i) => i);

  return (
    <View className="flex-1 bg-lhlBackgroundColor">
      <KeyboardAwareScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        enableOnAndroid
        keyboardShouldPersistTaps="handled"
      >
        <View className="min-h-screen pt-[70px] px-[20px]">
          <Pressable onPress={onBackPress} className="mb-[8px]">
            <ArrowLeftIcon size={24} color={colors.ink} />
          </Pressable>

          {showProgressBar && (
            <View
              className="w-full flex-row mt-[36px]"
              style={{ gap: SEGMENT_GAP }}
              accessibilityRole="progressbar"
              accessibilityLabel={`Step ${step} of ${totalSteps}`}
              accessibilityValue={{ min: 0, max: totalSteps, now: step }}
            >
              {segments.map((i) => (
                <ProgressSegment
                  key={i}
                  index={i}
                  step={step}
                  fillColor={colors.brand}
                  trackColor={colors.placeholder}
                />
              ))}
            </View>
          )}

          {title && (
            <Text className="mt-[42px] font-['Roboto-Flex'] text-[32px] font-semibold text-lhlInk">
              {title}
            </Text>
          )}

          {subTitle && (
            <Text className="mb-[4px] mt-[6px] font-['Roboto-Flex'] text-[16px] font-semibold text-lhlInk">
              {subTitle}
            </Text>
          )}

          <View>{children}</View>
        </View>
      </KeyboardAwareScrollView>

      {footer && <View className="px-[20px]">{footer}</View>}
    </View>
  );
}
