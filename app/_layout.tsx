import { Stack } from 'expo-router';
import { useState } from 'react';
import SplashScreen from './components/SplashScreen';
import { OnboardingProvider } from './context/OnboardingContext';

export default function RootLayout() {
  const [splashDone, setSplashDone] = useState(false);

  return (
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
      </Stack>

      {!splashDone && <SplashScreen onFinish={() => setSplashDone(true)} />}
    </OnboardingProvider>
  );
}
