import * as React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

interface LhlGearIconProps {
  size?: number;
  color?: string;
}

// Settings gear for the profile cover (LOOP-312). Outline cog, drawn on a 24
// grid so it shares stroke weight with the other 24-grid glyphs in the app.
const LhlGearIcon = ({ size = 20, color = '#000' }: LhlGearIconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M10.33 4.32c.43-1.76 2.91-1.76 3.34 0a1.72 1.72 0 0 0 2.57 1.06c1.54-.94 3.3.82 2.36 2.36a1.72 1.72 0 0 0 1.06 2.57c1.76.43 1.76 2.91 0 3.34a1.72 1.72 0 0 0-1.06 2.57c.94 1.54-.82 3.3-2.36 2.36a1.72 1.72 0 0 0-2.57 1.06c-.43 1.76-2.91 1.76-3.34 0a1.72 1.72 0 0 0-2.57-1.06c-1.54.94-3.3-.82-2.36-2.36a1.72 1.72 0 0 0-1.06-2.57c-1.76-.43-1.76-2.91 0-3.34a1.72 1.72 0 0 0 1.06-2.57c-.94-1.54.82-3.3 2.36-2.36a1.72 1.72 0 0 0 2.57-1.06Z"
      stroke={color}
      strokeWidth={1.8}
      strokeLinejoin="round"
    />
    <Circle cx={12} cy={12} r={3} stroke={color} strokeWidth={1.8} />
  </Svg>
);

export default LhlGearIcon;
