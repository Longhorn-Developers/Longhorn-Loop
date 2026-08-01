// Profile tab — "Profile Main" frame (LOOP-123 header + LOOP-137/138
// collections, both signed off in design but never built in code).
//
// Layout, top to bottom:
//   hamburger (org management + settings)
//   centred avatar, name, "N followers · N following"
//   Edit Profile pill + linked-social icon row
//   bio
//   metadata rows — icon + values, one per category (academic, background)
//   Interests — tag chips + "+" into Edit Profile
//   My Events — Going / Saved / Posted segmented control with counts,
//               search field, category chips, date sort, two-column grid
//
// Scope: this is the OWNER's own profile. The read-only Follow/Block variant
// for other users and orgs is LOOP-180 (assigned separately), which is why
// nothing here is written to take a target user id.

import OpenLinkModal, { useOpenLinkGuard } from '@/app/components/modals/OpenLinkModal';
import { getAvatarSource } from '@/app/components/profile/AvatarPickerModal';
import ProfileEventCard from '@/app/components/profile/ProfileEventCard';
import ProfileMetaRow from '@/app/components/profile/ProfileMetaRow';
import { GlobeIcon, GraduationCapIcon } from '@/assets/icons/LhlProfileMetaIcons';
import TextInputField from '@/app/components/inputs/TextInputField';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { ApiError, api } from '@/app/lib/api';
import { events as eventsKeys, user as userKeys } from '@/app/lib/queryKeys';
import { getSocialPlatformUI, type LinkedSocial } from '@/app/lib/socialPlatforms';
import type { ApiEvent } from '@/app/components/EventCard';
import LhlSearchIcon from '@/assets/icons/LhlSearchIcon';
import {
  PROFILE_EVENT_FILTERS,
  PROFILE_EVENT_FILTER_LABELS,
  type ProfileEventFilter,
  type ProfileEventTab,
} from '@/shared/profileEventFilters';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useThemeColors } from '@/app/lib/themeColors';

interface MeResponse {
  user: {
    id: number;
    first_name: string;
    last_name: string;
    year_classification: string | null;
    unique_classification: string[];
    bio: string | null;
    avatar: number | null;
    majors: string[];
    tags: string[];
    socials: LinkedSocial[];
    follower_count: number;
    following_count: number;
  };
}

interface MyEventsResponse {
  tab: ProfileEventTab;
  events: (ApiEvent & { org_verified?: boolean; is_saved?: boolean })[];
  counts: Record<ProfileEventTab, number>;
}

const TABS: { key: ProfileEventTab; label: string; empty: string }[] = [
  { key: 'going', label: 'Going', empty: 'Events you RSVP to will show up here' },
  { key: 'saved', label: 'Saved', empty: 'Events you save will show up here' },
  { key: 'posted', label: 'Posted', empty: 'Events you create will show up here' },
];

