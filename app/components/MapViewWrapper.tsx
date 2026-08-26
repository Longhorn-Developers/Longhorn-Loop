import { ApiEvent } from '@/app/components/EventCard';
import { useThemeColors } from '@/app/lib/themeColors';
import React, { useMemo, useRef } from 'react';
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

// Some sources report identical coordinates for multiple events (same
// building, no per-event geocoding). react-native-maps stacks markers with
// no offset, so the topmost one silently hides the rest (LOOP-271: "only
// one pin appears"). Spread exact-coordinate duplicates into a small, tight
// circle so every event stays visible and tappable.
//
// Two dynamic versions of this were tried and both reliably crashed
// react-native-maps on iOS: a tap-to-expand badge (removing/replacing itself
// from inside its own tap callback), and a zoom-driven badge/pins swap via
// onRegionChangeComplete. Different triggers, same failure -- swapping
// between a custom-view marker (a badge with a count) and plain pinColor
// markers is what's unstable here, not which event causes the swap. Plain,
// always-rendered pinColor Markers are the pattern already proven stable
// everywhere else on this screen, so that's what stays. The offset is kept
// small (~9m) specifically so it reads as "same spot, a couple of events"
// rather than "two unrelated locations" at a normal zoom level.
//
// UT Austin sits at ~30.28°N; a degree of longitude is shorter than a
// degree of latitude by cos(latitude), so the longitude offset is scaled up
// to draw a uniform circle on screen instead of a squashed ellipse.
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

interface MapViewWrapperProps {
  events: LocatedEvent[];
  selectedEventId: number | null;
  onPinPress: (eventId: number) => void;
  onMapPress: () => void;
}

export default function MapViewWrapper({
  events,
  selectedEventId,
  onPinPress,
  onMapPress,
}: MapViewWrapperProps) {
  // Hook must be called before any conditional return to satisfy the
  // rules of hooks.
  const pinJustPressed = useRef(false);
  const colors = useThemeColors();
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
        initialRegion={UT_REGION}
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
              onPinPress(event.id);
            }}
          />
        ))}
      </MapView>
    </View>
  );
}
