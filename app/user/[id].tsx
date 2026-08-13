// Public user profile — somebody else's (LOOP-180).
//
// Figma: "Profile Main" frame, public user profile ("Not Todd Jenkins"),
// reviewed 2026-06-08.
//
// Layout, top to bottom, mirroring app/(tabs)/profile.tsx line for line so the
// two read as one screen in two states:
//   back arrow + notification bell
//   centred avatar, name, "N followers · N following"
//   Follow button (+ Block on its menu) + linked-social icon row
//   bio, read-only
//   metadata rows — academic, background
//   Interests — chips with NO "+"
//   "<First> Events" with an Upcoming / Past toggle over a read-only grid
//
// SCOPE — what makes this the read-only variant, and why each piece differs:
//
//   * Edit Profile becomes Follow + Block. components/profile/FollowControl.
//   * Going / Saved / Posted becomes Upcoming / Past. The first two of those
//     tabs are private — showing a visitor what you saved turns a bookmark
//     into a public statement — so a visitor gets the one collection that was
//     already public, split by time. See shared/profileEventFilters.ts.
//   * The bio's "+ Add a bio" prompt and the interests "+" are gone, not
//     disabled. An affordance that appears and then refuses is worse than no
//     affordance; ProfileBio already handles this via its `editable` prop,
//     which defaults false.
//   * The event cards carry no bookmark button. Saving somebody else's event
//     is a real thing you might want to do, but the frame draws a plain grid
//     and ProfileEventCard hides the control when no handler is passed.
//   * There is no search field, no category chips and no date sort. The frame
//     shows none of them on a public profile, and the endpoint behind this
//     screen deliberately doesn't implement them.
//
// This screen lives at /user/[id] rather than /profile/[id] because
// app/profile/ already holds `edit` and `past`. Expo Router matches a literal
// segment before a dynamic one so /profile/edit would still work, but a
// directory where two of three routes are the owner's own and one is a
// stranger's is a trap for the next person adding a screen there.
//
// A BLOCK IN EITHER DIRECTION 404s BOTH QUERIES (the server decides this, not
// this file). The screen therefore treats 404 as "unavailable" and says
// nothing about why: distinguishing "blocked" from "deleted" in the copy would
// hand the blocked party the exact confirmation the block exists to withhold.

import type { ApiEvent } from '@/app/components/EventCard';
import OpenLinkModal, { useOpenLinkGuard } from '@/app/components/modals/OpenLinkModal';
import { getAvatarSource } from '@/app/components/profile/AvatarPickerModal';
import FollowControl from '@/app/components/profile/FollowControl';
import ProfileBio from '@/app/components/profile/ProfileBio';
import ProfileEventCard from '@/app/components/profile/ProfileEventCard';
import ProfileMetaRow from '@/app/components/profile/ProfileMetaRow';
import PublicProfileTopBar from '@/app/components/profile/PublicProfileTopBar';
import UpcomingPastToggle from '@/app/components/profile/UpcomingPastToggle';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { ApiError, api } from '@/app/lib/api';
import { user as userKeys } from '@/app/lib/queryKeys';
import { getSocialPlatformUI, type LinkedSocial } from '@/app/lib/socialPlatforms';
import { useThemeColors } from '@/app/lib/themeColors';
import { GlobeIcon, GraduationCapIcon } from '@/assets/icons/LhlProfileMetaIcons';
import type { PublicProfileTab } from '@/shared/profileEventFilters';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface PublicProfileResponse {
  user: {
    id: number;
    first_name: string;
    last_name: string;
    avatar: number | null;
    bio: string | null;
    year_classification: string | null;
    unique_classification: string[];
    majors: string[];
    tags: string[];
    socials: LinkedSocial[];
    follower_count: number;
    following_count: number;
  };
  is_following: boolean;
  is_self: boolean;
  blocked: boolean;
}

interface PublicEventsResponse {
  tab: PublicProfileTab;
  events: (ApiEvent & { org_verified?: boolean })[];
  counts: Record<PublicProfileTab, number>;
}

