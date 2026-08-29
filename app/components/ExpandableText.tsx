// Long text that clamps to a few lines with a "Read more" toggle.
//
// Kamsi, bug bash: event descriptions run the length of the screen and push
// everything below them — the org, the chips, the RSVP button — off the fold.
// Scraped descriptions are the worst of it; several colleges paste an entire
// press release into the field.
//
// The pattern is the one Eventbrite, Meetup and the App Store all use: clamp,
// then a text affordance with a chevron. Deliberately NOT a "..." that expands
// on tapping the text itself — an invisible hit target on a paragraph is a
// coin flip between "expand" and "I was trying to scroll".
//
// WHY THE HIDDEN MEASUREMENT PASS
//
// The toggle should only exist when the text actually overflows, otherwise a
// two-line description gets a "Read more" that reveals nothing. Knowing that
// means knowing the UNCLAMPED line count, and `onTextLayout` reports lines
// AFTER numberOfLines has truncated them on Android — so the clamped copy can
// only ever tell us "6", never "6 of 22". The fix is to lay the text out once
// with no clamp, offscreen, read the count, and render the real one. It costs
// one extra layout pass on mount and nothing after that.

import ChevronDownIcon from '@/assets/images/dropdown-arrow.svg';
import { useThemeColors } from '@/app/lib/themeColors';
import React, { useCallback, useState } from 'react';
import { Text, TouchableOpacity, View, type TextStyle } from 'react-native';

/**
 * Lines shown when collapsed. Six is about a phone-width paragraph — enough to
 * judge whether an event is worth reading, short enough that the RSVP button
 * stays on the first screen.
 */
const COLLAPSED_LINES = 6;

/**
 * Don't clamp text that only spills by a line. Hiding one line behind a tap is
 * more friction than the line costs, and a "Read more" that barely moves the
 * page reads as broken.
 */
const OVERFLOW_TOLERANCE = 1;

interface ExpandableTextProps {
  children: string;
  /** Style for the paragraph itself. Must carry a lineHeight for clean clamping. */
  style?: TextStyle;
  collapsedLines?: number;
  moreLabel?: string;
  lessLabel?: string;
}

export default function ExpandableText({
  children,
  style,
  collapsedLines = COLLAPSED_LINES,
  moreLabel = 'Read more',
  lessLabel = 'Show less',
}: ExpandableTextProps) {
  const colors = useThemeColors();
  const [totalLines, setTotalLines] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);

  const handleMeasure = useCallback((e: { nativeEvent: { lines: unknown[] } }) => {
    setTotalLines(e.nativeEvent.lines.length);
  }, []);

  // Nothing is clamped until the measurement answers. That ordering is the
  // safe one: `onTextLayout` is an iOS/Android API and react-native-web does
  // not implement it, so on web the measurement never lands. Clamping by
  // default would leave that text cut at six lines with no toggle to open it —
  // the description silently unreadable. Waiting instead degrades to exactly
  // today's behaviour (the full paragraph, no toggle), which is worth the
  // one-frame settle on mobile.
  const measured = totalLines != null;
  const overflows = measured && totalLines > collapsedLines + OVERFLOW_TOLERANCE;
  const clamped = overflows && !expanded;

  return (
    <View>
      {/* Measurement pass. Absolutely positioned so it takes no space, and
          zero-opacity + pointerEvents="none" so it is invisible and inert.
          `collapsable={false}` keeps Android from flattening the view away
          before it has laid the text out. Unmounted once it has answered. */}
      {!measured ? (
        <View
          style={{ position: 'absolute', left: 0, right: 0, opacity: 0 }}
          pointerEvents="none"
          collapsable={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text style={style} onTextLayout={handleMeasure}>
            {children}
          </Text>
        </View>
      ) : null}

      <Text style={style} numberOfLines={clamped ? collapsedLines : undefined}>
        {children}
      </Text>

      {overflows ? (
        <TouchableOpacity
          onPress={() => setExpanded((v) => !v)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={expanded ? lessLabel : moreLabel}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            alignSelf: 'flex-start',
            paddingTop: 6,
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.brand }}>
            {expanded ? lessLabel : moreLabel}
          </Text>
          {/* One asset, flipped. A separate up-chevron is a second file to keep
              in sync for a shape that is the same shape. */}
          <ChevronDownIcon
            width={16}
            height={16}
            color={colors.brand}
            style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}
          />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
