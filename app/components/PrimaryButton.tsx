import { IconProps } from 'phosphor-react-native';
import React from 'react';
import { Pressable, Text, PressableProps, View } from 'react-native';

interface PrimaryButtonProps extends PressableProps {
  isFilled?: boolean;
  label?: string;
  leftIcon?: React.ReactElement<IconProps>;
  rightIcon?: React.ReactElement<IconProps>;
}

export default function PrimaryButton({
  isFilled,
  label,
  leftIcon,
  rightIcon,
  ...props
}: PrimaryButtonProps) {

  const borderColorClass = isFilled
    ? 'border-lhlBurntOrange'
    : 'border-lhlBorderColor';
  
  const backgroundColorClass = isFilled
    ? 'bg-lhlBurntOrange'
    : 'bg-white'
  
  const textColorClass = isFilled
    ? 'text-white'
    : 'text-lhlSecondaryTextGrey'
  
  const iconColorClass = isFilled
    ? 'white'
    : 'hsla(180, 9%, 31%, 1)' // lhlSecondaryTextGrey

  return (
    <Pressable 
      className={`
        flex-row items-center justify-center gap-x-2
        h-[55px] border-2 rounded-lg px-2
        ${borderColorClass}
        ${backgroundColorClass}
      `}
      {...props}
    >

      {/* Left Icon */}
      {leftIcon &&
        <View>
          {React.isValidElement(leftIcon)
            ? React.cloneElement(leftIcon, { color: iconColorClass })
            : leftIcon}
        </View>
      }

      {/* Button Label */}
      <Text
        className={`font-semibold text-xl ${textColorClass} pb-[2px]`}
      >
        {label}
      </Text>

      {/* Right Icon */}
      {rightIcon &&
        <View>
          {React.isValidElement(rightIcon)
            ? React.cloneElement(rightIcon, { color: iconColorClass })
            : rightIcon}
        </View>
      }

    </Pressable>
  );
}