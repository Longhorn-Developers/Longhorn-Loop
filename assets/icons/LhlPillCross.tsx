import * as React from 'react';
import Svg, { Path } from 'react-native-svg';

interface LhlPillCrossProps {
  size?: number;
  color?: string;
}

export default function LhlPillCross({ size = 7, color = '#FFFFFF' }: LhlPillCrossProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 7 7" fill="none">
      <Path
        fill={color}
        d="M3.5 4.245.892 6.854A.5.5 0 0 1 .519 7a.5.5 0 0 1-.373-.146A.5.5 0 0 1 0 6.48q0-.226.146-.373L2.755 3.5.146.892A.5.5 0 0 1 0 .519Q0 .293.146.146A.5.5 0 0 1 .52 0q.225 0 .373.146L3.5 2.755 6.108.146A.5.5 0 0 1 6.48 0q.226 0 .373.146A.5.5 0 0 1 7 .52q0 .225-.146.373L4.245 3.5l2.609 2.608A.5.5 0 0 1 7 6.481q0 .226-.146.373A.5.5 0 0 1 6.48 7a.5.5 0 0 1-.373-.146z"
      />
    </Svg>
  );
}
