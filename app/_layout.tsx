import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as NativeSplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import SplashScreen from './components/SplashScreen';
import { OnboardingProvider } from './context/OnboardingContext';

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