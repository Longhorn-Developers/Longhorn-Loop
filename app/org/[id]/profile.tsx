// An org's landing page -- what EVERYONE sees, member or not (LOOP-180,
// LOOP-312, made the one page per org in LOOP-319, redesigned in LOOP-333 –
// LOOP-335).
//
// Figma: "Org Page", "Org Page (Upcoming Events Selected)", "Org Page (Past
// Events)", "Org Page (People Selected)" and its sticky-header / action-sheet
// variants, in "LOOP Design (Lasya's Copy)". Top to bottom:
//
//   salmon cover with •••  →  88pt square org picture overlapping it  →
//   name + verified  →  tag row  →  Members | Followers | Events card  →
//   primary + outline actions  →  weekly meeting cards (members only)  →
//   bio  →  Events | People tabs.
//
// Once the actions row scrolls off, a compact header pins to the top (back,
// avatar, name, primary action, •••) so Follow and the menu stay in reach on a
// long events list.
//
// Every entry point lands here: the Orgs tab, Explore's org card, Home's "Orgs
// for you", an event's "Posted by". NOT app/org/[id]/index.tsx, which is the
// members-only management console; members reach it from the Manage button.
//
// WHAT THE FRAMES DRAW THAT IS NOT BUILT -- each needs a backend that doesn't
// exist, and an empty or fake control is worse than none (the LOOP-312 rule):
//   * "Request To Join" / "Join" and the "Open to new members" chip: there is
//     no regular membership, only the admin/editor team (LOOP-336). The
//     primary slot is Follow for visitors and Manage for the team.
//   * LinkedIn / Instagram / email squares, "Ask a question", "Email the org",
//     officer titles: no org socials or contact channel (LOOP-337).
//   * The Updates tab: no org-level posts (LOOP-338). Hidden, not stubbed.
//   * Mute / Hide / Report / Block in the ••• sheet (LOOP-339).
//   * The meeting card's "Add" (to calendar): see OrgMeetingsSection.
//
// Meeting times stay MEMBERS-ONLY even though the frame shows the card to a
// visitor: GET /orgs/:id/meetings 403s non-members on purpose (LOOP-319 --
// where a student org meets isn't public the way its events are). Opening it
// up is a policy change for that ticket's owners, not a styling one.

import type { ApiEvent } from '@/app/components/EventCard';
import SettingsDrawer from '@/app/components/SettingsDrawer';
import OrgActionSheet from '@/app/components/org/OrgActionSheet';
import OrgMeetingsSection from '@/app/components/org/OrgMeetingsSection';
import OrgPeopleTab, { type OrgLeader } from '@/app/components/org/OrgPeopleTab';
import {
  Chip,
  OrgLogo,
  PastEventRow,
  SegmentedToggle,
  UpcomingEventRow,
} from '@/app/components/orgs/OrgsUi';
import FollowListSheet from '@/app/components/profile/FollowListSheet';
import ProfileEmptyState from '@/app/components/profile/ProfileEmptyState';
import ProfileTabRow from '@/app/components/profile/ProfileTabRow';
import PublicProfileTopBar from '@/app/components/profile/PublicProfileTopBar';
import FollowedOrgNotificationsScreen from '@/app/settings/followed-orgs';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { ApiError, api } from '@/app/lib/api';
import { org as orgKeys } from '@/app/lib/queryKeys';
import { shareOrg } from '@/app/lib/shareOrg';
import { MIN_TAP_TARGET } from '@/app/lib/tapTarget';
import { useGoingEventIds } from '@/app/lib/useGoingEventIds';
import { useOrgFollow } from '@/app/lib/useOrgFollow';
import { useThemeColors } from '@/app/lib/themeColors';
import { DotsIcon } from '@/assets/icons/LhlOrgsIcons';
import ArrowLeftIcon from '@/assets/images/arrow-left.svg';
import VerifiedIcon from '@/assets/images/verified.svg';
import type { PublicProfileTab } from '@/shared/profileEventFilters';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

/** Cover band height, from the frame. */
const COVER_HEIGHT = 165;
/** The org picture: 88pt square, 16 radius, 4pt page-colour ring. */
const AVATAR_SIZE = 88;
/** How far the picture rides up into the cover (frame: top 102 of 165). */
const AVATAR_OVERLAP = COVER_HEIGHT - 102;

type PageTab = 'events' | 'people';

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
    /** New with LOOP-333; absent from an older deployed Worker. */
    member_count?: number;
  };
  /** New with LOOP-334; absent from an older deployed Worker. */
  leadership?: OrgLeader[];
  is_following: boolean;
  is_member: boolean;
  role: 'admin' | 'editor' | null;
}

