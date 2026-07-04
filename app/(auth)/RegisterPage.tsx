import PrimaryButton from '@/app/components/buttons/PrimaryButton';
import TextInputField from '@/app/components/inputs/TextInputField';
import FlowLayout from '@/app/components/layouts/FlowLayout';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { API_BASE_URL } from '@/app/config/api';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import InlineAlert from '@/app/components/alerts/InlineAlert';

export default function RegisterPage() {
  const router = useRouter();
  const { update } = useOnboarding();

  const [fieldFirstName, setFieldFirstName] = useState('');
  const [fieldLastName, setFieldLastName] = useState('');
  const [fieldEmail, setFieldEmail] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fieldEmail.trim());

  const validateForm = () => {
    if (!fieldFirstName.trim()) {
      return 'Please enter your first name.';
    }
    if (!fieldLastName.trim()) {
      return 'Please enter your last name.';
    }
    if (!isEmailValid) {
      return 'UT email address is invalid or unregistered.';
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

      if (!res.ok) {
        if (data.error === 'INVALID_UT_EMAIL') {
          setAlertMessage('Please use a valid @utexas.edu email address.');
        } else if (data.error === 'RESEND_TOO_SOON') {
          setAlertMessage(
            'Verification code already sent. Please wait before requesting a new one.',
          );
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
      router.push('/AccountVerification');
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

      <View className="mt-[42px] mx-2">
        <PrimaryButton
          label={loading ? 'Sending...' : 'Sign Up'}
          isFilled={isEmailValid && !loading}
          onPress={loading ? undefined : handleSubmit}
        />
      </View>
    </FlowLayout>
  );
}
