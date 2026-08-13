// Notifications for the orgs you follow (LOOP-180, Figma Frame 471).
//
// Three switches: Pause all followed orgs, New event posts, Event detail
// changes.
//
// THEY ARE GLOBAL, NOT PER-ORG. One row per user, applying across every org
// that user follows. The signed-off frame shows exactly three switches and no
// org list, so a per-org screen would have been designing rather than
// building. Per-org muting is the obvious extension and nothing here forecloses
// it: the storage is its own table (followed_org_notification_settings) rather
// than three columns on user_settings precisely so that an (org_id, user_id)
// table could later override this row as a fallback. When that lands, this
// screen grows a list below the three switches; the switches themselves stay
// as the default.
//
// Distinct from two neighbours that sound the same:
//   * app/org/[id]/notifications.tsx — Frame 470, four switches, what an org's
//     ADMINS hear about their own org. Admin-gated.
//   * app/settings/preferences.tsx — LOOP-184, the user's own account
//     preferences.
// This is the third scope: what a FOLLOWER hears about other people's orgs.
//
// `paused` is stored alongside the other two rather than forcing them off, so
// un-pausing restores what the user had picked. That is why the two rows below
// are greyed and disabled while paused instead of being switched off — turning
// them off would destroy the state that makes un-pausing lossless.

import { useOnboarding } from '@/app/context/OnboardingContext';
import { ApiError, api } from '@/app/lib/api';
import { settings as settingsKeys } from '@/app/lib/queryKeys';
import { useThemeColors } from '@/app/lib/themeColors';
import ArrowLeftIcon from '@/assets/images/arrow-left.svg';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type SettingKey = 'paused' | 'new_event_posts' | 'event_detail_changes';

interface SettingsResponse {
  settings: Record<SettingKey, boolean>;
}

// The master switch is rendered separately from the other two — it is the one
// that changes what the rest of the screen means.
const PAUSE_ROW = {
  key: 'paused' as const,
  label: 'Pause all followed orgs',
  hint: 'Stop every notification from the organizations you follow',
};

const ROWS: { key: SettingKey; label: string; hint: string }[] = [
  {
    key: 'new_event_posts',
    label: 'New event posts',
    hint: 'When an org you follow posts an event',
  },
  {
    key: 'event_detail_changes',
    label: 'Event detail changes',
    hint: 'When the time, place or status of one of their events changes',
  },
];

export default function FollowedOrgNotificationsScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: onboarding } = useOnboarding();
  const token = onboarding.token || null;

  const [error, setError] = useState<string | null>(null);

  const settings = useQuery({
    queryKey: settingsKeys.followedOrgs(),
    queryFn: () => api.get<SettingsResponse>('/settings/followed-orgs', { token }),
    enabled: !!token,
  });

  const update = useMutation({
    mutationFn: (patch: Partial<Record<SettingKey, boolean>>) =>
      api.patch<SettingsResponse>('/settings/followed-orgs', { token, body: patch }),
    // The PATCH returns the full merged row, so write it straight into the
    // cache: invalidating would cost a round trip and make the switch visibly
    // bounce back to its old value before settling. Same pattern as the org
    // notification screen.
    onSuccess: (data) => queryClient.setQueryData(settingsKeys.followedOrgs(), data),
    onError: (err) => {
      const body = err instanceof ApiError ? (err.body as Record<string, unknown> | null) : null;
      setError((body?.message as string) ?? 'Could not save that setting.');
      // The optimistic-looking UI above is actually the server's last known
      // answer, so refetch to get back in step after a failure.
      queryClient.invalidateQueries({ queryKey: settingsKeys.followedOrgs() });
    },
  });

  const values = settings.data?.settings;
  const paused = values?.paused ?? false;

  return (
    <SafeAreaView className="flex-1 bg-lhlBackgroundColor" edges={['top']}>
      <View className="flex-row items-center px-[20px] py-[12px]">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
        >
          <ArrowLeftIcon width={22} height={22} color={colors.ink} />
        </Pressable>
        <Text className="font-['Roboto-Flex'] ml-[12px] text-[18px] font-semibold text-lhlInk">
          Followed organizations
        </Text>
      </View>

      {settings.isLoading ? (
        <View className="flex-1 items-center justify-center bg-lhlBackgroundColor">
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : (
        <ScrollView
          className="flex-1 bg-lhlBackgroundColor px-[20px]"
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          <Text className="font-['Roboto-Flex'] mb-[14px] text-[12px] text-lhlSecondaryTextGrey">
            These apply to every organization you follow.
          </Text>

          {error ? (
            <Text className="font-['Roboto-Flex'] mb-[12px] text-[12px] text-lhlDestructiveRed">
              {error}
            </Text>
          ) : null}

          {/* --- Master switch --- */}
          <View className="mb-[18px] flex-row items-center justify-between rounded-[10px] border border-lhlMutedBorder bg-lhlSurface px-[14px] py-[12px]">
            <View className="flex-1 pr-[12px]">
              <Text className="font-['Roboto-Flex'] text-[14px] font-medium text-lhlInk">
                {PAUSE_ROW.label}
              </Text>
              <Text className="font-['Roboto-Flex'] mt-[2px] text-[11px] text-lhlSecondaryTextGrey">
                {PAUSE_ROW.hint}
              </Text>
            </View>
            <Switch
              value={paused}
              disabled={update.isPending}
              onValueChange={(next) => {
                setError(null);
                update.mutate({ paused: next });
              }}
              trackColor={{ false: colors.border, true: colors.brand }}
              thumbColor={colors.surface}
            />
          </View>

          {/* --- The two it overrides --- */}
          {ROWS.map((row) => (
            <View
              key={row.key}
              className={`mb-[10px] flex-row items-center justify-between rounded-[10px] border border-lhlMutedBorder bg-lhlSurface px-[14px] py-[12px] ${
                // Greyed rather than switched off: the stored values survive a
                // pause so un-pausing puts them back.
                paused ? 'opacity-50' : ''
              }`}
            >
              <View className="flex-1 pr-[12px]">
                <Text className="font-['Roboto-Flex'] text-[14px] font-medium text-lhlInk">
                  {row.label}
                </Text>
                <Text className="font-['Roboto-Flex'] mt-[2px] text-[11px] text-lhlSecondaryTextGrey">
                  {row.hint}
                </Text>
              </View>
              <Switch
                value={values?.[row.key] ?? true}
                disabled={paused || update.isPending}
                onValueChange={(next) => {
                  setError(null);
                  update.mutate({ [row.key]: next });
                }}
                trackColor={{ false: colors.border, true: colors.brand }}
                thumbColor={colors.surface}
              />
            </View>
          ))}

          {paused ? (
            <Text className="font-['Roboto-Flex'] mt-[6px] text-[11px] text-lhlSecondaryTextGrey">
              Everything from followed organizations is paused. Your choices above are remembered
              for when you turn it back on.
            </Text>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
