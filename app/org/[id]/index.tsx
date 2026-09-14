// Organization Management console (LOOP-183; Events tab LOOP-136 design,
// LOOP-240 build).
//
// Figma: "Organization Management" frame, reviewed 2026-06-08.
//
// Shared header (avatar, name, role badge + verified check, follower counts,
// Views/Going/Saved tiles) plus the Events / Members / Analytics tab bar.
//
// All three tabs are now real. Members and Analytics live inline below because
// they are mostly markup over one query each; the Events tab is
// components/org/OrgEventsTab, which owns its own query, three filter controls,
// the Upcoming/Past split from LOOP-132 and an edit overlay, and would have
// doubled the length of this file. Managing an event still means editing it
// only — nothing in the API deletes or archives one; OrgEventsTab's header
// explains why that stayed unbuilt.
//
// The screen accepts an initial-tab param (`/org/123?tab=events`) so entry
// points can land on the tab they promised — "Manage" from the org list means
// "manage this org's events". Anything unrecognised falls back to Members,
// which is where the console opened before this existed.
//
// Permissions are mirrored from the server, never invented here: the API
// returns `can_manage`, and every management control is gated on it. The
// server re-checks each mutation, so hiding a button is presentation only.
//
// ---------------------------------------------------------------------------
// FIGMA PARITY PASS. Four things the frame has that the first build didn't:
//
// 1. The megaphone, top right. It is the ONLY entry point to
//    app/org/[id]/notifications.tsx — that screen was registered in
//    app/_layout.tsx and reachable by nothing, which is why the four org
//    notification toggles had never been seen outside a deep link. The frame
//    set is captioned "…and analytics overall, option for notifications" and
//    the notification-settings frame sits directly beside these, so this is
//    the destination it means. It is a megaphone rather than the bell that
//    PublicProfileTopBar uses for the same-shaped affordance: the bell there
//    goes to /settings/followed-orgs ("what orgs send ME"), and this goes to
//    what THIS ORG sends. Different destination, different glyph.
//
// 2. A real avatar with a pencil badge. `profile_picture` was already on the
//    header response and was being thrown away in favour of a grey circle.
//    The badge is admin-only and opens the same EditOrgProfileModal the
//    description's Edit Profile pill does — one editor, two entry points.
//
// 3. Icons on the stat tiles and the tab bar. eye.svg and bookmark.svg
//    already existed; the people / bar-chart / calendar glyphs are new, in
//    assets/icons/LhlOrgIcons.tsx.
//
// 4. Member rows read "Junior · Aerospace Engineering", not an email. The
//    fields are new on GET /orgs/:orgId/members; the email is still the
//    fallback for a member who has neither on file.

import EngagementChart, {
  buildWeeklySeries,
  type WeeklyRow,
} from '@/app/components/org/EngagementChart';
import EditOrgProfileModal from '@/app/components/org/EditOrgProfileModal';
import OrgEventsTab from '@/app/components/org/OrgEventsTab';
import InviteEditorModal from '@/app/components/modals/InviteEditorModal';
import ProfileModal, { ModalAction } from '@/app/components/modals/ProfileModal';
import TextInputField from '@/app/components/inputs/TextInputField';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { ApiError, api } from '@/app/lib/api';
import { org as orgKeys } from '@/app/lib/queryKeys';
import {
  BarChartIcon,
  CalendarListIcon,
  InvitePlusIcon,
  PeopleIcon,
  SwapRoleIcon,
  type OrgIconProps,
} from '@/assets/icons/LhlOrgIcons';
import LhlSearchIcon from '@/assets/icons/LhlSearchIcon';
import ArrowLeftIcon from '@/assets/images/arrow-left.svg';
import BookmarkIcon from '@/assets/images/bookmark.svg';
import EyeIcon from '@/assets/images/eye.svg';
import MegaphoneIcon from '@/assets/images/megaphone.svg';
import PencilIcon from '@/assets/images/pencil.svg';
import TrashIcon from '@/assets/images/trash.svg';
import VerifiedIcon from '@/assets/images/verified.svg';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useThemeColors } from '@/app/lib/themeColors';

const TABS = ['events', 'members', 'analytics'] as const;
type Tab = (typeof TABS)[number];

/**
 * Tab bar contents, in the frame's order.
 *
 * The icon is a component reference rather than an element so each tab can be
 * painted in its own state's colour — an active tab's glyph is white on burnt
 * orange, an inactive one is secondary grey.
 */
