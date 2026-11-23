import { useThemeColors } from '@/app/lib/themeColors';
import { CaretDownIcon, CheckIcon } from 'phosphor-react-native';
import { type ComponentRef, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

/**
 * The Upcoming header's `79 · Trending ⌄` control and its dropdown (LOOP-292).
 *
 * The menu is a transparent Modal rather than an absolutely positioned child.
 * This control sits in a FlatList header, and an overflowing child there is
 * painted over by the rows that render after it (and clipped on some Android
 * builds). A Modal sits above the whole screen, and its backdrop gives
 * tap-outside-to-close for free.
 */
export type EventSort = 'trending' | 'newest' | 'az';

const OPTIONS: { id: EventSort; label: string }[] = [
  { id: 'trending', label: 'Trending' },
  { id: 'newest', label: 'Newest' },
  { id: 'az', label: 'A–Z' },
];

const MENU_WIDTH = 120;

type Props = {
  count: number;
  sort: EventSort;
  onChange: (sort: EventSort) => void;
  categoryLabel?: string;
};

export default function ExploreSortControl({ count, sort, categoryLabel, onChange }: Props) {
  const colors = useThemeColors();
  const { width: screenWidth } = useWindowDimensions();
  // RN 0.8x types: `View` is a function component now, so `useRef<View>` no longer
  // types the host instance (no measureInWindow). ComponentRef reads the real
  // ref type off the Pressable this is attached to.
  const triggerRef = useRef<ComponentRef<typeof Pressable>>(null);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);

  const open = () => {
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ top: y + height + 6, right: screenWidth - (x + width) });
    });
  };
  const close = () => setAnchor(null);

  const current = OPTIONS.find((o) => o.id === sort) ?? OPTIONS[0];

  const triggerLabel = sort === 'trending' && categoryLabel ? categoryLabel : current.label;

  return (
    <>
      <Pressable
        ref={triggerRef}
        onPress={open}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`${count} events, sorted by ${current.label}. Change sort`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
      >
        <Text className="font-roboto-semibold" style={{ fontSize: 13, color: colors.accent }}>
          {count} · {triggerLabel}
        </Text>
        <CaretDownIcon size={14} color={colors.accent} weight="bold" />
      </Pressable>

      {/* statusBarTranslucent keeps measureInWindow's y in the same coordinate
          space as the Modal on Android. */}
      <Modal
        transparent
        statusBarTranslucent
        visible={anchor !== null}
        animationType="fade"
        onRequestClose={close}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={close}
          accessibilityLabel="Close sort menu"
        />
        <View
          style={{
            position: 'absolute',
            top: anchor?.top ?? 0,
            right: anchor?.right ?? 0,
            width: MENU_WIDTH,
            backgroundColor: colors.surface,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.borderSoft,
            overflow: 'hidden',
            shadowColor: colors.ink,
            shadowOpacity: 0.15,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 },
            elevation: 6,
          }}
        >
          {OPTIONS.map((option, index) => {
            const selected = option.id === sort;
            return (
              <Pressable
                key={option.id}
                onPress={() => {
                  onChange(option.id);
                  close();
                }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopColor: colors.borderSoft,
                  backgroundColor: selected ? colors.brandSoft : colors.surface,
                }}
              >
                <Text
                  className={selected ? 'font-roboto-semibold' : 'font-roboto'}
                  style={{
                    fontSize: 14,
                    color: selected ? colors.accent : colors.inkSecondary,
                  }}
                >
                  {option.label}
                </Text>
                {selected ? <CheckIcon size={14} color={colors.accent} weight="bold" /> : null}
              </Pressable>
            );
          })}
        </View>
      </Modal>
    </>
  );
}
