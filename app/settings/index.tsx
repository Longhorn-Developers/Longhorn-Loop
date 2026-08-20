// Settings entry point (LOOP-184, build step 1 — Figma Frame 399).
//
// Also the org-management entry point: the Manage Organizations list is how a
// user reaches the console (LOOP-183) and the registration flow (LOOP-185).
//
// Deliberately two screens rather than one: this is the hub (a Settings row +
// the org list), while app/settings/preferences.tsx is the accordion shell.
// Collapsing them would put a search field over content that is mostly
// navigation.

import { useOnboarding } from '@/app/context/OnboardingContext';
import { api } from '@/app/lib/api';
import { org as orgKeys } from '@/app/lib/queryKeys';
import ArrowLeftIcon from '@/assets/images/arrow-left.svg';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useThemeColors } from '@/app/lib/themeColors';

interface MyOrg {
  id: number;
  name: string;
  role: 'admin' | 'editor';
  verified: boolean;
  event_count: number;
}

interface MyOrgsResponse {
  organizations: MyOrg[];
}

export default function SettingsEntryScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { data: onboarding } = useOnboarding();
  const token = onboarding.token || null;

  const orgs = useQuery({
    queryKey: orgKeys.mine(),
    queryFn: () => api.get<MyOrgsResponse>('/orgs/mine', { token }),
    enabled: !!token,
  });

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
        <Text className="font-['Roboto-Flex'] ml-[12px] text-[20px] font-semibold text-lhlInk">
          Account
        </Text>
      </View>

      <ScrollView
        className="flex-1 px-[20px] bg-lhlBackgroundColor"
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/settings/preferences')}
          className="flex-row items-center justify-between rounded-[12px] border border-lhlMutedBorder bg-lhlSurface px-[14px] py-[14px]"
        >
          <View>
            <Text className="font-['Roboto-Flex'] text-[15px] font-semibold text-lhlInk">
              Settings
            </Text>
            <Text className="font-['Roboto-Flex'] mt-[2px] text-[11px] text-lhlSecondaryTextGrey">
              Customize your experience and manage your account.
            </Text>
          </View>
          <Text className="font-['Roboto-Flex'] text-[18px] text-lhlSecondaryTextGrey">›</Text>
        </Pressable>

        {/* Frame 471 (LOOP-180). Reachable from here as well as from the bell
            on a public org profile: this is where someone goes looking when an
            org they follow is being noisy, and they won't necessarily think to
            open that org's page first. */}
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/settings/followed-orgs')}
          className="mt-[10px] flex-row items-center justify-between rounded-[12px] border border-lhlMutedBorder bg-lhlSurface px-[14px] py-[14px]"
        >
          <View>
            <Text className="font-['Roboto-Flex'] text-[15px] font-semibold text-lhlInk">
              Followed organizations
            </Text>
            <Text className="font-['Roboto-Flex'] mt-[2px] text-[11px] text-lhlSecondaryTextGrey">
              Choose what the organizations you follow can notify you about.
            </Text>
          </View>
          <Text className="font-['Roboto-Flex'] text-[18px] text-lhlSecondaryTextGrey">›</Text>
        </Pressable>

        {/* --- Manage Organizations --- */}
        <Text className="font-['Roboto-Flex'] mt-[24px] text-[15px] font-semibold text-lhlInk">
          Manage Organizations
        </Text>

        {orgs.isLoading ? (
          <ActivityIndicator className="mt-[16px]" color={colors.brand} />
        ) : (
          <View className="mt-[10px]">
            {orgs.data?.organizations.length === 0 ? (
              <Text className="font-['Roboto-Flex'] text-[12px] text-lhlSecondaryTextGrey">
                You’re not part of any organizations yet.
              </Text>
            ) : (
              orgs.data?.organizations.map((o) => (
                <View
                  key={o.id}
                  className="mb-[10px] rounded-[12px] border border-lhlMutedBorder bg-lhlSurface px-[14px] py-[12px]"
                >
                  <View className="flex-row items-center">
                    <View className="h-[36px] w-[36px] rounded-full bg-lhlPlaceholderGrey" />
                    <View className="ml-[10px] flex-1 bg-lhlBackgroundColor">
                      <View className="flex-row items-center gap-[5px]">
                        <Text
                          numberOfLines={1}
                          className="font-['Roboto-Flex'] text-[14px] font-semibold text-lhlInk"
                        >
                          {o.name}
                        </Text>
                        {o.verified ? (
                          <Text
                            className="text-[12px] text-lhlAccent"
                            accessibilityLabel="Verified"
                          >
                            ✓
                          </Text>
                        ) : null}
                      </View>
                      <Text className="font-['Roboto-Flex'] mt-[2px] text-[11px] capitalize text-lhlSecondaryTextGrey">
                        {o.role} · {o.event_count} event{o.event_count === 1 ? '' : 's'}
                      </Text>
                    </View>
                  </View>

                  <View className="mt-[10px] flex-row gap-[8px]">
                    {/* "Manage" beside an event count means "manage these
                        events", so it opens the console on the Events tab
                        (LOOP-136) rather than the Members default. */}
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => router.push(`/org/${o.id}?tab=events`)}
                      className="flex-1 items-center rounded-full border border-lhlMutedBorder bg-lhlSurface py-[7px]"
                    >
                      <Text className="font-['Roboto-Flex'] text-[12px] font-medium text-lhlInk">
                        Manage
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => router.push('/(tabs)/create')}
                      className="flex-1 items-center rounded-full bg-lhlBurntOrange py-[7px]"
                    >
                      <Text className="font-['Roboto-Flex'] text-[12px] font-semibold text-white">
                        + New Event
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ))
            )}

            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/org/register')}
              className="mt-[6px] items-center rounded-[12px] border border-dashed border-lhlMutedBorder bg-lhlSurfaceGrey py-[14px]"
            >
              <Text className="font-['Roboto-Flex'] text-[13px] font-semibold text-lhlInk">
                + Register an Organization
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