const TAB_META: Record<Tab, { label: string; Icon: React.ComponentType<OrgIconProps> }> = {
  events: { label: 'Events', Icon: CalendarListIcon },
  members: { label: 'Members', Icon: PeopleIcon },
  analytics: { label: 'Analytics', Icon: BarChartIcon },
};

function isTab(value: string | undefined): value is Tab {
  return !!value && (TABS as readonly string[]).includes(value);
}

interface OrgHeaderResponse {
  org: {
    id: number;
    name: string;
    profile_picture: string | null;
    verified: boolean;
    bio: string | null;
    follower_count: number;
    following_count: number;
    event_count: number;
  };
  role: 'admin' | 'editor';
  stats: { views: number; going: number; saved: number };
}

interface Member {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  /** Both nullable: a member who skipped those onboarding steps has neither. */
  year_classification: string | null;
  major: string | null;
  role: 'admin' | 'editor';
}

interface MembersResponse {
  members: Member[];
  pending_invites: { id: number; email: string; role: string }[];
  role: 'admin' | 'editor';
  can_manage: boolean;
}

interface AnalyticsResponse {
  weekly: WeeklyRow[];
  events: {
    id: number;
    title: string;
    view_count: number;
    rsvp_count: number;
    save_count: number;
    conversion_rate: number;
  }[];
}

/**
 * One of the three engagement tiles under the header.
 *
 * The frame stacks a glyph over the number over the label, and the glyph is
 * what makes three near-identical numbers scannable — Views/Going/Saved all
 * read as "a count" without it.
 */
function StatTile({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <View className="flex-1 items-center rounded-[10px] border border-lhlMutedBorder bg-lhlSurface py-[10px]">
      <View className="h-[16px] items-center justify-center">{icon}</View>
      <Text className="font-['Roboto-Flex'] mt-[4px] text-[18px] font-semibold text-lhlInk">
        {value.toLocaleString()}
      </Text>
      <Text className="font-['Roboto-Flex'] mt-[2px] text-[11px] text-lhlSecondaryTextGrey">
        {label}
      </Text>
    </View>
  );
}

/**
 * The org's picture, or its initial on a tinted disc.
 *
 * `profile_picture` comes off the header response and is null for most orgs —
 * `organizations` rows created by the HornsLink directory scrape carry a name
 * and little else — so the fallback is the common case, not the edge one.
 */
