import ChipCloseIcon from '@/assets/images/chip-close.svg';
import ChipPlusIcon from '@/assets/images/chip-plus.svg';
import { MAX_INTEREST_TAGS, useCreateEvent } from '@/app/context/CreateEventContext';
import { INTEREST_CATEGORIES } from '@/app/lib/interestCategories';
import type { ThemeColors } from '@/app/lib/themeColors';
import { useThemeColors } from '@/app/lib/themeColors';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function InterestTags() {
  const router = useRouter();
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
                  <ChipPlusIcon width={8} height={8} color={colors.ink} />
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

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
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
    progressTrack: {
      height: 10,
      backgroundColor: c.placeholder,
      borderRadius: 999,
      overflow: 'hidden',
      marginBottom: 20,
    },
    progressFill: {
      height: '100%',
      backgroundColor: c.brand,
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
      color: c.ink,
      lineHeight: 20,
    },
    counterPill: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    counterText: {
      fontSize: 12,
      fontWeight: '500',
      color: c.ink,
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
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    chipSelected: {
      borderColor: c.brand,
      backgroundColor: c.brand,
    },
    chipDisabled: {
      opacity: 0.4,
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
