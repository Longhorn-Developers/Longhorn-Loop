import StepIndicator from '@/app/components/create-event/StepIndicator';
import { FieldError, RequiredMark } from '@/app/components/create-event/RequiredField';
import { useCreateEvent } from '@/app/context/CreateEventContext';
import type { EventTypeId } from '@/app/context/CreateEventContext';
import type { ThemeColors } from '@/app/lib/themeColors';
import { useThemeColors } from '@/app/lib/themeColors';
import React, { useState, useMemo } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const EVENT_TYPES: { id: EventTypeId; label: string }[] = [
  { id: 'general_meeting', label: 'General Meeting' },
  { id: 'social', label: 'Social' },
  { id: 'career', label: 'Career' },
  { id: 'workshop', label: 'Workshop' },
  { id: 'performance', label: 'Performance' },
  { id: 'fundraiser', label: 'Fundraiser' },
  { id: 'sports', label: 'Sports' },
  { id: 'other', label: 'Other' },
];

const TITLE_MAX = 80;
const DESCRIPTION_MAX = 500;

export default function EventDetails() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { data, update, goNext, goBack } = useCreateEvent();

  const missingTitle = data.title.trim().length === 0;
  const missingDescription = data.description.trim().length === 0;
  const missingType = data.eventType === null;
  const canContinue = !missingTitle && !missingDescription && !missingType;

  /**
   * Set by a Continue press, never by typing.
   *
   * The step opens with three empty required fields, and marking them red on
   * arrival would be scolding someone for not having started. Pressing
   * Continue is the moment they claim to be finished, and that is when naming
   * what is missing is help rather than nagging.
   */
  const [attempted, setAttempted] = useState(false);

  const onContinue = () => {
    if (!canContinue) {
      setAttempted(true);
      return;
    }
    goNext();
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <TouchableOpacity onPress={goBack} hitSlop={12}>
              <Text style={styles.backArrow}>←</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Create an Event</Text>
            <View style={styles.headerSpacer} />
          </View>

          <View style={styles.stepBlock}>
            <Text style={styles.stepLabel}>STEP 4 OF 6</Text>
            <Text style={styles.stepTitle}>Event Details</Text>
          </View>

          <StepIndicator style={{ marginBottom: 20 }} />

          <Text style={styles.instruction}>Add some details for your event.</Text>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>
              Event Title
              <RequiredMark />
            </Text>
            <TextInput
              value={data.title}
              onChangeText={(text) => update({ title: text })}
              placeholder="Enter Event Title"
              placeholderTextColor={colors.inkMuted}
              maxLength={TITLE_MAX}
              style={[
                styles.input,
                styles.singleLine,
                attempted && missingTitle ? { borderColor: colors.destructive } : null,
              ]}
              returnKeyType="next"
            />
            <FieldError show={attempted && missingTitle} message="Add a title for your event." />
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>
              Description of the Event
              <RequiredMark />
            </Text>
            <TextInput
              value={data.description}
              onChangeText={(text) => update({ description: text })}
              placeholder="Tell people what your event is about..."
              placeholderTextColor={colors.inkMuted}
              maxLength={DESCRIPTION_MAX}
              style={[
                styles.input,
                styles.textarea,
                attempted && missingDescription ? { borderColor: colors.destructive } : null,
              ]}
              multiline
              textAlignVertical="top"
            />
            <FieldError
              show={attempted && missingDescription}
              message="Tell people what your event is about."
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>
              Event Type
              <RequiredMark />
            </Text>
            <View style={styles.chipWrap}>
              {EVENT_TYPES.map((type) => {
                const isSelected = type.id === data.eventType;
                return (
                  <TouchableOpacity
                    key={type.id}
                    onPress={() => update({ eventType: type.id })}
                    activeOpacity={0.85}
                    style={[styles.chip, isSelected && styles.chipSelected]}
                  >
                    <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                      {type.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <FieldError show={attempted && missingType} message="Pick an event type." />
          </View>

          <TouchableOpacity
            onPress={onContinue}
            activeOpacity={0.85}
            // NOT disabled. A disabled button cannot tell you why it is
            // disabled, and this step has three required fields.
            accessibilityState={{ disabled: !canContinue }}
            style={[styles.continueButton, canContinue && styles.continueButtonEnabled]}
          >
            <Text style={[styles.continueText, canContinue && styles.continueTextEnabled]}>
              Continue
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    flex: {
      flex: 1,
    },
    scroll: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 40,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 24,
    },
    backArrow: {
      fontSize: 22,
      color: c.ink,
    },
    headerTitle: {
      fontSize: 19,
      fontWeight: '600',
      color: c.ink,
      letterSpacing: -0.5,
    },
    headerSpacer: {
      width: 22,
    },
    stepBlock: {
      marginBottom: 18,
    },
    stepLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: c.inkSecondary,
      letterSpacing: 1,
      marginBottom: 6,
    },
    stepTitle: {
      fontSize: 24,
      fontWeight: '500',
      color: c.ink,
    },
    instruction: {
      fontSize: 14,
      color: c.ink,
      lineHeight: 20,
      marginBottom: 24,
    },
    field: {
      marginBottom: 20,
    },
    fieldLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: c.ink,
      marginBottom: 8,
    },
    input: {
      backgroundColor: c.surface,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 16,
      paddingVertical: 12,
      fontSize: 14,
      color: c.ink,
    },
    // A single-line TextInput centres its own text when it is given a height.
    // The shared `input` style sets paddingVertical instead, and on Android the
    // font's own ascent padding stacks on top of that — which is what left the
    // placeholder sitting high in the box. Fixed height, no vertical padding,
    // and font padding off lets the input do the centring itself.
    //
    // Only the single-line fields take this. The textarea below wants its text
    // at the top and keeps the padded version.
    singleLine: {
      height: 44,
      paddingVertical: 0,
      includeFontPadding: false,
      textAlignVertical: 'center',
    },
    textarea: {
      minHeight: 140,
      paddingTop: 12,
    },
    chipWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    chipSelected: {
      borderColor: c.brand,
      backgroundColor: c.brand,
    },
    chipText: {
      fontSize: 12,
      fontWeight: '500',
      color: c.ink,
    },
    chipTextSelected: {
      color: '#FFFFFF',
    },
    continueButton: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
      paddingVertical: 14,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 8,
    },
    continueButtonEnabled: {
      backgroundColor: c.brand,
      borderColor: c.brand,
    },
    continueText: {
      fontSize: 16,
      fontWeight: '600',
      color: c.ink,
    },
    continueTextEnabled: {
      color: '#FFFFFF',
    },
  });
