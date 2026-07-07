import { ArrowLeftIcon } from "phosphor-react-native";
import React, { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

interface FlowLayoutProps {
  title?: string;
  subTitle?: string;
  showProgressBar?: boolean;
  startingPercentage?: number; // [0, 100]
  progressBarPercentage?: number; // [0, 100]
  children?: React.ReactNode;
  onBackPress?: () => void;
}

export default function FlowLayout({
  title,
  subTitle,
  showProgressBar = false,
  startingPercentage = 0,
  progressBarPercentage = 0,
  children,
  onBackPress = () => {},
}: FlowLayoutProps) {
  const progress = useSharedValue(startingPercentage);

  useEffect(() => {
    // Reset to the starting percentage
    progress.value = startingPercentage;

    // Animate to the target percentage
    progress.value = withTiming(progressBarPercentage, {
      duration: 500,
      easing: Easing.out(Easing.cubic),
    });
  }, [startingPercentage, progressBarPercentage]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: `${progress.value}%`,
  }));

  return (
    <KeyboardAwareScrollView
      className="bg-lhlBackgroundColor"
      contentContainerStyle={{ flexGrow: 1 }}
      enableOnAndroid
      keyboardShouldPersistTaps="handled"
    >
      <View className="min-h-screen pt-[70px] px-[20px]">
        {/* Back Icon */}
        <Pressable onPress={onBackPress} className="mb-[8px]">
          <ArrowLeftIcon size={24} />
        </Pressable>

        {/* Progress Bar */}
        {showProgressBar && (
          <View className="w-full h-[10px] bg-black rounded-full overflow-hidden mt-[36px]">
            <Animated.View
              style={[
                {
                  height: "100%",
                  borderRadius: 999,
                  backgroundColor: "hsla(27, 100%, 37%, 1)",
                },
                animatedStyle,
              ]}
            />
          </View>
        )}

        {/* Title */}
        {title && (
          <Text className="mt-[42px] font-['Roboto-Flex'] font-semibold text-[32px]">
            {title}
          </Text>
        )}

        {/* Subtitle */}
        {subTitle && (
          <Text className="mt-[6px] mb-[4px] font-['Roboto-Flex'] font-semibold text-[16px]">
            {subTitle}
          </Text>
        )}

        {/* Body */}
        <View className="mt-[24px]">{children}</View>
      </View>
    </KeyboardAwareScrollView>
  );
}