export default function PublicUserProfileScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = Number(id);
  const { data: onboarding } = useOnboarding();
  const token = onboarding.token || null;

  const openLink = useOpenLinkGuard();

  const [tab, setTab] = useState<PublicProfileTab>('upcoming');
  const [actionError, setActionError] = useState<string | null>(null);

  const enabled = !!token && Number.isFinite(userId);

  const profileQuery = useQuery({
    queryKey: userKeys.publicProfile(userId),
    queryFn: () => api.get<PublicProfileResponse>(`/users/${userId}/profile`, { token }),
    enabled,
    // A 404 here is a real answer — blocked, or gone — not a blip, so don't
    // spend a retry and a second round trip confirming it.
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 1,
  });

  const profile = profileQuery.data?.user;
  const isSelf = profileQuery.data?.is_self ?? false;

  const eventsQuery = useQuery({
    queryKey: userKeys.publicEvents(userId, tab),
    queryFn: () =>
      api.get<PublicEventsResponse>(`/users/${userId}/profile/events?tab=${tab}`, { token }),
    // Gated on the profile having loaded: if the profile 404s, the grid is
    // going to 404 too, and firing it anyway just doubles the failed requests.
    enabled: enabled && !!profile && !isSelf,
  });

  const follow = useMutation({
    mutationFn: (next: boolean) =>
      next
        ? api.post<{ following: boolean }>(`/users/${userId}/follow`, { token })
        : api.delete<{ following: boolean }>(`/users/${userId}/follow`, { token }),
    onSuccess: () => {
      setActionError(null);
      // Refetch rather than patching the cache: following changes the follower
      // COUNT as well as the button, and the count is the server's to compute
      // (it excludes blocked relationships).
      queryClient.invalidateQueries({ queryKey: userKeys.publicProfile(userId) });
    },
    onError: (err) => {
      // 409 BLOCKED is the one failure with a user-actionable cause, and the
      // server sends copy for it. Everything else gets a generic line.
      const body = err instanceof ApiError ? (err.body as Record<string, unknown> | null) : null;
      setActionError((body?.message as string) ?? 'Could not update follow. Try again.');
    },
  });

  const block = useMutation({
    mutationFn: () => api.post<{ blocked: boolean }>(`/users/${userId}/block`, { token }),
    onSuccess: () => {
      // The profile behind this screen is now a 404 for both parties, so
      // there is nothing to return to. Drop the cached copies first —
      // otherwise going Back lands on a stale render of a profile the API
      // will no longer serve — then leave.
      queryClient.removeQueries({ queryKey: userKeys.publicProfile(userId) });
      queryClient.removeQueries({ queryKey: userKeys.publicEventsAll(userId) });
      // A block also removes their events from the feed and every list, all of
      // which are now stale.
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
      router.back();
    },
    onError: () => setActionError('Could not block this person. Try again.'),
  });

  // Your own id resolves to your own profile, which has the editing
  // affordances this screen deliberately lacks — rendering a Follow button
  // pointed at yourself is the alternative. `replace`, not `push`, so Back
  // doesn't bounce between the two.
  //
  // In an effect rather than inline in the render body: navigating during
  // render mutates the router while React is still committing this tree, and
  // the redirect would fire again on every re-render until it landed.
  useEffect(() => {
    if (isSelf) router.replace('/(tabs)/profile');
  }, [isSelf, router]);

  if (isSelf) return null;

  if (!token) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-lhlBackgroundColor">
        <Text className="font-['Roboto-Flex'] text-[14px] text-lhlSecondaryTextGrey">
          Sign in to view profiles.
        </Text>
      </SafeAreaView>
    );
  }

  if (profileQuery.isError) {
    const status = profileQuery.error instanceof ApiError ? profileQuery.error.status : null;
    return (
      <SafeAreaView className="flex-1 bg-lhlBackgroundColor" edges={['top']}>
        <PublicProfileTopBar />
        <View className="flex-1 items-center justify-center px-[30px]">
          <Text className="font-['Roboto-Flex'] text-center text-[15px] font-semibold text-lhlInk">
            {status === 404 ? 'This profile isn’t available' : 'Couldn’t load this profile'}
          </Text>
          <Text className="font-['Roboto-Flex'] mt-[6px] text-center text-[12px] text-lhlSecondaryTextGrey">
            {status === 404
              ? // Says nothing about blocking. See the header.
                'It may have been removed, or it isn’t visible to you.'
              : `Something went wrong${status ? ` (HTTP ${status})` : ''}.`}
          </Text>
          {status !== 404 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => profileQuery.refetch()}
              className="mt-[18px] rounded-full bg-lhlBurntOrange px-[22px] py-[9px]"
            >
              <Text className="font-['Roboto-Flex'] text-[13px] font-semibold text-white">
                Try again
              </Text>
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  const fullName = profile ? `${profile.first_name} ${profile.last_name}`.trim() : '';
  const avatarSource = getAvatarSource(profile?.avatar);
  const events = eventsQuery.data?.events ?? [];

  return (
    <SafeAreaView className="flex-1 bg-lhlBackgroundColor" edges={['top']}>
      <PublicProfileTopBar />

      {profileQuery.isLoading ? (
        <View className="flex-1 items-center justify-center bg-lhlBackgroundColor">
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : (
        <ScrollView
          className="flex-1 bg-lhlBackgroundColor"
          contentContainerStyle={{ paddingBottom: 40 }}
        >
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
              {fullName || 'Profile'}
            </Text>

            <Text className="font-['Roboto-Flex'] mt-[3px] text-[12px] text-lhlSecondaryTextGrey">
              <Text className="font-semibold text-lhlInk">{profile?.follower_count ?? 0}</Text>{' '}
              followers ·{' '}
              <Text className="font-semibold text-lhlInk">{profile?.following_count ?? 0}</Text>{' '}
              following
            </Text>

            {/* Follow + Block, then the linked-social icons — the same row the
                owner's profile puts Edit Profile in. */}
            <View className="mt-[10px] flex-row items-center gap-[8px]">
              <FollowControl
                isFollowing={profileQuery.data?.is_following ?? false}
                pending={follow.isPending || block.isPending}
                displayName={profile?.first_name}
                onToggleFollow={() => {
                  setActionError(null);
                  follow.mutate(!(profileQuery.data?.is_following ?? false));
                }}
                onBlock={() => block.mutate()}
              />

              {profile?.socials?.map((social) => {
                const meta = getSocialPlatformUI(social.platform);
                if (!meta) return null;
                const Icon = meta.icon;
                return (
                  <Pressable
                    key={social.platform}
                    accessibilityRole="link"
                    accessibilityLabel={`Open ${meta.label}`}
                    // Same Open Link warning the owner's profile uses
                    // (LOOP-182) — more relevant here, since these are a
                    // stranger's links.
                    onPress={() => openLink.request(social.url)}
                    className="h-[30px] w-[30px] items-center justify-center rounded-[7px] border border-lhlMutedBorder bg-lhlSurface"
                  >
                    <Icon size={16} />
                  </Pressable>
                );
              })}
            </View>

            {actionError ? (
              <Text className="font-['Roboto-Flex'] mt-[8px] text-center text-[12px] text-lhlDestructiveRed">
                {actionError}
              </Text>
            ) : null}

            {/* editable defaults false: no "+ Add a bio" prompt, and the block
                collapses entirely when they haven't written one. */}
            <ProfileBio bio={profile?.bio} />
          </View>

          {/* --- Metadata --- */}
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

          {/* --- Interests, read-only --- */}
          {(profile?.tags ?? []).length > 0 ? (
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
              </View>
            </View>
          ) : null}

          {/* --- "<First> Events" --- */}
          <View className="mt-[22px] px-[20px]">
            <Text className="font-['Roboto-Flex'] text-[14px] font-bold text-lhlInk">
              {profile?.first_name ? `${profile.first_name} Events` : 'Events'}
            </Text>

            <UpcomingPastToggle value={tab} onChange={setTab} counts={eventsQuery.data?.counts} />

            {eventsQuery.isLoading ? (
              <ActivityIndicator className="mt-[24px]" color={colors.brand} />
            ) : (
              <View className="mt-[14px] flex-row flex-wrap justify-between">
                {events.length === 0 ? (
                  <View className="w-full items-center py-[30px]">
                    <Text className="font-['Roboto-Flex'] text-center text-[13px] text-lhlSecondaryTextGrey">
                      {tab === 'upcoming' ? 'No upcoming events.' : 'No past events.'}
                    </Text>
                  </View>
                ) : (
                  // No onToggleSave: the grid is read-only, so the card draws
                  // no bookmark overlay.
                  events.map((event) => <ProfileEventCard key={event.id} event={event} />)
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
