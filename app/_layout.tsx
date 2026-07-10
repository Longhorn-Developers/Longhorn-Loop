import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as NativeSplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import SplashScreen from './components/SplashScreen';
import { OnboardingProvider } from './context/OnboardingContext';

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
        <Stack screenOptions={{ headerShown: false }}>
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

          {/* Event detail + nested screens */}
          <Stack.Screen name="event/[id]/index" />
          <Stack.Screen name="event/[id]/report" />
          <Stack.Screen name="event/[id]/report-success" />
        </Stack>

        {!splashDone && <SplashScreen onFinish={() => setSplashDone(true)} />}
      </OnboardingProvider>
    </QueryClientProvider>
  );
}
