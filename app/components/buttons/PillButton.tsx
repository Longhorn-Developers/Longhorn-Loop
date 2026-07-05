import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  Text,
  View,
} from 'react-native';

interface PillButtonProps {
  label: string;
  isSelected?: boolean;
  selectable?: boolean;
  onPress?: () => void;
  height?: number;
  textSize?: number;
  gap?: number;
}

export default function PillButton({
  label,
  isSelected = false,
  selectable = true,
  onPress,
  height = 26,
  textSize = 12,
  gap = 6,
}: PillButtonProps) {
  
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

  let backgroundColor = 'hsla(45, 25%, 97%, 1)';
  let borderColor = 'hsla(35, 21%, 89%, 1)';
  let borderWidth = 1;
  let textColor = '#404040';
  let iconColor = '#000000';

  if (!selectable) {
    backgroundColor = 'hsla(35, 21%, 89%, 1)';
    borderWidth = 0;
  } else if (isSelected) {
    backgroundColor = 'hsla(27, 100%, 37%, 1)';
    borderColor = 'hsla(27, 93%, 32%, 1)';
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
        paddingHorizontal: 12,
        gap: selectable ? gap : 0,
      }}
    >
      {selectable && (
        <Animated.View style={{ transform: [{ rotate: rotateInterpolate }] }}>
          <View style={{ width: 10, height: 10, justifyContent: 'center', alignItems: 'center' }}>
            <View style={{ position: 'absolute', width: 10, height: 2, backgroundColor: iconColor, borderRadius: 1 }} />
            <View style={{ position: 'absolute', width: 2, height: 10, backgroundColor: iconColor, borderRadius: 1 }} />
          </View>
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