import CheckIcon from '@/assets/images/check-selected.svg';
import PosterOrgSmallIcon from '@/assets/images/poster-org-small.svg';
import PosterOrgIcon from '@/assets/images/poster-org.svg';
import PosterPersonalIcon from '@/assets/images/poster-personal.svg';
import { useCreateEvent } from '@/app/context/CreateEventContext';
import type { CreateEventPoster } from '@/app/context/CreateEventContext';
import type { ThemeColors } from '@/app/lib/themeColors';
import { useThemeColors, withAlpha } from '@/app/lib/themeColors';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SvgProps } from 'react-native-svg';

type PosterOption = CreateEventPoster & {
  Icon: React.FC<SvgProps>;
  iconSize: { width: number; height: number };
};

// NOTE: hard-coded placeholder posters. Swap for real data once the
// profile endpoint is wired up. Expected source:
//   - Personal account: current user (name from /users/me/profile)
//   - Orgs: the memberships list on the user profile, filtered to roles
//     that can post (Admin / Editor / etc.)
// Match the shape of PosterOption when mapping the API response.
const POSTERS: PosterOption[] = [
  {
    kind: 'personal',
    id: 'me',
    name: 'Todd Jenkins',
    role: 'Personal Account',
    Icon: PosterPersonalIcon,
    iconSize: { width: 24, height: 24 },
  },
  {
    kind: 'org',
    id: 'longhorn-ai',
    name: 'Longhorn AI Society',
    role: 'Admin',
    Icon: PosterOrgIcon,
    iconSize: { width: 20, height: 20 },
  },
  {
    kind: 'org',
    id: 'ut-food',
    name: 'UT Food Society',
    role: 'Editor',
    Icon: PosterOrgSmallIcon,
    iconSize: { width: 19, height: 16 },
  },
];

export default function WhosPosting() {
  const router = useRouter();
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { data, update } = useCreateEvent();
  const selectedId = data.poster?.id ?? null;

  const canContinue = selectedId !== null;

  const onContinue = () => {
    if (!canContinue) return;
    router.push('/(create-event)/DiscoveryBucket');
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
          <Text style={styles.stepLabel}>STEP 1 OF 6</Text>
          <Text style={styles.stepTitle}>Who&apos;s Posting?</Text>
        </View>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: '16.66%' }]} />
        </View>

        <Text style={styles.instruction}>
          Your event will be attributed to the profile or organization that you select.
        </Text>

        <View style={styles.posterList}>
          {POSTERS.map((poster) => {
            const isSelected = poster.id === selectedId;
            const { Icon, iconSize } = poster;
            const posterForContext: CreateEventPoster = {
              kind: poster.kind,
              id: poster.id,
              name: poster.name,
              role: poster.role,
            };
            return (
              <TouchableOpacity
                key={poster.id}
                activeOpacity={0.85}
                onPress={() => update({ poster: posterForContext })}
                style={[styles.posterCard, isSelected && styles.posterCardSelected]}
              >
                <View style={[styles.avatar, isSelected && styles.avatarSelected]}>
                  <Icon
                    width={iconSize.width}
                    height={iconSize.height}
                    color={isSelected ? colors.accent : colors.ink}
                  />
                </View>
                <View style={styles.posterText}>
                  <Text style={styles.posterName}>{poster.name}</Text>
                  <Text style={styles.posterRole}>
                    {poster.kind === 'personal' ? (
                      poster.role
                    ) : (
                      <>
                        Org <Text style={styles.posterRoleBold}>·</Text> {poster.role}
                      </>
                    )}
                  </Text>
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
    posterList: {
      gap: 12,
      marginBottom: 24,
    },
    posterCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      padding: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    posterCardSelected: {
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
    posterText: {
      flex: 1,
      gap: 2,
    },
    posterName: {
      fontSize: 16,
      fontWeight: '600',
      color: c.ink,
    },
    posterRole: {
      fontSize: 12,
      color: c.ink,
    },
    posterRoleBold: {
      fontWeight: '700',
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
