import { ApiEvent } from '@/app/components/EventCard';
import React, { useRef } from 'react';
import { Platform, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

const BURNT_ORANGE = '#BF5700';
const SELECTED_ORANGE = '#FF8C00';

const UT_REGION = {
  latitude: 30.2849,
  longitude: -97.7341,
  latitudeDelta: 0.02,
  longitudeDelta: 0.02,
} as const;

export type LocatedEvent = ApiEvent & { latitude: number; longitude: number };

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
  if (Platform.OS === 'web') {
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

  const pinJustPressed = useRef(false);

  return (
    <View style={{ flex: 1 }}>
      <MapView
        style={{ flex: 1 }}
        initialRegion={UT_REGION}
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
            coordinate={{ latitude: event.latitude, longitude: event.longitude }}
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
