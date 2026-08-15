import InlineAlert from '@/app/components/alerts/InlineAlert';
import PrimaryButton from '@/app/components/buttons/PrimaryButton';
import TextInputField from '@/app/components/inputs/TextInputField';
import FlowLayout from '@/app/components/layouts/FlowLayout';
import { API_BASE_URL } from '@/app/config/api';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

export default function LoginPage() {
  const router = useRouter();
  const { update } = useOnboarding();

  const [fieldEmail, setFieldEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fieldEmail.trim());

  /**
   * Request the code here rather than letting the verification screen do it.
   *
   * This screen previously only stashed the email and navigated, with a
   * "call backend here" TODO. It appeared to work because AccountVerification
   * sends a code from a mount effect — but that meant every failure surfaced
   * one screen too late, on a page already showing six empty code boxes, and
   * an unregistered address was walked straight into creating an account.
   *
   * `mode: 'login'` is what makes the server answer ACCOUNT_NOT_FOUND instead
   * of issuing a code. We only navigate once a code is genuinely on its way.
   */
  const handleSubmit = async () => {
    if (!isEmailValid || loading) return;

    const email = fieldEmail.trim().toLowerCase();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE_URL}/auth/send-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, mode: 'login' }),
      });
      const result = await res.json().catch(() => ({}) as { error?: string });

      if (!res.ok) {
        if (result.error === 'ACCOUNT_NOT_FOUND') {
          setError("We couldn't find an account with that email. Try signing up instead.");
        } else if (result.error === 'INVALID_UT_EMAIL') {
          setError('Please use a valid @utexas.edu email address.');
        } else if (result.error === 'RESEND_TOO_SOON') {
          // A code from a moment ago is still valid, so this is not a failure
          // worth stopping on — send them to type the one they already have.
          update({ email });
          router.push('/AccountVerification?sent=1');
          return;
        } else {
          setError('Something went wrong sending your code. Please try again.');
        }
        return;
      }

      update({ email });
      // ?sent=1 tells the verification screen a code is already in flight, so
      // it doesn't fire a second /auth/send-code and immediately trip the
      // 60-second cooldown it just created.
      router.push('/AccountVerification?sent=1');
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAccount = () => {
    router.push('/RegisterPage');
  };

  return (
    <FlowLayout
      title="Welcome Back!"
      subTitle="Staying in the Loop? Log In!"
      onBackPress={() => router.back()}
    >
      {error && (
        <View className="mt-4">
          <InlineAlert message={error} />
        </View>
      )}

      <View className="mt-[42px]">
        <TextInputField
          label="UT Email"
          placeholder="Enter your UT Email"
          clearable={true}
          value={fieldEmail}
          onChangeText={(text) => {
            setFieldEmail(text);
            setError(null);
          }}
        />
      </View>

      <View className="mt-[42px]">
        <PrimaryButton
          label="Verify Email"
          isFilled={isEmailValid}
          onPress={loading ? undefined : handleSubmit}
          isLoading={loading}
          loadingLabel="Sending code..."
        />
      </View>

      <Pressable className="mt-4" onPress={handleCreateAccount}>
        <Text className="font-['Roboto-Flex'] text-base text-center">
          {"Don't have an account? "}
          <Text className="font-['Roboto-Flex'] font-semibold text-lhlAccent">Sign Up</Text>
        </Text>
      </Pressable>
    </FlowLayout>
  );
}