function OrgAvatar({
  name,
  uri,
  size,
}: {
  name: string | undefined;
  uri: string | null | undefined;
  size: number;
}) {
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        resizeMode="cover"
      />
    );
  }
  return (
    <View
      className="items-center justify-center rounded-full bg-lhlSurfaceGrey"
      style={{ width: size, height: size }}
    >
      <Text
        className="font-['Roboto-Flex'] font-semibold text-lhlAccent"
        style={{ fontSize: Math.round(size * 0.4) }}
      >
        {(name ?? '?').trim().charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

/**
 * Initials disc for a member row, matching the frame's TJ / AR / JC circles.
 *
 * Members deliberately do NOT show their Bevo avatar or profile photo here.
 * The endpoint returns `avatar`, but the frame draws initials, and a console
 * whose Team list is a column of near-identical cartoon longhorns is harder to
 * read at a glance than one of two-letter monograms.
 */
function MemberInitials({ first, last }: { first: string; last: string }) {
  const initials = `${first.trim().charAt(0)}${last.trim().charAt(0)}`.toUpperCase();
  return (
    <View className="h-[36px] w-[36px] items-center justify-center rounded-full bg-lhlSurfaceGrey">
      <Text className="font-['Roboto-Flex'] text-[13px] font-semibold text-lhlAccent">
        {initials || '?'}
      </Text>
    </View>
  );
}

/**
 * "Junior · Aerospace Engineering", degrading gracefully.
 *
 * Four cases, and the email fallback is the one that matters: it is what this
 * row showed before the two academic fields existed, and an admin looking at a
 * member who filled in neither still needs something to identify them by.
 */
function memberSubtitle(member: Member): string {
  const parts = [member.year_classification, member.major].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : member.email;
}

function RoleBadge({ role }: { role: 'admin' | 'editor' }) {
  const isAdmin = role === 'admin';
  return (
    <View
      className={`rounded-full px-[8px] py-[2px] ${isAdmin ? 'bg-lhlInk' : 'bg-lhlSurfaceGrey'}`}
    >
      <Text
        className={`font-['Roboto-Flex'] text-[10px] font-semibold ${
          isAdmin ? 'text-white' : 'text-lhlSecondaryTextGrey'
        }`}
      >
        {isAdmin ? 'Admin' : 'Editor'}
      </Text>
    </View>
  );
}

export default function OrgConsoleScreen() {
  const colors = useThemeColors();
  const { id, tab: initialTab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const orgId = Number(id);
  const router = useRouter();
  const { data: onboarding } = useOnboarding();
  const token = onboarding.token || null;
  const queryClient = useQueryClient();

  // Read once, as the initial value: the param seeds where the console opens,
  // it does not pin it, so tapping another tab still works.
  const [tab, setTab] = useState<Tab>(isTab(initialTab) ? initialTab : 'members');
  const [editingProfile, setEditingProfile] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [eventFilter, setEventFilter] = useState<'all' | number>('all');
  const [analyticsSearch, setAnalyticsSearch] = useState('');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const header = useQuery({
    queryKey: orgKeys.detail(orgId),
    queryFn: () => api.get<OrgHeaderResponse>(`/orgs/${orgId}`, { token }),
    enabled: !!token && Number.isFinite(orgId),
  });

  const members = useQuery({
    queryKey: orgKeys.members(orgId),
    queryFn: () => api.get<MembersResponse>(`/orgs/${orgId}/members`, { token }),
    enabled: !!token && Number.isFinite(orgId) && tab === 'members',
  });

  const analytics = useQuery({
    queryKey: orgKeys.analytics(orgId, String(eventFilter)),
    queryFn: () =>
      api.get<AnalyticsResponse>(`/orgs/${orgId}/analytics?event_id=${eventFilter}`, { token }),
    enabled: !!token && Number.isFinite(orgId) && tab === 'analytics',
  });

  const canManage = members.data?.can_manage ?? header.data?.role === 'admin';

  const describeError = (err: unknown, fallback: string) => {
    const body = err instanceof ApiError ? (err.body as Record<string, unknown> | null) : null;
    return (body?.message as string) ?? (body?.error as string) ?? fallback;
  };

  const invalidateOrg = () => {
    queryClient.invalidateQueries({ queryKey: orgKeys.members(orgId) });
    queryClient.invalidateQueries({ queryKey: orgKeys.detail(orgId) });
  };

  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: 'admin' | 'editor' }) =>
      api.patch(`/orgs/${orgId}/members/${userId}`, { token, body: { role } }),
    onSuccess: invalidateOrg,
    onError: (err) => setActionError(describeError(err, 'Could not change that role.')),
  });

  const removeMember = useMutation({
    mutationFn: (userId: number) => api.delete(`/orgs/${orgId}/members/${userId}`, { token }),
    onSuccess: invalidateOrg,
    onError: (err) => setActionError(describeError(err, 'Could not remove that member.')),
  });

  const leaveOrg = useMutation({
    mutationFn: () => api.post(`/orgs/${orgId}/leave`, { token }),
    onSuccess: () => {
      setConfirmLeave(false);
      queryClient.invalidateQueries({ queryKey: orgKeys.all });
      router.back();
    },
    onError: (err) => {
      setConfirmLeave(false);
      // The common case is LAST_ADMIN, whose message tells the user to promote
      // someone first — surfacing it verbatim is more useful than a generic
      // failure toast.
      setActionError(describeError(err, 'Could not leave this organization.'));
    },
  });

  const weekly = useMemo(
    () => buildWeeklySeries(analytics.data?.weekly ?? []),
    [analytics.data?.weekly],
  );

  /**
   * The Analytics tab's event picker and performance cards, narrowed by the
   * local search box.
   *
   * Substring match rather than the fuzzy scorer in app/lib/localSearch: these
   * are the org's own event titles, which the person searching wrote, so they
   * are typing a prefix they remember rather than guessing at a name.
   *
   * The currently selected event is NOT force-kept in the list. Typing a query
   * that excludes it hides its pill while `eventFilter` still points at it, so
   * the chart above keeps showing the event whose pill just scrolled out of
   * view — which is the same thing that happens when the strip scrolls, and
   * clearing the search brings the pill straight back.
   */
  const visibleAnalyticsEvents = useMemo(() => {
    const rows = analytics.data?.events ?? [];
    const needle = analyticsSearch.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((event) => event.title.toLowerCase().includes(needle));
  }, [analytics.data?.events, analyticsSearch]);

  if (!token) {
    return (
      <SafeAreaView className="flex-1 bg-lhlBackgroundColor" edges={['top']}>
        <View className="px-[20px] py-[12px]">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.back()}
          >
            <ArrowLeftIcon width={22} height={22} color={colors.ink} />
          </Pressable>
        </View>
        <View className="flex-1 items-center justify-center">
          <Text className="font-['Roboto-Flex'] text-[14px] text-lhlSecondaryTextGrey">
            Sign in to manage your organization.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (header.isError) {
    const message = describeError(header.error, 'Could not load this organization.');
    // Landing here (e.g. NOT_A_MEMBER, tapped straight from the Explore feed)
    // used to be a dead end -- no header, no tabs, nothing to press but the
    // hardware back gesture. One user reported getting stuck on it.
    return (
      <SafeAreaView className="flex-1 bg-lhlBackgroundColor" edges={['top']}>
        <View className="px-[20px] py-[12px]">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.back()}
          >
            <ArrowLeftIcon width={22} height={22} color={colors.ink} />
          </Pressable>
        </View>
        <View className="flex-1 items-center justify-center px-[30px]">
          <Text className="font-['Roboto-Flex'] text-center text-[14px] text-lhlSecondaryTextGrey">
            {message === 'NOT_A_MEMBER' ? 'You’re not a member of this organization.' : message}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const org = header.data?.org;
  const stats = header.data?.stats;

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
        <Text className="font-['Roboto-Flex'] ml-[12px] flex-1 text-[18px] font-semibold text-lhlInk">
          Organization Management
        </Text>

        {/* See note 1 in the file header: this is the only route into the org
            notification settings. Shown to editors too — the screen renders
            read-only for them rather than 403ing, so hiding it would be
            hiding information they are allowed to see. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Organization notification settings"
          hitSlop={10}
          onPress={() => router.push(`/org/${orgId}/notifications`)}
        >
          <MegaphoneIcon width={22} height={22} color={colors.ink} />
        </Pressable>
      </View>

      {header.isLoading ? (
        <View className="flex-1 items-center justify-center bg-lhlBackgroundColor">
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : (
        <ScrollView
          className="flex-1 px-[20px] bg-lhlBackgroundColor"
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          {/* --- Console header --- */}
          <View className="flex-row items-center">
            <View>
              <OrgAvatar name={org?.name} uri={org?.profile_picture} size={60} />

              {/* Note 2 in the file header. Admin-only, and the same modal as
                  the description's pill below — an editor sees the avatar
                  without the badge, and PATCH /orgs/:orgId re-checks the role
                  either way. */}
              {header.data?.role === 'admin' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Edit organization picture and description"
                  hitSlop={8}
                  onPress={() => setEditingProfile(true)}
                  className="absolute bottom-0 right-0 h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-lhlBackgroundColor bg-lhlBurntOrange"
                >
                  <PencilIcon width={11} height={11} color="#FFFFFF" />
                </Pressable>
              ) : null}
            </View>

            <View className="ml-[12px] flex-1 bg-lhlBackgroundColor">
              <View className="flex-row items-center gap-[6px]">
                <Text
                  numberOfLines={1}
                  className="font-['Roboto-Flex'] shrink text-[17px] font-semibold text-lhlInk"
                >
                  {org?.name}
                </Text>
                {/* The shared verified mark (assets/images/verified.svg), the
                    same one the public org profile draws. The bare "✓" this
                    replaced was a text glyph whose size and baseline shifted
                    per platform. */}
                {org?.verified ? (
                  <VerifiedIcon
                    width={14}
                    height={14}
                    color={colors.info}
                    accessibilityLabel="Verified"
                  />
                ) : null}
              </View>
              <View className="mt-[4px] flex-row items-center gap-[8px]">
                {header.data?.role ? <RoleBadge role={header.data.role} /> : null}
                <Text className="font-['Roboto-Flex'] text-[11px] text-lhlSecondaryTextGrey">
                  {org?.follower_count ?? 0} followers · {org?.following_count ?? 0} following
                </Text>
              </View>
            </View>
          </View>

          {/* --- Description (LOOP-261) ---
              Admin-only edit, matching PATCH /orgs/:orgId. An editor sees the
              text but not the affordance; the endpoint re-checks the role
              regardless, so hiding it is a courtesy rather than the boundary.
              The empty state is a prompt rather than blank space, because a
              missing description is the state EVERY org is in today. */}
          <View className="mt-[12px]">
            {org?.bio ? (
              <Text className="font-['Roboto-Flex'] text-[13px] leading-[18px] text-lhlInk">
                {org.bio}
              </Text>
            ) : (
              <Text className="font-['Roboto-Flex'] text-[13px] italic text-lhlSecondaryTextGrey">
                No description yet.
              </Text>
            )}

            {header.data?.role === 'admin' ? (
              <Pressable
                onPress={() => setEditingProfile(true)}
                accessibilityRole="button"
                accessibilityLabel="Edit organization profile"
                hitSlop={8}
                className="mt-[8px] self-start rounded-full border border-lhlMutedBorder bg-lhlSurface px-[14px] py-[6px]"
              >
                <Text className="font-['Roboto-Flex'] text-[12px] font-medium text-lhlInk">
                  {org?.bio ? 'Edit Profile' : 'Add a description'}
                </Text>
              </Pressable>
            ) : null}
          </View>

          <View className="mt-[14px] flex-row gap-[8px]">
            <StatTile
              label="Views"
              value={stats?.views ?? 0}
              icon={<EyeIcon width={16} height={16} color={colors.inkSecondary} />}
            />
            <StatTile
              label="Going"
              value={stats?.going ?? 0}
              icon={<PeopleIcon size={16} color={colors.inkSecondary} />}
            />
            <StatTile
              label="Saved"
              value={stats?.saved ?? 0}
              icon={<BookmarkIcon width={11} height={15} color={colors.inkSecondary} />}
            />
          </View>

          {/* --- Tabs --- */}
          <View className="mt-[18px] flex-row gap-[8px]">
            {TABS.map((key) => {
              const isActive = tab === key;
              const { label, Icon } = TAB_META[key];
              return (
                <Pressable
                  key={key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: isActive }}
                  onPress={() => setTab(key)}
                  className={`flex-1 flex-row items-center justify-center gap-[5px] rounded-full border py-[8px] ${
                    isActive
                      ? 'border-lhlBurntOrange bg-lhlBurntOrange'
                      : 'border-lhlMutedBorder bg-lhlSurface'
                  }`}
                >
                  <Icon size={13} color={isActive ? '#FFFFFF' : colors.inkSecondary} />
                  <Text
                    className={`font-['Roboto-Flex'] text-[12px] font-semibold ${
                      isActive ? 'text-white' : 'text-lhlSecondaryTextGrey'
                    }`}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {actionError ? (
            <Text className="font-['Roboto-Flex'] mt-[12px] text-center text-[12px] text-lhlDestructiveRed">
              {actionError}
            </Text>
          ) : null}

          {/* --- Events tab (LOOP-136) --- */}
          {tab === 'events' ? <OrgEventsTab orgId={orgId} token={token} /> : null}

          {/* --- Members tab --- */}
          {tab === 'members' ? (
            <View className="mt-[20px]">
              <View className="flex-row items-center justify-between">
                <Text className="font-['Roboto-Flex'] text-[15px] font-semibold text-lhlInk">
                  Team ({members.data?.members.length ?? 0})
                </Text>
                {canManage ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Invite an editor"
                    onPress={() => setShowInvite(true)}
                    className="flex-row items-center gap-[5px] rounded-full bg-lhlBurntOrange px-[14px] py-[6px]"
                  >
                    <InvitePlusIcon size={13} />
                    <Text className="font-['Roboto-Flex'] text-[12px] font-semibold text-white">
                      Invite
                    </Text>
                  </Pressable>
                ) : null}
              </View>

              {members.isLoading ? (
                <ActivityIndicator className="mt-[20px]" color={colors.brand} />
              ) : (
                <View className="mt-[12px]">
                  {members.data?.members.map((m) => (
                    <View
                      key={m.id}
                      className="mb-[10px] flex-row items-center rounded-[10px] border border-lhlMutedBorder bg-lhlSurface px-[12px] py-[10px]"
                    >
                      <MemberInitials first={m.first_name} last={m.last_name} />
                      <View className="ml-[10px] flex-1 bg-lhlBackgroundColor">
                        <Text
                          numberOfLines={1}
                          className="font-['Roboto-Flex'] text-[13px] font-semibold text-lhlInk"
                        >
                          {m.first_name} {m.last_name}
                        </Text>
                        <Text
                          numberOfLines={1}
                          className="font-['Roboto-Flex'] mt-[2px] text-[11px] text-lhlSecondaryTextGrey"
                        >
                          {memberSubtitle(m)}
                        </Text>
                      </View>

                      <View className="flex-row items-center gap-[8px]">
                        <RoleBadge role={m.role} />

                        {/* Role swap is admin-only. The server enforces the
                            last-admin rule and returns LAST_ADMIN, surfaced
                            above rather than pre-empted here. */}
                        {canManage ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Make ${m.first_name} ${
                              m.role === 'admin' ? 'an editor' : 'an admin'
                            }`}
                            disabled={changeRole.isPending}
                            onPress={() => {
                              setActionError(null);
                              changeRole.mutate({
                                userId: m.id,
                                role: m.role === 'admin' ? 'editor' : 'admin',
                              });
                            }}
                            hitSlop={8}
                          >
                            <SwapRoleIcon size={16} color={colors.accent} />
                          </Pressable>
                        ) : null}

                        {/* Trash only on editor rows, matching the design —
                            removing an admin is a deliberate demote-then-remove. */}
                        {canManage && m.role === 'editor' ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Remove ${m.first_name}`}
                            disabled={removeMember.isPending}
                            onPress={() => {
                              setActionError(null);
                              removeMember.mutate(m.id);
                            }}
                            hitSlop={8}
                          >
                            {/* assets/images/trash.svg, the glyph
                                ManageEventSheet already uses for destructive
                                row actions. The 🗑 emoji this replaced
                                rendered as a different picture on every
                                platform and ignored the theme colour. */}
                            <TrashIcon width={16} height={16} color={colors.destructive} />
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  ))}

                  {members.data?.pending_invites.length ? (
                    <View className="mt-[8px]">
                      <Text className="font-['Roboto-Flex'] text-[12px] font-semibold text-lhlSecondaryTextGrey">
                        Pending invites
                      </Text>
                      {members.data.pending_invites.map((invite) => (
                        <Text
                          key={invite.id}
                          className="font-['Roboto-Flex'] mt-[4px] text-[12px] text-lhlSecondaryTextGrey"
                        >
                          {invite.email} · {invite.role}
                        </Text>
                      ))}
                    </View>
                  ) : null}

                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setActionError(null);
                      setConfirmLeave(true);
                    }}
                    className="mt-[20px] items-center rounded-[10px] border border-lhlDestructiveRed bg-lhlSurface py-[12px]"
                  >
                    <Text className="font-['Roboto-Flex'] text-[13px] font-semibold text-lhlDestructiveRed">
                      Leave Organization
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>
          ) : null}

          {/* --- Analytics tab --- */}
          {tab === 'analytics' ? (
            <View className="mt-[20px]">
              <Text className="font-['Roboto-Flex'] text-[15px] font-semibold text-lhlInk">
                Event Performance
              </Text>

              {/* The frame draws the Events tab's whole control row here —
                  search, the General/Academic/Social chips, and a Date sort.
                  Only the search is built, and deliberately:
                  GET /orgs/:orgId/analytics takes one parameter, `event_id`.
                  Chips and a sort would need `filter` and `sort` on that route
                  the way orgs.worker.ts already implements them for
                  /:orgId/events, which is server work and a separate ticket —
                  and three controls where two do nothing is worse than one
                  that works.

                  The search is worth having on its own merits: the pill strip
                  below is the event picker, and an org with a semester of
                  events turns it into a scroll no thumb wants. Filtering is
                  local because the pills are already in hand — the response
                  carries every event, so narrowing them costs no request. */}
              <View className="mt-[10px]">
                <TextInputField
                  value={analyticsSearch}
                  onChangeText={setAnalyticsSearch}
                  placeholder="Search events..."
                  autoCapitalize="none"
                  autoCorrect={false}
                  borderRadius={8}
                  clearable
                  leftIcon={<LhlSearchIcon size={14} color={colors.inkSecondary} />}
                />
              </View>

              {/* Event filter */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                className="mt-[10px]"
                contentContainerStyle={{ gap: 8 }}
              >
                <Pressable
                  onPress={() => setEventFilter('all')}
                  className={`rounded-full border px-[12px] py-[6px] ${
                    eventFilter === 'all'
                      ? 'border-lhlInk bg-lhlInk'
                      : 'border-lhlMutedBorder bg-lhlSurface'
                  }`}
                >
                  <Text
                    className={`font-['Roboto-Flex'] text-[11px] font-medium ${
                      eventFilter === 'all' ? 'text-white' : 'text-lhlSecondaryTextGrey'
                    }`}
                  >
                    All events
                  </Text>
                </Pressable>
                {visibleAnalyticsEvents.map((e) => (
                  <Pressable
                    key={e.id}
                    onPress={() => setEventFilter(e.id)}
                    className={`rounded-full border px-[12px] py-[6px] ${
                      eventFilter === e.id
                        ? 'border-lhlInk bg-lhlInk'
                        : 'border-lhlMutedBorder bg-lhlSurface'
                    }`}
                  >
                    <Text
                      numberOfLines={1}
                      className={`font-['Roboto-Flex'] max-w-[120px] text-[11px] font-medium ${
                        eventFilter === e.id ? 'text-white' : 'text-lhlSecondaryTextGrey'
                      }`}
                    >
                      {e.title}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

              {analytics.isLoading ? (
                <ActivityIndicator className="mt-[20px]" color={colors.brand} />
              ) : (
                <>
                  <View className="mt-[16px] rounded-[12px] border border-lhlMutedBorder bg-lhlSurface p-[12px]">
                    <EngagementChart data={weekly} />
                  </View>

                  <View className="mt-[16px]">
                    {visibleAnalyticsEvents.length === 0 ? (
                      <Text className="font-['Roboto-Flex'] mt-[10px] text-center text-[12px] text-lhlSecondaryTextGrey">
                        {analyticsSearch.trim()
                          ? 'No events match that search.'
                          : 'No events to report on yet.'}
                      </Text>
                    ) : (
                      visibleAnalyticsEvents.map((e) => (
                        <View
                          key={e.id}
                          className="mb-[10px] rounded-[10px] border border-lhlMutedBorder bg-lhlSurface px-[12px] py-[10px]"
                        >
                          <Text
                            numberOfLines={1}
                            className="font-['Roboto-Flex'] text-[13px] font-semibold text-lhlInk"
                          >
                            {e.title}
                          </Text>
                          <View className="mt-[8px] flex-row justify-between">
                            {[
                              ['Views', e.view_count.toLocaleString()],
                              ['Going', e.rsvp_count.toLocaleString()],
                              ['Saved', e.save_count.toLocaleString()],
                              ['Conv.', `${e.conversion_rate}%`],
                            ].map(([label, value]) => (
                              <View key={label} className="items-center">
                                <Text className="font-['Roboto-Flex'] text-[13px] font-semibold text-lhlInk">
                                  {value}
                                </Text>
                                <Text className="font-['Roboto-Flex'] text-[10px] text-lhlSecondaryTextGrey">
                                  {label}
                                </Text>
                              </View>
                            ))}
                          </View>
                        </View>
                      ))
                    )}
                  </View>
                </>
              )}
            </View>
          ) : null}
        </ScrollView>
      )}

      <EditOrgProfileModal
        visible={editingProfile}
        orgId={orgId}
        token={token}
        bio={org?.bio ?? null}
        onClose={() => setEditingProfile(false)}
      />

      {/* Invite Editor (LOOP-182) wired to its real endpoint. */}
      <InviteEditorModal
        visible={showInvite}
        onClose={() => setShowInvite(false)}
        onInvite={async (email) => {
          try {
            await api.post(`/orgs/${orgId}/invites`, { token, body: { email } });
            queryClient.invalidateQueries({ queryKey: orgKeys.members(orgId) });
          } catch (err) {
            throw new Error(describeError(err, 'That invite could not be sent.'));
          }
        }}
      />

      <ProfileModal
        visible={confirmLeave}
        onDismiss={() => setConfirmLeave(false)}
        title="Leave Organization?"
        body="You'll lose access to this organization's events and analytics."
        actions={
          <>
            <ModalAction label="Cancel" variant="outline" onPress={() => setConfirmLeave(false)} />
            <ModalAction
              label={leaveOrg.isPending ? 'Leaving…' : 'Leave'}
              variant="ink"
              disabled={leaveOrg.isPending}
              onPress={() => leaveOrg.mutate()}
            />
          </>
        }
      />
    </SafeAreaView>
  );
}
