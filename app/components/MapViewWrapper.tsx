import { ApiEvent } from '@/app/components/EventCard';
import { buildMapMarkers, clusterDiameter, type ClusterMarker } from '@/app/lib/mapClusters';
import { useAnimatedValue } from '@/app/lib/useAnimatedValue';
import { useThemeColors } from '@/app/lib/themeColors';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

const BURNT_ORANGE = '#BF5700'; // theme-exempt: map marker pin, drawn over Google's tiles
const SELECTED_ORANGE = '#FF8C00'; // theme-exempt: map marker pin, drawn over Google's tiles
// theme-exempt for the same reason as the two above: it sits on Google's tiles,
// not on our surface, so it has to read against the map in both app themes.
const DIMMED_GREY = '#8A8A8A';
// The press state of a cluster bubble. Lighter rather than darker so the white
// count stays legible through the pulse.
const PRESSED_ORANGE = '#E06A10'; // theme-exempt: drawn over Google's tiles

const UT_REGION = {
  latitude: 30.2849,
  longitude: -97.7341,
  latitudeDelta: 0.02,
  longitudeDelta: 0.02,
} as const;

export type LocatedEvent = ApiEvent & { latitude: number; longitude: number };

// The scatter maths, the coordinate grouping and the collapse threshold moved
// to app/lib/mapClusters.ts. Unchanged below the threshold — same ring, same
// numbers — and testable there without mounting a map. That file's header
// explains why a building with forty events now gets one marker.
//
// LOOP-279's coordinate validation moved with it. That fix landed on main
// against the version of this function that lived here; the guard itself is
// what matters, not where it sits, so it is now the first thing
// buildMapMarkers does. See the note on `toPoint` in mapClusters.ts.

/**
 * Android's double-tap timeout (ViewConfiguration.getDoubleTapTimeout). Zoom
 * gestures are suppressed for this long after a marker press -- see the note
 * on suppressZoomBriefly below.
 */
const ZOOM_SUPPRESS_MS = 300;

export interface MapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

interface MapViewWrapperProps {
  events: LocatedEvent[];
  /**
   * Events the current filters EXCLUDED, drawn grey and untappable.
   *
   * Filtering a map by deleting pins tells you nothing about what you removed —
   * the map just looks emptier, and you cannot tell "my filter is narrow" from
   * "this part of campus is quiet". Greying them keeps the shape of the
   * excluded set visible, which is what makes the filter legible as a filter
   * (design: Explore filters, Concept 01).
   *
   * No onPress on purpose: a grey pin is context, not a target, and selecting
   * one would open a mini card for an event that is not in the list behind it.
   */
  dimmedEvents?: LocatedEvent[];
  selectedEventId: number | null;
  onPinPress: (eventId: number) => void;
  /**
   * A counted bubble was tapped. Carries the whole cluster — its `key` is the
   * venue key the list sections use, and `events` are the ones the filters
   * kept, which is what the number on the bubble promised.
   *
   * Required for the collapse to be usable: a marker reading 40 that opens
   * nothing is worse than the ring it replaced, because at least the ring's
   * pins were individually tappable.
   */
  onClusterPress?: (cluster: ClusterMarker<LocatedEvent>) => void;
  onMapPress: () => void;
  /**
   * Where to open the map. Campus on a cold start; last position on a remount.
   *
   * A getter, not a value: the caller keeps the last camera in a ref (so a pan
   * does not re-render the screen) and reading a ref during render is
   * `react-hooks/refs`. Called once, from a useState initializer — see
   * `mountRegion` below.
   */
  getInitialRegion?: () => MapRegion | undefined;
  /** Fires when the camera settles, so the caller can remember where we are. */
  onRegionSettled?: (region: MapRegion) => void;
}

