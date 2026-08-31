// Delete Account — code confirmation (LOOP-131).
//
// The tail of the flow that starts with the "Delete Account?" modal on
// Settings: that modal asks POST /users/me/delete/request to email a code,
// then routes here to spend it.
//
// WHY A CODE AND NOT A PASSWORD. The ticket's acceptance criteria ask the user
// to re-enter their password. This app has never had one — the only credential
// anyone holds is an emailed verification code (see app/(auth)/
// AccountVerification.tsx). So the product owner's call, implemented here, is
// to ask for the same proof the criteria were reaching for: that whoever holds
// this session also holds the mailbox.
//
// The step machine and OTP handling mirror app/org/register.tsx rather than
// reinventing them; the digit-advance/backspace logic in particular is copied
// deliberately, because OtpInput expects a char array plus focus refs and each
// screen owns that behaviour. The difference is that this screen has only the
// code step — the "are you sure" step is the modal on Settings, and putting it
// here too would ask the same question twice.
//
// SCOPE: nothing here decides WHAT gets deleted. The cascade, the rules for
// events the user created, and org succession all live server-side in
// server/src/lib/accountDeletion.ts.

import OtpInput from '@/app/components/inputs/OtpInputField';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { ApiError, api } from '@/app/lib/api';
import ArrowLeftIcon from '@/assets/images/arrow-left.svg';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
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

// Six, matching the account 2FA code in AccountVerification — this is an
// account-level credential, so it should not be weaker than the one that
// signs you in. (Org verification is four; that's a different, lower-stakes
// claim.)
const CODE_LENGTH = 6;

export default function DeleteAccountScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: onboarding, reset } = useOnboarding();
  const token = onboarding.token || null;

  const [code, setCode] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const inputs = useRef<(TextInput | null)[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const codeValue = code.join('');
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

  const describeError = (err: unknown, fallback: string) => {
    const body = err instanceof ApiError ? (err.body as Record<string, unknown> | null) : null;
    return (body?.message as string) ?? fallback;
  };

  const resend = async () => {
    if (isResending || isSubmitting) return;
    setIsResending(true);
    setError(null);
    setNotice(null);
    try {
      await api.post('/users/me/delete/request', { token });
      setCode(Array(CODE_LENGTH).fill(''));
      setNotice('We sent a new code.');
    } catch (err) {
      // RESEND_TOO_SOON carries its own message; anything else is a network
      // problem the user can retry.
      setError(describeError(err, 'Could not send a new code. Try again.'));
    } finally {
      setIsResending(false);
    }
  };

  const confirmDelete = async () => {
    if (!isCodeValid || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await api.post('/users/me/delete/confirm', { token, body: { code: codeValue } });

      // Same teardown as the Log Out handler in settings/preferences.tsx, and
      // in the same order: drop the cached data BEFORE the session, so no
      // screen can re-render against another user's stale cache on the way
      // out. The account is already gone server-side; there is nothing to
      // return to.
      queryClient.clear();
      reset();
      // dismissAll first: this screen sits on top of settings, which sits on
      // top of (tabs). replace alone would leave the whole signed-in stack
      // beneath the front page -- for an account that no longer exists.
      if (router.canDismiss()) router.dismissAll();
      router.replace('/');
    } catch (err) {
      // The important guarantee: a wrong code changes nothing. The server
      // burns an attempt and the account is untouched, so the screen stays
      // put with the code cleared for another try.
      setError(describeError(err, 'That code isn’t right. Check it and try again.'));
      setCode(Array(CODE_LENGTH).fill(''));
      setIsSubmitting(false);
    }
  };

  if (!token) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-lhlBackgroundColor">
        <Text className="font-['Roboto-Flex'] text-[14px] text-lhlSecondaryTextGrey">
          Sign in to manage your account.
        </Text>
      </SafeAreaView>
    );
  }

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
            disabled={isSubmitting}
            onPress={() => router.back()}
          >
            <ArrowLeftIcon width={22} height={22} color={colors.ink} />
          </Pressable>
          <Text className="font-['Roboto-Flex'] ml-[12px] text-[18px] font-semibold text-lhlInk">
            Delete Account
          </Text>
        </View>

        <ScrollView
          className="flex-1 px-[20px] bg-lhlBackgroundColor"
          contentContainerStyle={{ paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text className="font-['Roboto-Flex'] mt-[10px] text-[15px] font-semibold text-lhlInk">
            Enter the {CODE_LENGTH}-digit code
          </Text>
          <Text className="font-['Roboto-Flex'] mt-[6px] text-[12px] leading-[18px] text-lhlSecondaryTextGrey">
            We sent it to {onboarding.email || 'your email'}. Entering it permanently deletes your
            account and everything in it. This cannot be undone.
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

          {notice && !error ? (
            <Text className="font-['Roboto-Flex'] mt-[10px] text-[12px] text-lhlSecondaryTextGrey">
              {notice}
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete my account"
            accessibilityState={{ disabled: !isCodeValid || isSubmitting }}
            disabled={!isCodeValid || isSubmitting}
            onPress={confirmDelete}
            className={`mt-[26px] h-[50px] items-center justify-center rounded-[10px] border ${
              isCodeValid
                ? 'border-lhlDestructiveRed bg-lhlDestructiveSoft'
                : 'border-lhlMutedBorder bg-lhlSurface opacity-60'
            }`}
          >
            {isSubmitting ? (
              <ActivityIndicator color={isCodeValid ? colors.destructive : colors.inkSecondary} />
            ) : (
              <Text
                className={`font-['Roboto-Flex'] text-[16px] font-semibold ${
                  isCodeValid ? 'text-lhlDestructiveRed' : 'text-lhlSecondaryTextGrey'
                }`}
              >
                Delete my account
              </Text>
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Resend code"
            accessibilityState={{ disabled: isResending || isSubmitting }}
            disabled={isResending || isSubmitting}
            onPress={resend}
            className="mt-[16px] items-center"
          >
            <Text className="font-['Roboto-Flex'] text-[13px] font-medium text-lhlAccent">
              {isResending ? 'Sending…' : 'Resend code'}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
