import PrimaryButton from '@/app/components/buttons/PrimaryButton';
import TextInputField from '@/app/components/inputs/TextInputField';
import FlowLayout from '@/app/components/layouts/FlowLayout';
import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import InlineAlert from '@/app/components/alerts/InlineAlert';

interface LoginPageProps {
}

export default function LoginPage({
}: LoginPageProps) {

  const [fieldEmail, setFieldEmail] = useState('');
  const [showAlert, setShowAlert] = useState(false);

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fieldEmail);

  const handleSubmit = () => {
    // TODO: needs more checks and backend support
    if (!isEmailValid) {
      setShowAlert(true);
    }
  }

  const handleCreateAccount = () => {
    // TODO
  }

  return (
    <FlowLayout
      title='Welcome Back!'
      subTitle='Continuing the journey? Log In!'
    >
      
      {showAlert && (
        <View className='mt-4'>
          <InlineAlert
            message='UT email address is invalid or unregistered.'
          />
        </View>
      )}

      <View className='mt-[42px]'>
        <TextInputField
          label='UT Email'
          placeholder='Enter your UT Email'
          clearable={true}
          value={fieldEmail}
          onChangeText={(text) => {
            setFieldEmail(text);
            setShowAlert(false);
          }}
        />
      </View>

      <View className='mt-[42px] mx-2'>
        <PrimaryButton
          label='Verify Email'
          isFilled={isEmailValid}
          onPress={handleSubmit}
        />
      </View>

      <Pressable className='mt-4' onPress={handleCreateAccount}>
        <Text className='font-normal text-base text-center' >
          I need to make an account.
        </Text>
      </Pressable>

    </FlowLayout>
  );
}