export default function MapViewWrapper({
  events,
  dimmedEvents,
  selectedEventId,
  onPinPress,
  onClusterPress,
  onMapPress,
  getInitialRegion,
  onRegionSettled,
}: MapViewWrapperProps) {
  // Hook must be called before any conditional return to satisfy the
  // rules of hooks.
  const pinJustPressed = useRef(false);
  const suppressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [zoomSuppressed, setZoomSuppressed] = useState(false);
  const colors = useThemeColors();

  // Lazy initializer, so the caller's ref is read exactly once — at mount,
  // which is the only moment an uncontrolled MapView looks at initialRegion.
  const [mountRegion] = useState<MapRegion>(() => getInitialRegion?.() ?? UT_REGION);

  useEffect(
    () => () => {
      if (suppressTimer.current) clearTimeout(suppressTimer.current);
    },
    [],
  );

  /**
   * Google Maps on Android has a ONE-FINGER zoom: tap, then put a finger down
   * and drag vertically. Tapping a pin supplies the tap and moving the map
   * straight after supplies the drag, so the map zooms instead of panning.
   * That is what "it thinks I am still pinching" is -- a real gesture being
   * recognised, not a stuck pointer, which is why it only happens when you
   * move quickly: the gesture has a 300ms recognition window.
   *
   * react-native-maps 1.20 exposes no way to disable that one gesture.
   * zoomTapEnabled exists only in ios/AirGoogleMaps; Android's MapManager
   * wires setZoomGesturesEnabled to the blanket `zoomEnabled` prop and nothing
   * else. So zoom is blocked for exactly the window in which the stray gesture
   * can be recognised, and pinch behaves normally the rest of the time.
   */
  const suppressZoomBriefly = useCallback(() => {
    setZoomSuppressed(true);
    if (suppressTimer.current) clearTimeout(suppressTimer.current);
    suppressTimer.current = setTimeout(() => setZoomSuppressed(false), ZOOM_SUPPRESS_MS);
  }, []);
  /**
   * Both sets go in together, for the reason spelled out in mapClusters: a
   * separate pass per set would de-overlap each one on its own and then drop a
   * live marker exactly on top of a dead one, which is the overlap the scatter
   * exists to prevent — with the untappable pin on top.
   */
  const { scattered, clusters } = useMemo(
    () => buildMapMarkers({ visible: events, dimmed: dimmedEvents ?? [] }),
    [events, dimmedEvents],
  );

  if (Platform.OS === 'web') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text
          style={{
            fontSize: 16,
            color: colors.inkMuted,
            textAlign: 'center',
            paddingHorizontal: 40,
            lineHeight: 24,
          }}
        >
          Map view is available in the mobile app.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <MapView
        style={{ flex: 1 }}
        // The map is uncontrolled, so initialRegion is read once, at mount --
        // and any REMOUNT therefore snaps the camera back to it. body() in
        // explore.tsx swaps this whole subtree out for a spinner whenever the
        // events query key changes (switching an Explore toggle changes it), so
        // the map unmounts and reopens at campus zoom having discarded wherever
        // you had panned to. Indistinguishable from "the map zoomed on me".
        // The caller remembers the last settled camera and hands it back.
        initialRegion={mountRegion}
        onRegionChangeComplete={onRegionSettled}
        zoomEnabled={!zoomSuppressed}
        moveOnMarkerPress={false}
        onPress={() => {
          if (pinJustPressed.current) {
            pinJustPressed.current = false;
            return;
          }
          onMapPress();
        }}
      >
        {/* Dimmed first so they paint UNDER the live markers — react-native-maps
            stacks markers in child order, and an excluded pin drawn on top of a
            match would hide the one that matters. */}
        {scattered
          .filter((marker) => marker.dimmed)
          .map((marker) => (
            <Marker
              key={`dim-${marker.event.id}`}
              coordinate={marker.coordinate}
              pinColor={DIMMED_GREY}
              tracksViewChanges={false}
              opacity={0.55}
            />
          ))}

        {scattered
          .filter((marker) => !marker.dimmed)
          .map((marker) => (
            <Marker
              key={marker.event.id}
              coordinate={marker.coordinate}
              pinColor={selectedEventId === marker.event.id ? SELECTED_ORANGE : BURNT_ORANGE}
              onPress={() => {
                pinJustPressed.current = true;
                suppressZoomBriefly();
                onPinPress(marker.event.id);
              }}
            />
          ))}

        {clusters.map((cluster) => (
          <ClusterBubble
            key={cluster.key}
            cluster={cluster}
            onPress={() => {
              pinJustPressed.current = true;
              suppressZoomBriefly();
              onClusterPress?.(cluster);
            }}
          />
        ))}
      </MapView>
    </View>
  );
}

