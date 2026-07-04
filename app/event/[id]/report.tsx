// Report event screen. Reached from "Report this event" on the event
// detail screen.
//
// Layout follows Figma (Report frame): off-white background, title,
// four reason checkboxes (multi-select), required description textarea,
// submit button that turns orange once both fields are valid.
//
// On submit:
//   - POST /events/:id/report with { reasons: string[], description: string }
//   - navigate to /event/[id]/report-success on success
//   - show inline red banner if validation fails

import ArrowLeftIcon from '@/assets/images/arrow-left.svg';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { api } from '@/app/lib/api';
import { events as eventsKeys } from '@/app/lib/queryKeys';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const BG = '#F9F8F5';
const TEXT_PRIMARY = '#020B12';
const TEXT_MUTED = '#485656';
const BORDER = 'rgba(0,0,0,0.20)';
const BURNT_ORANGE = '#BF5700';
const ERROR_RED = '#B30404';
const ERROR_BG = '#FCE4E4';

type ReasonCode = 'violent_harmful' | 'misinformation' | 'troll_spam' | 'other';

const REASONS: { code: ReasonCode; label: string }[] = [
  { code: 'violent_harmful', label: 'This event is violent / harmful' },
  { code: 'misinformation', label: 'This event contains misinformation' },
  { code: 'troll_spam', label: 'This event is a troll / spam' },
  { code: 'other', label: 'Concern not listed' },
];

export default function ReportEventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: onboarding } = useOnboarding();
  const token = onboarding.token || null;
  const queryClient = useQueryClient();

  const [selectedReasons, setSelectedReasons] = useState<Set<ReasonCode>>(new Set());
  const [description, setDescription] = useState('');
  const [showError, setShowError] = useState(false);

  const isValid = selectedReasons.size > 0 && description.trim().length > 0;

  const toggleReason = (code: ReasonCode) => {
    setShowError(false);
    setSelectedReasons((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const submitReport = useMutation({
    mutationFn: () =>
      api.post(`/events/${id}/report`, {
        token,
        body: {
          reasons: Array.from(selectedReasons),
          description: description.trim(),
        },
      }),
    onSuccess: () => {
      // The reported event is filtered out of /events list queries, so
      // refresh the home carousels. Detail-screen queries don't need
      // refetching: each detail screen the user already viewed will
      // 404 if they revisit it, which is the correct behavior.
      queryClient.invalidateQueries({ queryKey: eventsKeys.lists() });
      router.replace(`/event/${id}/report-success`);
    },
    onError: (err) => {
      console.error('Report request failed:', err);
      setShowError(true);
    },
  });

  const submitting = submitReport.isPending;

  const handleSubmit = () => {
    if (!isValid || !token) {
      setShowError(true);
      return;
    }
    submitReport.mutate();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Back */}
        <View style={{ paddingHorizontal: 24, paddingTop: 8 }}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={16}>
            <ArrowLeftIcon width={24} height={24} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Title */}
          <Text style={styles.title}>Why are you reporting this event?</Text>

          {showError && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>Please fill out all of the required fields.</Text>
            </View>
          )}

          {/* Reason checkboxes */}
          <View style={{ marginTop: 16, gap: 16 }}>
            {REASONS.map((r) => {
              const checked = selectedReasons.has(r.code);
              return (
                <Pressable
                  key={r.code}
                  onPress={() => toggleReason(r.code)}
                  style={styles.checkboxRow}
                >
                  <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                    {checked && <Text style={styles.checkboxMark}>✓</Text>}
                  </View>
                  <Text
                    style={[
                      styles.reasonLabel,
                      checked && { color: BURNT_ORANGE, fontWeight: '600' },
                    ]}
                  >
                    {r.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Tell us more */}
          <Text style={[styles.title, { marginTop: 32 }]}>Tell us more:</Text>

          <View style={styles.textareaWrapper}>
            <TextInput
              value={description}
              onChangeText={(t) => {
                setDescription(t);
                setShowError(false);
              }}
              placeholder="Description (required)"
              placeholderTextColor={TEXT_MUTED}
              multiline
              textAlignVertical="top"
              style={styles.textarea}
            />
          </View>
        </ScrollView>

        {/* Submit */}
        <View style={styles.submitWrapper}>
          <Pressable
            onPress={handleSubmit}
            disabled={submitting}
            style={[
              styles.submitButton,
              isValid ? styles.submitButtonActive : styles.submitButtonDisabled,
            ]}
          >
            <Text
              style={[
                styles.submitText,
                isValid ? styles.submitTextActive : styles.submitTextDisabled,
              ]}
            >
              {submitting ? 'Submitting…' : 'Submit report'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = {
  title: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: '#000',
    marginTop: 24,
  },
  errorBanner: {
    marginTop: 16,
    backgroundColor: ERROR_BG,
    borderColor: ERROR_RED,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  errorText: {
    color: ERROR_RED,
    fontSize: 14,
    fontWeight: '500' as const,
  },
  checkboxRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 16,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  checkboxChecked: {
    backgroundColor: BURNT_ORANGE,
    borderColor: BURNT_ORANGE,
  },
  checkboxMark: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700' as const,
    lineHeight: 14,
  },
  reasonLabel: {
    flex: 1,
    fontSize: 16,
    color: TEXT_PRIMARY,
  },
  textareaWrapper: {
    marginTop: 16,
    height: 182,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderColor: BORDER,
    borderWidth: 1,
    padding: 12,
  },
  textarea: {
    flex: 1,
    fontSize: 16,
    color: TEXT_PRIMARY,
  },
  submitWrapper: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    paddingTop: 8,
    backgroundColor: BG,
  },
  submitButton: {
    borderRadius: 8,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: 14,
  },
  submitButtonDisabled: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: BORDER,
  },
  submitButtonActive: {
    backgroundColor: BURNT_ORANGE,
  },
  submitText: {
    fontSize: 20,
    fontWeight: '500' as const,
  },
  submitTextDisabled: {
    color: TEXT_MUTED,
  },
  submitTextActive: {
    color: '#fff',
    fontWeight: '600' as const,
  },
};
