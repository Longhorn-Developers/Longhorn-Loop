import { Stack } from 'expo-router';
import { OnboardingProvider } from './context/OnboardingContext';

export default function RootLayout() {
  return (
    <OnboardingProvider>
      <Stack screenOptions={{ headerShown: false }}>
        {/* Entry: Login */}
        <Stack.Screen name="index" />

        {/* Auth flow */}
        <Stack.Screen name="(auth)" />

        {/* Onboarding flow */}
        <Stack.Screen name="(onboarding)" />

        {/* Main app tabs */}
        <Stack.Screen name="(tabs)" />
      </Stack>
    </OnboardingProvider>
  );
}
