// Org notification settings (LOOP-183, build step 5 — Figma Frame 470).
//
// Four toggles scoped to one organization: New RSVPs, New followers, Event
// reports, Org Team invites. Distinct from the user's own notification
// preferences (LOOP-125), which live on the Settings page.
//
// Writes are admin-only and the server enforces that; an editor sees the
// current values read-only rather than a screen that appears editable and
// then fails.

import { useOnboarding } from '@/app/context/OnboardingContext';
import { ApiError, api } from '@/app/lib/api';
import { org as orgKeys } from '@/app/lib/queryKeys';
import ArrowLeftIcon from '@/assets/images/arrow-left.svg';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const BG = '#F9F8F5';

type SettingKey = 'new_rsvps' | 'new_followers' | 'event_reports' | 'org_team_invites';

const ROWS: { key: SettingKey; label: string; hint: string }[] = [
  { key: 'new_rsvps', label: 'New RSVPs', hint: 'When someone says they’re going' },
  { key: 'new_followers', label: 'New followers', hint: 'When someone follows this org' },
  { key: 'event_reports', label: 'Event reports', hint: 'When an event is reported' },
  { key: 'org_team_invites', label: 'Org Team invites', hint: 'Invite activity for your team' },
];

interface SettingsResponse {
  settings: Record<SettingKey, boolean>;
}

interface OrgHeaderResponse {
  role: 'admin' | 'editor';
}

export default function OrgNotificationSettingsScreen() {
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
    <SafeAreaView className="flex-1" style={{ backgroundColor: BG }} edges={['top']}>
      <View className="flex-row items-center px-[20px] py-[12px]">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
        >
          <ArrowLeftIcon width={22} height={22} />
        </Pressable>
        <Text className="font-['Roboto-Flex'] ml-[12px] text-[18px] font-semibold text-lhlInk">
          Notifications
        </Text>
      </View>

      {settings.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#BD5500" />
        </View>
      ) : (
        <ScrollView className="flex-1 px-[20px]" contentContainerStyle={{ paddingBottom: 40 }}>
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

          {ROWS.map((row) => (
            <View
              key={row.key}
              className="mb-[10px] flex-row items-center justify-between rounded-[10px] border border-lhlMutedBorder bg-white px-[14px] py-[12px]"
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
                trackColor={{ false: '#B4B2B2', true: '#BD5500' }}
              />
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
