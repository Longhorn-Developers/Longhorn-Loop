import { IconProps } from 'phosphor-react-native';
import React from 'react';
import { ActivityIndicator, Pressable, PressableProps, Text, View } from 'react-native';

interface PrimaryButtonProps extends PressableProps {
  isFilled?: boolean;
  label?: string;
  leftIcon?: React.ReactElement<IconProps>;
  rightIcon?: React.ReactElement<IconProps>;
  isLoading?: boolean;
}

export default function PrimaryButton({
  isFilled,
  label,
  leftIcon,
  rightIcon,
  isLoading = false,
  disabled,
  ...props
}: PrimaryButtonProps) {

  const borderColorClass = isFilled
    ? 'border-lhlBurntOrange'
    : 'border-lhlBorderColor';
  
  const backgroundColorClass = isFilled
    ? 'bg-lhlBurntOrange'
    : 'bg-white';
  
  const textColorClass = isFilled
    ? 'text-white'
    : 'text-lhlSecondaryTextGrey';
  
  const iconColorClass = isFilled
    ? 'white'
    : 'hsla(180, 9%, 31%, 1)'; // lhlSecondaryTextGrey

  return (
    <Pressable 
      disabled={disabled || isLoading} 
      className={`
        flex-row items-center justify-center gap-x-2
        h-[55px] border-2 rounded-lg px-2 relative
        ${borderColorClass}
        ${backgroundColorClass}
      `}
      {...props}
    >
      {/* Absolute overlay container for the spinner */}
      {isLoading && (
        <View className="absolute inset-0 flex items-center justify-center z-10">
          <ActivityIndicator color={iconColorClass} size="small" />
        </View>
      )}

      {/* Content wrapper that dims when loading */}
      <View className={`flex-row items-center justify-center gap-x-2 ${isLoading ? 'opacity-60' : 'opacity-100'}`}>
        {leftIcon && (
          <View>
            {React.isValidElement(leftIcon)
              ? React.cloneElement(leftIcon, { color: iconColorClass })
              : leftIcon}
          </View>
        )}

        <Text className={`font-['Roboto-Flex'] font-semibold text-xl ${textColorClass} pb-[2px]`}>
          {label}
        </Text>

        {rightIcon && (
          <View>
            {React.isValidElement(rightIcon)
              ? React.cloneElement(rightIcon, { color: iconColorClass })
              : rightIcon}
          </View>
        )}
      </View>
    </Pressable>
  );
}