interface OrgEventsResponse {
  tab: PublicProfileTab;
  events: (ApiEvent & { org_verified?: boolean })[];
  counts: Record<PublicProfileTab, number>;
}

/** "3.4k" past 10,000-ish, the full number below -- the stats card is narrow. */
function compactCount(n: number | undefined): string {
  if (n === undefined) return '—';
  if (n >= 10_000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, '')}k`;
  return n.toLocaleString();
}

function Stat({ value, label, onPress }: { value: string; label: string; onPress?: () => void }) {
  const body = (
    <View className="items-center gap-[4px]">
      <Text className="font-roboto-semibold text-[16px] leading-[19px] text-lhlInk">{value}</Text>
      <Text className="font-roboto text-[12px] leading-[14px] text-lhlSecondaryTextGrey">
        {label}
      </Text>
    </View>
  );
  return (
    <View className="flex-1 items-center">
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${value} ${label}`}
          onPress={onPress}
        >
          {body}
        </Pressable>
      ) : (
        body
      )}
    </View>
  );
}

/**
 * The 33pt surface disc the cover and sticky header put their buttons in,
 * inside a 44pt touch box -- same construction as ProfileCover's
 * CoverIconButton, with an optional hairline for the sticky header, where the
 * disc sits on the page colour instead of the cover.
 */
function RoundButton({
  label,
  onPress,
  outlined = false,
  children,
}: {
  label: string;
  onPress: () => void;
  outlined?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="items-center justify-center"
      style={{ width: MIN_TAP_TARGET, height: MIN_TAP_TARGET }}
    >
      <View
        className={`h-[33px] w-[33px] items-center justify-center rounded-full bg-lhlSurface ${
          outlined ? 'border border-lhlInk' : ''
        }`}
      >
        {children}
      </View>
    </Pressable>
  );
}

