import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
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

export default function RootLayout() {
  const [splashDone, setSplashDone] = useState(false);

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
