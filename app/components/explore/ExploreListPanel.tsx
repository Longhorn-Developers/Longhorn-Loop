// The list of events at one venue, opened by tapping a counted cluster.
//
// Design: "Events in View" — Explore map, treatment D, three resting heights.
//
// ---------------------------------------------------------------------------
// SCOPE: ONE CLUSTER, NOT THE VIEWPORT.
//
// An earlier version of this synced to the camera box and listed everything on
// screen. It doesn't any more, and the reason is worth keeping: the list
// changed on every pan, which meant every settled gesture set state on the
// Explore screen and re-rendered the map and a sixty-row SectionList with a
// freshly-identified sections array. That was the jitter.
//
// Now it opens from a cluster, shows that building's events, and closes. Its
// contents change only when a different cluster is tapped, so panning the map
// costs nothing at all.
//
// Individual pins do NOT open this. They get EventMiniCard, the way they always
// did — one event is a card, a building is a list.
//
// ---------------------------------------------------------------------------
// HOW THE HEIGHTS WORK. Laid out once at full height and moved with
// translateY; peek and half are larger translations. Animating `height` would
// relayout the list on every frame of a drag. Dragging below peek dismisses —
// this panel does have a closed state, unlike the resting-only version these
// comments used to describe.
//
// WHERE THE DRAG LIVES. Grabber and header only. The body is a scrolling list,
// and a pan over it has to arbitrate for every vertical gesture, with a list
// that won't scroll as the failure mode.

import type { ApiEvent } from '@/app/components/EventCard';
import { formatEventDate } from '@/app/components/EventCard';
import EventFlyerPlaceholder from '@/app/components/EventFlyerPlaceholder';
import { useThemeColors } from '@/app/lib/themeColors';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

export type PanelDetent = 'peek' | 'half' | 'full';

/**
 * Fractions of the MAP AREA each detent shows — not of the window. The panel
 * sits inside the map, which is the window minus Explore's pinned header;
 * measuring the window instead put the full detent's top edge above its own
 * container and stranded the grabber off-screen.
 *
 * `peek` is a FALLBACK only, for the frame before the header is measured.
 * Peek's real height is the header's own — see peekHeight below.
 */
const DETENT_FRACTION: Record<PanelDetent, number> = {
  peek: 0.12,
  half: 0.5,
  full: 0.86,
};

const SPRING = { damping: 26, stiffness: 240, mass: 0.9 };

/** Vertical travel before the drag takes over from a tap on the header. */
const DRAG_SLOP = 8;

/** Where a throw was heading, in seconds of travel. */
const VELOCITY_PROJECTION_S = 0.12;

/**
 * How far past peek a throw has to project before the panel closes instead of
 * snapping back. Generous, because dismissing something you meant to keep is
 * more annoying than a snap-back you have to repeat.
 */
const DISMISS_MARGIN = 90;

