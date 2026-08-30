import type { ApiEvent } from '@/app/components/EventCard';
import { api } from '@/app/lib/api';
import { searchPlace } from '@/app/lib/localSearch';
import type { ThemeColors } from '@/app/lib/themeColors';
import { useThemeColors } from '@/app/lib/themeColors';
import * as Linking from 'expo-linking';
import * as Location from 'expo-location';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import EventLocationMap, { type Coord } from './EventLocationMap';

interface EventLocationMapModalProps {
  visible: boolean;
  onClose: () => void;
  event: ApiEvent;
  // Auth token, so a coordinate resolved from the location label can be
  // written back to the server for this event (backfill). Optional: without it
  // the map still shows, the coordinate just isn't persisted.
  token?: string | null;
}

// Average walking speed (~5 km/h) for the straight-line ETA. Real turn-by-turn
// distance would need a Directions API; this is the honest estimate we can give
// from coordinates alone.
const WALK_METERS_PER_MIN = 80;

// Haversine distance in meters between two coordinates.
function distanceMeters(a: Coord, b: Coord): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export default function EventLocationMapModal({
  visible,
  onClose,
  event,
  token,
}: EventLocationMapModalProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Coordinate resolution: explicit lat/lng, else geocode the address string,
  // else no location. 'resolving' covers the geocode round-trip.
  const [coord, setCoord] = useState<Coord | null>(null);
  const [resolving, setResolving] = useState(true);
  const [user, setUser] = useState<Coord | null>(null);
  const [locating, setLocating] = useState(false);

  const locationName = event.location_short || event.location_full || null;
  const addressString = event.location_full || event.location_short || null;

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    const resolve = async () => {
      setResolving(true);
      if (event.latitude != null && event.longitude != null) {
        if (!cancelled) {
          setCoord({ latitude: event.latitude, longitude: event.longitude });
          setResolving(false);
        }
        return;
      }
      if (!addressString) {
        if (!cancelled) {
          setCoord(null);
          setResolving(false);
        }
        return;
      }

      // Resolve the location label to coordinates. MKLocalSearch first — it's a
      // point-of-interest search (iOS only) that understands building/landmark
      // names like "Texas Union Ballroom", which a plain postal geocoder can't.
      // Fall back to geocodeAsync on other platforms or when POI search misses.
      let resolved: Coord | null = null;
      try {
        const poi = await searchPlace(addressString);
        if (poi) {
          resolved = { latitude: poi.latitude, longitude: poi.longitude };
        } else {
          const results = await Location.geocodeAsync(addressString);
          const first = results[0];
          if (first) resolved = { latitude: first.latitude, longitude: first.longitude };
        }
      } catch {
        resolved = null;
      }

      if (cancelled) return;
      setCoord(resolved);
      setResolving(false);

      // Backfill: this event had no stored coordinates, so persist the one we
      // just resolved. The server only fills when the columns are still NULL,
      // so this is safe to fire and forget from any viewing client.
      if (resolved && token) {
        api
          .post(`/events/${event.id}/coordinates`, {
            token,
            body: { latitude: resolved.latitude, longitude: resolved.longitude },
          })
          .catch(() => {});
      }
    };

    resolve();
    return () => {
      cancelled = true;
    };
  }, [visible, event.id, event.latitude, event.longitude, addressString, token]);

  // Reset per-open transient state when the modal closes.
  useEffect(() => {
    if (!visible) {
      setUser(null);
      setLocating(false);
    }
  }, [visible]);

  const onShowDistance = useCallback(async () => {
    if (locating) return;
    setLocating(true);
    try {
      // Requesting permission is what surfaces the OS location prompt.
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const pos = await Location.getCurrentPositionAsync({});
      setUser({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    } catch {
      // Leave user null; the distance hint stays available to retry.
    } finally {
      setLocating(false);
    }
  }, [locating]);

  const walkMinutes = useMemo(() => {
    if (!user || !coord) return null;
    return Math.max(1, Math.round(distanceMeters(user, coord) / WALK_METERS_PER_MIN));
  }, [user, coord]);

  const onOpenInMaps = useCallback(() => {
    const query = coord
      ? `${coord.latitude},${coord.longitude}`
      : addressString
        ? encodeURIComponent(addressString)
        : null;
    if (!query) return;
    // Apple Maps on iOS, Google Maps elsewhere.
    const url =
      Platform.OS === 'ios'
        ? `http://maps.apple.com/?q=${query}`
        : `https://www.google.com/maps/search/?api=1&query=${query}`;
    Linking.openURL(url);
  }, [coord, addressString]);

  const hasLocation = coord != null || addressString != null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <TouchableOpacity style={styles.close} onPress={onClose} hitSlop={12}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>

          {!hasLocation ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No location listed for this event.</Text>
            </View>
          ) : (
            <>
              <View style={styles.headerText}>
                {locationName && <Text style={styles.title}>{locationName}</Text>}
                <Text style={styles.subtitle} numberOfLines={2}>
                  {event.title}
                </Text>
              </View>

              <View style={styles.mapFrame}>
                {resolving ? (
                  <View style={styles.mapLoading}>
                    <ActivityIndicator color={colors.brand} />
                  </View>
                ) : coord ? (
                  <EventLocationMap
                    event={coord}
                    label={locationName || event.title}
                    user={user}
                    showRoute={user != null}
                  />
                ) : (
                  <View style={styles.mapLoading}>
                    <Text style={styles.emptyText}>
                      Couldn&apos;t place this address on the map.
                    </Text>
                  </View>
                )}

                {coord && (
                  <TouchableOpacity
                    style={styles.distancePill}
                    onPress={onShowDistance}
                    disabled={locating}
                  >
                    {locating ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.distancePillText}>
                        {walkMinutes != null
                          ? `${walkMinutes} min walk`
                          : 'Tap to see current distance'}
                      </Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>

              <TouchableOpacity
                style={styles.openButton}
                onPress={onOpenInMaps}
                activeOpacity={0.85}
              >
                <Text style={styles.openButtonText}>Open in Maps</Text>
              </TouchableOpacity>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    scrim: {
      flex: 1,
      backgroundColor: c.scrim,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    },
    card: {
      width: '100%',
      maxWidth: 400,
      backgroundColor: c.background,
      borderRadius: 16,
      padding: 16,
      gap: 20,
    },
    close: {
      position: 'absolute',
      top: 12,
      right: 14,
      zIndex: 2,
    },
    closeText: {
      fontSize: 16,
      color: c.ink,
    },
    headerText: {
      paddingTop: 8,
      gap: 6,
      paddingRight: 24,
    },
    title: {
      fontSize: 23,
      fontWeight: '500',
      color: c.ink,
    },
    subtitle: {
      fontSize: 15,
      color: c.ink,
    },
    mapFrame: {
      height: 260,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surfaceMuted,
      overflow: 'hidden',
    },
    mapLoading: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
    },
    distancePill: {
      position: 'absolute',
      bottom: 12,
      alignSelf: 'center',
      backgroundColor: c.inkSecondary,
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingVertical: 12,
      minWidth: 170,
      alignItems: 'center',
    },
    distancePillText: {
      color: '#FFFFFF',
      fontSize: 12,
    },
    openButton: {
      height: 55,
      borderRadius: 8,
      backgroundColor: c.brand,
      alignItems: 'center',
      justifyContent: 'center',
    },
    openButtonText: {
      color: '#FFFFFF',
      fontSize: 20,
      fontWeight: '500',
    },
    emptyState: {
      paddingVertical: 40,
      paddingHorizontal: 16,
      alignItems: 'center',
    },
    emptyText: {
      fontSize: 15,
      color: c.inkMuted,
      textAlign: 'center',
      lineHeight: 22,
    },
  });
