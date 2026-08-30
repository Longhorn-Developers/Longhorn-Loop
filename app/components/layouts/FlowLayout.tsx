import StepPills from '@/app/components/StepPills';
import { useThemeColors } from '@/app/lib/themeColors';
import { ArrowLeftIcon } from 'phosphor-react-native';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';

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
            <StepPills step={step} totalSteps={totalSteps} style={{ marginTop: 36 }} />
          )}

          {/* font-roboto-semibold, not font-['Roboto-Flex'] + font-semibold:
              RN can't pick a weight off a variable font, so that pair renders
              at 400 on device. Same everywhere weights are set. */}
          {title && (
            <Text className="mt-[42px] font-roboto-semibold text-[32px] text-lhlInk">{title}</Text>
          )}

          {subTitle && (
            <Text className="mb-[4px] mt-[6px] font-roboto-semibold text-[16px] text-lhlInk">
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
