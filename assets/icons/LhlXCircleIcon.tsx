import * as React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

interface LhlXCircleProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export default function LhlXCircle({
  size = 24,
  color = 'currentColor',
  strokeWidth = 2,
}: LhlXCircleProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Outer Circle - Expanded radius to 11 to fill the 24x24 canvas */}
      <Circle cx="12" cy="12" r="11" />

      {/* Inner X Lines - Expanded coordinates from 7 to 17 for a bigger X */}
      <Path d="m17 7-10 10M7 7l10 10" />
    </Svg>
  );
}