/**
 * A collapsed venue: one marker carrying its count.
 *
 * A custom child view rather than `pinColor`, because the number is the whole
 * point — a teardrop cannot say "40".
 *
 * ---------------------------------------------------------------------------
 * THE PRESS ANIMATION AND `tracksViewChanges` ARE ONE PROBLEM, not two.
 *
 * A Marker with children is rasterised to a bitmap and pinned to the map. While
 * `tracksViewChanges` is true it re-rasterises on EVERY map frame, which turns
 * a pan across a handful of these into a slideshow on Android — so the resting
 * state has to be `false`.
 *
 * But a snapshotted marker does not repaint, which means an animation inside it
 * is invisible. Both facts are true at once, and the way through is to turn
 * tracking on only for the length of the pulse: `tracksViewChanges={animating}`.
 * The map pays the rasterisation cost for 260ms, on one marker, in response to a
 * deliberate tap.
 *
 * That also rules out the native driver. Native-driven transforms never reach
 * the JS-side view tree the rasteriser reads, so the bitmap would be captured
 * unchanged — `useNativeDriver: false` is required here, not an oversight.
 *
 * Outside the pulse, the snapshot is keyed on everything it draws
 * (count + dim state), so a filter change still forces a fresh capture.
 */
function ClusterBubble({
  cluster,
  onPress,
}: {
  cluster: ClusterMarker<LocatedEvent>;
  onPress: () => void;
}) {
  // Nothing in this group survived the filters. It stays on the map, greyed, so
  // the filter reads as a filter rather than as an empty campus — the same rule
  // the dimmed pins follow.
  const isEmpty = cluster.count === 0;
  const label = isEmpty ? cluster.dimmedEvents.length : cluster.count;
  const size = clusterDiameter(label);

  const pulse = useAnimatedValue(0);
  const [animating, setAnimating] = useState(false);

  /**
   * Track for one beat after mount, then stop.
   *
   * `tracksViewChanges={false}` from the very first render is the documented
   * way to get a BLANK marker out of react-native-maps: the bitmap is captured
   * before the child view has laid out, and nothing ever recaptures it. The
   * bubble either doesn't appear or appears at the wrong size, and on a map
   * that is redrawing as you pan it reads as flicker rather than as a missing
   * view.
   *
   * So: capture properly, then go quiet. The cost is one short tracking window
   * per bubble on mount rather than tracking forever.
   */
  const [settling, setSettling] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setSettling(false), 250);
    return () => clearTimeout(timer);
  }, []);

  // A pending animation on an unmounted marker would call setState on a dead
  // component every time the filters change under a pressed bubble.
  useEffect(() => () => pulse.stopAnimation(), [pulse]);

  const handlePress = useCallback(() => {
    setAnimating(true);
    pulse.setValue(0);
    Animated.sequence([
      Animated.timing(pulse, {
        toValue: 1,
        duration: 110,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.spring(pulse, {
        toValue: 0,
        friction: 5,
        tension: 140,
        useNativeDriver: false,
      }),
    ]).start(() => setAnimating(false));

    onPress();
  }, [onPress, pulse]);

  // Down and back, not up: a bubble that grows under the thumb is hidden by it
  // at exactly the moment the feedback is wanted.
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.86] });
  const backgroundColor = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [isEmpty ? DIMMED_GREY : BURNT_ORANGE, isEmpty ? DIMMED_GREY : PRESSED_ORANGE],
  });

  return (
    <Marker
      coordinate={cluster.coordinate}
      key={`${cluster.key}-${label}-${isEmpty ? 'dim' : 'live'}`}
      tracksViewChanges={animating || settling}
      onPress={isEmpty ? undefined : handlePress}
      opacity={isEmpty ? 0.55 : 1}
      accessibilityLabel={
        isEmpty
          ? `${label} events here, all hidden by your filters`
          : `${label} events at this location`
      }
    >
      {/* Padded so the scaled-up ring has somewhere to go; without it the
          bitmap is cropped to the resting size and the pulse looks clipped. */}
      <View style={{ padding: 4 }}>
        <Animated.View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor,
            // theme-exempt, like the pin colours: this ring separates the
            // bubble from Google's tiles, not from our surface.
            borderWidth: 2.5,
            borderColor: 'rgba(255,255,255,0.82)',
            transform: [{ scale }],
          }}
        >
          <Text
            style={{
              color: '#FFFFFF',
              fontWeight: '700',
              fontVariant: ['tabular-nums'],
              // Steps with the bubble so a three-digit count still fits.
              fontSize: size >= 46 ? 16 : size >= 38 ? 13 : 11.5,
            }}
          >
            {label}
          </Text>
        </Animated.View>
      </View>
    </Marker>
  );
}
