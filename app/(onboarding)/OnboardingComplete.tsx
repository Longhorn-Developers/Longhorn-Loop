import { API_BASE_URL } from '@/app/config/api';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { appendImageFile } from '@/app/lib/imageForm';
import type { ThemeColors } from '@/app/lib/themeColors';
import { useThemeColors } from '@/app/lib/themeColors';
import { captureError } from '@/app/lib/monitoring';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  SafeAreaView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

export default function OnboardingComplete() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { data, setOnboardingComplete } = useOnboarding();

  // Has the user tapped the CTA at least once? Drives the button label.
  // false → "GO TO HOME PAGE", true → "TRY AGAIN" after a failed attempt.
  const [hasAttempted, setHasAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  /**
   * Notification preference — ASKED, not assumed.
   *
   * This screen used to post `notifications_enabled: true` unconditionally,
   * alongside three `agreed_*` flags that are genuinely implied by finishing
   * onboarding. Reminders are not: nobody was shown the question, so the value
   * recorded a decision the user never made. Settings then displayed a toggle
   * already switched on, which reads as "you chose this" rather than "we chose
   * for you".
   *
   * Defaulting ON is a deliberate product call, not an accident — the app's
   * core value is not missing events, and a beta tester who never finds the
   * Settings screen still gets reminders. But it is now visibly a default the
   * user can decline before it is ever written.
   *
   * Note this flag is only a stored preference. There is no expo-notifications
   * dependency and no push token anywhere in the app yet, so nothing actually
   * delivers on it — and no OS permission dialog appears here. When push does
   * land, the OS prompt should be requested at a moment the user has asked for
   * it, not fired blind on this screen.
   */
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  const checkScale = useRef(new Animated.Value(0)).current;
  const checkOpacity = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const textTranslate = useRef(new Animated.Value(24)).current;
  const buttonOpacity = useRef(new Animated.Value(0)).current;
  const buttonTranslate = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.spring(checkScale, {
          toValue: 1,
          friction: 5,
          tension: 80,
          useNativeDriver: true,
        }),
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
  //
  // The profile call is always multipart, even without a photo: the upload
  // picked on Avatar.tsx is a local URI up to this point (deferred, same as
  // the create-event flyer), and this is the one place it actually reaches
  // the server — accepting only-sometimes-multipart would mean branching this
  // request body for one optional field.
  const submitOnboarding = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const authHeaders = { Authorization: `Bearer ${data.token}` };

      const form = new FormData();
      form.append('first_name', data.firstName);
      form.append('last_name', data.lastName);
      form.append('avatar_config', JSON.stringify(data.avatarConfig));
      form.append('year_classification', data.selectedYear);
      form.append('unique_classification', JSON.stringify(data.uniqueClassification));
      form.append('majors', JSON.stringify(data.selectedMajors));
      form.append('tags', JSON.stringify(data.selectedTags));
      if (data.avatarPhotoUri) {
        await appendImageFile(form, 'photo', {
          uri: data.avatarPhotoUri,
          name: data.avatarPhotoName,
          mimeType: data.avatarPhotoMimeType,
        });
      }

      const profileRes = await fetch(`${API_BASE_URL}/users/me/profile`, {
        method: 'POST',
        headers: authHeaders,
        body: form,
      });
      if (!profileRes.ok) {
        const body = await profileRes.text().catch(() => '(no body)');
        throw new Error(`profile ${profileRes.status}: ${body}`);
      }

      const agreementsRes = await fetch(`${API_BASE_URL}/users/me/agreements`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agreed_responsible_use: true,
          agreed_visibility_acknowledgment: true,
          agreed_community_guidelines: true,
          notifications_enabled: notificationsEnabled,
        }),
      });
      if (!agreementsRes.ok) {
        const body = await agreementsRes.text().catch(() => '(no body)');
        throw new Error(`agreements ${agreementsRes.status}: ${body}`);
      }

      // Only after BOTH calls succeed. `onboarding_completed` is set by the
      // agreements endpoint, so a profile save that lands without it leaves a
      // half-made account — and caching "complete" here off the back of a
      // failure would send the next launch to a feed with no profile behind it.
      setOnboardingComplete(true);

      router.replace('/(tabs)/home');
    } catch (err) {
      // Reported, not just logged. This is the last step of signup: a failure
      // here leaves someone verified but with no profile, and they have no way
      // to tell us beyond "it didn't work". A console.error on their phone is
      // invisible to us.
      console.error('Onboarding submit failed:', err);
      captureError('onboarding.submit', err);
      setHasAttempted(true);
    } finally {
      setSubmitting(false);
    }
  };

  const buttonLabel = submitting ? 'SAVING…' : hasAttempted ? 'TRY AGAIN' : 'GO TO HOME PAGE';

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
          {/* Above the CTA on purpose. Below it and most people never see it,
              which puts us back where we started. */}
          <View style={styles.notifyRow}>
            <View style={styles.notifyText}>
              <Text style={styles.notifyTitle}>Event reminders</Text>
              <Text style={styles.notifySubtitle}>
                Get a heads-up before events you save. You can change this any time in Settings.
              </Text>
            </View>
            <Switch
              value={notificationsEnabled}
              onValueChange={setNotificationsEnabled}
              disabled={submitting}
              trackColor={{ true: colors.accent }}
              accessibilityLabel="Event reminders"
            />
          </View>

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

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.surface,
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
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 8,
    },
    checkmark: {
      fontSize: 48,
      color: c.ink,
      lineHeight: 56,
    },
    title: {
      fontSize: 20,
      fontWeight: '700',
      color: c.ink,
      textAlign: 'center',
      lineHeight: 28,
    },
    subtitle: {
      fontSize: 15,
      color: c.inkSecondary,
      textAlign: 'center',
    },
    buttonWrapper: {
      width: '100%',
      marginTop: 16,
    },
    notifyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
      marginBottom: 20,
    },
    notifyText: {
      flex: 1,
    },
    notifyTitle: {
      color: c.ink,
      fontFamily: 'Roboto-Flex',
      fontSize: 16,
      fontWeight: '600',
    },
    notifySubtitle: {
      color: c.inkSecondary,
      fontFamily: 'Roboto-Flex',
      fontSize: 13,
      marginTop: 2,
    },
    button: {
      backgroundColor: c.brand,
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