export default function PublicOrgProfileScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const orgId = Number(id);
  const { data: onboarding } = useOnboarding();
  const token = onboarding.token || null;

  const [pageTab, setPageTab] = useState<PageTab>('events');
  const [eventTab, setEventTab] = useState<PublicProfileTab>('upcoming');
  const [actionError, setActionError] = useState<string | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [followersOpen, setFollowersOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** Scroll offset past which the sticky header shows: the actions row's bottom. */
  const [stickyAfter, setStickyAfter] = useState<number | null>(null);
  const [stuck, setStuck] = useState(false);

  const enabled = !!token && Number.isFinite(orgId);

  const profileQuery = useQuery({
    queryKey: orgKeys.publicProfile(orgId),
    queryFn: () => api.get<OrgProfileResponse>(`/orgs/${orgId}/profile`, { token }),
    enabled,
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 1,
  });

  const eventsQuery = useQuery({
    queryKey: orgKeys.publicEvents(orgId, eventTab),
    queryFn: () =>
      api.get<OrgEventsResponse>(`/orgs/${orgId}/profile/events?tab=${eventTab}`, { token }),
    enabled: enabled && !!profileQuery.data,
  });

  const going = useGoingEventIds(token);

  // Last counts seen, so switching Upcoming <-> Past doesn't blank the numbers
  // while the other list loads. Adjusted during render (React's documented
  // pattern for state that follows a prop) to skip a render with stale values.
  const latestCounts = eventsQuery.data?.counts;
  const [counts, setCounts] = useState<Record<PublicProfileTab, number> | undefined>(latestCounts);
  if (latestCounts && latestCounts !== counts) setCounts(latestCounts);

  const follow = useOrgFollow(orgId, token, {
    onSuccess: () => setActionError(null),
    onError: () => setActionError('Could not update follow. Try again.'),
  });

  const data = profileQuery.data;
  const org = data?.org;
  const isFollowing = data?.is_following ?? false;
  const isTeam = !!data?.is_member;
  const events = eventsQuery.data?.events ?? [];
  const totalEvents = counts ? counts.upcoming + counts.past : undefined;

  const toggleFollow = () => {
    setActionError(null);
    follow.mutate(!isFollowing);
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (stickyAfter === null) return;
    const next = e.nativeEvent.contentOffset.y > stickyAfter;
    if (next !== stuck) setStuck(next);
  };

  if (!token) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-lhlBackgroundColor">
        <Text className="font-roboto text-[14px] text-lhlSecondaryTextGrey">
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
          <Text className="font-roboto-semibold text-center text-[15px] text-lhlInk">
            {status === 404 ? 'This organization isn’t available' : 'Couldn’t load this page'}
          </Text>
          <Text className="font-roboto mt-[6px] text-center text-[12px] text-lhlSecondaryTextGrey">
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

  // The primary action. Team members manage; everyone else follows. Following
  // drops to the outline style so "you already did this" reads at a glance.
  const primary = isTeam
    ? {
        label: 'Manage',
        a11y: 'Manage this organization',
        filled: true,
        onPress: () => router.push(`/org/${orgId}?tab=events`),
      }
    : {
        label: isFollowing ? 'Following' : 'Follow',
        a11y: isFollowing
          ? `Unfollow ${org?.name ?? 'organization'}`
          : `Follow ${org?.name ?? 'organization'}`,
        filled: !isFollowing,
        onPress: toggleFollow,
      };

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
          contentContainerStyle={{ paddingBottom: 64 }}
          onScroll={onScroll}
          scrollEventThrottle={16}
        >
          {/* --- Cover --- */}
          <View className="bg-lhlOrgCover" style={{ height: COVER_HEIGHT }}>
            <View
              className="flex-row items-center justify-between px-[8px]"
              style={{ marginTop: insets.top + 4 }}
            >
              <RoundButton label="Back" onPress={() => router.back()}>
                <ArrowLeftIcon width={18} height={18} color={colors.ink} />
              </RoundButton>
              <RoundButton label="More options" onPress={() => setMenuOpen(true)}>
                <DotsIcon size={16} color={colors.ink} />
              </RoundButton>
            </View>
          </View>

          {/* --- Identity --- */}
          <View className="px-[20px]" style={{ marginTop: -AVATAR_OVERLAP }}>
            <View
              className="self-start overflow-hidden rounded-[20px] border-4 border-lhlBackgroundColor bg-lhlBackgroundColor"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <OrgLogo
                name={org?.name}
                uri={org?.profile_picture}
                size={AVATAR_SIZE - 8}
                radius={16}
              />
            </View>

            <View className="mt-[8px] flex-row items-center gap-[4px]">
              <Text
                accessibilityRole="header"
                numberOfLines={3}
                className="font-roboto-semibold shrink text-[20px] leading-[24px] text-lhlInk"
              >
                {org?.name ?? 'Organization'}
              </Text>
              {org?.verified ? (
                <VerifiedIcon width={20} height={20} accessibilityLabel="Verified organization" />
              ) : null}
            </View>

            {org?.category ? (
              <View className="mt-[6px] flex-row flex-wrap gap-[8px]">
                <Chip label={org.category} />
              </View>
            ) : null}

            {/* --- Stats --- */}
            <View className="mt-[16px] h-[55px] flex-row items-center rounded-[16px] border border-lhlBorderSoft bg-lhlSurface px-[12px]">
              <Stat value={compactCount(org?.member_count)} label="Members" />
              <View className="h-[35px] w-px bg-lhlBorderSoft" />
              <Stat
                value={compactCount(org?.follower_count)}
                label="Followers"
                // Followers open the list sheet (LOOP-307).
                onPress={() => setFollowersOpen(true)}
              />
              <View className="h-[35px] w-px bg-lhlBorderSoft" />
              <Stat value={compactCount(totalEvents)} label="Events" />
            </View>

            {/* --- Actions --- */}
            <View
              className="mt-[8px] flex-row gap-[16px]"
              onLayout={(e) => {
                const { y, height } = e.nativeEvent.layout;
                // y is relative to the identity block, which starts at
                // COVER_HEIGHT - AVATAR_OVERLAP in scroll coordinates.
                setStickyAfter(COVER_HEIGHT - AVATAR_OVERLAP + y + height);
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={primary.a11y}
                accessibilityState={{ busy: follow.isPending }}
                disabled={follow.isPending}
                onPress={primary.onPress}
                className={`h-[36px] flex-[1.6] items-center justify-center rounded-[8px] ${
                  primary.filled ? 'bg-lhlBurntOrange' : 'border border-lhlDivider bg-lhlSurface'
                }`}
              >
                <Text
                  className={`font-roboto-semibold text-[12px] ${
                    primary.filled ? 'text-white' : 'text-lhlSecondaryTextGrey'
                  }`}
                >
                  {primary.label}
                </Text>
              </Pressable>

              {/* Secondary: Follow for the team (they can follow their own org
                  too), Share for everyone else. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  isTeam ? (isFollowing ? 'Unfollow' : 'Follow') : 'Share organization'
                }
                disabled={isTeam && follow.isPending}
                onPress={
                  isTeam
                    ? toggleFollow
                    : () => {
                        if (org) void shareOrg({ id: org.id, name: org.name });
                      }
                }
                className="h-[36px] flex-1 items-center justify-center rounded-[8px] border border-lhlDivider bg-lhlSurface"
              >
                <Text className="font-roboto-semibold text-[12px] text-lhlSecondaryTextGrey">
                  {isTeam ? (isFollowing ? 'Following' : 'Follow') : 'Share'}
                </Text>
              </Pressable>
            </View>

            {actionError ? (
              <Text className="font-roboto mt-[8px] text-[12px] text-lhlDestructiveRed">
                {actionError}
              </Text>
            ) : null}

            {/* --- Weekly meetings (members only; see the file header) --- */}
            {isTeam && data?.role ? (
              <View className="mt-[16px]">
                <OrgMeetingsSection orgId={orgId} role={data.role} token={token} />
              </View>
            ) : null}

            {org?.bio?.trim() ? (
              <Text className="font-roboto mt-[16px] text-[16px] leading-[20px] text-lhlInk">
                {org.bio.trim()}
              </Text>
            ) : null}

            {/* --- Tabs --- */}
            <View className="mt-[16px]">
              <ProfileTabRow<PageTab>
                tabs={[
                  { key: 'events', label: 'Events', count: totalEvents },
                  { key: 'people', label: 'People' },
                ]}
                value={pageTab}
                onChange={setPageTab}
              />
            </View>

            {pageTab === 'events' ? (
              <View className="mt-[12px] gap-[12px]">
                <SegmentedToggle<PublicProfileTab>
                  options={[
                    {
                      key: 'upcoming',
                      label: counts ? `Upcoming (${counts.upcoming})` : 'Upcoming',
                    },
                    { key: 'past', label: counts ? `Past (${counts.past})` : 'Past' },
                  ]}
                  value={eventTab}
                  onChange={setEventTab}
                />
                {eventsQuery.isLoading ? (
                  <ActivityIndicator className="mt-[12px]" color={colors.brand} />
                ) : events.length === 0 ? (
                  <ProfileEmptyState
                    title={eventTab === 'upcoming' ? 'No upcoming events' : 'No past events'}
                    body={
                      eventTab === 'upcoming' && !isFollowing && !isTeam
                        ? 'Follow to hear when this organization posts one.'
                        : undefined
                    }
                  />
                ) : (
                  events.map((event) =>
                    eventTab === 'upcoming' ? (
                      <UpcomingEventRow key={event.id} event={event} going={going.has(event.id)} />
                    ) : (
                      <PastEventRow key={event.id} event={event} />
                    ),
                  )
                )}
              </View>
            ) : (
              <OrgPeopleTab leadership={data?.leadership} memberCount={org?.member_count} />
            )}
          </View>
        </ScrollView>

        {/* --- Sticky header (LOOP-335) --- */}
        {stuck ? (
          <View
            className="absolute left-0 right-0 top-0 flex-row items-center gap-[8px] border-b border-lhlBorderSoft bg-lhlBackgroundColor px-[12px] pb-[8px]"
            style={{ paddingTop: insets.top + 4 }}
          >
            <RoundButton label="Back" outlined onPress={() => router.back()}>
              <ArrowLeftIcon width={16} height={16} color={colors.ink} />
            </RoundButton>
            <View
              className="overflow-hidden rounded-full"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <OrgLogo name={org?.name} uri={org?.profile_picture} size={24} radius={12} />
            </View>
            <Text numberOfLines={1} className="font-roboto-semibold flex-1 text-[16px] text-lhlInk">
              {org?.name}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={primary.a11y}
              disabled={follow.isPending}
              onPress={primary.onPress}
              className={`h-[32px] items-center justify-center rounded-[8px] px-[14px] ${
                primary.filled ? 'bg-lhlBurntOrange' : 'border border-lhlDivider bg-lhlSurface'
              }`}
            >
              <Text
                className={`font-roboto-semibold text-[12px] ${
                  primary.filled ? 'text-white' : 'text-lhlSecondaryTextGrey'
                }`}
              >
                {primary.label}
              </Text>
            </Pressable>
            <RoundButton label="More options" outlined onPress={() => setMenuOpen(true)}>
              <DotsIcon size={14} color={colors.ink} />
            </RoundButton>
          </View>
        ) : null}

        <OrgActionSheet
          visible={menuOpen}
          onClose={() => setMenuOpen(false)}
          org={org ? { id: org.id, name: org.name } : undefined}
          onOpenNotifications={() => setNotificationsOpen(true)}
        />

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
