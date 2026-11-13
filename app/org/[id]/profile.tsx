// An org's landing page -- what EVERYONE sees, member or not (LOOP-180,
// redesigned in LOOP-312, made the one page per org in LOOP-319).
//
// LOOP-319 template, top to bottom:
//   title + profile picture (verified check), followers / following, the
//   description, then -- for MEMBERS only -- the org's meeting times and
//   locations (components/org/OrgMeetingsSection), then its events. Further
//   sections are still to be designed; nothing is stubbed in their place.
//
// Every entry point lands here: Explore's org card (it used to open the
// console and show non-members "You're not a member of this organization"),
// Home's "Orgs for you", and an event's "Posted by". The console itself now
// sends non-members back here rather than showing that message.
//
// Figma: "Profile - Org Page" V4. Same shell as the user profiles -- cover,
// avatar, counts, tab row -- with a taller identity block, because org names
// run to three lines ("American Institute of Aeronautics and Astronautics -
// UT Chapter") and the bio is usually longer than a student's.
//
// NOT app/org/[id]/index.tsx. That is the management console: it is reached
// from Settings > Manage Organizations, every one of its endpoints 403s a
// non-member, and it shows engagement analytics, the member list and an event
// editor. This screen is the org's public face -- the thing you land on from an
// event's "Posted by", where the only actions are Follow and, for the handful
// of viewers who happen to be members, a shortcut into that console.
//
// THE GEAR opens the Notification Settings side sheet (Figma "Notification
// Settings Sheet", 336 wide): the followed-org toggles, which are the same
// three switches as /settings/followed-orgs and the same component. From an
// org page "notifications" means "what orgs send me", which is why it is not
// the inbox. The toggles are global across followed orgs; see that screen's
// header for why there is no per-org row yet.
//
// WHAT THE FRAME DRAWS THAT IS NOT BUILT, and why each one stops here rather
// than inventing an API (LOOP-312: "if the org page needs endpoints that don't
// exist, stop and say so"):
//   * Instagram / LinkedIn squares -- organizations have no socials. Storage,
//     editor and validation would all be new (user_socials is keyed on
//     user_id).
//   * Block -- blocks are between people; there is no org_blocks table. See
//     server/src/lib/blocks.ts.
//   * Interest chips -- /orgs/:id/profile returns a category, not tags.
//   * "Message" (named in the LOOP-312 handoff, not drawn in the frame) --
//     there is no messaging feature or endpoint of any kind.
// An empty row of icons looks like a bug and a fake one is worse, so these are
// absent rather than stubbed.

