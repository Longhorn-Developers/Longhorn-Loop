// The two-line header every Home section shares: a small orange eyebrow that
// says WHY the row is there ("Because You Picked", "You Might Like") over the
// section name in caps, with "See all ›" on the right.
//
// The eyebrow is the point of the redesign's personalisation: a bare "Career"
// reads as generic, while "Because You Picked CAREER" tells the user the feed is
// answering something they chose. It is optional because not every section has a
// reason to give.
//
// One component for all of them so the sections can't drift apart again — Upcoming
// used to carry a different header from the bucket carousels, with no arrow at all
// (LOOP-283). Pass `onViewAll` and the arrow appears; leave it off and the section
// simply has none, rather than a dead control.

import ChevronIcon from '@/assets/images/dropdown-arrow.svg';
import { useThemeColors } from '@/app/lib/themeColors';
import React from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';

interface SectionHeaderProps {
  /** Small orange line above the title. */
  eyebrow?: string;
  title: string;
  /** Shows "See all ›" when provided. */
  onViewAll?: () => void;
  /** Outer container, e.g. the horizontal inset a carousel needs. */
  style?: StyleProp<ViewStyle>;
}

export default function SectionHeader({ eyebrow, title, onViewAll, style }: SectionHeaderProps) {
  const colors = useThemeColors();

  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
        style,
      ]}
    >
      <View style={{ flex: 1, paddingRight: 12 }}>
        {eyebrow ? (
          <Text
            style={{
              fontFamily: 'Roboto-Flex-Medium',
              fontSize: 11,
              color: colors.brand,
              marginBottom: 1,
            }}
          >
            {eyebrow}
          </Text>
        ) : null}
        {/* Caps come from here, not from the server's labels ("Career"), so the
            treatment is the same however a section is named. */}
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={{
            fontFamily: 'Roboto-Flex-Bold',
            fontSize: 18,
            letterSpacing: 0.3,
            color: colors.ink,
          }}
        >
          {title.toUpperCase()}
        </Text>
      </View>

      {onViewAll ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`See all ${title}`}
          onPress={onViewAll}
          // The glyph and label stay small; the TOUCHABLE area is what grows. The
          // control is 20pt tall by its own layout, and 12pt of slop above and
          // below brings it to 44pt (LOOP-283: "too small to hit"). hitSlop
          // extends the touch area without moving anything on screen, so the
          // header's spacing is exactly what it was. Horizontally the label is
          // already wider than 44pt; the slop there is for forgiveness.
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 2,
            minHeight: 20,
            paddingBottom: 2,
          }}
        >
          <Text style={{ fontFamily: 'Roboto-Flex-Medium', fontSize: 14, color: colors.brand }}>
            See all
          </Text>
          {/* One chevron asset, turned a quarter turn — same approach as
              ExpandableText. */}
          <ChevronIcon
            width={16}
            height={16}
            color={colors.brand}
            style={{ transform: [{ rotate: '-90deg' }] }}
          />
        </Pressable>
      ) : null}
    </View>
  );
}
