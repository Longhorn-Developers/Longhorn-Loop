import * as React from 'react';
import Svg, { Path, SvgProps } from 'react-native-svg';

const LhlCaretDownIcon = (props: SvgProps) => (
  <Svg width={12} height={7} viewBox="0 0 12 7" fill="none" {...props}>
    <Path
      fill="#000"
      fillRule="evenodd"
      d="M6.147 6.147a.833.833 0 0 1-1.178 0L.254 1.433A.833.833 0 1 1 1.433.254L5.558 4.38 9.683.254a.833.833 0 0 1 1.178 1.179z"
      clipRule="evenodd"
    />
  </Svg>
);

export default LhlCaretDownIcon;