export default function ProfileScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { data: onboarding } = useOnboarding();
  const token = onboarding.token || null;
  const queryClient = useQueryClient();

  const openLink = useOpenLinkGuard();

  const [tab, setTab] = useState<ProfileEventTab>('going');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ProfileEventFilter>('all');
  const [sortRecent, setSortRecent] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const profileQuery = useQuery({
    queryKey: userKeys.me(),
    queryFn: () => api.get<MeResponse>('/users/me', { token }),
    enabled: !!token,
  });

  const eventsQuery = useQuery({
    queryKey: userKeys.myEvents({ tab, q: search, filter, sort: sortRecent ? 'recent' : 'date' }),
    queryFn: () => {
      const params = new URLSearchParams({
        tab,
        filter,
        sort: sortRecent ? 'recent' : 'date',
      });
      if (search.trim()) params.set('q', search.trim());
      return api.get<MyEventsResponse>(`/users/me/events?${params.toString()}`, { token });
    },
    enabled: !!token,
  });

  const toggleSave = useMutation({
    mutationFn: async ({ eventId, saved }: { eventId: number; saved: boolean }) =>
      saved ? api.delete(`/saved/${eventId}`, { token }) : api.post(`/saved/${eventId}`, { token }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.myEventsAll() });
      queryClient.invalidateQueries({ queryKey: eventsKeys.all });
    },
  });

  const profile = profileQuery.data?.user;
  const fullName = profile ? `${profile.first_name} ${profile.last_name}`.trim() : '';
  const avatarSource = getAvatarSource(profile?.avatar);

  const counts = eventsQuery.data?.counts;
  const activeTab = TABS.find((t) => t.key === tab)!;

  if (!token) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-lhlBackgroundColor">
        <Text className="font-['Roboto-Flex'] text-[14px] text-lhlSecondaryTextGrey">
          Sign in to see your profile.
        </Text>
      </SafeAreaView>
    );
  }

  if (profileQuery.isError) {
    const status = profileQuery.error instanceof ApiError ? profileQuery.error.status : null;
    return (
      <SafeAreaView className="flex-1 items-center justify-center px-[30px] bg-lhlBackgroundColor">
        <Text className="font-['Roboto-Flex'] text-center text-[15px] font-semibold text-lhlInk">
          Couldn’t load your profile
        </Text>
        <Text className="font-['Roboto-Flex'] mt-[6px] text-center text-[12px] text-lhlSecondaryTextGrey">
          {status === 401
            ? 'Your session expired. Sign in again.'
            : `Something went wrong${status ? ` (HTTP ${status})` : ''}.`}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => profileQuery.refetch()}
          className="mt-[18px] rounded-full bg-lhlBurntOrange px-[22px] py-[9px]"
        >
          <Text className="font-['Roboto-Flex'] text-[13px] font-semibold text-white">
            Try again
          </Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-lhlBackgroundColor" edges={['top']}>
      {profileQuery.isLoading ? (
        <View className="flex-1 items-center justify-center bg-lhlBackgroundColor">
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : (
        <ScrollView
          className="flex-1 bg-lhlBackgroundColor"
          contentContainerStyle={{ paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* --- Hamburger: org management + settings --- */}
          <View className="flex-row justify-end px-[20px] pt-[6px]">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Menu"
              accessibilityState={{ expanded: menuOpen }}
              onPress={() => setMenuOpen((v) => !v)}
              hitSlop={10}
              className="h-[28px] w-[28px] items-center justify-center"
            >
              {/* Three bars, drawn rather than an emoji glyph so it renders
                  identically on both platforms. */}
              {[0, 1, 2].map((i) => (
                <View key={i} className="my-[2px] h-[2px] w-[18px] rounded-full bg-lhlInk" />
              ))}
            </Pressable>
          </View>

          {menuOpen ? (
            <View className="mx-[20px] mb-[6px] overflow-hidden rounded-[10px] border border-lhlMutedBorder bg-lhlSurface">
              {[
                { label: 'Manage Organizations', to: '/settings' },
                { label: 'Settings', to: '/settings/preferences' },
              ].map((item, i) => (
                <Pressable
                  key={item.to}
                  accessibilityRole="button"
                  onPress={() => {
                    setMenuOpen(false);
                    router.push(item.to as never);
                  }}
                  className={`px-[14px] py-[12px] ${i > 0 ? 'border-t border-lhlSurfaceGrey' : ''}`}
                >
                  <Text className="font-['Roboto-Flex'] text-[13px] text-lhlInk">{item.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {/* --- Header --- */}
          <View className="items-center px-[20px]">
            <View className="h-[92px] w-[92px] overflow-hidden rounded-full bg-lhlPlaceholderGrey">
              {avatarSource ? (
                <Image source={avatarSource} style={{ width: '100%', height: '100%' }} />
              ) : null}
            </View>

            <Text
              numberOfLines={1}
              className="font-['Roboto-Flex'] mt-[10px] text-[20px] font-bold text-lhlInk"
            >
              {fullName || 'Your profile'}
            </Text>

            <Text className="font-['Roboto-Flex'] mt-[3px] text-[12px] text-lhlSecondaryTextGrey">
              <Text className="font-semibold text-lhlInk">{profile?.follower_count ?? 0}</Text>{' '}
              followers ·{' '}
              <Text className="font-semibold text-lhlInk">{profile?.following_count ?? 0}</Text>{' '}
              following
            </Text>

            {/* Edit Profile + linked socials, one row */}
            <View className="mt-[10px] flex-row items-center gap-[8px]">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit profile"
                onPress={() => router.push('/profile/edit')}
                className="flex-row items-center gap-[5px] rounded-full border border-lhlMutedBorder bg-lhlSurface px-[14px] py-[6px]"
              >
                <Text className="font-['Roboto-Flex'] text-[12px] font-medium text-lhlInk">
                  Edit Profile
                </Text>
                <Text className="text-[10px] text-lhlSecondaryTextGrey">✎</Text>
              </Pressable>

              {profile?.socials?.map((social) => {
                const meta = getSocialPlatformUI(social.platform);
                if (!meta) return null;
                const Icon = meta.icon;
                return (
                  <Pressable
                    key={social.platform}
                    accessibilityRole="link"
                    accessibilityLabel={`Open ${meta.label}`}
                    // Routed through the Open Link warning (LOOP-182).
                    onPress={() => openLink.request(social.url)}
                    className="h-[30px] w-[30px] items-center justify-center rounded-[7px] border border-lhlMutedBorder bg-lhlSurface"
                  >
                    <Icon size={16} />
                  </Pressable>
                );
              })}
            </View>

            {profile?.bio ? (
              <Text className="font-['Roboto-Flex'] mt-[12px] text-center text-[12px] leading-[18px] text-lhlInk">
                {profile.bio}
              </Text>
            ) : null}
          </View>

          {/* --- Metadata ---
              One muted icon+value row per category, the pattern X and LinkedIn
              use under a bio. Replaces a "Details and Interests" heading over a
              row of grey chips: the icon carries the category so no label is
              needed, and it scales to however many values exist. Left-aligned
              because multi-item rows centre badly. */}
          <View className="mt-[14px] px-[20px]">
            <ProfileMetaRow
              icon={<GraduationCapIcon />}
              label="Academic"
              values={[profile?.year_classification, ...(profile?.majors ?? [])]}
            />
            <ProfileMetaRow
              icon={<GlobeIcon />}
              label="Background"
              values={profile?.unique_classification ?? []}
            />
          </View>

          {/* --- Interests --- */}
          <View className="mt-[18px] px-[20px]">
            <Text className="font-['Roboto-Flex'] text-[14px] font-bold text-lhlInk">
              Interests
            </Text>

            <View className="mt-[8px] flex-row flex-wrap items-center gap-[7px]">
              {(profile?.tags ?? []).map((tag) => (
                <View
                  key={tag}
                  className="rounded-full border border-lhlMutedBorder bg-lhlSurface px-[12px] py-[5px]"
                >
                  <Text className="font-['Roboto-Flex'] text-[11px] text-lhlInk">{tag}</Text>
                </View>
              ))}
              {/* "+" goes to Edit Profile rather than opening an inline picker,
                  so interests have exactly one place they're edited. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add interests"
                onPress={() => router.push('/profile/edit')}
                className="h-[26px] w-[26px] items-center justify-center rounded-full border border-lhlMutedBorder bg-lhlSurface"
              >
                <Text className="font-['Roboto-Flex'] text-[13px] leading-[15px] text-lhlSecondaryTextGrey">
                  +
                </Text>
              </Pressable>
            </View>
          </View>

          {/* --- My Events --- */}
          <View className="mt-[22px] px-[20px]">
            <Text className="font-['Roboto-Flex'] text-[14px] font-bold text-lhlInk">
              My Events
            </Text>

            {/* Segmented control with counts */}
            <View className="mt-[10px] flex-row gap-[6px]">
              {TABS.map((t) => {
                const isActive = t.key === tab;
                const count = counts?.[t.key];
                return (
                  <Pressable
                    key={t.key}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: isActive }}
                    onPress={() => setTab(t.key)}
                    className={`flex-1 flex-row items-center justify-center rounded-full border py-[7px] ${
                      isActive
                        ? 'border-lhlInk bg-lhlSurface'
                        : 'border-lhlMutedBorder bg-lhlSurfaceGrey'
                    }`}
                  >
                    <Text
                      className={`font-['Roboto-Flex'] text-[11px] ${
                        isActive ? 'font-semibold text-lhlInk' : 'text-lhlSecondaryTextGrey'
                      }`}
                    >
                      {t.label}
                      {count !== undefined ? ` (${count})` : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Search */}
            <View className="mt-[10px]">
              <TextInputField
                value={search}
                onChangeText={setSearch}
                placeholder="Search events..."
                autoCapitalize="none"
                autoCorrect={false}
                borderRadius={8}
                clearable
                leftIcon={<LhlSearchIcon size={14} color={colors.inkSecondary} />}
              />
            </View>

            {/* Category chips + date sort */}
            <View className="mt-[10px] flex-row items-center justify-between">
              <View className="flex-row gap-[6px]">
                {PROFILE_EVENT_FILTERS.map((key) => {
                  const isActive = key === filter;
                  return (
                    <Pressable
                      key={key}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isActive }}
                      onPress={() => setFilter(key)}
                      className={`rounded-full px-[12px] py-[5px] ${
                        isActive
                          ? 'bg-lhlBurntOrange'
                          : 'border border-lhlMutedBorder bg-lhlSurface'
                      }`}
                    >
                      <Text
                        className={`font-['Roboto-Flex'] text-[11px] font-medium ${
                          isActive ? 'text-white' : 'text-lhlSecondaryTextGrey'
                        }`}
                      >
                        {PROFILE_EVENT_FILTER_LABELS[key]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={sortRecent ? 'Sort by date' : 'Sort by recently added'}
                onPress={() => setSortRecent((v) => !v)}
                className="flex-row items-center gap-[4px] rounded-full border border-lhlMutedBorder bg-lhlSurface px-[10px] py-[5px]"
              >
                <Text className="font-['Roboto-Flex'] text-[11px] text-lhlSecondaryTextGrey">
                  {sortRecent ? 'Recent' : 'Date'}
                </Text>
              </Pressable>
            </View>

            {/* Grid */}
            {eventsQuery.isLoading ? (
              <ActivityIndicator className="mt-[24px]" color={colors.brand} />
            ) : (
              <View className="mt-[14px] flex-row flex-wrap justify-between">
                {(eventsQuery.data?.events ?? []).length === 0 ? (
                  <View className="w-full items-center py-[30px]">
                    <Text className="font-['Roboto-Flex'] text-center text-[13px] text-lhlSecondaryTextGrey">
                      {search.trim() || filter !== 'all'
                        ? 'No events match that search.'
                        : activeTab.empty}
                    </Text>
                    {!search.trim() && filter === 'all' && tab !== 'posted' ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => router.push('/(tabs)/home')}
                        className="mt-[14px] rounded-full bg-lhlBurntOrange px-[20px] py-[8px]"
                      >
                        <Text className="font-['Roboto-Flex'] text-[12px] font-semibold text-white">
                          Explore Events
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : (
                  eventsQuery.data?.events.map((event) => (
                    <ProfileEventCard
                      key={event.id}
                      event={event}
                      onToggleSave={(eventId) =>
                        toggleSave.mutate({ eventId, saved: !!event.is_saved })
                      }
                    />
                  ))
                )}
              </View>
            )}
          </View>
        </ScrollView>
      )}

      <OpenLinkModal {...openLink.modalProps} />
    </SafeAreaView>
  );
}
