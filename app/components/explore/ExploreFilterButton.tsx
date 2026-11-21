import { useThemeColors } from '@/app/lib/themeColors';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

/**
 * The Explore filter button (LOOP-292): a 22px square at the right end of the
 * search bar, with a count badge once filters are applied.
 *
 * 22 is the Figma size, well under the 44pt floor, so hitSlop supplies the
 * rest. The badge values (9.5px circle, 7px digit) are Figma's too.
 *
 * The pressed state is React state, not a ({ pressed }) style function:
 * NativeWind's jsx runtime drops function-valued styles. Pressed OR sheet-open
 * lights the button so a tap visibly lands (#487).
 */
const BUTTON_SIZE = 22;
const BADGE_SIZE = 9.5;
const BADGE_DIGIT_SIZE = 7;

function SliderGlyph({ color }: { color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 7h10M18 7h2M4 17h4M12 17h8"
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
      />
      <Path
        d="M16 4.8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4ZM10 14.8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4Z"
        stroke={color}
        strokeWidth={1.9}
      />
    </Svg>
  );
}

type Props = {
  /** Active filter groups for whichever sheet the button opens. */
  activeCount: number;
  /** Whether that sheet is open, so the button stays lit while it is. */
  open: boolean;
  onPress: () => void;
};

export default function ExploreFilterButton({ activeCount, open, onPress }: Props) {
  const colors = useThemeColors();
  const [pressed, setPressed] = useState(false);
  const engaged = pressed || open;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      hitSlop={11}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={
        activeCount === 0
          ? 'Filters'
          : `Filters, ${activeCount} active filter group${activeCount === 1 ? '' : 's'}`
      }
      style={{
        width: BUTTON_SIZE,
        height: BUTTON_SIZE,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6,
        borderWidth: 1,
        borderColor: engaged ? colors.brand : colors.segmentTrack,
        backgroundColor: engaged ? colors.brandSoft : colors.segmentTrack,
      }}
    >
      <SliderGlyph color={engaged ? colors.accent : colors.inkSecondary} />
      {activeCount > 0 ? (
        <View
          style={{
            position: 'absolute',
            top: -3,
            right: -3,
            minWidth: BADGE_SIZE,
            height: BADGE_SIZE,
            paddingHorizontal: 2,
            borderRadius: 999,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.brand,
          }}
        >
          <Text style={{ fontSize: BADGE_DIGIT_SIZE, fontWeight: '700', color: colors.surface }}>
            {activeCount}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
