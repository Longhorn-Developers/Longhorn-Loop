// Public org profile — the org account as a NON-MEMBER sees it (LOOP-180).
//
// Figma: "Profile Main" frame, Org account profile, reviewed 2026-06-08.
//
// NOT app/org/[id]/index.tsx. That is the management console: it is reached
// from Settings > Manage Organizations, every one of its endpoints 403s a
// non-member, and it shows engagement analytics, the member list and an event
// editor. This screen is the org's public face — the thing you land on from an
// event's "Posted by", where the only actions are Follow and, for the handful
// of viewers who happen to be members, a shortcut into that console.
//
// The layout is the public USER profile with the person-shaped parts removed,
// which is the point of the ticket's "same layout" requirement:
//   back arrow + bell   -> bell goes to the FOLLOWED-ORG toggles, not the
//                          inbox, because from an org page "notifications"
//                          means "what orgs send me" (Frame 471)
//   avatar, name (+ verified check), followers · following
//   Follow button       -> no Block: blocks are between people, and there is
//                          no org_blocks table. See server/src/lib/blocks.ts.
//   org bio, read-only
//   "Organization account" + Upcoming / Past over a read-only grid
//
// NO SOCIAL ICON ROW. The Figma frame draws one, but organizations have no
// socials in the database — user_socials is keyed on user_id and there is no
// org equivalent — and inventing the storage, the editor and the validation
// would have been a second ticket wearing this one's hat. Called out in the
// commit message as unbuilt rather than stubbed, because an empty row of icons
// looks like a bug and a fake one is worse.

import type { ApiEvent } from '@/app/components/EventCard';
import FollowControl from '@/app/components/profile/FollowControl';
import ProfileBio from '@/app/components/profile/ProfileBio';
import ProfileEventCard from '@/app/components/profile/ProfileEventCard';
import PublicProfileTopBar from '@/app/components/profile/PublicProfileTopBar';
import UpcomingPastToggle from '@/app/components/profile/UpcomingPastToggle';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { ApiError, api } from '@/app/lib/api';
import { org as orgKeys } from '@/app/lib/queryKeys';
import { useThemeColors } from '@/app/lib/themeColors';
import VerifiedIcon from '@/assets/images/verified.svg';
import type { PublicProfileTab } from '@/shared/profileEventFilters';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface OrgProfileResponse {
  org: {
    id: number;
    name: string;
    slug: string | null;
    profile_picture: string | null;
    verified: boolean;
    category: string | null;
    bio: string | null;
    follower_count: number;
    following_count: number;
  };
  is_following: boolean;
  is_member: boolean;
  role: 'admin' | 'editor' | null;
}

interface OrgEventsResponse {
  tab: PublicProfileTab;
  events: (ApiEvent & { org_verified?: boolean })[];
  counts: Record<PublicProfileTab, number>;
}

