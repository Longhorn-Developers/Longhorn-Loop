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
import React, { useCallback, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View, type LayoutChangeEvent, type TextStyle } from 'react-native';

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

interface MeasuredLine {
  text: string;
  width: number;
}

/**
 * The collapsed copy for the inline toggle: the first `collapsedLines` lines of
 * the measured layout, with the last one cut short enough that "… Read More"
 * fits after it on the same line.
 *
 * React Native cannot append a node to the end of a clamped paragraph —
 * numberOfLines truncates with its own ellipsis and leaves no room for a link —
 * so the truncation is done here, in characters, from the line widths the
 * measurement pass already reports. It is an estimate: average character width
 * of the last kept line, with 20% slack on the suffix because it is set in a
 * heavier weight. Erring short costs a few characters of text; erring long
 * would wrap "Read More" onto a fourth line, which is the thing this exists to
 * avoid.
 */
function buildInlineCollapsed(
  lines: MeasuredLine[],
  collapsedLines: number,
  containerWidth: number,
  suffix: string,
): string {
  const kept = lines.slice(0, collapsedLines);
  const head = kept
    .slice(0, -1)
    .map((l) => l.text)
    .join('');
  const last = kept[kept.length - 1];
  const lastText = last.text.replace(/\s+$/, '');
  if (!lastText) return head.replace(/\s+$/, '');

  const avgChar = last.width / lastText.length;
  const room = containerWidth - suffix.length * avgChar * 1.2;
  const keepChars = Math.max(0, Math.floor(room / avgChar));
  if (keepChars >= lastText.length) return head + lastText;

  // Back up to a word boundary so the cut doesn't land mid-word.
  const cut = lastText.slice(0, keepChars);
  const space = cut.lastIndexOf(' ');
  return head + (space > 0 ? cut.slice(0, space) : cut).replace(/\s+$/, '');
}

interface ExpandableTextProps {
  children: string;
  /** Style for the paragraph itself. Must carry a lineHeight for clean clamping. */
  style?: TextStyle;
  collapsedLines?: number;
  moreLabel?: string;
  lessLabel?: string;
  /**
   * Put the toggle at the end of the text ("discuss… Read More") instead of on
   * its own line beneath it with a chevron. Opt-in: the default layout is what
   * the create-event preview was built against.
   */
  inlineToggle?: boolean;
}

export default function ExpandableText({
  children,
  style,
  collapsedLines = COLLAPSED_LINES,
  moreLabel = 'Read more',
  lessLabel = 'Show less',
  inlineToggle = false,
}: ExpandableTextProps) {
  const colors = useThemeColors();
  const [lines, setLines] = useState<MeasuredLine[] | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const handleMeasure = useCallback((e: { nativeEvent: { lines: MeasuredLine[] } }) => {
    setLines(e.nativeEvent.lines);
  }, []);
  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    setContainerWidth(e.nativeEvent.layout.width);
  }, []);
  const totalLines = lines ? lines.length : null;

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

  const inlineCollapsed = useMemo(
    () =>
      inlineToggle && lines && clamped && containerWidth > 0
        ? buildInlineCollapsed(lines, collapsedLines, containerWidth, `… ${moreLabel}`)
        : null,
    [inlineToggle, lines, clamped, containerWidth, collapsedLines, moreLabel],
  );

  const inlineToggleStyle = { fontWeight: '600', color: colors.brand } as const;

  return (
    <View onLayout={handleLayout}>
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

      {inlineToggle && overflows ? (
        // Until the width is known the full text shows, same as before the
        // measurement lands; then it collapses to the cut copy.
        <Text style={style}>
          {inlineCollapsed ?? children}
          {inlineCollapsed != null ? '… ' : ' '}
          <Text
            onPress={() => setExpanded((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={expanded ? lessLabel : moreLabel}
            style={inlineToggleStyle}
          >
            {expanded ? lessLabel : moreLabel}
          </Text>
        </Text>
      ) : (
        <Text style={style} numberOfLines={clamped ? collapsedLines : undefined}>
          {children}
        </Text>
      )}

      {overflows && !inlineToggle ? (
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
