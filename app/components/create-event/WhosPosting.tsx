import StepPills from '@/app/components/StepPills';
import CheckIcon from '@/assets/images/check-selected.svg';
import PosterOrgIcon from '@/assets/images/poster-org.svg';
import PosterPersonalIcon from '@/assets/images/poster-personal.svg';
import { useCreateEvent } from '@/app/context/CreateEventContext';
import type { CreateEventPoster } from '@/app/context/CreateEventContext';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { api } from '@/app/lib/api';
import { org as orgKeys, user as userKeys } from '@/app/lib/queryKeys';
import type { ThemeColors } from '@/app/lib/themeColors';
import { useThemeColors, withAlpha } from '@/app/lib/themeColors';
import { useQuery } from '@tanstack/react-query';
import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SvgProps } from 'react-native-svg';

type PosterOption = CreateEventPoster & {
  Icon: React.FC<SvgProps>;
  iconSize: { width: number; height: number };
};

// /users/me gives the personal account; /orgs/mine gives every org the user
// belongs to, each with their role. Both admin and editor can post, so every
// org the endpoint returns is a valid poster. A user in no orgs sees only the
// personal option.
interface MeResponse {
  user: { first_name: string; last_name: string };
}
interface MyOrg {
  id: number;
  name: string;
  role: 'admin' | 'editor';
}
interface MyOrgsResponse {
  organizations: MyOrg[];
}

const roleLabel = (role: MyOrg['role']) => (role === 'admin' ? 'Admin' : 'Editor');

export default function WhosPosting() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { data, update, goNext } = useCreateEvent();
  const { data: onboarding } = useOnboarding();
  const token = onboarding.token || null;
  const selectedId = data.poster?.id ?? null;

  const meQuery = useQuery({
    queryKey: userKeys.me(),
    queryFn: () => api.get<MeResponse>('/users/me', { token }),
    enabled: !!token,
  });

  const orgsQuery = useQuery({
    queryKey: orgKeys.mine(),
    queryFn: () => api.get<MyOrgsResponse>('/orgs/mine', { token }),
    enabled: !!token,
  });

  // Build the poster list from the two queries. Personal account first (using
  // the onboarding name as a fallback before /users/me resolves), then orgs.
  const posters = useMemo<PosterOption[]>(() => {
    const meName =
      [meQuery.data?.user.first_name, meQuery.data?.user.last_name].filter(Boolean).join(' ') ||
      [onboarding.firstName, onboarding.lastName].filter(Boolean).join(' ') ||
      'Personal Account';

    const personal: PosterOption = {
      kind: 'personal',
      id: 'me',
      name: meName,
      role: 'Personal Account',
      Icon: PosterPersonalIcon,
      iconSize: { width: 24, height: 24 },
    };

    const orgs: PosterOption[] = (orgsQuery.data?.organizations ?? []).map((o) => ({
      kind: 'org',
      id: String(o.id),
      name: o.name,
      role: roleLabel(o.role),
      Icon: PosterOrgIcon,
      iconSize: { width: 20, height: 20 },
    }));

    return [personal, ...orgs];
  }, [meQuery.data, orgsQuery.data, onboarding.firstName, onboarding.lastName]);

  const canContinue = selectedId !== null;
  const isLoading = meQuery.isLoading || orgsQuery.isLoading;

  const onContinue = () => {
    if (!canContinue) return;
    goNext();
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Text style={styles.headerTitle}>Create an Event</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.stepBlock}>
          <Text style={styles.stepLabel}>STEP 1 OF 6</Text>
          <Text style={styles.stepTitle}>Who&apos;s Posting?</Text>
        </View>

        <StepPills step={1} totalSteps={6} style={{ marginBottom: 20 }} />

        <Text style={styles.instruction}>
          Your event will be attributed to the profile or organization that you select.
        </Text>

        {isLoading && (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.brand} />
          </View>
        )}

        <View style={styles.posterList}>
          {posters.map((poster) => {
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
    instruction: {
      fontSize: 14,
      color: c.ink,
      lineHeight: 20,
      marginBottom: 24,
    },
    loading: {
      paddingVertical: 12,
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
