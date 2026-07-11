import { API_BASE_URL } from '@/app/config/api';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  NativeSyntheticEvent,
  Pressable,
  Text,
  TextInput,
  TextInputKeyPressEventData,
  View,
} from 'react-native';
import InlineAlert from '../components/alerts/InlineAlert';
import PrimaryButton from '../components/buttons/PrimaryButton';
import OtpInput from '../components/inputs/OtpInputField';
import FlowLayout from '../components/layouts/FlowLayout';

export default function AccountVerification() {
  const router = useRouter();
  const { data, update } = useOnboarding();
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [sendingInitialCode, setSendingInitialCode] = useState(true);
  const inputs = useRef<(TextInput | null)[]>([]);
  const hasSentInitialCode = useRef(false);

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
            setError('Please use a valid @utexas.edu email address.');
          } else {
            setError(result.error || 'Failed to send verification code. Please try again.');
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
          setError('Please use a valid @utexas.edu email address.');
        } else {
          setError(result.error || 'Something went wrong. Please try again.');
        }
        return;
      }

      const token = result.token;
      if (token) {
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
          setError('Please use a valid @utexas.edu email address.');
        } else {
          setError(result.error || 'Failed to resend code. Please try again.');
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

      <View className="mt-[42px]">
        <PrimaryButton
          label="Verify Email"
          isFilled={allFilled}
          onPress={handleVerify}
          isLoading={loading}
          loadingLabel="Verifying..."
        />
      </View>

      <Pressable className="mt-4" onPress={handleResend}>
        <Text className="font-['Roboto-Flex'] text-base text-center">
          {"Didn't receive the code? "}
          <Text className="font-['Roboto-Flex'] font-semibold text-lhlBurntOrange">
            {resending ? 'Sending...' : 'Resend Code'}
          </Text>
        </Text>
      </Pressable>
    </FlowLayout>
  );
}
