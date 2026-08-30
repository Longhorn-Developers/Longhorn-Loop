import { API_BASE_URL } from '@/app/config/api';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  NativeSyntheticEvent,
  Pressable,
  Text,
  TextInput,
  TextInputKeyPressEventData,
  View,
} from 'react-native';
import { useThemeColors } from '@/app/lib/themeColors';
import { UT_EMAIL_ERROR } from '@/shared/utEmail';
import InlineAlert from '../components/alerts/InlineAlert';
import PrimaryButton from '../components/buttons/PrimaryButton';
import OtpInput from '../components/inputs/OtpInputField';
import FlowLayout from '../components/layouts/FlowLayout';

export default function AccountVerification() {
  const router = useRouter();
  const params = useLocalSearchParams<{ sent?: string }>();
  const colors = useThemeColors();
  const { data, update, setOnboardingComplete } = useOnboarding();
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  // Starts true only when this screen is the one that has to send the code.
  // LoginPage and RegisterPage both send it themselves and arrive with ?sent=1
  // — firing a second /auth/send-code here would immediately trip the
  // 60-second cooldown that the first request just started.
  const [sendingInitialCode, setSendingInitialCode] = useState(params.sent !== '1');
  const inputs = useRef<(TextInput | null)[]>([]);
  const hasSentInitialCode = useRef(params.sent === '1');

  const allFilled = code.every((digit) => digit !== '');

  useEffect(() => {
    if (hasSentInitialCode.current || !data.email) {
      setSendingInitialCode(false);
      return;
    }
    hasSentInitialCode.current = true;

    const sendInitialCode = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/auth/send-code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: data.email }),
        });

        const result = await res.json();

        if (!res.ok) {
          if (result.error === 'RESEND_TOO_SOON') {
            // A code was already sent very recently
          } else if (result.error === 'INVALID_UT_EMAIL') {
            setError(UT_EMAIL_ERROR);
          } else {
            // Never render result.error directly — it is a machine code like
            // MISSING_FIELDS, and testers were seeing it verbatim.
            setError('Failed to send verification code. Please try again.');
          }
        }
      } catch (_err) {
        setError('Network error. Please check your connection.');
      } finally {
        setSendingInitialCode(false);
      }
    };

    sendInitialCode();
  }, [data.email]);

  const handleChange = (text: string, index: number) => {
    const cleanText = text.replace(/[^0-9]/g, '');

    if (text.length > 0 && cleanText.length === 0) {
      return;
    }

    const newCode = [...code];
    newCode[index] = text.slice(-1);
    setCode(newCode);
    setError('');

    if (text && index < 5) {
      inputs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>, index: number) => {
    if (e.nativeEvent.key === 'Backspace') {
      if (code[index]) {
        const newCode = [...code];
        newCode[index] = '';
        setCode(newCode);
      } else if (index > 0) {
        const newCode = [...code];
        newCode[index - 1] = '';
        setCode(newCode);
        inputs.current[index - 1]?.focus();
      }
    }
  };

  const handleVerify = async () => {
    if (!allFilled || loading) return;

    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${API_BASE_URL}/auth/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: data.email,
          code: code.join(''),
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        if (result.error === 'INVALID_CODE') {
          setError('Incorrect code. Please try again.');
          setCode(['', '', '', '', '', '']);
          inputs.current[0]?.focus();
        } else if (result.error === 'CODE_EXPIRED') {
          setError('Code has expired. Please request a new one.');
        } else if (result.error === 'TOO_MANY_ATTEMPTS') {
          setError('Too many attempts. Please request a new code.');
        } else if (result.error === 'CODE_NOT_FOUND') {
          setError('No verification code found. Please request a new one.');
        } else if (result.error === 'INVALID_UT_EMAIL') {
          setError(UT_EMAIL_ERROR);
        } else {
          setError('Something went wrong. Please try again.');
        }
        return;
      }

      const token = result.token;
      if (token) {
        // This is what persists the session — update() mirrors a new token to
        // secure storage, so the next cold start skips all of this.
        update({ token });
      }

      try {
        const profileRes = await fetch(`${API_BASE_URL}/users/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (profileRes.ok) {
          const profileData = await profileRes.json();
          if (profileData.user?.onboarding_completed) {
            update({
              firstName: profileData.user.first_name || '',
              lastName: profileData.user.last_name || '',
            });
            // Cache it so the launch gate can route straight to the feed
            // without waiting on a network call.
            setOnboardingComplete(true);
            router.replace('/(tabs)/home');
            return;
          }
        }
      } catch {
        // If profile check fails, fall through to onboarding
      }

      router.push('/CreateAccount');
    } catch (_err) {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resending) return;

    setResending(true);
    setError('');

    try {
      const res = await fetch(`${API_BASE_URL}/auth/resend-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.email }),
      });

      const result = await res.json();

      if (!res.ok) {
        if (result.error === 'RESEND_TOO_SOON') {
          setError('Please wait before requesting a new code.');
        } else if (result.error === 'INVALID_UT_EMAIL') {
          setError(UT_EMAIL_ERROR);
        } else {
          setError('Failed to resend code. Please try again.');
        }
        return;
      }

      setCode(['', '', '', '', '', '']);
      inputs.current[0]?.focus();
    } catch (_err) {
      setError('Network error. Please check your connection.');
    } finally {
      setResending(false);
    }
  };

  const showAlert = error.length > 0;

  return (
    <FlowLayout
      title="Account Verification"
      subTitle={`We've sent a verification code to your email.\nEnter the code below.`}
      onBackPress={() => router.back()}
    >
      {showAlert && (
        <View className="mt-4">
          <InlineAlert message={error} />
        </View>
      )}

      <View className="mt-[42px]">
        <OtpInput
          code={code}
          error={showAlert}
          inputs={inputs}
          handleChange={handleChange}
          handleKeyPress={handleKeyPress}
        />
      </View>

      {/* Without this the screen showed six empty boxes and nothing else while
          the first code was still being requested. On a slow connection that
          reads as broken, and the natural response — tapping Resend — trips
          the 60-second cooldown the pending request is about to create. */}
      {sendingInitialCode && (
        <View className="mt-4 flex-row items-center justify-center gap-2">
          <ActivityIndicator size="small" color={colors.brand} />
          <Text className="font-['Roboto-Flex'] text-sm text-lhlSecondaryTextGrey">
            Sending your code...
          </Text>
        </View>
      )}

      <View className="mt-[42px]">
        <PrimaryButton
          label="Verify Email"
          isFilled={allFilled && !sendingInitialCode}
          onPress={handleVerify}
          isLoading={loading}
          loadingLabel="Verifying..."
        />
      </View>

      <Pressable className="mt-4" disabled={sendingInitialCode || resending} onPress={handleResend}>
        {/* All 400 — the accent colour marks the tappable half. */}
        <Text className="text-center font-roboto text-base text-lhlInk">
          {"Didn't receive the code? "}
          <Text className="font-roboto text-lhlAccent">
            {resending ? 'Sending...' : 'Resend Code'}
          </Text>
        </Text>
      </Pressable>
    </FlowLayout>
  );
}
