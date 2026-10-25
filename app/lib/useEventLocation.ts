// Where an event is, and how far that is from the viewer.
//
// Shared by the inline route card on the event detail screen and
// EventLocationMapModal, which used to own all of this itself. Pulled out so the
// two can't drift: the page needs the coordinate and the walk time in three
// places (the info card's subtitle, the route card, its Directions button), and
// copying the resolve-and-backfill logic into each would mean three geocode
// round trips and three POSTs to /events/:id/coordinates.

import type { ApiEvent } from '@/app/components/EventCard';
import type { Coord } from '@/app/components/modals/EventLocationMap';
import { api } from '@/app/lib/api';
import { searchPlace } from '@/app/lib/localSearch';
import * as Linking from 'expo-linking';
import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

// Average walking speed (~5 km/h) for the straight-line ETA. Real turn-by-turn
// distance would need a Directions API; this is the honest estimate we can give
// from coordinates alone.
const WALK_METERS_PER_MIN = 80;

const METERS_PER_MILE = 1609.34;

// Haversine distance in meters between two coordinates.
export function distanceMeters(a: Coord, b: Coord): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** "0.3 mi". Floors at 0.1 so a venue next door doesn't read "0.0 mi". */
export function formatMiles(meters: number): string {
  const miles = Math.max(0.1, Math.round((meters / METERS_PER_MILE) * 10) / 10);
  return `${miles.toFixed(1)} mi`;
}

interface Options {
  /**
   * Nothing runs while false. The modal passes its `visible` so it only
   * geocodes when opened; the page leaves it on.
   */
  enabled?: boolean;
  /**
   * Fetch the viewer's position as soon as the screen opens, but ONLY if
   * location permission was already granted. The OS prompt is never raised
   * unprompted by opening an event; with no permission the viewer asks for it
   * by tapping, via requestUserLocation.
   */
  autoLocate?: boolean;
}

export function useEventLocation(
  event: ApiEvent | null,
  token: string | null | undefined,
  { enabled = true, autoLocate = false }: Options = {},
) {
  // Coordinate resolution: explicit lat/lng, else geocode the address string,
  // else no location. 'resolving' covers the geocode round-trip.
  const [coord, setCoord] = useState<Coord | null>(null);
  const [resolving, setResolving] = useState(true);
  const [user, setUser] = useState<Coord | null>(null);
  const [locating, setLocating] = useState(false);

  const eventId = event?.id;
  const latitude = event?.latitude;
  const longitude = event?.longitude;
  const addressString = event ? event.location_full || event.location_short || null : null;

  useEffect(() => {
    if (!enabled || eventId === undefined) return;
    let cancelled = false;

    const resolve = async () => {
      setResolving(true);
      if (latitude != null && longitude != null) {
        if (!cancelled) {
          setCoord({ latitude, longitude });
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
          .post(`/events/${eventId}/coordinates`, {
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
  }, [enabled, eventId, latitude, longitude, addressString, token]);

  // Reset per-open transient state when the consumer is switched off (the modal
  // closing), so the next open doesn't flash the previous position.
  useEffect(() => {
    if (!enabled) {
      setUser(null);
      setLocating(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !autoLocate) return;
    let cancelled = false;
    (async () => {
      try {
        // getForegroundPermissionsAsync only READS the current grant; unlike
        // requestForegroundPermissionsAsync it never shows the OS prompt.
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!cancelled) setUser({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      } catch {
        // No fix: stay on the "tap to see walking time" state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, autoLocate]);

  const requestUserLocation = useCallback(async () => {
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

  const meters = useMemo(() => (user && coord ? distanceMeters(user, coord) : null), [user, coord]);
  const walkMinutes = useMemo(
    () => (meters == null ? null : Math.max(1, Math.round(meters / WALK_METERS_PER_MIN))),
    [meters],
  );

  // 'search' drops a pin on the venue; 'directions' starts a walking route from
  // wherever the viewer is, which is what the route card's button promises.
  const openInMaps = useCallback(
    (mode: 'search' | 'directions' = 'search') => {
      const target = coord
        ? `${coord.latitude},${coord.longitude}`
        : addressString
          ? encodeURIComponent(addressString)
          : null;
      if (!target) return;
      // Apple Maps on iOS, Google Maps elsewhere.
      const url =
        mode === 'directions'
          ? Platform.OS === 'ios'
            ? `http://maps.apple.com/?daddr=${target}&dirflg=w`
            : `https://www.google.com/maps/dir/?api=1&destination=${target}&travelmode=walking`
          : Platform.OS === 'ios'
            ? `http://maps.apple.com/?q=${target}`
            : `https://www.google.com/maps/search/?api=1&query=${target}`;
      Linking.openURL(url).catch(() => {});
    },
    [coord, addressString],
  );

  return {
    coord,
    resolving,
    user,
    locating,
    meters,
    walkMinutes,
    requestUserLocation,
    openInMaps,
    hasLocation: coord != null || addressString != null,
  };
}
