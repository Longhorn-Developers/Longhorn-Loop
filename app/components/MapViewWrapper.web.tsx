import { ApiEvent } from '@/app/components/EventCard';
import React from 'react';
import { Text, View } from 'react-native';

export type LocatedEvent = ApiEvent & { latitude: number; longitude: number };

// Metro picks this file on web by extension; tsc resolves the native one, so
// this interface is documentation rather than the type the caller is checked
// against — note that it is already missing initialRegion / onRegionSettled and
// nothing complained. Kept roughly in step anyway, so a reader comparing the
// two files isn't misled about what the web build ignores.
interface MapViewWrapperProps {
  events: LocatedEvent[];
  dimmedEvents?: LocatedEvent[];
  selectedEventId: number | null;
  onPinPress: (eventId: number) => void;
  onClusterPress?: (cluster: { key: string; events: LocatedEvent[] }) => void;
  onMapPress: () => void;
}

export default function MapViewWrapper(_props: MapViewWrapperProps) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text
        style={{
          fontSize: 16,
          color: '#9A9A9A',
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
