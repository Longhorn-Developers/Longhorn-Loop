// Profile tab (LOOP-181).
//
// Replaces the placeholder screen with the real header the Figma Profile frame
// specifies: avatar, name, classification, bio, linked-social chips and an
// entry point into Edit Profile.
//
// Scope note: this is the profile *shell* only. The Going / Saved / Posted
// collections are LOOP-137 / LOOP-138, and the Past view is LOOP-200 — this
// screen is built so those drop in below the header without restructuring it.

import OpenLinkModal, { useOpenLinkGuard } from '@/app/components/modals/OpenLinkModal';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { api } from '@/app/lib/api';
import { user as userKeys } from '@/app/lib/queryKeys';
import { getSocialPlatformUI, type LinkedSocial } from '@/app/lib/socialPlatforms';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const BG = '#F9F8F5';

interface MeResponse {
  user: {
    first_name: string;
    last_name: string;
    year_classification: string | null;
    bio: string | null;
    tags: string[];
    socials: LinkedSocial[];
  };
}

export default function ProfileScreen() {
  const router = useRouter();
  const { data: onboarding } = useOnboarding();
  const token = onboarding.token || null;

  const openLink = useOpenLinkGuard();

  const { data, isLoading } = useQuery({
    queryKey: userKeys.me(),
    queryFn: () => api.get<MeResponse>('/users/me', { token }),
    enabled: !!token,
  });

  const profile = data?.user;
  const fullName = profile ? `${profile.first_name} ${profile.last_name}`.trim() : '';

  if (!token) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center" style={{ backgroundColor: BG }}>
        <Text className="font-['Roboto-Flex'] text-[14px] text-lhlSecondaryTextGrey">
          Sign in to see your profile.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: BG }} edges={['top']}>
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#BD5500" />
        </View>
      ) : (
        <ScrollView className="flex-1 px-[20px]" contentContainerStyle={{ paddingBottom: 40 }}>
          <View className="mt-[10px] flex-row items-center">
            {/* Avatar art is LOOP-130's open question (preset vs upload), so
                the placeholder circle from the design stands in for now. */}
            <View className="h-[72px] w-[72px] rounded-full bg-lhlPlaceholderGrey" />

            <View className="ml-[14px] flex-1">
              <Text
                numberOfLines={1}
                className="font-['Roboto-Flex'] text-[20px] font-semibold text-lhlInk"
              >
                {fullName || 'Your profile'}
              </Text>
              {profile?.year_classification ? (
                <Text className="font-['Roboto-Flex'] mt-[2px] text-[13px] text-lhlSecondaryTextGrey">
                  {profile.year_classification}
                </Text>
              ) : null}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit profile"
              onPress={() => router.push('/profile/edit')}
              className="rounded-full border border-lhlMutedBorder bg-white px-[14px] py-[7px]"
            >
              <Text className="font-['Roboto-Flex'] text-[12px] font-medium text-lhlInk">Edit</Text>
            </Pressable>
          </View>

          {profile?.bio ? (
            <Text className="font-['Roboto-Flex'] mt-[14px] text-[13px] leading-[19px] text-lhlInk">
              {profile.bio}
            </Text>
          ) : null}

          {profile?.socials && profile.socials.length > 0 ? (
            <View className="mt-[16px] flex-row gap-[12px]">
              {profile.socials.map((social) => {
                const meta = getSocialPlatformUI(social.platform);
                if (!meta) return null;
                const Icon = meta.icon;
                return (
                  <Pressable
                    key={social.platform}
                    accessibilityRole="link"
                    accessibilityLabel={`Open ${meta.label}`}
                    // Routed through the Open Link warning (LOOP-182) rather
                    // than Linking.openURL, so the guard can't be bypassed.
                    onPress={() => openLink.request(social.url)}
                    className="h-[40px] w-[40px] items-center justify-center rounded-full border border-lhlMutedBorder bg-white"
                  >
                    <Icon size={20} />
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {/* Past events (LOOP-200). Sits above Interests so history is one
              tap from the header, per the Profile frame. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Past events"
            onPress={() => router.push('/profile/past')}
            className="mt-[20px] flex-row items-center justify-between rounded-[12px] border border-lhlMutedBorder bg-white px-[14px] py-[12px]"
          >
            <View>
              <Text className="font-['Roboto-Flex'] text-[14px] font-semibold text-lhlInk">
                Past Events
              </Text>
              <Text className="font-['Roboto-Flex'] mt-[2px] text-[11px] text-lhlSecondaryTextGrey">
                Events you created, attended or saved
              </Text>
            </View>
            <Text className="font-['Roboto-Flex'] text-[18px] text-lhlSecondaryTextGrey">›</Text>
          </Pressable>

          {profile?.tags && profile.tags.length > 0 ? (
            <View className="mt-[20px]">
              <Text className="font-['Roboto-Flex'] text-[14px] font-semibold text-lhlInk">
                Interests
              </Text>
              <View className="mt-[8px] flex-row flex-wrap gap-[8px]">
                {profile.tags.map((tag) => (
                  <View
                    key={tag}
                    className="rounded-full border border-lhlMutedBorder bg-white px-[12px] py-[6px]"
                  >
                    <Text className="font-['Roboto-Flex'] text-[12px] text-lhlSecondaryTextGrey">
                      {tag}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      )}

      <OpenLinkModal {...openLink.modalProps} />
    </SafeAreaView>
  );
}
