// Organization registration — verification tail (LOOP-185).
//
// Figma: "Organization Registration" frame, reviewed 2026-06-08.
//
// SCOPE. This ticket owns the *end* of the flow: the president-email step, its
// error state, the 4-digit code step, and the success screen. The earlier
// search/claim steps are LOOP-141 and the generic UT email verification is
// LOOP-134 — neither exists in code yet, so this screen implements the
// president-email + code steps itself and is written so LOOP-141 can push into
// it with an ?org= param once the search step lands.
//
// The states this ticket names, and where they are below:
//   - email mismatch  -> red field border + "This email does not match the
//                        president on file."  (step 'email', error set)
//   - inactive button  -> Send Email / Verify stay outline-styled and disabled
//                        until their field is valid
//   - success          -> "Thank you for verifying!" + review-pending copy +
//                        Exit

import OtpInput from '@/app/components/inputs/OtpInputField';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { ApiError, api } from '@/app/lib/api';
import { org as orgKeys } from '@/app/lib/queryKeys';
import ArrowLeftIcon from '@/assets/images/arrow-left.svg';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TextInputKeyPressEventData,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useThemeColors } from '@/app/lib/themeColors';

type Step = 'email' | 'code' | 'success';

const CODE_LENGTH = 4;

export default function OrgRegisterScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ org?: string; name?: string }>();
  const { data: onboarding } = useOnboarding();
  const token = onboarding.token || null;

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  // OtpInput is the existing 2FA component (app/(auth)/AccountVerification):
  // it owns per-digit boxes and expects a char array plus focus refs, so the
  // digit-advance / backspace handling below mirrors that screen rather than
  // reimplementing the component with a string API.
  const [code, setCode] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const inputs = useRef<(TextInput | null)[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const codeValue = code.join('');

  // Build steps 4 + 5: the primary action stays secondary/outline and disabled
  // until its field is valid, then turns burnt orange. A blank field must
  // never be submittable.
  const isEmailValid = /^[^\s@]+@([\w-]+\.)*utexas\.edu$/i.test(email.trim());
  const isCodeValid = codeValue.length === CODE_LENGTH && !code.some((d) => d === '');

  const handleCodeChange = (text: string, index: number) => {
    const digitsOnly = text.replace(/[^0-9]/g, '');
    if (text.length > 0 && digitsOnly.length === 0) return;

    const next = [...code];
    next[index] = text.slice(-1);
    setCode(next);
    setError(null);

    if (text && index < CODE_LENGTH - 1) inputs.current[index + 1]?.focus();
  };

  const handleCodeKeyPress = (
    e: NativeSyntheticEvent<TextInputKeyPressEventData>,
    index: number,
  ) => {
    if (e.nativeEvent.key !== 'Backspace') return;
    const next = [...code];
    if (code[index]) {
      next[index] = '';
      setCode(next);
    } else if (index > 0) {
      next[index - 1] = '';
      setCode(next);
      inputs.current[index - 1]?.focus();
    }
  };

  const orgName = params.name ?? 'your organization';

  const describeError = (err: unknown, fallback: string) => {
    const body = err instanceof ApiError ? (err.body as Record<string, unknown> | null) : null;
    return (body?.message as string) ?? fallback;
  };

  const sendEmail = async () => {
    if (!isEmailValid || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await api.post('/orgs/register/verify-president', {
        token,
        body: { org_id: params.org ? Number(params.org) : null, email: email.trim() },
      });
      setStep('code');
    } catch (err) {
      // The mismatch case is the one the design calls out explicitly; the
      // server returns PRESIDENT_EMAIL_MISMATCH with this exact copy.
      setError(describeError(err, 'This email does not match the president on file.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const verifyCode = async () => {
    if (!isCodeValid || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await api.post('/orgs/register/confirm', {
        token,
        body: { org_id: params.org ? Number(params.org) : null, code: codeValue },
      });
      queryClient.invalidateQueries({ queryKey: orgKeys.mine() });
      setStep('success');
    } catch (err) {
      setError(describeError(err, 'That code isn’t right. Check it and try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- Success (build step 1) ---------------------------------------------
  if (step === 'success') {
    return (
      <SafeAreaView className="flex-1 bg-lhlBackgroundColor" edges={['top']}>
        <View className="flex-1 items-center justify-center px-[36px] bg-lhlBackgroundColor">
          <View className="h-[72px] w-[72px] items-center justify-center rounded-full bg-lhlSurfaceGrey">
            <Text className="text-[30px] text-lhlBurntOrange">✓</Text>
          </View>

          <Text className="font-['Roboto-Flex'] mt-[20px] text-center text-[22px] font-semibold text-lhlInk">
            Thank you for verifying!
          </Text>

          <Text className="font-['Roboto-Flex'] mt-[10px] text-center text-[13px] leading-[19px] text-lhlSecondaryTextGrey">
            Our team at Longhorn Loop will review the verification request and send a notification
            with the result.
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Exit"
            // Dismisses the whole registration flow rather than stepping back
            // into the code screen, which is already spent.
            onPress={() => router.replace('/settings')}
            className="mt-[28px] h-[50px] w-full items-center justify-center rounded-[10px] bg-lhlBurntOrange"
          >
            <Text className="font-['Roboto-Flex'] text-[16px] font-semibold text-white">Exit</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // --- Email + code steps --------------------------------------------------
  const isEmailStep = step === 'email';
  const canSubmit = isEmailStep ? isEmailValid : isCodeValid;

  return (
    <SafeAreaView className="flex-1 bg-lhlBackgroundColor" edges={['top']}>
      <KeyboardAvoidingView
        className="flex-1 bg-lhlBackgroundColor"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View className="flex-row items-center px-[20px] py-[12px]">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => {
              if (!isEmailStep) {
                setStep('email');
                setError(null);
                setCode(Array(CODE_LENGTH).fill(''));
                return;
              }
              router.back();
            }}
          >
            <ArrowLeftIcon width={22} height={22} />
          </Pressable>
          <Text className="font-['Roboto-Flex'] ml-[12px] text-[18px] font-semibold text-lhlInk">
            Verify Organization
          </Text>
        </View>

        <ScrollView
          className="flex-1 px-[20px] bg-lhlBackgroundColor"
          contentContainerStyle={{ paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          {isEmailStep ? (
            <>
              <Text className="font-['Roboto-Flex'] mt-[10px] text-[15px] font-semibold text-lhlInk">
                President’s UT email
              </Text>
              <Text className="font-['Roboto-Flex'] mt-[6px] text-[12px] leading-[18px] text-lhlSecondaryTextGrey">
                We’ll send a verification code to the president on file for {orgName}.
              </Text>

              <TextInput
                value={email}
                onChangeText={(text) => {
                  setEmail(text);
                  if (error) setError(null);
                }}
                placeholder="president@utexas.edu"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                className="font-['Roboto-Flex'] mt-[14px] rounded-[8px] border bg-lhlSurface px-[12px] py-[12px] text-[14px] text-lhlInk"
                // Build step 3: red border on mismatch, and the form stays
                // editable so the user can correct and resubmit.
                style={{ borderColor: error ? colors.destructive : colors.border }}
              />

              {error ? (
                <Text className="font-['Roboto-Flex'] mt-[6px] text-[12px] text-lhlDestructiveRed">
                  {error}
                </Text>
              ) : null}
            </>
          ) : (
            <>
              <Text className="font-['Roboto-Flex'] mt-[10px] text-[15px] font-semibold text-lhlInk">
                Enter the 4-digit code
              </Text>
              <Text className="font-['Roboto-Flex'] mt-[6px] text-[12px] leading-[18px] text-lhlSecondaryTextGrey">
                Sent to {email.trim()}.
              </Text>

              <View className="mt-[18px]">
                <OtpInput
                  code={code}
                  error={!!error}
                  inputs={inputs}
                  handleChange={handleCodeChange}
                  handleKeyPress={handleCodeKeyPress}
                />
              </View>

              {error ? (
                <Text className="font-['Roboto-Flex'] mt-[10px] text-[12px] text-lhlDestructiveRed">
                  {error}
                </Text>
              ) : null}
            </>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isEmailStep ? 'Send Email' : 'Verify'}
            accessibilityState={{ disabled: !canSubmit || isSubmitting }}
            disabled={!canSubmit || isSubmitting}
            onPress={isEmailStep ? sendEmail : verifyCode}
            className={`mt-[26px] h-[50px] items-center justify-center rounded-[10px] border ${
              canSubmit
                ? 'border-lhlBurntOrange bg-lhlBurntOrange'
                : 'border-lhlMutedBorder bg-lhlSurface opacity-60'
            }`}
          >
            {isSubmitting ? (
              <ActivityIndicator color={canSubmit ? '#FFFFFF' : '#485656'} />
            ) : (
              <Text
                className={`font-['Roboto-Flex'] text-[16px] font-semibold ${
                  canSubmit ? 'text-white' : 'text-lhlSecondaryTextGrey'
                }`}
              >
                {isEmailStep ? 'Send Email' : 'Verify'}
              </Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
