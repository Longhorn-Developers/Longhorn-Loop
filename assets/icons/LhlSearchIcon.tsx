import * as React from 'react';
import Svg, { Path } from 'react-native-svg';

interface LhlSearchIconProps {
  size?: number;
  color?: string;
}

const LhlSearchIcon = ({ size = 15, color = '#000' }: LhlSearchIconProps) => (
  <Svg width={size} height={size} fill="none" viewBox="0 0 15 15">
    <Path
      fill={color}
      d="M0 5.962A5.967 5.967 0 0 1 5.962 0a5.967 5.967 0 0 1 5.962 5.962A5.83 5.83 0 0 1 10.81 9.39l3.348 3.354c.197.205.3.476.3.77 0 .607-.447 1.076-1.07 1.076-.285 0-.57-.095-.776-.308l-3.369-3.369a5.8 5.8 0 0 1-3.281 1.01A5.967 5.967 0 0 1 0 5.963m1.523 0A4.436 4.436 0 0 0 5.962 10.4 4.436 4.436 0 0 0 10.4 5.962a4.436 4.436 0 0 0-4.438-4.439 4.436 4.436 0 0 0-4.439 4.439"
    />
  </Svg>
);

export default LhlSearchIcon;
