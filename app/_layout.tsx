import { Baloo2_400Regular, Baloo2_700Bold } from '@expo-google-fonts/baloo-2';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as NativeSplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import AnimatedSplash from './components/AnimatedSplash';
import { OnboardingProvider } from './context/OnboardingContext';
import { ThemeProvider, useAppTheme } from './context/ThemeContext';
import { initMonitoring } from './lib/monitoring';
import { useThemeColors } from './lib/themeColors';

// One QueryClient for the whole app. 30s staleTime means same-key queries
// won't refetch within 30s of the last fetch. Mutations still force fresh
// data via queryClient.invalidateQueries().
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

// Prevent the native splash screen from auto-hiding before assets are loaded
NativeSplashScreen.preventAutoHideAsync();

// Crash reporting, started before any screen mounts so an error during the
// first render is still captured. No-op without the SDK or a DSN — see
// lib/monitoring.ts for why that matters.
initMonitoring();

/**
 * The navigator, plus the two themed things that live outside any screen.
 *
 * Split out of RootLayout because both hooks have to run INSIDE ThemeProvider.
 *
 *  - The status bar has no colour of its own; it only chooses whether the
 *    clock and battery glyphs are drawn dark or light. Left alone it draws
 *    dark, which on a dark page is invisible.
 *  - `contentStyle` is the canvas React Navigation paints behind a screen
 *    during a push or pop. It defaults to white, so every transition flashed
 *    white before the dark screen faded in.
 */
function ThemedStack() {
  const { isDark } = useAppTheme();
  const colors = useThemeColors();

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        {/* Entry: FrontPage */}
        <Stack.Screen name="index" />

        {/* Auth flow */}
        <Stack.Screen name="(auth)" />

        {/* Onboarding flow */}
        <Stack.Screen name="(onboarding)" />

        {/* Main tabs — disable swipe back to prevent returning to onboarding */}
        <Stack.Screen name="(tabs)" options={{ gestureEnabled: false }} />

        {/* View All events screen */}
        <Stack.Screen name="view-all" />

        {/* Edit Profile + Past Events, pushed from the Profile tab */}
        <Stack.Screen name="profile/edit" />
        <Stack.Screen name="profile/past" />

        {/* Org Management console + registration */}
        <Stack.Screen name="org/[id]/index" />
        <Stack.Screen name="org/[id]/notifications" />
        <Stack.Screen name="org/register" />

        {/* Public profiles — somebody else's, and an org's (LOOP-180). The
            org one is a sibling of the console above, not a tab inside it:
            different audience, different endpoints. */}
        <Stack.Screen name="user/[id]" />
        <Stack.Screen name="org/[id]/profile" />

        {/* Settings */}
        <Stack.Screen name="settings/index" />
        <Stack.Screen name="settings/preferences" />
        <Stack.Screen name="settings/feedback" />
        {/* Delete Account code confirmation (LOOP-131). */}
        <Stack.Screen name="settings/delete-account" />
        {/* Followed-org notification toggles (LOOP-180, Frame 471). */}
        <Stack.Screen name="settings/followed-orgs" />

        {/* Event detail + nested screens */}
        <Stack.Screen name="event/[id]/index" />
        <Stack.Screen name="event/[id]/report" />
        <Stack.Screen name="event/[id]/report-success" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  // Each weight is a separate static file with its own family name. React
  // Native can't pick a weight off a single variable font, so a shared family
  // collides and renders one weight everywhere. tailwind maps font-roboto-*
  // onto these.

  const [showAnimatedSplash, setShowAnimatedSplash] = useState(true);

  const [fontsLoaded, fontError] = useFonts({
    'Roboto-Flex': require('../assets/fonts/RobotoFlex-VariableFont.ttf'),
    'Roboto-Flex-Medium': require('../assets/fonts/RobotoFlex-Medium.ttf'),
    'Roboto-Flex-SemiBold': require('../assets/fonts/RobotoFlex-SemiBold.ttf'),
    'Roboto-Flex-Bold': require('../assets/fonts/RobotoFlex-Bold.ttf'),
    // Customize Bevo (Figma "Content" panel: Baloo, 400 Regular) — its own
    // font, distinct from the app's Roboto Flex default.
    'Baloo2-Regular': Baloo2_400Regular,
    'Baloo2-Bold': Baloo2_700Bold,
  });

  // Hide the native splash screen once the font is loaded (or fails)
  useEffect(() => {
    if (fontsLoaded || fontError) {
      NativeSplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // Prevent rendering anything until the font asset is fully ready
  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <OnboardingProvider>
        <ThemeProvider>
          {/* The splash floats OVER the navigator rather than replacing it. As
              a ternary it faded out over nothing and the first screen mounted
              cold afterwards — a pop, not a cross-fade. This also lets session
              hydration happen behind the video. */}
          <View className="flex-1">
            <ThemedStack />

            {showAnimatedSplash && <AnimatedSplash onFinish={() => setShowAnimatedSplash(false)} />}
          </View>
        </ThemeProvider>
      </OnboardingProvider>
    </QueryClientProvider>
  );
}
