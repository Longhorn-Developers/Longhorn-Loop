import { IconProps } from 'phosphor-react-native';
import React from 'react';
import { ActivityIndicator, Pressable, PressableProps, Text, View } from 'react-native';

interface PrimaryButtonProps extends PressableProps {
  isFilled?: boolean;
  label?: string;
  loadingLabel?: string;
  leftIcon?: React.ReactElement<IconProps>;
  rightIcon?: React.ReactElement<IconProps>;
  isLoading?: boolean;
}

export default function PrimaryButton({
  isFilled,
  label,
  loadingLabel,
  leftIcon,
  rightIcon,
  isLoading = false,
  disabled,
  ...props
}: PrimaryButtonProps) {
  const borderColorClass = isFilled ? 'border-lhlBurntOrange' : 'border-lhlBorderColor';

  const backgroundColorClass = isFilled ? 'bg-lhlBurntOrange' : 'bg-white';

  const textColorClass = isFilled ? 'text-white' : 'text-lhlSecondaryTextGrey';

  const iconColorClass = isFilled ? 'white' : 'hsla(180, 9%, 31%, 1)'; // lhlSecondaryTextGrey

  const displayedText = isLoading ? loadingLabel || label : label;

  return (
    <Pressable
      className={`flex-row items-center justify-center gap-x-2 h-[55px] border-2 rounded-lg px-2 relative ${borderColorClass} ${backgroundColorClass}`}
      disabled={disabled || isLoading}
      {...props}
    >
      <View className="flex-row items-center justify-center gap-x-2">
        {isLoading ? (
          <ActivityIndicator color={iconColorClass} size="small" />
        ) : (
          leftIcon && (
            <View>
              {React.isValidElement(leftIcon)
                ? React.cloneElement(leftIcon, { color: iconColorClass })
                : leftIcon}
            </View>
          )
        )}

        <Text className={`font-['Roboto-Flex'] font-semibold text-xl ${textColorClass} pb-[2px]`}>
          {displayedText}
        </Text>

        {!isLoading && rightIcon && (
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