export default function PublicOrgProfileScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const orgId = Number(id);
  const { data: onboarding } = useOnboarding();
  const token = onboarding.token || null;

  const [tab, setTab] = useState<PublicProfileTab>('upcoming');
  const [actionError, setActionError] = useState<string | null>(null);

  const enabled = !!token && Number.isFinite(orgId);

  const profileQuery = useQuery({
    queryKey: orgKeys.publicProfile(orgId),
    queryFn: () => api.get<OrgProfileResponse>(`/orgs/${orgId}/profile`, { token }),
    enabled,
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 1,
  });

  const eventsQuery = useQuery({
    queryKey: orgKeys.publicEvents(orgId, tab),
    queryFn: () =>
      api.get<OrgEventsResponse>(`/orgs/${orgId}/profile/events?tab=${tab}`, { token }),
    enabled: enabled && !!profileQuery.data,
  });

  const follow = useMutation({
    mutationFn: (next: boolean) =>
      next
        ? api.post<{ following: boolean }>(`/orgs/${orgId}/follow`, { token })
        : api.delete<{ following: boolean }>(`/orgs/${orgId}/follow`, { token }),
    onSuccess: () => {
      setActionError(null);
      // The follower count on the header moves with this, and the console's
      // own header reads the same underlying table, so drop both.
      queryClient.invalidateQueries({ queryKey: orgKeys.publicProfile(orgId) });
      queryClient.invalidateQueries({ queryKey: orgKeys.detail(orgId) });
    },
    onError: () => setActionError('Could not update follow. Try again.'),
  });

  const org = profileQuery.data?.org;
  const events = eventsQuery.data?.events ?? [];

  if (!token) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-lhlBackgroundColor">
        <Text className="font-['Roboto-Flex'] text-[14px] text-lhlSecondaryTextGrey">
          Sign in to view organizations.
        </Text>
      </SafeAreaView>
    );
  }

  if (profileQuery.isError) {
    const status = profileQuery.error instanceof ApiError ? profileQuery.error.status : null;
    return (
      <SafeAreaView className="flex-1 bg-lhlBackgroundColor" edges={['top']}>
        <PublicProfileTopBar bellHref="/settings/followed-orgs" bellLabel="Org notifications" />
        <View className="flex-1 items-center justify-center px-[30px]">
          <Text className="font-['Roboto-Flex'] text-center text-[15px] font-semibold text-lhlInk">
            {status === 404 ? 'This organization isn’t available' : 'Couldn’t load this page'}
          </Text>
          <Text className="font-['Roboto-Flex'] mt-[6px] text-center text-[12px] text-lhlSecondaryTextGrey">
            {status === 404
              ? 'It may have been removed.'
              : `Something went wrong${status ? ` (HTTP ${status})` : ''}.`}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-lhlBackgroundColor" edges={['top']}>
      <PublicProfileTopBar bellHref="/settings/followed-orgs" bellLabel="Org notifications" />

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
              {org?.profile_picture ? (
                <Image
                  source={{ uri: org.profile_picture }}
                  style={{ width: '100%', height: '100%' }}
                />
              ) : null}
            </View>

            <View className="mt-[10px] flex-row items-center gap-[5px]">
              <Text
                numberOfLines={1}
                className="font-['Roboto-Flex'] text-[20px] font-bold text-lhlInk"
              >
                {org?.name ?? 'Organization'}
              </Text>
              {org?.verified ? (
                <VerifiedIcon width={16} height={16} accessibilityLabel="Verified organization" />
              ) : null}
            </View>

            {org?.category ? (
              <Text className="font-['Roboto-Flex'] mt-[2px] text-[11px] text-lhlSecondaryTextGrey">
                {org.category}
              </Text>
            ) : null}

            <Text className="font-['Roboto-Flex'] mt-[3px] text-[12px] text-lhlSecondaryTextGrey">
              <Text className="font-semibold text-lhlInk">{org?.follower_count ?? 0}</Text>{' '}
              followers ·{' '}
              <Text className="font-semibold text-lhlInk">{org?.following_count ?? 0}</Text>{' '}
              following
            </Text>

            <View className="mt-[10px] flex-row items-center gap-[8px]">
              {/* No onBlock — see the header. */}
              <FollowControl
                isFollowing={profileQuery.data?.is_following ?? false}
                pending={follow.isPending}
                displayName={org?.name}
                onToggleFollow={() => {
                  setActionError(null);
                  follow.mutate(!(profileQuery.data?.is_following ?? false));
                }}
              />

              {/* Members get a way into the console from here rather than
                  having to go round through Settings. Presentation only: the
                  console re-checks membership on every endpoint it calls. */}
              {profileQuery.data?.is_member ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Manage this organization"
                  onPress={() => router.push(`/org/${orgId}?tab=events`)}
                  className="rounded-full border border-lhlMutedBorder bg-lhlSurface px-[14px] py-[6px]"
                >
                  <Text className="font-['Roboto-Flex'] text-[12px] font-medium text-lhlInk">
                    Manage
                  </Text>
                </Pressable>
              ) : null}
            </View>

            {actionError ? (
              <Text className="font-['Roboto-Flex'] mt-[8px] text-center text-[12px] text-lhlDestructiveRed">
                {actionError}
              </Text>
            ) : null}

            {/* The same bio block as a user profile, read-only. Nothing writes
                organizations.bio yet — the console has no edit-profile screen
                — so today this always collapses. Wired now so the screen
                doesn't need revisiting when a writer lands. */}
            <ProfileBio bio={org?.bio} />
          </View>

          {/* --- Organization account --- */}
          <View className="mt-[22px] px-[20px]">
            <Text className="font-['Roboto-Flex'] text-[14px] font-bold text-lhlInk">
              Organization account
            </Text>

            <UpcomingPastToggle value={tab} onChange={setTab} counts={eventsQuery.data?.counts} />

            {eventsQuery.isLoading ? (
              <ActivityIndicator className="mt-[24px]" color={colors.brand} />
            ) : (
              <View className="mt-[14px] flex-row flex-wrap justify-between">
                {events.length === 0 ? (
                  <View className="w-full items-center py-[30px]">
                    <Text className="font-['Roboto-Flex'] text-center text-[13px] text-lhlSecondaryTextGrey">
                      {tab === 'upcoming'
                        ? 'No upcoming events from this organization.'
                        : 'No past events.'}
                    </Text>
                  </View>
                ) : (
                  events.map((event) => <ProfileEventCard key={event.id} event={event} />)
                )}
              </View>
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
