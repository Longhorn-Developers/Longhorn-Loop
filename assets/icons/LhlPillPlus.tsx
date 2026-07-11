import * as React from 'react';
import Svg, { Path } from 'react-native-svg';

interface LhlPillPlusProps {
  size?: number;
  color?: string;
}

export default function LhlPillPlus({ size = 8, color = '#020B12' }: LhlPillPlusProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 8 8" fill="none">
      <Path
        fill={color}
        d="M3.429 4.571H.57a.55.55 0 0 1-.406-.164A.56.56 0 0 1 0 4a.55.55 0 0 1 .165-.407.55.55 0 0 1 .406-.164H3.43V.57q0-.242.164-.406A.56.56 0 0 1 4 0q.242 0 .407.165t.164.406V3.43H7.43q.242 0 .407.164A.55.55 0 0 1 8 4a.56.56 0 0 1-.571.571H4.57V7.43a.55.55 0 0 1-.164.407A.55.55 0 0 1 4 8a.56.56 0 0 1-.407-.165.55.55 0 0 1-.164-.406z"
      />
    </Svg>
  );
}
