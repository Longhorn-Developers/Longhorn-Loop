// Where the app sends its API calls.
//
// THE DEFAULT IS THE DEPLOYED WORKER, IN DEVELOPMENT TOO.
//
// It used to be a local `wrangler dev`, which quietly required five things to
// be true before `npx expo start` did anything: npm install in server/, a
// .dev.vars file, a seeded local D1, a Cloudflare account, and a second
// terminal left running. Miss any one and the app says "Network error: please
// check your connection", which sends people to look at their wifi. That cost
// a whole bug bash morning across several people.
//
// Almost nobody working on a screen needs a local Worker. So `git pull` and
// `npx expo start` now work with no setup at all, and running the server
// locally is the thing you opt into:
//
//   EXPO_PUBLIC_USE_LOCAL_API=1     talk to `wrangler dev` on this machine
//   EXPO_PUBLIC_API_BASE_URL=...    talk to this exact URL (wins over both)
//
// The trade-off is real and worth saying out loud: the default writes to the
// PRODUCTION database. Accounts you create and events you post are visible to
// everyone. That is the right default while the whole team is testing flows
// against real email, and the wrong one if you are experimenting — use the
// local flag then.
//
// Whichever it picks, it says so in the Metro console on startup.
//
// Reaching a local Worker is itself awkward, which is why devApiBaseUrl exists:
//
//   Expo web, iOS simulator   "localhost" is the same machine — works
//   A real phone in Expo Go   "localhost" is the *phone* — nothing is
//                             listening there, so every request fails
//
// So we read the dev machine's address out of the Expo host URI: the same host
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

/**
 * Trim whitespace and any trailing slashes off a base URL.
 *
 * Every caller writes `${API_BASE_URL}/auth/send-code`, so a base ending in
 * "/" produces "https://host//auth/send-code". Hono does not match a doubled
 * slash, so every request 404s and the app reports a network error — which
 * points at the wifi rather than at the one character that is wrong. Not
 * hypothetical: the value gets copied out of a browser address bar, and
 * browsers show the trailing slash.
 */
function normalizeBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim().replace(/\/+$/, '');
  return trimmed ? trimmed : undefined;
}

/** An exact URL to talk to. Wins over everything, in dev and (over https) in
 *  release. A teammate's machine, a tunnel, a staging Worker. */
const override = normalizeBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL);

/** Opt in to the `wrangler dev` running on this machine. Accepts "1" or "true"
 *  because both are what people type. */
const useLocalApi = /^(1|true)$/i.test(process.env.EXPO_PUBLIC_USE_LOCAL_API?.trim() ?? '');

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

function resolveDevBaseUrl(): string {
  if (override) return override;
  if (useLocalApi) return devApiBaseUrl();
  return PROD_API;
}

export const API_BASE_URL = __DEV__
  ? resolveDevBaseUrl()
  : overrideForRelease(override) || PROD_API;

// Say which backend this bundle is talking to, and why.
//
// Every confusing hour this file has caused came down to not knowing that.
// EXPO_PUBLIC_* is inlined at BUILD time, so an edited .env with no `--clear`
// and no app reload silently keeps the old value — and the only symptom is a
// network error that looks like a connectivity problem.
if (__DEV__) {
  const reason = override
    ? 'EXPO_PUBLIC_API_BASE_URL'
    : useLocalApi
      ? 'EXPO_PUBLIC_USE_LOCAL_API=1'
      : 'default';

  console.log(
    `[api] ${API_BASE_URL}  (${reason})` +
      (override || useLocalApi
        ? ''
        : '  — production database; set EXPO_PUBLIC_USE_LOCAL_API=1 for a local Worker'),
  );
}
