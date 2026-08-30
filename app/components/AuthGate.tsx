// Keeps signed-out users out of signed-in screens, whatever route they took.
//
// THE BUG THIS EXISTS FOR. Log Out lives on app/settings/preferences.tsx,
// which is PUSHED on top of (tabs). It finished with router.replace('/'), and
// replace swaps the current route -- preferences -- leaving (tabs) sitting
// underneath in the stack. So after logging out and starting to sign back in,
// swiping back walked down through index and landed on the home tab, still
// mounted, with no token. Every screen there renders from react-query's cache,
// so it looked like a working, signed-in app.
//
// app/settings/delete-account.tsx ended the same way, which is worse: the
// account is gone from the database and the phone still shows it.
//
// A GUARD, NOT A NAVIGATION FIX. Clearing the stack at each logout site is the
// obvious repair and it only closes the two doors we know about; the next
// screen that logs someone out re-opens one. This asks the only question that
// actually matters -- is there a token, and is this a screen that needs one --
// on every navigation, so a route added next month is covered by default.
//
// PROTECTED BY DEFAULT, for the same reason. The list below is what a signed
// OUT user may see; everything else requires a session. A new screen is
// protected unless someone deliberately adds it here.

import { useOnboarding } from '@/app/context/OnboardingContext';
import { useRouter, useSegments } from 'expo-router';
import React, { useEffect } from 'react';

/**
 * Route groups a signed-out user is allowed to be in.
 *
 * `index` is the entry screen, which decides for itself where to send you;
 * `(auth)` is signing in; `(onboarding)` runs AFTER a token exists but before
 * the profile is finished, so it is reachable with a session and pointless
 * without one -- the screens inside it redirect on their own.
 */
const PUBLIC_SEGMENTS = new Set(['(auth)', '(onboarding)']);

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { data, isHydrating } = useOnboarding();
  const segments = useSegments();
  const router = useRouter();

  const token = data.token;
  const group = segments[0];

  useEffect(() => {
    // Reading the token mid-hydration reports '' for someone perfectly signed
    // in, and redirecting on that would throw every returning user back to the
    // front page while the keychain read finishes.
    if (isHydrating) return;
    if (token) return;

    // segments is [] on the entry route itself, which is public.
    if (group === undefined || PUBLIC_SEGMENTS.has(group)) return;

    // dismissAll first, so the protected screens actually leave the stack
    // rather than staying underneath the redirect for the next back-swipe to
    // find. replace alone is what caused this in the first place.
    if (router.canDismiss()) router.dismissAll();
    router.replace('/');
  }, [isHydrating, token, group, router]);

  return <>{children}</>;
}
