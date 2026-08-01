import LhlPillCross from '@/assets/icons/LhlPillCross';
import LhlPillPlus from '@/assets/icons/LhlPillPlus';
import { useThemeColors } from '@/app/lib/themeColors';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, Text } from 'react-native';

interface PillButtonProps {
  label: string;
  isSelected?: boolean;
  selectable?: boolean;
  onPress?: () => void;
  height?: number;
  textSize?: number;
  gap?: number;
  padding?: number;
  iconSize?: number;
}

export default function PillButton({
  label,
  isSelected = false,
  selectable = true,
  onPress,
  height = 26,
  textSize = 12,
  gap = 6,
  padding = 12,
  iconSize = 8,
}: PillButtonProps) {
  const colors = useThemeColors();
  const rotationAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(rotationAnim, {
      toValue: isSelected ? 1 : 0,
      duration: 200,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: true,
    }).start();
  }, [isSelected, rotationAnim]);

  const rotateInterpolate = rotationAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '45deg'],
  });

  let backgroundColor = colors.background;
  let borderColor = colors.border;
  let borderWidth = 1;
  let textColor = colors.inkSecondary;
  let iconColor = colors.ink;

  if (!selectable) {
    backgroundColor = colors.surfaceMuted;
    borderWidth = 0;
  } else if (isSelected) {
    backgroundColor = colors.brand;
    borderColor = colors.brand;
    textColor = '#FFFFFF';
    iconColor = '#FFFFFF';
  }

  return (
    <Pressable
      onPress={selectable ? onPress : undefined}
      disabled={!selectable}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        height: height,
        borderRadius: 9999,
        backgroundColor: backgroundColor,
        borderColor: borderColor,
        borderWidth: borderWidth,
        paddingHorizontal: padding,
        gap: selectable ? gap : 0,
      }}
    >
      {selectable && (
        <Animated.View
          style={{
            transform: isSelected ? [] : [{ rotate: rotateInterpolate }],
          }}
        >
          {isSelected ? (
            <LhlPillCross size={iconSize - 1} color={iconColor} />
          ) : (
            <LhlPillPlus size={iconSize} color={iconColor} />
          )}
        </Animated.View>
      )}

      <Text
        style={{
          fontFamily: 'Roboto-Flex',
          fontSize: textSize,
          fontWeight: '500',
          color: textColor,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
