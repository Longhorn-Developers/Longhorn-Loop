// Public user profile -- somebody else's (LOOP-180, redesigned in LOOP-312).
//
// Figma: "Profile - Public User View" V4. The same shell as your own profile
// (app/(tabs)/profile.tsx) so the two read as one screen in two states:
//   cover band with Back, avatar across its bottom edge
//   name, year · majors, Events / Followers / Following counts
//   Follow + linked-social squares + Block
//   bio, read-only
//   interest chips, no "+"
//   Upcoming / Past tab row over a read-only grid
//
// SCOPE -- what makes this the read-only variant, and why each piece differs:
//
//   * Edit Profile becomes Follow, and Block gets its own pill at the end of
//     the row. components/profile/FollowControl explains why Block left the
//     "..." menu and how it stays two deliberate taps away.
//   * No settings gear. The frame draws one, but LOOP-312 says outright that
//     the public view has none: there is nothing of yours to configure here.
//   * Going / Saved / Posted becomes Upcoming / Past. The first two of those
//     tabs are private -- showing a visitor what you saved turns a bookmark
//     into a public statement -- so a visitor gets the one collection that was
//     already public, split by time. See shared/profileEventFilters.ts.
//   * Followers / Following are NOT tappable here. Who may see another
//     person's follower list is an open product call on LOOP-307, so the
//     counts stay plain text until it is settled.
//   * The bio's "+ Add a bio" prompt and the interests "+" are gone, not
//     disabled. An affordance that appears and then refuses is worse than no
//     affordance.
//   * The event cards carry no bookmark button, and there is no search field,
//     no category chips and no date sort: the frame shows none of them on a
//     public profile, and the endpoint behind this screen doesn't implement
//     them.
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
import { AvatarDisplay } from '@/app/components/profile/AvatarDisplay';
import { BlockButton, FollowButton } from '@/app/components/profile/FollowControl';
import InterestChips from '@/app/components/profile/InterestChips';
import OutlinedButton from '@/app/components/profile/OutlinedButton';
import ProfileBio from '@/app/components/profile/ProfileBio';
import ProfileCounts from '@/app/components/profile/ProfileCounts';
import ProfileCover, {
  CoverIconButton,
  PROFILE_AVATAR_SIZE,
} from '@/app/components/profile/ProfileCover';
import ProfileEmptyState from '@/app/components/profile/ProfileEmptyState';
import ProfileEventCard from '@/app/components/profile/ProfileEventCard';
import ProfileTabRow from '@/app/components/profile/ProfileTabRow';
import PublicProfileTopBar from '@/app/components/profile/PublicProfileTopBar';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { ApiError, api } from '@/app/lib/api';
import { user as userKeys } from '@/app/lib/queryKeys';
import { getSocialPlatformUI, type LinkedSocial } from '@/app/lib/socialPlatforms';
import { useThemeColors } from '@/app/lib/themeColors';
import ArrowLeftIcon from '@/assets/images/arrow-left.svg';
import type { AvatarConfig } from '@/shared/avatar';
import {
  PUBLIC_PROFILE_TABS,
  PUBLIC_PROFILE_TAB_LABELS,
  type PublicProfileTab,
} from '@/shared/profileEventFilters';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface PublicProfileResponse {
  user: {
    id: number;
    first_name: string;
    last_name: string;
    avatar: number | null;
    avatar_config: AvatarConfig | null;
    profile_photo_url: string | null;
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

  // Last counts seen, so switching Upcoming <-> Past doesn't blank the tab
  // numbers and the Events count while the other tab loads. Same reasoning as
  // the owner's profile.
  // Adjusted during render rather than in an effect: React's documented
  // pattern for state that follows a prop, and it avoids a second render with
  // the stale value.
  const latestCounts = eventsQuery.data?.counts;
  const [counts, setCounts] = useState<Record<PublicProfileTab, number> | undefined>(latestCounts);
  if (latestCounts && latestCounts !== counts) setCounts(latestCounts);

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
  const academicLine = profile
    ? [profile.year_classification, ...(profile.majors ?? [])].filter(Boolean).join(' · ')
    : '';
  const events = eventsQuery.data?.events ?? [];
  const pending = follow.isPending || block.isPending;

  if (profileQuery.isLoading) {
    // The plain top bar while loading, so Back works before there is a cover
    // to put it on.
    return (
      <SafeAreaView className="flex-1 bg-lhlBackgroundColor" edges={['top']}>
        <PublicProfileTopBar />
        <View className="flex-1 items-center justify-center bg-lhlBackgroundColor">
          <ActivityIndicator color={colors.brand} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    // No top SafeAreaView edge: the cover runs under the status bar and
    // ProfileCover does its own inset maths.
    <View className="flex-1 bg-lhlBackgroundColor">
      <ScrollView
        className="flex-1 bg-lhlBackgroundColor"
        // The frame adds 32 under the content stack on public and org views.
        contentContainerStyle={{ paddingBottom: 64 }}
      >
        <ProfileCover
          avatar={profile ? <AvatarDisplay user={profile} size={PROFILE_AVATAR_SIZE} /> : null}
          left={
            <CoverIconButton accessibilityLabel="Back" onPress={() => router.back()}>
              <ArrowLeftIcon width={18} height={18} color={colors.ink} />
            </CoverIconButton>
          }
        />

        {/* --- Identity block (297 tall in the frame; width 289) --- */}
        <View className="w-[289px] max-w-full items-center self-center">
          <Text
            numberOfLines={1}
            className="font-roboto-bold mt-[8px] text-[20px] leading-[23px] text-lhlInk"
          >
            {fullName || 'Profile'}
          </Text>

          {academicLine ? (
            <Text
              numberOfLines={1}
              className="font-roboto-medium mt-[8px] text-[12px] leading-[14px] text-lhlSecondaryTextGrey"
            >
              {academicLine}
            </Text>
          ) : null}

          <ProfileCounts
            events={counts ? counts.upcoming + counts.past : undefined}
            followers={profile?.follower_count ?? 0}
            following={profile?.following_count ?? 0}
          />

          {/* Follow, then the linked-social squares, then Block -- the row the
              owner's profile puts Edit Profile in. */}
          <View className="mt-[10px] flex-row items-center gap-[8px]">
            <FollowButton
              isFollowing={profileQuery.data?.is_following ?? false}
              pending={pending}
              displayName={profile?.first_name}
              onToggleFollow={() => {
                setActionError(null);
                follow.mutate(!(profileQuery.data?.is_following ?? false));
              }}
            />

            {profile?.socials?.map((social) => {
              const meta = getSocialPlatformUI(social.platform);
              if (!meta) return null;
              const Icon = meta.icon;
              return (
                <OutlinedButton
                  key={social.platform}
                  accessibilityRole="link"
                  accessibilityLabel={`Open ${meta.label}`}
                  // Same Open Link warning the owner's profile uses
                  // (LOOP-182) -- more relevant here, since these are a
                  // stranger's links.
                  onPress={() => openLink.request(social.url)}
                  borderRadius={8}
                >
                  <Icon size={20} color={colors.ink} />
                </OutlinedButton>
              );
            })}

            <BlockButton
              pending={pending}
              displayName={profile?.first_name}
              onBlock={() => block.mutate()}
            />
          </View>

          {actionError ? (
            <Text className="font-roboto mt-[8px] text-center text-[12px] text-lhlDestructiveRed">
              {actionError}
            </Text>
          ) : null}

          {/* editable defaults false: no "+ Add a bio" prompt, and the block
              collapses entirely when they haven't written one. */}
          <ProfileBio bio={profile?.bio} />
        </View>

        {/* --- Interests, read-only --- */}
        {(profile?.tags ?? []).length > 0 ? (
          <View className="mt-[24px] px-[20px]">
            <InterestChips tags={profile?.tags ?? []} />
          </View>
        ) : null}

        {/* --- Upcoming / Past --- */}
        <View className="mt-[24px] px-[20px]">
          <ProfileTabRow<PublicProfileTab>
            tabs={PUBLIC_PROFILE_TABS.map((key) => ({
              key,
              label: PUBLIC_PROFILE_TAB_LABELS[key],
              count: counts?.[key],
            }))}
            value={tab}
            onChange={setTab}
          />

          {eventsQuery.isLoading ? (
            <ActivityIndicator className="mt-[24px]" color={colors.brand} />
          ) : (
            <View className="mt-[12px] flex-row flex-wrap justify-between">
              {events.length === 0 ? (
                <ProfileEmptyState
                  title={tab === 'upcoming' ? 'No upcoming events' : 'No past events'}
                  body={
                    tab === 'upcoming'
                      ? `${profile?.first_name ?? 'This person'} hasn’t posted anything coming up.`
                      : undefined
                  }
                />
              ) : (
                // No onToggleSave: the grid is read-only, so the card draws
                // no bookmark overlay.
                events.map((event) => <ProfileEventCard key={event.id} event={event} />)
              )}
            </View>
          )}
        </View>
      </ScrollView>

      <OpenLinkModal {...openLink.modalProps} />
    </View>
  );
}
