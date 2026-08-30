// Typed wrapper over the ExpoLocalSearch native module (Apple MKLocalSearch).
//
// MKLocalSearch is the point-of-interest engine behind the Maps app search bar:
// it resolves place/landmark/building names ("Texas Union Ballroom") that a
// plain postal geocoder can't. It is Apple-only and runs on-device — there is
// no server-side equivalent, so anything that needs coordinates from a name
// has to route through here on iOS.
//
// On Android/web the native module is absent; searchPlace resolves to null so
// callers fall back to their existing geocode path without crashing.

import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

// UT Austin's approximate center. Passed as the search region so campus
// buildings outrank identically-named places elsewhere in the world.
export const UT_AUSTIN_REGION = {
  latitude: 30.2849,
  longitude: -97.7341,
  radiusMeters: 4000,
};

export interface LocalSearchResult {
  name: string;
  latitude: number;
  longitude: number;
  address: string;
}

interface SearchOptions {
  latitude: number;
  longitude: number;
  radiusMeters?: number;
}

interface ExpoLocalSearchModule {
  search(query: string, options?: SearchOptions): Promise<LocalSearchResult[]>;
}

// requireOptionalNativeModule returns null when the module isn't linked
// (Android, web, or Expo Go), instead of throwing like requireNativeModule.
const native = requireOptionalNativeModule<ExpoLocalSearchModule>('ExpoLocalSearch');

/**
 * Resolve a place/building name to its best-match coordinate, biased to UT
 * Austin. Returns null when nothing matches, or when the native module isn't
 * available (non-iOS) so callers can fall back to geocoding.
 */
export async function searchPlace(
  query: string,
  region: SearchOptions = UT_AUSTIN_REGION,
): Promise<LocalSearchResult | null> {
  if (Platform.OS !== 'ios' || !native) return null;
  const trimmed = query.trim();
  if (!trimmed) return null;
  try {
    const results = await native.search(trimmed, region);
    return results[0] ?? null;
  } catch {
    return null;
  }
}
