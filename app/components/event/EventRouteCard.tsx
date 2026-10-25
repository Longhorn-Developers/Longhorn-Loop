// The inline route card on the event detail screen: a short map framed on the
// viewer-to-venue line, then the venue name, "6 min walk · 0.3 mi" and a
// Directions button. It is what EventLocationMapModal used to be the only way
// to see; the modal is still there behind the info card's location row for a
// full, pannable map.
//
// The route is a straight line and the walk time is distance at a fixed pace
// (see useEventLocation). The design draws a street-following path with a
// routed time; that needs a Directions API this app doesn't have, so what is
// shown is an estimate, and Directions hands off to Maps for the real route.

import type { ApiEvent } from '@/app/components/EventCard';
import EventLocationMap from '@/app/components/modals/EventLocationMap';
import { useThemeColors, type ThemeColors } from '@/app/lib/themeColors';
import { formatMiles, type useEventLocation } from '@/app/lib/useEventLocation';
import DirectionsIcon from '@/assets/images/directions.svg';
import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

interface EventRouteCardProps {
  event: ApiEvent;
  location: ReturnType<typeof useEventLocation>;
}

export default function EventRouteCard({ event, location }: EventRouteCardProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { coord, resolving, user, locating, meters, walkMinutes, requestUserLocation, openInMaps } =
    location;

  // No place to draw. The info card above still shows the address text, and a
  // card that apologises for a missing map is worse than no card.
  if (!resolving && !coord) return null;

  const venueName = event.location_short || event.location_full || event.title;

  return (
    <View style={styles.card}>
      <View style={styles.mapFrame}>
        {coord ? (
          <EventLocationMap
            event={coord}
            label={venueName}
            user={user}
            showRoute={user != null}
            variant="inline"
            walkMinutes={walkMinutes}
          />
        ) : (
          <View style={styles.mapLoading}>
            <ActivityIndicator color={colors.brand} />
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <View style={{ flex: 1 }}>
          <Text style={styles.venue} numberOfLines={1}>
            {venueName}
          </Text>
          {walkMinutes != null && meters != null ? (
            <Text style={styles.detail}>
              {walkMinutes} min walk · {formatMiles(meters)}
            </Text>
          ) : (
            // Without a position there is nothing to compute. Asking is a tap,
            // not something the screen does on open: see autoLocate in
            // useEventLocation for why the OS prompt isn't raised unprompted.
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Show walking time from your location"
              onPress={requestUserLocation}
              disabled={locating || !coord}
              hitSlop={6}
            >
              <Text style={[styles.detail, { color: colors.brand }]}>
                {locating ? 'Finding you…' : 'Show walking time'}
              </Text>
            </Pressable>
          )}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Get walking directions"
          disabled={!coord}
          onPress={() => openInMaps('directions')}
          style={[styles.directions, !coord ? { opacity: 0.5 } : null]}
        >
          <DirectionsIcon width={16} height={16} color={colors.brand} />
          <Text style={styles.directionsText}>Directions</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    // Same surface as the info and About cards.
    card: {
      backgroundColor: c.surfaceMuted,
      borderRadius: 12,
      marginBottom: 16,
      overflow: 'hidden',
      shadowColor: '#000', // theme-exempt: a shadow is black in both themes
      shadowOpacity: 0.06,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    },
    mapFrame: {
      height: 170,
      backgroundColor: c.surfaceMuted,
    },
    mapLoading: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    venue: {
      fontFamily: 'RobotoFlex_600SemiBold',
      fontSize: 15,
      fontWeight: '600',
      color: c.ink,
    },
    detail: {
      fontFamily: 'RobotoFlex_400Regular',
      fontSize: 14,
      color: c.ink,
      marginTop: 2,
    },
    directions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: 8,
      backgroundColor: c.brandSoft,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    directionsText: {
      fontFamily: 'RobotoFlex_600SemiBold',
      fontSize: 13,
      fontWeight: '600',
      color: c.brand,
    },
  });
