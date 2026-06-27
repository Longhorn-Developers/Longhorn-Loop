// Shown after a successful report submission. Confirms receipt and gives
// the user a clean "Return Home" exit (instead of leaving them on the
// event they just reported, which is now hidden for them anyway).

import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const BG = '#F9F8F5';
const BURNT_ORANGE = '#BF5700';
const TEXT_PRIMARY = '#020B12';

export default function ReportSuccessScreen() {
  const router = useRouter();

  const goHome = () => router.replace('/(tabs)/home');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }}>
      <View style={styles.container}>
        <View style={styles.checkCircle}>
          <Text style={styles.checkMark}>✓</Text>
        </View>

        <Text style={styles.body}>
          We appreciate your report and will review this event soon!
        </Text>

        <Pressable onPress={goHome} style={styles.button}>
          <Text style={styles.buttonText}>RETURN HOME</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = {
  container: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingHorizontal: 32,
  },
  checkCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: BURNT_ORANGE,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 32,
  },
  checkMark: {
    color: '#fff',
    fontSize: 44,
    fontWeight: '700' as const,
    lineHeight: 48,
  },
  body: {
    fontSize: 18,
    color: TEXT_PRIMARY,
    textAlign: 'center' as const,
    lineHeight: 26,
    marginBottom: 40,
  },
  button: {
    backgroundColor: BURNT_ORANGE,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700' as const,
    letterSpacing: 1,
  },
};
