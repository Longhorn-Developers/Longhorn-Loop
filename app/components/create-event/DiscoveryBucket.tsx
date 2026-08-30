import StepIndicator from '@/app/components/create-event/StepIndicator';
import { FieldError, RequiredMark } from '@/app/components/create-event/RequiredField';
import { useCreateEvent } from '@/app/context/CreateEventContext';
import type { DiscoveryBucketId } from '@/app/context/CreateEventContext';
import { INTEREST_CATEGORIES } from '@/app/lib/interestCategories';
import type { ThemeColors } from '@/app/lib/themeColors';
import { useThemeColors } from '@/app/lib/themeColors';
import React, { useState, useMemo } from 'react';
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
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { data, update, goNext, goBack } = useCreateEvent();
  const selectedId = data.discoveryBucket;
  const canContinue = selectedId !== null;

  /**
   * Set by a Continue press, never by selecting. Marking the step red before
   * anyone has tried to leave it is scolding them for not having started.
   */
  const [attempted, setAttempted] = useState(false);

  const onContinue = () => {
    if (!canContinue) {
      setAttempted(true);
      return;
    }
    goNext();
  };

  // Tapping the selected bucket clears it. Without this there was no way back
  // to "nothing chosen" once you had touched anything — you could change your
  // mind about which bucket, but not about having one.
  const onBucketPress = (id: DiscoveryBucketId) => {
    const wasSelected = id === data.discoveryBucket;
    update({
      discoveryBucket: wasSelected ? null : id,
      // Step 3's tag list is derived from the bucket's category, so any change
      // — including clearing it — invalidates whatever was picked there.
      interestTags: [],
    });
  };

  /**
   * Continue moves rather than duplicating.
   *
   * With nothing chosen it sits at the end of the list, where it reads as the
   * last thing on the page and does not cover a bucket you are still scrolling
   * to. Once you choose one it pins above the tab bar, because at that point it
   * is the only thing left to do and you should not have to scroll back down to
   * find it. Deselecting sends it back.
   */
  const continueButton = (
    <TouchableOpacity
      onPress={onContinue}
      activeOpacity={0.85}
      // NOT disabled: a disabled button cannot explain itself.
      accessibilityRole="button"
      accessibilityState={{ disabled: !canContinue }}
      style={[styles.continueButton, canContinue && styles.continueButtonEnabled]}
    >
      <Text style={[styles.continueText, canContinue && styles.continueTextEnabled]}>Continue</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          // Clear the pinned bar so the last bucket is never trapped behind it.
          canContinue && styles.scrollWithPinnedFooter,
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        // Step 2 alone pins its header. It is the only step with a list long
        // enough to scroll — twelve buckets, roughly 940pt against a ~600pt
        // window — so it is the only one where the pills and the back arrow
        // leave the screen at all. The other five fit, and pinning there would
        // spend height to solve nothing.
        //
        // The whole block sticks, not just the pills: a progress bar floating
        // free of the "STEP 2 OF 6" that explains it reads as decoration, and
        // losing the back arrow mid-scroll is worse than losing the pills.
        stickyHeaderIndices={[0]}
      >
        <View style={styles.stickyHeader}>
          <View style={styles.header}>
            <TouchableOpacity onPress={goBack} hitSlop={12}>
              <Text style={styles.backArrow}>←</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Create an Event</Text>
            <View style={styles.headerSpacer} />
          </View>

          <View style={styles.stepBlock}>
            <Text style={styles.stepLabel}>STEP 2 OF 6</Text>
            <Text style={styles.stepTitle}>Choose a Discovery Bucket</Text>
          </View>

          <StepIndicator />
        </View>

        <Text style={[styles.instruction, styles.gutter]}>
          Buckets help your event reach the right audience.
          <RequiredMark />
        </Text>

        <View style={styles.gutter}>
          <FieldError show={attempted && !canContinue} message="Pick one bucket to continue." />
        </View>

        <View style={[styles.bucketList, styles.gutter]}>
          {BUCKETS.map((bucket) => {
            const isSelected = bucket.id === selectedId;
            const { Icon, iconSize } = bucket;
            return (
              <TouchableOpacity
                key={bucket.id}
                activeOpacity={0.85}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${bucket.title}. ${bucket.description}`}
                onPress={() => onBucketPress(bucket.id)}
                style={[styles.bucketCard, isSelected && styles.bucketCardSelected]}
              >
                <View style={[styles.avatar, isSelected && styles.avatarSelected]}>
                  <Icon
                    width={iconSize.width}
                    height={iconSize.height}
                    color={isSelected ? colors.brand : colors.ink}
                  />
                </View>
                <View style={styles.bucketText}>
                  <Text style={[styles.bucketTitle, isSelected && styles.bucketTextSelected]}>
                    {bucket.title}
                  </Text>
                  <Text style={[styles.bucketDescription, isSelected && styles.bucketTextSelected]}>
                    {bucket.description}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {!canContinue && <View style={[styles.inlineFooter, styles.gutter]}>{continueButton}</View>}
      </ScrollView>

      {canContinue && <View style={styles.pinnedFooter}>{continueButton}</View>}
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
      paddingTop: 8,
      paddingBottom: 40,
    },
    // Opaque and full-bleed. Sticky headers are transparent by default, and
    // the horizontal padding has to live here rather than on the scroll
    // container — inset by 20pt, cards would show through the gutters as they
    // pass underneath.
    stickyHeader: {
      backgroundColor: c.background,
      paddingHorizontal: 20,
      paddingBottom: 20,
    },
    // Button height + its padding, so the list can still be scrolled clear of
    // the pinned bar.
    scrollWithPinnedFooter: {
      paddingBottom: 108,
    },
    gutter: {
      paddingHorizontal: 20,
    },
    inlineFooter: {
      marginTop: 4,
    },
    pinnedFooter: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 16,
      backgroundColor: c.background,
      borderTopWidth: 1,
      borderTopColor: c.divider,
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
    // Filled, not tinted, and no checkmark. A tick beside a tinted row is the
    // universal shape of a multi-select list, and people were reading these as
    // checkboxes — you can only pick one bucket. A solid fill is the shape of a
    // chosen segment, and it does not need a second marker to say so.
    bucketCardSelected: {
      borderColor: c.brand,
      backgroundColor: c.brand,
    },
    // White on #BD5500 is 4.7:1 — the same pairing PrimaryButton already ships.
    bucketTextSelected: {
      color: '#FFFFFF',
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 10,
      backgroundColor: c.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The tile inverts with the card: a light plate holding a brand-coloured
    // icon, so the icon stays legible now that the row behind it is brand.
    avatarSelected: {
      backgroundColor: '#FFFFFF',
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
