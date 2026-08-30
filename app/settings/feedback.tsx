// Feedback form (LOOP-184, build step 7 — "Let us know your thoughts").
//
// One screen serves three Support & About rows — Send Feedback, Report a Bug
// and Contact Support — because the form is identical and only the stored
// `kind` differs. Splitting them into three screens would triple the code to
// change one label.

import ProfileModal, { ModalAction } from '@/app/components/modals/ProfileModal';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { ApiError, api } from '@/app/lib/api';
import { useThemeColors } from '@/app/lib/themeColors';
import ArrowLeftIcon from '@/assets/images/arrow-left.svg';
import { useMutation } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const MAX_MESSAGE = 2000;

type FeedbackKind = 'feedback' | 'bug' | 'support';

// `cta` is the submit button's label. It has to travel with the rest of the
// copy rather than being a hardcoded "Send": this one screen backs all three
// Support & About rows, so a fixed "Send Feedback" would sit under the Report a
// Bug and Contact Support forms too.
const COPY: Record<
  FeedbackKind,
  { title: string; prompt: string; placeholder: string; cta: string }
> = {
  feedback: {
    title: 'Send Feedback',
    prompt: 'Let us know your thoughts!',
    placeholder: 'What’s working, what isn’t, what you’d like to see…',
    cta: 'Send Feedback',
  },
  bug: {
    title: 'Report a Bug',
    prompt: 'What went wrong?',
    placeholder: 'What you did, what you expected, and what happened instead…',
    cta: 'Report a Bug',
  },
  support: {
    title: 'Contact Support',
    prompt: 'How can we help?',
    placeholder: 'Tell us what you need a hand with…',
    cta: 'Contact Support',
  },
};

export default function FeedbackScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ kind?: string }>();
  const { data: onboarding } = useOnboarding();
  const token = onboarding.token || null;

  const kind: FeedbackKind =
    params.kind === 'bug' || params.kind === 'support' ? params.kind : 'feedback';
  const copy = COPY[kind];

  const [message, setMessage] = useState('');
  const [showSent, setShowSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () =>
      api.post('/settings/feedback', {
        token,
        body: {
          message: message.trim(),
          kind,
          // Platform + version give triage something to work with without
          // asking the user to describe their device.
          context: `platform=${Platform.OS}; version=${Platform.Version}`,
        },
      }),
    onSuccess: () => setShowSent(true),
    onError: (err) => {
      const body = err instanceof ApiError ? (err.body as Record<string, unknown> | null) : null;
      setError((body?.message as string) ?? 'That couldn’t be sent. Try again in a moment.');
    },
  });

  const canSend = message.trim().length > 0 && !submit.isPending;

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
            onPress={() => router.back()}
          >
            <ArrowLeftIcon width={22} height={22} color={colors.ink} />
          </Pressable>
          <Text className="font-['Roboto-Flex'] ml-[12px] text-[20px] font-semibold text-lhlInk">
            {copy.title}
          </Text>
        </View>

        <ScrollView
          className="flex-1 px-[20px] bg-lhlBackgroundColor"
          contentContainerStyle={{ paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text className="font-['Roboto-Flex'] text-[14px] font-semibold text-lhlInk">
            {copy.prompt}
          </Text>

          <TextInput
            value={message}
            onChangeText={(text) => {
              setMessage(text);
              if (error) setError(null);
            }}
            placeholder={copy.placeholder}
            multiline
            maxLength={MAX_MESSAGE}
            className="font-['Roboto-Flex'] mt-[10px] h-[180px] rounded-[10px] border bg-lhlSurface px-[12px] py-[10px] text-[14px] text-lhlInk"
            style={{
              borderColor: error ? colors.destructive : colors.border,
              textAlignVertical: 'top',
            }}
          />

          <Text className="font-['Roboto-Flex'] mt-[4px] text-right text-[11px] text-lhlSecondaryTextGrey">
            {message.length}/{MAX_MESSAGE}
          </Text>

          {error ? (
            <Text className="font-['Roboto-Flex'] mt-[6px] text-[12px] text-lhlDestructiveRed">
              {error}
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.cta}
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={() => submit.mutate()}
            className={`mt-[20px] h-[50px] items-center justify-center rounded-[10px] border ${
              canSend
                ? 'border-lhlBurntOrange bg-lhlBurntOrange'
                : 'border-lhlMutedBorder bg-lhlSurface opacity-60'
            }`}
          >
            <Text
              className={`font-['Roboto-Flex'] text-[16px] font-semibold ${
                canSend ? 'text-white' : 'text-lhlSecondaryTextGrey'
              }`}
            >
              {submit.isPending ? 'Sending…' : copy.cta}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      <ProfileModal
        visible={showSent}
        onDismiss={() => {
          setShowSent(false);
          router.back();
        }}
        showIconPlaceholder
        title="Thanks!"
        body="We read every message that comes through."
        actions={
          <ModalAction
            label="Done"
            variant="ink"
            fullWidth
            onPress={() => {
              setShowSent(false);
              router.back();
            }}
          />
        }
      />
    </SafeAreaView>
  );
}
