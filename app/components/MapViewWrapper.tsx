import { ApiEvent } from '@/app/components/EventCard';
import { useThemeColors } from '@/app/lib/themeColors';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

const BURNT_ORANGE = '#BF5700'; // theme-exempt: map marker pin, drawn over Google's tiles
const SELECTED_ORANGE = '#FF8C00'; // theme-exempt: map marker pin, drawn over Google's tiles

const UT_REGION = {
  latitude: 30.2849,
  longitude: -97.7341,
  latitudeDelta: 0.02,
  longitudeDelta: 0.02,
} as const;

export type LocatedEvent = ApiEvent & { latitude: number; longitude: number };

const LATITUDE_COS_AT_UT = Math.cos((30.2849 * Math.PI) / 180);
const OVERLAP_OFFSET_DEGREES = 0.00008; // ~9m radius

function jitterOverlappingCoordinates(
  events: LocatedEvent[],
): Map<number, { latitude: number; longitude: number }> {
  // Coerce and validate BEFORE grouping (LOOP-279). The type says number and
  // the caller filters on `!= null`, but the value comes off the wire: a string
  // "30.28" passes that filter and then throws on .toFixed(). A non-finite
  // value is worse than a throw — it reaches MapKit as a NaN coordinate and
  // takes the app down natively, where there is no JS frame left to catch it.
  // An event that fails this gets no pin rather than killing the whole map.
  const points: { id: number; latitude: number; longitude: number }[] = [];
  for (const event of events) {
    const latitude = Number(event.latitude);
    const longitude = Number(event.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    points.push({ id: event.id, latitude, longitude });
  }

  const groups = new Map<string, typeof points>();
  for (const point of points) {
    const key = `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`;
    const group = groups.get(key);
    if (group) {
      group.push(point);
    } else {
      groups.set(key, [point]);
    }
  }

  const result = new Map<number, { latitude: number; longitude: number }>();
  for (const group of groups.values()) {
    if (group.length === 1) {
      const [point] = group;
      result.set(point.id, { latitude: point.latitude, longitude: point.longitude });
      continue;
    }
    group.forEach((point, index) => {
      const angle = (2 * Math.PI * index) / group.length;
      result.set(point.id, {
        latitude: point.latitude + OVERLAP_OFFSET_DEGREES * Math.cos(angle),
        longitude:
          point.longitude + (OVERLAP_OFFSET_DEGREES * Math.sin(angle)) / LATITUDE_COS_AT_UT,
      });
    });
  }
  return result;
}

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
  selectedEventId: number | null;
  onPinPress: (eventId: number) => void;
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
  selectedEventId,
  onPinPress,
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
  const displayCoordinates = useMemo(() => jitterOverlappingCoordinates(events), [events]);

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
        {/*
          The `!` this used to carry on .get() was the dangerous part
          (LOOP-279): an event with no entry in displayCoordinates handed
          <Marker> an undefined coordinate, which is an unrecoverable native
          throw on both platforms. Entries are now missing by design — that is
          how a bad coordinate is dropped — so the lookup is checked.
        */}
        {events.map((event) => {
          const coordinate = displayCoordinates.get(event.id);
          if (!coordinate) return null;
          return (
            <Marker
              key={event.id}
              coordinate={coordinate}
              pinColor={selectedEventId === event.id ? SELECTED_ORANGE : BURNT_ORANGE}
              onPress={() => {
                pinJustPressed.current = true;
                suppressZoomBriefly();
                onPinPress(event.id);
              }}
            />
          );
        })}
      </MapView>
    </View>
  );
}
