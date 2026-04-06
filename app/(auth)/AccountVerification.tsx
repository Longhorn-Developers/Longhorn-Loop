import { useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  NativeSyntheticEvent,
  SafeAreaView,
  Text,
  TextInput,
  TextInputKeyPressEventData,
  TouchableOpacity,
  View,
} from 'react-native';

export default function AccountVerification() {
  const router = useRouter();
  const [code, setCode] = useState(['', '', '', '']);
  const inputs = useRef<(TextInput | null)[]>([]);

  const allFilled = code.every((digit) => digit !== '');

  const handleChange = (text: string, index: number) => {
    const newCode = [...code];
    newCode[index] = text.slice(-1); // only keep last character
    setCode(newCode);

    // Auto-advance to next input
    if (text && index < 3) {
      inputs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (
    e: NativeSyntheticEvent<TextInputKeyPressEventData>,
    index: number
  ) => {
    // Go back on backspace if empty
    if (e.nativeEvent.key === 'Backspace' && !code[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 px-6 pt-4">

        {/* Back Arrow */}
        <TouchableOpacity onPress={() => router.back()} className="mb-8 self-start">
          <Text className="text-2xl text-gray-800">←</Text>
        </TouchableOpacity>

        {/* Title */}
        <Text className="text-2xl font-bold text-gray-900 mb-2">Account Verification</Text>
        <Text className="text-sm text-gray-500 mb-8">
          We&apos;ve sent you a verification link to your email.{'\n'}Enter the code below.
        </Text>

        {/* Code Input Boxes */}
        <View className="flex-row justify-center gap-3 mb-8">
        {code.map((digit, index) => (
            <TextInput
            key={index}
            ref={(ref) => { inputs.current[index] = ref; }}
            style={{ width: 56, height: 56, borderWidth: 1, borderRadius: 8, textAlign: 'center', fontSize: 20, fontWeight: '600', borderColor: digit ? '#9CA3AF' : '#D1D5DB' }}
            value={digit}
            onChangeText={(text) => handleChange(text, index)}
            onKeyPress={(e) => handleKeyPress(e, index)}
            keyboardType="number-pad"
            maxLength={1}
            selectTextOnFocus
            />
        ))}
        </View>

        {/* Verify Button */}
        <TouchableOpacity
          className={`rounded-lg py-4 items-center justify-center mb-4 ${
            allFilled ? 'bg-orange-700' : 'bg-transparent border border-gray-300'
          }`}
          onPress={allFilled ? () => {
            // TODO: call backend /auth/verify-code here
            router.push('/CreateAccount');
          } : undefined}
          activeOpacity={allFilled ? 0.8 : 1}
        >
          <Text className={`text-base font-semibold ${allFilled ? 'text-white' : 'text-gray-400'}`}>
            Verify
          </Text>
        </TouchableOpacity>

        {/* Resend Code */}
        <View className="flex-row justify-center mt-2">
          <Text className="text-sm text-gray-500">Didn&apos;t receive the code? </Text>
          <TouchableOpacity onPress={() => {
            // TODO: call backend /auth/resend-code here
          }}>
            <Text className="text-sm text-orange-700 font-semibold">Resend Code</Text>
          </TouchableOpacity>
        </View>

      </View>
    </SafeAreaView>
  );
}
