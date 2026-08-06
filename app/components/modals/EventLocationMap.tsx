import { useThemeColors } from '@/app/lib/themeColors';
import React, { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, type Region } from 'react-native-maps';

const EVENT_PIN = '#BF5700'; // theme-exempt: pin drawn over map tiles
const USER_PIN = '#2591D4'; // theme-exempt: user-location pin, matches design

export interface Coord {
  latitude: number;
  longitude: number;
}

interface EventLocationMapProps {
  event: Coord;
  /** Label shown on the event pin callout. */
  label: string;
  user: Coord | null;
  /** Straight-line path between user and event, drawn when both are known. */
  showRoute: boolean;
}

// The native map inside the location modal: event pin, optional user pin, and a
// line between them. The .web sibling renders a fallback message.
export default function EventLocationMap({ event, label, user, showRoute }: EventLocationMapProps) {
  const colors = useThemeColors();
  const mapRef = useRef<MapView>(null);

  const region: Region = {
    latitude: event.latitude,
    longitude: event.longitude,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  };

  return (
    <View style={styles.fill}>
      <MapView ref={mapRef} style={styles.fill} initialRegion={region}>
        <Marker coordinate={event} title={label} pinColor={EVENT_PIN} />
        {user && <Marker coordinate={user} title="You" pinColor={USER_PIN} />}
        {showRoute && user && (
          <Polyline coordinates={[user, event]} strokeColor={USER_PIN} strokeWidth={3} />
        )}
      </MapView>
      <View style={styles.caption} pointerEvents="none">
        <Text style={[styles.captionText, { color: colors.inkMuted }]}>UT Austin Campus</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  caption: { position: 'absolute', bottom: 8, left: 10 },
  captionText: { fontSize: 11 },
});
