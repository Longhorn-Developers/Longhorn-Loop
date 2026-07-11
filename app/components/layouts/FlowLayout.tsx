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
  startingPercentage?: number;
  progressBarPercentage?: number;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  onBackPress?: () => void;
}

export default function FlowLayout({
  title,
  subTitle,
  showProgressBar = false,
  startingPercentage = 0,
  progressBarPercentage = 0,
  children,
  footer,
  onBackPress = () => {},
}: FlowLayoutProps) {
  const progress = useSharedValue(startingPercentage);

  useEffect(() => {
    progress.value = startingPercentage;

    progress.value = withTiming(progressBarPercentage, {
      duration: 500,
      easing: Easing.out(Easing.cubic),
    });
  }, [startingPercentage, progressBarPercentage, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: `${progress.value}%`,
  }));

  return (
    <View className="flex-1 bg-lhlBackgroundColor">
      <KeyboardAwareScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        enableOnAndroid
        keyboardShouldPersistTaps="handled"
      >
        <View className="min-h-screen pt-[70px] px-[20px]">
          <Pressable onPress={onBackPress} className="mb-[8px]">
            <ArrowLeftIcon size={24} />
          </Pressable>

          {showProgressBar && (
            <View className="w-full h-[10px] bg-black rounded-full overflow-hidden mt-[36px]">
              <Animated.View
                style={[
                  {
                    height: '100%',
                    borderRadius: 999,
                    backgroundColor: 'hsla(27, 100%, 37%, 1)',
                  },
                  animatedStyle,
                ]}
              />
            </View>
          )}

          {title && (
            <Text className="mt-[42px] font-['Roboto-Flex'] font-semibold text-[32px]">
              {title}
            </Text>
          )}

          {subTitle && (
            <Text className="mt-[6px] mb-[4px] font-['Roboto-Flex'] font-semibold text-[16px]">
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
