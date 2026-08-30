// App entry point — loads global styles, then decides where a launch lands.
//
// This used to be a one-line re-export of FrontPage, which meant every cold
// start began at the onboarding carousel no matter who you were. Combined with
// a token that lived only in React state, a returning user had to request and
// type an emailed code every single time they opened the app.
//
// Now the session is restored from secure storage first (OnboardingContext),
// and this file routes on the result:
//
//   no token            -> FrontPage, the normal signed-out entry
//   token, onboarded    -> straight to the feed
//   token, not onboarded-> resume onboarding rather than drop them on an empty
//                          feed. Happens to anyone who verified their email and
//                          then quit partway through the profile steps.
//
// An expired token counts as "no token": loadSession checks `exp` locally and
// clears it, so nobody gets let in on a credential the Worker will reject.

import { Redirect } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import FrontPage from './(auth)/FrontPage';
import { useOnboarding } from './context/OnboardingContext';
import { useThemeColors } from './lib/themeColors';

export default function Index() {
  const { data, isHydrating, onboardingComplete } = useOnboarding();
  const colors = useThemeColors();

  // Reading the token before hydration finishes reports '' for a user who is
  // perfectly signed in — which would flash FrontPage and then redirect. A
  // themed blank is only on screen for the few milliseconds the keychain read
  // takes; rendering null instead would show white in dark mode.
  if (isHydrating) {
    return <View className="flex-1" style={{ backgroundColor: colors.background }} />;
  }

  if (data.token) {
    return <Redirect href={onboardingComplete ? '/(tabs)/home' : '/CreateAccount'} />;
  }

  return <FrontPage />;
}
