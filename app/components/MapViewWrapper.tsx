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
  const groups = new Map<string, LocatedEvent[]>();
  for (const event of events) {
    const key = `${event.latitude.toFixed(6)},${event.longitude.toFixed(6)}`;
    const group = groups.get(key);
    if (group) {
      group.push(event);
    } else {
      groups.set(key, [event]);
    }
  }

  const result = new Map<number, { latitude: number; longitude: number }>();
  for (const group of groups.values()) {
    if (group.length === 1) {
      const [event] = group;
      result.set(event.id, { latitude: event.latitude, longitude: event.longitude });
      continue;
    }
    group.forEach((event, index) => {
      const angle = (2 * Math.PI * index) / group.length;
      result.set(event.id, {
        latitude: event.latitude + OVERLAP_OFFSET_DEGREES * Math.cos(angle),
        longitude:
          event.longitude + (OVERLAP_OFFSET_DEGREES * Math.sin(angle)) / LATITUDE_COS_AT_UT,
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
  /** Where to open the map. Campus on a cold start; last position on a remount. */
  initialRegion?: MapRegion;
  /** Fires when the camera settles, so the caller can remember where we are. */
  onRegionSettled?: (region: MapRegion) => void;
}

export default function MapViewWrapper({
  events,
  selectedEventId,
  onPinPress,
  onMapPress,
  initialRegion,
  onRegionSettled,
}: MapViewWrapperProps) {
  // Hook must be called before any conditional return to satisfy the
  // rules of hooks.
  const pinJustPressed = useRef(false);
  const suppressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [zoomSuppressed, setZoomSuppressed] = useState(false);
  const colors = useThemeColors();

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
        initialRegion={initialRegion ?? UT_REGION}
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
        {events.map((event) => (
          <Marker
            key={event.id}
            coordinate={displayCoordinates.get(event.id)!}
            pinColor={selectedEventId === event.id ? SELECTED_ORANGE : BURNT_ORANGE}
            onPress={() => {
              pinJustPressed.current = true;
              suppressZoomBriefly();
              onPinPress(event.id);
            }}
          />
        ))}
      </MapView>
    </View>
  );
}
