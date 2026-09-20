// Org notification settings (LOOP-183, build step 5 — Figma Frame 470).
//
// Four toggles scoped to one organization: New RSVPs, New followers, Event
// reports, Org Team invites. Distinct from the user's own notification
// preferences (LOOP-125), which live on the Settings page.
//
// Writes are admin-only and the server enforces that; an editor sees the
// current values read-only rather than a screen that appears editable and
// then fails.
//
// REACHED FROM the megaphone in the Organization Management header
// (app/org/[id]/index.tsx). Until that icon existed this screen was registered
// in app/_layout.tsx and linked from nowhere, so the toggles below had never
// been reachable in the running app — worth knowing if git blame makes the
// copy here look untested.
//
// The rows are hairline-divided, not carded. The frame draws a plain list, and
// bordered cards were making four switches look like four separate settings
// screens.

import { useOnboarding } from '@/app/context/OnboardingContext';
import { ApiError, api } from '@/app/lib/api';
import { org as orgKeys } from '@/app/lib/queryKeys';
import ArrowLeftIcon from '@/assets/images/arrow-left.svg';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useThemeColors } from '@/app/lib/themeColors';

type SettingKey = 'new_rsvps' | 'new_followers' | 'event_reports' | 'org_team_invites';

/** Labels and hints verbatim from Frame 470. */
const ROWS: { key: SettingKey; label: string; hint: string }[] = [
  { key: 'new_rsvps', label: 'New RSVPs', hint: 'When someone RSVPs to your events' },
  { key: 'new_followers', label: 'New followers', hint: 'When users follow your org' },
  {
    key: 'event_reports',
    label: 'Event reports',
    hint: 'When a report is filed against your event',
  },
  { key: 'org_team_invites', label: 'Org Team invites', hint: 'Role changes and team invitations' },
];

interface SettingsResponse {
  settings: Record<SettingKey, boolean>;
}

interface OrgHeaderResponse {
  role: 'admin' | 'editor';
}

export default function OrgNotificationSettingsScreen() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const orgId = Number(id);
  const router = useRouter();
  const { data: onboarding } = useOnboarding();
  const token = onboarding.token || null;
  const queryClient = useQueryClient();

  const [error, setError] = useState<string | null>(null);

  const header = useQuery({
    queryKey: orgKeys.detail(orgId),
    queryFn: () => api.get<OrgHeaderResponse>(`/orgs/${orgId}`, { token }),
    enabled: !!token && Number.isFinite(orgId),
  });

  const settings = useQuery({
    queryKey: orgKeys.notificationSettings(orgId),
    queryFn: () => api.get<SettingsResponse>(`/orgs/${orgId}/notification-settings`, { token }),
    enabled: !!token && Number.isFinite(orgId),
  });

  const update = useMutation({
    mutationFn: (patch: Partial<Record<SettingKey, boolean>>) =>
      api.patch<SettingsResponse>(`/orgs/${orgId}/notification-settings`, { token, body: patch }),
    // Write the server's response straight into the cache instead of
    // invalidating: the PATCH already returns the full merged settings, so a
    // refetch would be a wasted round trip and a visible toggle flicker.
    onSuccess: (data) => queryClient.setQueryData(orgKeys.notificationSettings(orgId), data),
    onError: (err) => {
      const body = err instanceof ApiError ? (err.body as Record<string, unknown> | null) : null;
      setError((body?.message as string) ?? 'Could not save that setting.');
      queryClient.invalidateQueries({ queryKey: orgKeys.notificationSettings(orgId) });
    },
  });

  const canEdit = header.data?.role === 'admin';
  const values = settings.data?.settings;

  return (
    <SafeAreaView className="flex-1 bg-lhlBackgroundColor" edges={['top']}>
      {/* The frame stacks the title UNDER the back arrow rather than beside
          it, which every other stack header in the app does. That is not a
          styling slip: "Organization Notification Settings" is too long to sit
          next to a 22pt arrow on a 390pt screen without wrapping to two ragged
          lines around it. */}
      <View className="px-[20px] pb-[6px] pt-[12px]">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          onPress={() => router.back()}
          className="self-start"
        >
          <ArrowLeftIcon width={22} height={22} color={colors.ink} />
        </Pressable>
        <Text
          accessibilityRole="header"
          className="font-['Roboto-Flex'] mt-[14px] text-[18px] font-semibold text-lhlInk"
        >
          Organization Notification Settings
        </Text>
      </View>

      {settings.isLoading ? (
        <View className="flex-1 items-center justify-center bg-lhlBackgroundColor">
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : (
        <ScrollView
          className="flex-1 px-[20px] bg-lhlBackgroundColor"
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          {!canEdit ? (
            <Text className="font-['Roboto-Flex'] mb-[12px] text-[12px] text-lhlSecondaryTextGrey">
              Only admins can change these.
            </Text>
          ) : null}

          {error ? (
            <Text className="font-['Roboto-Flex'] mb-[12px] text-[12px] text-lhlDestructiveRed">
              {error}
            </Text>
          ) : null}

          {ROWS.map((row, index) => (
            <View
              key={row.key}
              className={`flex-row items-center justify-between py-[14px] ${
                index === ROWS.length - 1 ? '' : 'border-b border-lhlDivider'
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
                disabled={!canEdit || update.isPending}
                onValueChange={(next) => {
                  setError(null);
                  update.mutate({ [row.key]: next });
                }}
                trackColor={{ false: colors.border, true: colors.brand }}
                thumbColor={colors.surface}
              />
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