function CloseGlyph({ color }: { color: string }) {
  return (
    <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
      <Path d="M6 6l12 12M18 6L6 18" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}

export interface ExploreListPanelProps {
  visible: boolean;
  /** The tapped cluster's events — the ones the filters kept. */
  events: ApiEvent[];
  onClose: () => void;
  onSelectEvent: (eventId: number) => void;
}

export default function ExploreListPanel({
  visible,
  events,
  onClose,
  onSelectEvent,
}: ExploreListPanelProps) {
  const colors = useThemeColors();
  const { height: windowHeight } = useWindowDimensions();

  const [availableHeight, setAvailableHeight] = useState(0);

  /**
   * Peek shows the header and nothing else, so its height IS the header's.
   *
   * Measured rather than given a fraction: a fraction that looks right on one
   * phone leaves a sliver of a cut-off row on the next, and breaks outright at
   * large accessibility text sizes — the header grows, the fraction doesn't,
   * and the count it exists to show gets clipped.
   */
  const [headerHeight, setHeaderHeight] = useState(0);

  const panelHeight = Math.round(availableHeight * DETENT_FRACTION.full);

  const offsets = useMemo(() => {
    const peekHeight =
      headerHeight > 0 ? headerHeight : Math.round(availableHeight * DETENT_FRACTION.peek);
    return {
      peek: panelHeight - peekHeight,
      half: panelHeight - Math.round(availableHeight * DETENT_FRACTION.half),
      // Clamped so the panel can never be dragged above its own container.
      full: Math.max(0, panelHeight - availableHeight),
    };
  }, [panelHeight, availableHeight, headerHeight]);

  /** Opens at half: you tapped a cluster to read its events, and peek shows none. */
  const [detent, setDetent] = useState<PanelDetent>('half');

  /**
   * Starts below the fold. A shared value takes its initial value on the first
   * render, when availableHeight is 0 and every offset is 0 — the FULL detent —
   * so seeding it from `offsets` would paint one frame of a fully-open panel.
   */
  const translateY = useSharedValue(windowHeight);
  const dragStart = useSharedValue(0);

  const sorted = useMemo(
    () =>
      [...events].sort(
        (a, b) => new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime(),
      ),
    [events],
  );

  /**
   * The building's name, off the events rather than passed in.
   *
   * There is no venue entity to ask: the coordinate came from a building lookup
   * at ingest and only the location string survived onto the row. Every event
   * here shares a coordinate, so any of their strings names the same place.
   */
  const venueName = useMemo(() => {
    const named = sorted.find((e) => e.location_short || e.location_full);
    return named?.location_short ?? named?.location_full ?? 'This location';
  }, [sorted]);

  const settle = useCallback(
    (next: PanelDetent) => {
      setDetent(next);
      translateY.value = withSpring(offsets[next], SPRING);
    },
    [offsets, translateY],
  );

  const closeWithSlide = useCallback(() => {
    translateY.value = withTiming(panelHeight, { duration: 180 }, (finished) => {
      if (finished) runOnJS(onClose)();
    });
  }, [translateY, panelHeight, onClose]);

  /**
   * Open and close animations, plus re-settling when the container resizes.
   *
   * Reopening always starts from below rather than from wherever the last close
   * left it, so a cluster tap always reads as the panel arriving.
   */
  useEffect(() => {
    if (availableHeight === 0) return;
    if (visible) {
      setDetent('half');
      translateY.value = panelHeight;
      translateY.value = withSpring(offsets.half, SPRING);
    } else {
      translateY.value = panelHeight;
    }
    // Deliberately keyed on `visible` and the measurements only: adding
    // `detent` would re-run this on every drag and yank the panel back to half.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, availableHeight, panelHeight, offsets.half]);

  /**
   * Snap to whichever detent the throw was heading for, or close.
   *
   * Nearest-by-projection rather than "one step up/down": a hard flick from
   * peek should reach full, and a small nudge should fall back where it
   * started.
   */
  const snapTo = useCallback(
    (projected: number) => {
      if (projected > offsets.peek + DISMISS_MARGIN) {
        closeWithSlide();
        return;
      }
      const entries = Object.entries(offsets) as [PanelDetent, number][];
      let best = entries[0];
      for (const entry of entries) {
        if (Math.abs(entry[1] - projected) < Math.abs(best[1] - projected)) best = entry;
      }
      settle(best[0]);
    },
    [offsets, settle, closeWithSlide],
  );

  const pan = Gesture.Pan()
    .activeOffsetY([-DRAG_SLOP, DRAG_SLOP])
    .failOffsetX([-24, 24])
    .onStart(() => {
      dragStart.value = translateY.value;
    })
    .onUpdate((e) => {
      const next = dragStart.value + e.translationY;
      // Can't go above full; can go below peek, because below peek is closing.
      translateY.value = Math.max(next, offsets.full);
    })
    .onEnd((e) => {
      runOnJS(snapTo)(translateY.value + e.velocityY * VELOCITY_PROJECTION_S);
    });

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const renderItem = useCallback(
    ({ item }: { item: ApiEvent }) => (
      <Pressable
        onPress={() => onSelectEvent(item.id)}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}, ${formatEventDate(item.start_datetime)}`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 11,
          paddingVertical: 9,
          borderTopWidth: 1,
          borderColor: colors.divider,
        }}
      >
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: 8,
            overflow: 'hidden',
            backgroundColor: colors.placeholder,
          }}
        >
          {item.image_url ? (
            <Image
              source={{ uri: item.image_url }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
            />
          ) : (
            <EventFlyerPlaceholder seed={item.id} />
          )}
        </View>

        <View style={{ flex: 1 }}>
          <Text numberOfLines={2} style={{ fontSize: 13.5, fontWeight: '600', color: colors.ink }}>
            {item.title}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 11.5, color: colors.inkMuted, marginTop: 2 }}>
            {formatEventDate(item.start_datetime)}
            {item.host_organization_name ? ` · ${item.host_organization_name}` : ''}
          </Text>
        </View>
      </Pressable>
    ),
    [colors, onSelectEvent],
  );

  const keyExtractor = useCallback((item: ApiEvent) => String(item.id), []);

  if (!visible) return null;

  return (
    /* The measuring frame. Fills the map area, reports its height, and hands
       every touch it doesn't own to the map — `box-none` means "I am not a
       target, my children might be". */
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="box-none"
      onLayout={(e) => setAvailableHeight(e.nativeEvent.layout.height)}
    >
      {availableHeight === 0 ? null : (
        <Animated.View
          style={[
            {
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: panelHeight,
              backgroundColor: colors.surface,
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              borderTopWidth: 1,
              borderColor: colors.divider,
            },
            panelStyle,
          ]}
        >
          {/* flexGrow:0 is load-bearing. GestureHandlerRootView's own default
              style is `flex: 1` — unstyled, it takes the whole panel and leaves
              the list zero height. It is also required at all: there is none at
              the app root, which is why every gesture in this repo wraps
              itself. */}
          <GestureHandlerRootView style={{ flexGrow: 0, flexShrink: 0 }}>
            <GestureDetector gesture={pan}>
              {/* What peek shows, and what peek measures itself against.
                  Nothing in here is conditional on the detent: a header whose
                  height changes when the panel moves feeds a measurement back
                  into the offsets that moved it. */}
              <View onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}>
                <Pressable
                  onPress={() =>
                    settle(detent === 'peek' ? 'half' : detent === 'half' ? 'full' : 'peek')
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Event list, ${detent}. Tap to ${
                    detent === 'full' ? 'collapse' : 'expand'
                  }`}
                  style={{ paddingTop: 9, paddingBottom: 10, alignItems: 'center' }}
                >
                  <View
                    style={{
                      width: 38,
                      height: 4,
                      borderRadius: 4,
                      backgroundColor: colors.border,
                    }}
                  />
                </Pressable>

                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    paddingLeft: 20,
                    paddingRight: 12,
                    paddingBottom: 14,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      numberOfLines={1}
                      style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}
                    >
                      {venueName}
                    </Text>
                    <Text style={{ fontSize: 11.5, color: colors.inkMuted, marginTop: 1 }}>
                      {sorted.length} {sorted.length === 1 ? 'event' : 'events'} here
                    </Text>
                  </View>

                  {/* Dragging down closes too, but a visible control is what
                      makes that discoverable — and it is the only way out for
                      anyone not using the gesture. */}
                  <Pressable
                    onPress={closeWithSlide}
                    accessibilityRole="button"
                    accessibilityLabel="Close"
                    hitSlop={10}
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 15,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: colors.surfaceMuted,
                    }}
                  >
                    <CloseGlyph color={colors.inkSecondary} />
                  </Pressable>
                </View>
              </View>
            </GestureDetector>
          </GestureHandlerRootView>

          <FlatList
            // flex:1 so the list takes exactly the space under the header and
            // scrolls inside it. Without it a list in a fixed-height parent
            // sizes to its content and runs past the bottom of the panel.
            style={{ flex: 1 }}
            data={sorted}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
            // Android detaches clipped subviews by default, which combined with
            // a transformed parent is a reliable way to read a detached cell.
            // Cheap to disable: a venue has tens of events, not thousands.
            removeClippedSubviews={false}
            // Nothing to scroll to at peek, where the list isn't visible.
            scrollEnabled={detent !== 'peek'}
          />
        </Animated.View>
      )}
    </View>
  );
}
