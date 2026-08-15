// Where the signed-in session lives between app launches.
//
// Before this file the auth token lived only in OnboardingContext's useState,
// so every cold start threw it away and sent the user back through
// FrontPage -> email -> wait for a code -> six digits. The server was never
// the problem: /auth/verify-code issues a JWT good for 7 days and getAuthUser
// honours it. The client simply forgot.
//
// WHY SecureStore RATHER THAN AsyncStorage. The token is a bearer credential
// — anything holding it is the user until it expires. SecureStore puts it in
// the iOS keychain and Android's encrypted store; AsyncStorage is a plaintext
// file that any backup or rooted-device dump reads straight out.
//
// WEB. SecureStore has no web implementation and throws if called there. The
// app has a web output target, so every call goes through the guards below and
// degrades to sessionStorage on web — which is the honest ceiling for a
// browser anyway, and keeps a refresh from logging you out.

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { isJwtExpired } from '@/shared/jwtExpiry';

const TOKEN_KEY = 'lhl.session.token';
const EMAIL_KEY = 'lhl.session.email';
const ONBOARDED_KEY = 'lhl.session.onboarded';

export interface StoredSession {
  token: string;
  email: string;
  /**
   * Whether this user has finished onboarding.
   *
   * Stored rather than re-fetched so the launch gate can decide where to send
   * someone without a network round trip on every cold start — and so it still
   * decides correctly with no connection.
   *
   * It matters because the token is saved the moment a code verifies, which is
   * BEFORE onboarding runs. Without this flag, a user who verified and then
   * quit halfway through onboarding would be sent to the feed on next launch
   * with no profile row behind them. The server is the source of truth
   * (`users.onboarding_completed`); this is a cache of it, refreshed every time
   * we hear from /users/me.
   */
  onboardingComplete: boolean;
}

const isWeb = Platform.OS === 'web';

/** sessionStorage, but only if this really is a browser that has it. */
function webStore(): Storage | null {
  try {
    return typeof globalThis !== 'undefined' && 'sessionStorage' in globalThis
      ? (globalThis as unknown as { sessionStorage: Storage }).sessionStorage
      : null;
  } catch {
    // Some embedded browsers throw on access rather than returning undefined.
    return null;
  }
}

async function setItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    webStore()?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function getItem(key: string): Promise<string | null> {
  if (isWeb) return webStore()?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

async function removeItem(key: string): Promise<void> {
  if (isWeb) {
    webStore()?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

/** Persist a session. Called right after a code verifies. */
export async function saveSession(session: StoredSession): Promise<void> {
  try {
    await setItem(TOKEN_KEY, session.token);
    await setItem(EMAIL_KEY, session.email);
    await setItem(ONBOARDED_KEY, session.onboardingComplete ? '1' : '0');
  } catch (err) {
    // A failed write must not break sign-in. The user is authenticated for
    // this launch either way; they just won't be remembered next time.
    console.warn('[session] could not persist session:', err);
  }
}

/**
 * Read the stored session at launch.
 *
 * Returns null when there is nothing stored OR when what is stored has
 * expired — and clears the expired copy on the way out, so a stale token is
 * not re-read on every subsequent launch.
 */
export async function loadSession(): Promise<StoredSession | null> {
  try {
    const [token, email, onboarded] = await Promise.all([
      getItem(TOKEN_KEY),
      getItem(EMAIL_KEY),
      getItem(ONBOARDED_KEY),
    ]);
    if (!token || !email) return null;

    if (isJwtExpired(token)) {
      await clearSession();
      return null;
    }

    return { token, email, onboardingComplete: onboarded === '1' };
  } catch (err) {
    console.warn('[session] could not read session:', err);
    return null;
  }
}

/**
 * Update just the onboarding flag on an already-stored session.
 *
 * Called when onboarding finishes, and whenever /users/me tells us something
 * different from what we cached.
 */
export async function markOnboardingComplete(complete: boolean): Promise<void> {
  try {
    await setItem(ONBOARDED_KEY, complete ? '1' : '0');
  } catch (err) {
    console.warn('[session] could not update onboarding flag:', err);
  }
}

/** Forget the session. Log Out, account deletion, and an expired token. */
export async function clearSession(): Promise<void> {
  try {
    await Promise.all([removeItem(TOKEN_KEY), removeItem(EMAIL_KEY), removeItem(ONBOARDED_KEY)]);
  } catch (err) {
    console.warn('[session] could not clear session:', err);
  }
}
