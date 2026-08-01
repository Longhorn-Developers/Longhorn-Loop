import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as NativeSplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import SplashScreen from './components/SplashScreen';
import { OnboardingProvider } from './context/OnboardingContext';
import { ThemeProvider, useAppTheme } from './context/ThemeContext';
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

        {/* Create Event multi-step flow */}
        <Stack.Screen name="(create-event)" />

        {/* View All events screen */}
        <Stack.Screen name="view-all" />

        {/* Edit Profile + Past Events, pushed from the Profile tab */}
        <Stack.Screen name="profile/edit" />
        <Stack.Screen name="profile/past" />

        {/* Org Management console + registration */}
        <Stack.Screen name="org/[id]/index" />
        <Stack.Screen name="org/[id]/notifications" />
        <Stack.Screen name="org/register" />

        {/* Settings */}
        <Stack.Screen name="settings/index" />
        <Stack.Screen name="settings/preferences" />
        <Stack.Screen name="settings/feedback" />

        {/* Event detail + nested screens */}
        <Stack.Screen name="event/[id]/index" />
        <Stack.Screen name="event/[id]/report" />
        <Stack.Screen name="event/[id]/report-success" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [splashDone, setSplashDone] = useState(false);

  // Load the Roboto Flex variable font file
  const [fontsLoaded, fontError] = useFonts({
    'Roboto-Flex': require('../assets/fonts/RobotoFlex-VariableFont.ttf'),
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
          <ThemedStack />

          {!splashDone && <SplashScreen onFinish={() => setSplashDone(true)} />}
        </ThemeProvider>
      </OnboardingProvider>
    </QueryClientProvider>
  );
}
