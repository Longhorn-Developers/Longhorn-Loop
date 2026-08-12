// Where the app sends its API calls.
//
// Production hits the deployed Worker. Development has to reach the
// `wrangler dev` process on whichever machine started Expo, and the address
// that machine answers to depends on where the app is running:
//
//   Expo web, iOS simulator   "localhost" is the same machine — works
//   A real phone in Expo Go   "localhost" is the *phone* — nothing is
//                             listening there, so every request fails
//
// This file used to hardcode localhost in dev, which is exactly why the app
// worked in a browser and threw "Network request failed" on phones. We now
// read the dev machine's address out of the Expo host URI: it's the same host
// Metro just served the JS bundle from, so if the app opened at all, this
// resolves to something reachable.

import Constants from 'expo-constants';
import { Platform } from 'react-native';

const PROD_API = 'https://loop-db.longhorn-developers.workers.dev';

/** Port `wrangler dev` listens on. */
const DEV_API_PORT = 8787;

/**
 * Host part of the URI Expo loaded this bundle from — the dev machine's LAN IP
 * on a device ("192.168.1.24:8081"), "localhost:8081" on web and simulators.
 * `expoGoConfig.debuggerHost` is the older field, kept as a fallback.
 */
function expoDevHost(): string | null {
  const config = Constants.expoConfig as { hostUri?: string } | null | undefined;
  const goConfig = Constants.expoGoConfig as { debuggerHost?: string | null } | null | undefined;

  const hostUri = config?.hostUri ?? goConfig?.debuggerHost ?? null;
  if (!hostUri) return null;

  // Strip the port, and any scheme if one ever shows up.
  const withoutScheme = hostUri.replace(/^\w+:\/\//, '');
  const host = withoutScheme.split(':')[0];

  return host || null;
}

function devApiBaseUrl(): string {
  const localhost = `http://localhost:${DEV_API_PORT}`;

  // The web dev server runs on the same machine as the Worker. Using the LAN
  // IP here would work but needlessly changes the origin.
  if (Platform.OS === 'web') return localhost;

  const host = expoDevHost();
  if (!host) return localhost;

  // `expo start --tunnel` serves the bundle through an exp.direct hostname
  // that only proxies Metro, not port 8787. Nothing sensible to derive, so
  // fall back and let EXPO_PUBLIC_API_BASE_URL take over.
  if (host.endsWith('.exp.direct')) return localhost;

  return `http://${host}:${DEV_API_PORT}`;
}

// An explicit override wins in dev. Set EXPO_PUBLIC_API_BASE_URL in .env to
// point a device at the deployed Worker, a tunnel, or a teammate's machine.
const override = process.env.EXPO_PUBLIC_API_BASE_URL;

/**
 * EXPO_PUBLIC_* values are inlined into the bundle at build time, so a `.env`
 * left over from local testing can be baked into a release -- shipping an app
 * that points every user at someone's laptop on a LAN they cannot reach.
 *
 * A production override is only honoured over HTTPS, which a LAN address never
 * is. EAS Build respects .gitignore so a cloud build never sees .env anyway,
 * but `expo export` and `eas build --local` both would.
 */
function overrideForRelease(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith('https://')) return value;

  console.warn(
    `[api] Ignoring EXPO_PUBLIC_API_BASE_URL="${value}" in a production build: ` +
      `only https:// overrides are allowed. Falling back to ${PROD_API}.`,
  );
  return undefined;
}

export const API_BASE_URL = __DEV__
  ? override || devApiBaseUrl()
  : overrideForRelease(override) || PROD_API;
