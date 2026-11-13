import InlineAlert from '@/app/components/alerts/InlineAlert';
import PrimaryButton from '@/app/components/buttons/PrimaryButton';
import TextInputField from '@/app/components/inputs/TextInputField';
import FlowLayout from '@/app/components/layouts/FlowLayout';
import { API_BASE_URL } from '@/app/config/api';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { UT_EMAIL_ERROR, isAllowedUTEmail } from '@/shared/utEmail';
import { RESEND_COOLDOWN_MS } from '@/shared/verificationCode';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';

export default function RegisterPage() {
  const router = useRouter();
  const { update } = useOnboarding();

  const [fieldFirstName, setFieldFirstName] = useState('');
  const [fieldLastName, setFieldLastName] = useState('');
  const [fieldEmail, setFieldEmail] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [loading, setLoading] = useState(false);

  // LOOP-255: the same allow-list the Worker enforces.
  const isEmailValid = isAllowedUTEmail(fieldEmail);

  const validateForm = () => {
    if (!fieldFirstName.trim()) {
      return 'Please enter your first name.';
    }
    if (!fieldLastName.trim()) {
      return 'Please enter your last name.';
    }
    if (!isEmailValid) {
      return UT_EMAIL_ERROR;
    }
    return '';
  };

  const handleSubmit = async () => {
    const error = validateForm();
    if (error) {
      setAlertMessage(error);
      return;
    }

    setLoading(true);
    setAlertMessage('');

    try {
      const email = fieldEmail.trim().toLowerCase();
      const res = await fetch(`${API_BASE_URL}/auth/send-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      // RESEND_TOO_SOON is not a failure here (LOOP-302). It means a code for
      // this address went out a moment ago — typically from this same screen,
      // before the user tapped back off the verification step to check their
      // email and then tapped Continue again. That code is still valid. The
      // old alert stranded them on this page with "please wait", no idea how
      // long, and no way forward to type the code they already had.
      const tooSoon = !res.ok && data.error === 'RESEND_TOO_SOON';

      if (!res.ok && !tooSoon) {
        if (data.error === 'INVALID_UT_EMAIL') {
          setAlertMessage(UT_EMAIL_ERROR);
        } else if (data.error === 'SEND_FAILED') {
          setAlertMessage("We couldn't send your code right now. Please try again.");
        } else {
          setAlertMessage('Something went wrong. Please try again.');
        }
        return;
      }

      // Store user info and navigate to verification
      update({
        firstName: fieldFirstName.trim(),
        lastName: fieldLastName.trim(),
        email,
      });
      // ?sent=1: a code is already out (just now, or from the earlier send
      // that caused the 429). Without it the verification screen sends a
      // second one on mount and immediately trips the cooldown.
      // retryAfterMs: so Resend shows the real wait instead of looking
      // available while the server would refuse it.
      const retryAfterMs = tooSoon ? data.retryAfterMs : RESEND_COOLDOWN_MS;
      router.push(`/AccountVerification?sent=1&retryAfterMs=${Number(retryAfterMs) || 0}`);
    } catch (_err) {
      setAlertMessage('Network error. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <FlowLayout
      title="Welcome!"
      subTitle="Start by creating an account."
      onBackPress={() => router.back()}
    >
      {alertMessage && (
        <View className="mt-4">
          <InlineAlert message={alertMessage} />
        </View>
      )}

      <View className="mt-[42px]">
        <TextInputField
          label="First Name"
          placeholder="Enter your first name"
          clearable={true}
          value={fieldFirstName}
          onChangeText={(text) => {
            setFieldFirstName(text);
            setAlertMessage('');
          }}
        />
      </View>

      <View className="mt-4">
        <TextInputField
          label="Last Name"
          placeholder="Enter your last name"
          clearable={true}
          value={fieldLastName}
          onChangeText={(text) => {
            setFieldLastName(text);
            setAlertMessage('');
          }}
        />
      </View>

      <View className="mt-4">
        <TextInputField
          label="UT Email"
          placeholder="Enter your UT email address"
          clearable={true}
          value={fieldEmail}
          onChangeText={(text) => {
            setFieldEmail(text);
            setAlertMessage('');
          }}
        />
      </View>

      <View className="mt-[42px]">
        <PrimaryButton
          label={loading ? 'Sending...' : 'Sign Up'}
          isFilled={isEmailValid && !loading}
          onPress={loading ? undefined : handleSubmit}
        />
      </View>
    </FlowLayout>
  );
}
