import { API_BASE_URL } from '@/app/config/api';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function OnboardingComplete() {
  const router = useRouter();
  const { data } = useOnboarding();

  // Has the user tapped the CTA at least once? Drives the button label.
  // false → "GO TO HOME PAGE", true → "TRY AGAIN" after a failed attempt.
  const [hasAttempted, setHasAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const checkScale = useRef(new Animated.Value(0)).current;
  const checkOpacity = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const textTranslate = useRef(new Animated.Value(24)).current;
  const buttonOpacity = useRef(new Animated.Value(0)).current;
  const buttonTranslate = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.spring(checkScale, { toValue: 1, friction: 5, tension: 80, useNativeDriver: true }),
        Animated.timing(checkOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(textOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(textTranslate, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(buttonOpacity, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.timing(buttonTranslate, { toValue: 0, duration: 350, useNativeDriver: true }),
      ]),
    ]).start();
  }, []);

  // Save the collected onboarding data to the backend, then navigate home.
  // Two calls: profile first (creates the user row), agreements second
  // (the agreements endpoint UPDATEs and assumes the row exists).
  const submitOnboarding = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${data.token}`,
      };

      const profileRes = await fetch(`${API_BASE_URL}/users/me/profile`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          first_name: data.firstName,
          last_name: data.lastName,
          avatar: data.avatar,
          year_classification: data.selectedYear,
          unique_classification: data.uniqueClassification,
          majors: data.selectedMajors,
          tags: data.selectedTags,
        }),
      });
      if (!profileRes.ok) throw new Error('profile failed');

      const agreementsRes = await fetch(`${API_BASE_URL}/users/me/agreements`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          agreed_responsible_use: true,
          agreed_visibility_acknowledgment: true,
          agreed_community_guidelines: true,
          notifications_enabled: true,
        }),
      });
      if (!agreementsRes.ok) throw new Error('agreements failed');

      router.replace('/(tabs)/home');
    } catch (err) {
      console.error('Onboarding submit failed:', err);
      setHasAttempted(true);
    } finally {
      setSubmitting(false);
    }
  };

  const buttonLabel = submitting
    ? 'SAVING…'
    : hasAttempted
      ? 'TRY AGAIN'
      : 'GO TO HOME PAGE';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Animated.View
          style={[
            styles.checkCircle,
            { opacity: checkOpacity, transform: [{ scale: checkScale }] },
          ]}
        >
          <Text style={styles.checkmark}>✓</Text>
        </Animated.View>

        <Animated.Text
          style={[
            styles.title,
            { opacity: textOpacity, transform: [{ translateY: textTranslate }] },
          ]}
        >
          You have completed onboarding and are ready to explore all events!
        </Animated.Text>

        <Animated.Text
          style={[
            styles.subtitle,
            { opacity: textOpacity, transform: [{ translateY: textTranslate }] },
          ]}
        >
          Welcome to Longhorn Loop 🤘
        </Animated.Text>

        <Animated.View
          style={[
            styles.buttonWrapper,
            { opacity: buttonOpacity, transform: [{ translateY: buttonTranslate }] },
          ]}
        >
          <TouchableOpacity
            style={[styles.button, submitting && styles.buttonDisabled]}
            onPress={submitOnboarding}
            disabled={submitting}
            activeOpacity={0.85}
          >
            <Text style={styles.buttonText}>{buttonLabel}</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    gap: 20,
  },
  checkCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    borderColor: '#1f2937',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  checkmark: {
    fontSize: 48,
    color: '#1f2937',
    lineHeight: 56,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    lineHeight: 28,
  },
  subtitle: {
    fontSize: 15,
    color: '#6b7280',
    textAlign: 'center',
  },
  buttonWrapper: {
    width: '100%',
    marginTop: 16,
  },
  button: {
    backgroundColor: '#BF5700',
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
    letterSpacing: 1,
  },
});
