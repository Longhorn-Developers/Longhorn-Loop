import { ApiEvent } from '@/app/components/EventCard';
import React from 'react';
import { Text, View } from 'react-native';

export type LocatedEvent = ApiEvent & { latitude: number; longitude: number };

interface MapViewWrapperProps {
  events: LocatedEvent[];
  selectedEventId: number | null;
  onPinPress: (eventId: number) => void;
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
