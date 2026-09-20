// Where the appearance choice lives between launches.
//
// ---------------------------------------------------------------------------
// WHY THIS IS ON THE DEVICE AND NOT ON THE SERVER.
//
// The old setting was a server-side boolean, `user_settings.dark_mode`, synced
// across every device on the account. Appearance stopped being that kind of
// setting the moment "System" existed:
//
//   - "Follow the system" is a statement about THIS phone. Syncing it is
//     meaningless — the answer is already per-device, because the OS setting is.
//   - Someone can reasonably want dark on a phone they read in bed and light on
//     an iPad in a lecture hall. A synced boolean can't express that; it is the
//     same reason iOS keeps Appearance in Settings and not in an account.
//   - It applies before the first network call. A server-backed theme flashes
//     the wrong palette on every cold start while /settings is in flight.
//
// The legacy column is still read ONCE, by ThemeContext, to carry an existing
// dark-mode user across the upgrade. Nothing writes it any more, and it can be
// dropped from user_settings whenever someone is doing a migration anyway.
//
// SecureStore rather than AsyncStorage, which is heavier than a theme needs:
// it is what this app already depends on (see session.ts) and adding a storage
// package for one enum is a worse trade than over-securing a colour. Same
// web-degradation shape as session.ts, for the same reason — SecureStore has no
// web implementation and throws if called there.

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** What the user chose. `system` defers to the OS, and is the default. */
export type ThemePreference = 'system' | 'light' | 'dark';

const KEY = 'lhl.theme.preference';

const isWeb = Platform.OS === 'web';

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/**
 * localStorage, not sessionStorage.
 *
 * session.ts deliberately uses sessionStorage because a bearer token should not
 * outlive the tab. A colour preference should — losing it on every refresh is
 * the bug, not the safeguard.
 */
function webStore(): Storage | null {
  try {
    return typeof globalThis !== 'undefined' && 'localStorage' in globalThis
      ? (globalThis as unknown as { localStorage: Storage }).localStorage
      : null;
  } catch {
    // Some embedded browsers throw on access rather than returning undefined.
    return null;
  }
}

/**
 * The stored choice, or null if this device has never expressed one.
 *
 * Null is meaningful and is NOT the same as 'system': it is what tells
 * ThemeContext it may still adopt the legacy server value. Collapsing the two
 * would silently reset every existing dark-mode user to system on upgrade.
 */
export async function loadThemePreference(): Promise<ThemePreference | null> {
  try {
    const raw = isWeb ? (webStore()?.getItem(KEY) ?? null) : await SecureStore.getItemAsync(KEY);
    return isThemePreference(raw) ? raw : null;
  } catch {
    // Storage being unavailable is not a reason to fail to render. The caller
    // falls back to 'system', which is the right answer anyway.
    return null;
  }
}

export async function saveThemePreference(preference: ThemePreference): Promise<void> {
  try {
    if (isWeb) webStore()?.setItem(KEY, preference);
    else await SecureStore.setItemAsync(KEY, preference);
  } catch {
    // A theme that fails to persist still applied for this session; there is
    // nothing useful to tell the user and nothing to retry.
  }
}
