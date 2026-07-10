import ChipCloseIcon from '@/assets/images/chip-close.svg';
import ChipPlusIcon from '@/assets/images/chip-plus.svg';
import { MAX_INTEREST_TAGS, useCreateEvent } from '@/app/context/CreateEventContext';
import { INTEREST_CATEGORIES } from '@/app/lib/interestCategories';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const BURNT_ORANGE = '#9D4A06';
const CARD_BG = '#FFFFFF';
const CHIP_BORDER = '#E8E3DC';
const BG = '#F9F8F5';
const TEXT_SECONDARY = '#485656';

export default function InterestTags() {
  const router = useRouter();
  const { data, update } = useCreateEvent();

  // Tags come from the category matching the discovery bucket picked in
  // step 2. That step is required, so this will always resolve.
  const tags = useMemo(() => {
    const match = INTEREST_CATEGORIES.find((c) => c.id === data.discoveryBucket);
    return match?.tags ?? [];
  }, [data.discoveryBucket]);

  const canContinue = data.interestTags.length > 0;
  const atLimit = data.interestTags.length >= MAX_INTEREST_TAGS;

  const toggleTag = (tag: string) => {
    const isSelected = data.interestTags.includes(tag);
    if (isSelected) {
      update({ interestTags: data.interestTags.filter((t) => t !== tag) });
      return;
    }
    if (atLimit) return;
    update({ interestTags: [...data.interestTags, tag] });
  };

  const onContinue = () => {
    if (!canContinue) return;
    router.push('/(create-event)/EventDetails');
  };

  return (
    <SafeAreaView style={styles.container}>
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
          <Text style={styles.stepLabel}>STEP 3 OF 6</Text>
          <Text style={styles.stepTitle}>Add Up to 5 Interest Tags</Text>
        </View>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: '50%' }]} />
        </View>

        <View style={styles.instructionRow}>
          <Text style={styles.instruction}>
            Pick interests so the right people find your event.
          </Text>
          <View style={styles.counterPill}>
            <Text style={styles.counterText}>
              {data.interestTags.length}/{MAX_INTEREST_TAGS}
            </Text>
          </View>
        </View>

        <View style={styles.chipWrap}>
          {tags.map((tag) => {
            const isSelected = data.interestTags.includes(tag);
            const disabled = !isSelected && atLimit;
            return (
              <TouchableOpacity
                key={tag}
                onPress={() => toggleTag(tag)}
                activeOpacity={disabled ? 1 : 0.85}
                disabled={disabled}
                style={[
                  styles.chip,
                  isSelected && styles.chipSelected,
                  disabled && styles.chipDisabled,
                ]}
              >
                {isSelected ? (
                  <ChipCloseIcon width={7} height={7} color="#FFFFFF" />
                ) : (
                  <ChipPlusIcon width={8} height={8} color="#020B12" />
                )}
                <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>{tag}</Text>
              </TouchableOpacity>
            );
          })}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
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
  instructionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 20,
  },
  instruction: {
    flex: 1,
    fontSize: 14,
    color: '#000000',
    lineHeight: 20,
  },
  counterPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    backgroundColor: CARD_BG,
  },
  counterText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#020B12',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 32,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
  chipDisabled: {
    opacity: 0.4,
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
    borderColor: '#00000033',
    backgroundColor: CARD_BG,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
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
