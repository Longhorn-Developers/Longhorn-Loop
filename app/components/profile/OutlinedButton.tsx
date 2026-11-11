// The white outlined controls under the profile header: the Edit Profile pill
// and the linked-social squares.
//
// One component because the Figma draws them as one thing in two shapes --
// same white fill, same soft #E8E3DC hairline, same height -- and the two
// had been built separately with different borders and different radii.
//
// Style is a PLAIN OBJECT, never a `({ pressed }) => ...` callback. Every
// element in this app goes through NativeWind's jsx runtime (jsxImportSource
// in babel.config), and a function-valued style is silently dropped by it. See
// components/profile/ProfileEventCard for the same note and the bugs it cost.

import { hitSlopFor } from '@/app/lib/tapTarget';
import { useThemeColors } from '@/app/lib/themeColors';
import React, { useState } from 'react';
import { Pressable, type ViewStyle } from 'react-native';

export interface OutlinedButtonProps {
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityRole?: 'button' | 'link';
  /** Figma: 8 for the Edit Profile pill and (V4) the social squares. */
  borderRadius: number;
  /** Omit for the square controls, which take their width from height. */
  width?: number;
  gap?: number;
  children: React.ReactNode;
  style?: ViewStyle;
}

/**
 * Both shapes share one height, which is what lines the row up. 36 in the V4
 * frames (LOOP-312); it was 30 in the LOOP-180 ones. Still under the 44pt
 * floor, so the hitSlop below makes up the rest without redrawing the row.
 */
export const OUTLINED_BUTTON_HEIGHT = 36;

export default function OutlinedButton({
  onPress,
  accessibilityLabel,
  accessibilityRole = 'button',
  borderRadius,
  width,
  gap,
  children,
  style,
}: OutlinedButtonProps) {
  const colors = useThemeColors();
  const [pressed, setPressed] = useState(false);

  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={hitSlopFor(OUTLINED_BUTTON_HEIGHT, width ?? OUTLINED_BUTTON_HEIGHT)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        height: OUTLINED_BUTTON_HEIGHT,
        width: width ?? OUTLINED_BUTTON_HEIGHT,
        gap,
        borderRadius,
        borderWidth: 1,
        borderColor: colors.borderSoft,
        backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
        ...style,
      }}
    >
      {children}
    </Pressable>
  );
}
