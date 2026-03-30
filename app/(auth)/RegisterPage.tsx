import PrimaryButton from '@/app/components/buttons/PrimaryButton';
import TextInputField from '@/app/components/inputs/TextInputField';
import FlowLayout from '@/app/components/layouts/FlowLayout';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import InlineAlert from '@/app/components/alerts/InlineAlert';

export default function RegisterPage() {
  const router = useRouter();
  const { update } = useOnboarding();

  const [fieldFirstName, setFieldFirstName] = useState('');
  const [fieldLastName, setFieldLastName] = useState('');
  const [fieldEmail, setFieldEmail] = useState('');
  const [alertMessage, setAlertMessage] = useState('');

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fieldEmail);

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

    // TODO: call backend /auth/send-code here
    // Store user info and navigate to verification
    update({
      firstName: fieldFirstName.trim(),
      lastName: fieldLastName.trim(),
      email: fieldEmail.trim().toLowerCase(),
    });
    router.push('/AccountVerification');
  };

  return (
    <FlowLayout
      title='Welcome!'
      subTitle='Start by creating an account.'
    >

      {alertMessage && (
        <View className='mt-4'>
          <InlineAlert
            message={alertMessage}
          />
        </View>
      )}

      <View className='mt-[42px]'>
        <TextInputField
          label='First Name'
          placeholder='Enter your first name'
          clearable={true}
          value={fieldFirstName}
          onChangeText={(text) => {
            setFieldFirstName(text);
            setAlertMessage('');
          }}
        />
      </View>

      <View className='mt-4'>
        <TextInputField
          label='Last Name'
          placeholder='Enter your last name'
          clearable={true}
          value={fieldLastName}
          onChangeText={(text) => {
            setFieldLastName(text);
            setAlertMessage('');
          }}
        />
      </View>

      <View className='mt-4'>
        <TextInputField
          label='UT Email'
          placeholder='Enter your UT email address'
          clearable={true}
          value={fieldEmail}
          onChangeText={(text) => {
            setFieldEmail(text);
            setAlertMessage('');
          }}
        />
      </View>

      <View className='mt-[42px] mx-2'>
        <PrimaryButton
          label='Sign Up'
          isFilled={isEmailValid}
          onPress={handleSubmit}
        />
      </View>

    </FlowLayout>
  );
}
