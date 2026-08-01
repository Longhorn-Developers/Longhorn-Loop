import CheckIcon from '@/assets/images/check-selected.svg';
import { useCreateEvent } from '@/app/context/CreateEventContext';
import type { DiscoveryBucketId } from '@/app/context/CreateEventContext';
import { INTEREST_CATEGORIES } from '@/app/lib/interestCategories';
import type { ThemeColors } from '@/app/lib/themeColors';
import { useThemeColors, withAlpha } from '@/app/lib/themeColors';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const DEFAULT_ICON_SIZE = { width: 22, height: 22 };

// Derived from the shared interestCategories.ts.
const BUCKETS = INTEREST_CATEGORIES.map((c) => ({
  id: c.id as DiscoveryBucketId,
  title: c.label,
  description: c.description,
  Icon: c.icon,
  iconSize: DEFAULT_ICON_SIZE,
}));

export default function DiscoveryBucket() {
  const router = useRouter();
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { data, update } = useCreateEvent();
  const selectedId = data.discoveryBucket;
  const canContinue = selectedId !== null;

  const onContinue = () => {
    if (!canContinue) return;
    router.push('/(create-event)/InterestTags');
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
          <Text style={styles.stepLabel}>STEP 2 OF 6</Text>
          <Text style={styles.stepTitle}>Choose a Discovery Bucket</Text>
        </View>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: '33.33%' }]} />
        </View>

        <Text style={styles.instruction}>Buckets help your event reach the right audience.</Text>

        <View style={styles.bucketList}>
          {BUCKETS.map((bucket) => {
            const isSelected = bucket.id === selectedId;
            const { Icon, iconSize } = bucket;
            return (
              <TouchableOpacity
                key={bucket.id}
                activeOpacity={0.85}
                onPress={() => {
                  // Clear interest tags when the bucket changes — the tag
                  // list on step 3 is derived from the bucket's category,
                  // so previous picks wouldn't be visible anyway.
                  const changing = bucket.id !== data.discoveryBucket;
                  update({
                    discoveryBucket: bucket.id,
                    ...(changing ? { interestTags: [] } : {}),
                  });
                }}
                style={[styles.bucketCard, isSelected && styles.bucketCardSelected]}
              >
                <View style={[styles.avatar, isSelected && styles.avatarSelected]}>
                  <Icon
                    width={iconSize.width}
                    height={iconSize.height}
                    color={isSelected ? colors.accent : colors.ink}
                  />
                </View>
                <View style={styles.bucketText}>
                  <Text style={styles.bucketTitle}>{bucket.title}</Text>
                  <Text style={styles.bucketDescription}>{bucket.description}</Text>
                </View>
                {isSelected && <CheckIcon width={19} height={14} color={colors.accent} />}
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
    instruction: {
      fontSize: 14,
      color: c.ink,
      lineHeight: 20,
      marginBottom: 24,
    },
    bucketList: {
      gap: 12,
      marginBottom: 24,
    },
    bucketCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      padding: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    bucketCardSelected: {
      borderColor: c.brand,
      backgroundColor: c.brandSoft,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 10,
      backgroundColor: c.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarSelected: {
      backgroundColor: withAlpha(c.brand, 0.35),
    },
    bucketText: {
      flex: 1,
      gap: 2,
    },
    bucketTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: c.ink,
    },
    bucketDescription: {
      fontSize: 12,
      color: c.ink,
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