import type { ApiEvent } from '@/app/components/EventCard';
import SettingsDrawer from '@/app/components/SettingsDrawer';
import { FollowButton } from '@/app/components/profile/FollowControl';
import FollowListSheet from '@/app/components/profile/FollowListSheet';
import OrgMeetingsSection from '@/app/components/org/OrgMeetingsSection';
import OutlinedButton from '@/app/components/profile/OutlinedButton';
import ProfileBio from '@/app/components/profile/ProfileBio';
import ProfileCounts from '@/app/components/profile/ProfileCounts';
import ProfileCover, { CoverIconButton } from '@/app/components/profile/ProfileCover';
import ProfileEmptyState from '@/app/components/profile/ProfileEmptyState';
import ProfileEventCard from '@/app/components/profile/ProfileEventCard';
import ProfileTabRow from '@/app/components/profile/ProfileTabRow';
import PublicProfileTopBar from '@/app/components/profile/PublicProfileTopBar';
import FollowedOrgNotificationsScreen from '@/app/settings/followed-orgs';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { ApiError, api } from '@/app/lib/api';
import { org as orgKeys } from '@/app/lib/queryKeys';
import { useOrgFollow } from '@/app/lib/useOrgFollow';
import { useThemeColors } from '@/app/lib/themeColors';
import LhlGearIcon from '@/assets/icons/LhlGearIcon';
import ArrowLeftIcon from '@/assets/images/arrow-left.svg';
import VerifiedIcon from '@/assets/images/verified.svg';
import {
  PUBLIC_PROFILE_TABS,
  PUBLIC_PROFILE_TAB_LABELS,
  type PublicProfileTab,
} from '@/shared/profileEventFilters';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Image, ScrollView, Text, View } from 'react-native';
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
  const { id } = useLocalSearchParams<{ id: string }>();
  const orgId = Number(id);
  const { data: onboarding } = useOnboarding();
  const token = onboarding.token || null;

  const [tab, setTab] = useState<PublicProfileTab>('upcoming');
  const [actionError, setActionError] = useState<string | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [followersOpen, setFollowersOpen] = useState(false);

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

  // Last counts seen, so switching Upcoming <-> Past doesn't blank the tab
  // numbers and the Events count while the other tab loads.
  // Adjusted during render rather than in an effect: React's documented
  // pattern for state that follows a prop, and it avoids a second render with
  // the stale value.
  const latestCounts = eventsQuery.data?.counts;
  const [counts, setCounts] = useState<Record<PublicProfileTab, number> | undefined>(latestCounts);
  if (latestCounts && latestCounts !== counts) setCounts(latestCounts);

  // The mutation and its cache invalidation live in useOrgFollow so the event
  // detail screen's Follow button shares them.
  const follow = useOrgFollow(orgId, token, {
    onSuccess: () => setActionError(null),
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

  if (profileQuery.isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-lhlBackgroundColor" edges={['top']}>
        <PublicProfileTopBar bellHref="/settings/followed-orgs" bellLabel="Org notifications" />
        <View className="flex-1 items-center justify-center bg-lhlBackgroundColor">
          <ActivityIndicator color={colors.brand} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SettingsDrawer
      open={notificationsOpen}
      onOpenChange={setNotificationsOpen}
      renderPanel={(close) => <FollowedOrgNotificationsScreen onBack={close} />}
    >
      {/* No top SafeAreaView edge: the cover runs under the status bar. */}
      <View className="flex-1 bg-lhlBackgroundColor">
        <ScrollView
          className="flex-1 bg-lhlBackgroundColor"
          // The frame adds 32 under the content stack on public and org views.
          contentContainerStyle={{ paddingBottom: 64 }}
        >
          <ProfileCover
            avatar={
              org?.profile_picture ? (
                <Image
                  source={{ uri: org.profile_picture }}
                  style={{ width: '100%', height: '100%' }}
                />
              ) : null
            }
            left={
              <CoverIconButton accessibilityLabel="Back" onPress={() => router.back()}>
                <ArrowLeftIcon width={18} height={18} color={colors.ink} />
              </CoverIconButton>
            }
            right={
              <CoverIconButton
                accessibilityLabel="Org notification settings"
                accessibilityState={{ expanded: notificationsOpen }}
                onPress={() => setNotificationsOpen(true)}
              >
                <LhlGearIcon size={20} color={colors.ink} />
              </CoverIconButton>
            }
          />

          {/* --- Identity block (367 tall in the frame, mostly name + bio) --- */}
          <View className="w-[289px] max-w-full items-center self-center">
            {/* Up to three lines, centred, with the verified tick beside it.
                The name shrinks rather than the tick, so a long name wraps
                instead of pushing the tick off the 289 column. */}
            <View className="mt-[8px] flex-row items-center justify-center gap-[5px]">
              <Text
                numberOfLines={3}
                className="font-roboto-bold shrink text-center text-[20px] leading-[23px] text-lhlInk"
              >
                {org?.name ?? 'Organization'}
              </Text>
              {org?.verified ? (
                <VerifiedIcon width={16} height={16} accessibilityLabel="Verified organization" />
              ) : null}
            </View>

            {org?.category ? (
              <Text className="font-roboto-medium mt-[8px] text-[12px] leading-[14px] text-lhlSecondaryTextGrey">
                {org.category}
              </Text>
            ) : null}

            <ProfileCounts
              events={counts ? counts.upcoming + counts.past : undefined}
              followers={org?.follower_count ?? 0}
              following={org?.following_count ?? 0}
              // Followers open the list sheet (LOOP-307). Following stays
              // plain: it counts other ORGS this org follows, which nothing
              // lists yet and nobody has asked to see.
              onPressFollowers={() => setFollowersOpen(true)}
            />

            <View className="mt-[10px] flex-row items-center gap-[8px]">
              <FollowButton
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
                <OutlinedButton
                  accessibilityLabel="Manage this organization"
                  onPress={() => router.push(`/org/${orgId}?tab=events`)}
                  borderRadius={8}
                  width={96}
                >
                  <Text className="font-roboto-medium text-[14px] text-lhlInk">Manage</Text>
                </OutlinedButton>
              ) : null}
            </View>

            {actionError ? (
              <Text className="font-roboto mt-[8px] text-center text-[12px] text-lhlDestructiveRed">
                {actionError}
              </Text>
            ) : null}

            {/* The same bio block as a user profile, read-only. */}
            <ProfileBio bio={org?.bio} />
          </View>

          {/* --- Meetings, members only (LOOP-319) ---
              Rendered for members only, but the server is the gate: the
              meetings endpoint 403s anyone not in org_members. */}
          {profileQuery.data?.is_member && profileQuery.data.role ? (
            <OrgMeetingsSection orgId={orgId} role={profileQuery.data.role} token={token} />
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
                        ? 'Follow to hear when this organization posts one.'
                        : undefined
                    }
                  />
                ) : (
                  events.map((event) => <ProfileEventCard key={event.id} event={event} />)
                )}
              </View>
            )}
          </View>
        </ScrollView>

        {org ? (
          <FollowListSheet
            visible={followersOpen}
            onClose={() => setFollowersOpen(false)}
            subject={{ type: 'org', id: org.id }}
            initialKind="followers"
            followerCount={org.follower_count}
            token={token}
          />
        ) : null}
      </View>
    </SettingsDrawer>
  );
}
