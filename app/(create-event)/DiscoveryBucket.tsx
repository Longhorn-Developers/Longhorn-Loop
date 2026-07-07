import CheckIcon from '@/assets/images/check-selected.svg';
import { useCreateEvent } from '@/app/context/CreateEventContext';
import type { DiscoveryBucketId } from '@/app/context/CreateEventContext';
import { INTEREST_CATEGORIES } from '@/app/lib/interestCategories';
import { useRouter } from 'expo-router';
import React from 'react';
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

const BURNT_ORANGE = '#9D4A06';
const BLACK = '#020B12';
const BORDER = '#D9D9D9';
const CARD_BG = '#FFFFFF';
const CARD_BG_SELECTED = '#FFF5E5';
const AVATAR_BG = '#E9E6E2';
const AVATAR_BG_SELECTED = '#EEA26480';
const BG = '#F9F8F5';
const TEXT_SECONDARY = '#485656';

export default function DiscoveryBucket() {
  const router = useRouter();
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
                    color={isSelected ? BURNT_ORANGE : BLACK}
                  />
                </View>
                <View style={styles.bucketText}>
                  <Text style={styles.bucketTitle}>{bucket.title}</Text>
                  <Text style={styles.bucketDescription}>{bucket.description}</Text>
                </View>
                {isSelected && <CheckIcon width={19} height={14} color={BURNT_ORANGE} />}
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
  instruction: {
    fontSize: 14,
    color: '#000000',
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
    borderColor: BORDER,
    backgroundColor: CARD_BG,
  },
  bucketCardSelected: {
    borderColor: BURNT_ORANGE,
    backgroundColor: CARD_BG_SELECTED,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: AVATAR_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarSelected: {
    backgroundColor: AVATAR_BG_SELECTED,
  },
  bucketText: {
    flex: 1,
    gap: 2,
  },
  bucketTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
  },
  bucketDescription: {
    fontSize: 12,
    color: '#000000',
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
