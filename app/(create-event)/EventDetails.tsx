import { useCreateEvent } from '@/app/context/CreateEventContext';
import type { EventTypeId } from '@/app/context/CreateEventContext';
import { useRouter } from 'expo-router';
import React from 'react';
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

const BURNT_ORANGE = '#9D4A06';
const CARD_BG = '#FFFFFF';
const CHIP_BORDER = '#E8E3DC';
const INPUT_BORDER = '#00000033';
const BG = '#F9F8F5';
const TEXT_SECONDARY = '#485656';

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
  const router = useRouter();
  const { data, update } = useCreateEvent();

  const canContinue =
    data.title.trim().length > 0 && data.description.trim().length > 0 && data.eventType !== null;

  const onContinue = () => {
    if (!canContinue) return;
    router.push('/(create-event)/WhenIsIt');
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
            <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
              <Text style={styles.backArrow}>←</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Create an Event</Text>
            <View style={styles.headerSpacer} />
          </View>

          <View style={styles.stepBlock}>
            <Text style={styles.stepLabel}>STEP 4 OF 6</Text>
            <Text style={styles.stepTitle}>Event Details</Text>
          </View>

          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: '66.66%' }]} />
          </View>

          <Text style={styles.instruction}>Add some details for your event.</Text>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Event Title</Text>
            <TextInput
              value={data.title}
              onChangeText={(text) => update({ title: text })}
              placeholder="Enter Event Title"
              placeholderTextColor="#9CA3AF"
              maxLength={TITLE_MAX}
              style={styles.input}
              returnKeyType="next"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Description of the Event</Text>
            <TextInput
              value={data.description}
              onChangeText={(text) => update({ description: text })}
              placeholder="Tell people what your event is about..."
              placeholderTextColor="#9CA3AF"
              maxLength={DESCRIPTION_MAX}
              style={[styles.input, styles.textarea]}
              multiline
              textAlignVertical="top"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Event Type</Text>
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
          </View>

          <TouchableOpacity
            onPress={onContinue}
            activeOpacity={canContinue ? 0.85 : 1}
            disabled={!canContinue}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
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
    color: '#000000',
  },
  headerTitle: {
    fontSize: 19,
    fontWeight: '600',
    color: '#000000',
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
    color: TEXT_SECONDARY,
    letterSpacing: 1,
    marginBottom: 6,
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: '500',
    color: '#000000',
  },
  progressTrack: {
    height: 10,
    backgroundColor: '#E5E1DA',
    borderRadius: 999,
    overflow: 'hidden',
    marginBottom: 20,
  },
  progressFill: {
    height: '100%',
    backgroundColor: BURNT_ORANGE,
    borderRadius: 999,
  },
  instruction: {
    fontSize: 14,
    color: '#000000',
    lineHeight: 20,
    marginBottom: 24,
  },
  field: {
    marginBottom: 20,
  },
  fieldLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#020B12',
    marginBottom: 8,
  },
  input: {
    backgroundColor: CARD_BG,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    color: '#020B12',
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
    borderColor: CHIP_BORDER,
    backgroundColor: CARD_BG,
  },
  chipSelected: {
    borderColor: BURNT_ORANGE,
    backgroundColor: BURNT_ORANGE,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#020B12',
  },
  chipTextSelected: {
    color: '#FFFFFF',
  },
  continueButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    backgroundColor: CARD_BG,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  continueButtonEnabled: {
    backgroundColor: BURNT_ORANGE,
    borderColor: BURNT_ORANGE,
  },
  continueText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#020B12',
  },
  continueTextEnabled: {
    color: '#FFFFFF',
  },
});
