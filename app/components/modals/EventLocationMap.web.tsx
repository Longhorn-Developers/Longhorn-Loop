import { useThemeColors } from '@/app/lib/themeColors';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Coord } from './EventLocationMap';

interface EventLocationMapProps {
  event: Coord;
  label: string;
  user: Coord | null;
  showRoute: boolean;
}

// Web has no native map; match the existing MapViewWrapper.web fallback.
export default function EventLocationMap(_props: EventLocationMapProps) {
  const colors = useThemeColors();
  return (
    <View style={styles.center}>
      <Text style={[styles.text, { color: colors.inkMuted }]}>
        Map view is available in the mobile app.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  text: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
});
