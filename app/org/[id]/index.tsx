// Organization Management console (LOOP-183).
//
// Figma: "Organization Management" frame, reviewed 2026-06-08.
//
// Shared header (avatar, name, role badge + verified check, follower counts,
// Views/Going/Saved tiles) plus the Events / Members / Analytics tab bar.
//
// Scope: this ticket owns Members and Analytics. The Events tab is LOOP-136 —
// it renders a placeholder here rather than a half-built list, so LOOP-136 can
// drop in without unpicking anything.
//
// Permissions are mirrored from the server, never invented here: the API
// returns `can_manage`, and every management control is gated on it. The
// server re-checks each mutation, so hiding a button is presentation only.

import EngagementChart, {
  buildWeeklySeries,
  type WeeklyRow,
} from '@/app/components/org/EngagementChart';
import InviteEditorModal from '@/app/components/modals/InviteEditorModal';
import ProfileModal, { ModalAction } from '@/app/components/modals/ProfileModal';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { ApiError, api } from '@/app/lib/api';
import { org as orgKeys } from '@/app/lib/queryKeys';
import ArrowLeftIcon from '@/assets/images/arrow-left.svg';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useThemeColors } from '@/app/lib/themeColors';

type Tab = 'events' | 'members' | 'analytics';

interface OrgHeaderResponse {
  org: {
    id: number;
    name: string;
    profile_picture: string | null;
    verified: boolean;
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

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <View className="flex-1 items-center rounded-[10px] border border-lhlMutedBorder bg-lhlSurface py-[10px]">
      <Text className="font-['Roboto-Flex'] text-[18px] font-semibold text-lhlInk">
        {value.toLocaleString()}
      </Text>
      <Text className="font-['Roboto-Flex'] mt-[2px] text-[11px] text-lhlSecondaryTextGrey">
        {label}
      </Text>
    </View>
  );
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
  const { id } = useLocalSearchParams<{ id: string }>();
  const orgId = Number(id);
  const router = useRouter();
  const { data: onboarding } = useOnboarding();
  const token = onboarding.token || null;
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>('members');
  const [showInvite, setShowInvite] = useState(false);
  const [eventFilter, setEventFilter] = useState<'all' | number>('all');
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

  if (!token) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-lhlBackgroundColor">
        <Text className="font-['Roboto-Flex'] text-[14px] text-lhlSecondaryTextGrey">
          Sign in to manage your organization.
        </Text>
      </SafeAreaView>
    );
  }

  if (header.isError) {
    const message = describeError(header.error, 'Could not load this organization.');
    return (
      <SafeAreaView className="flex-1 items-center justify-center px-[30px] bg-lhlBackgroundColor">
        <Text className="font-['Roboto-Flex'] text-center text-[14px] text-lhlSecondaryTextGrey">
          {message === 'NOT_A_MEMBER' ? 'You’re not a member of this organization.' : message}
        </Text>
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
          <ArrowLeftIcon width={22} height={22} />
        </Pressable>
        <Text className="font-['Roboto-Flex'] ml-[12px] text-[18px] font-semibold text-lhlInk">
          Manage Organization
        </Text>
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
            <View className="h-[60px] w-[60px] rounded-full bg-lhlPlaceholderGrey" />
            <View className="ml-[12px] flex-1 bg-lhlBackgroundColor">
              <View className="flex-row items-center gap-[6px]">
                <Text
                  numberOfLines={1}
                  className="font-['Roboto-Flex'] text-[17px] font-semibold text-lhlInk"
                >
                  {org?.name}
                </Text>
                {org?.verified ? (
                  <Text className="text-[13px] text-lhlBurntOrange" accessibilityLabel="Verified">
                    ✓
                  </Text>
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

          <View className="mt-[14px] flex-row gap-[8px]">
            <StatTile label="Views" value={stats?.views ?? 0} />
            <StatTile label="Going" value={stats?.going ?? 0} />
            <StatTile label="Saved" value={stats?.saved ?? 0} />
          </View>

          {/* --- Tabs --- */}
          <View className="mt-[18px] flex-row gap-[8px]">
            {(['events', 'members', 'analytics'] as Tab[]).map((key) => {
              const isActive = tab === key;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: isActive }}
                  onPress={() => setTab(key)}
                  className={`flex-1 items-center rounded-full border py-[8px] ${
                    isActive
                      ? 'border-lhlBurntOrange bg-lhlBurntOrange'
                      : 'border-lhlMutedBorder bg-lhlSurface'
                  }`}
                >
                  <Text
                    className={`font-['Roboto-Flex'] text-[12px] font-semibold capitalize ${
                      isActive ? 'text-white' : 'text-lhlSecondaryTextGrey'
                    }`}
                  >
                    {key}
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
          {tab === 'events' ? (
            <View className="mt-[24px] items-center">
              <Text className="font-['Roboto-Flex'] text-center text-[13px] text-lhlSecondaryTextGrey">
                The Events tab is LOOP-136.
              </Text>
              <Text className="font-['Roboto-Flex'] mt-[4px] text-center text-[12px] text-lhlSecondaryTextGrey">
                This org has {org?.event_count ?? 0} event
                {(org?.event_count ?? 0) === 1 ? '' : 's'}.
              </Text>
            </View>
          ) : null}

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
                    onPress={() => setShowInvite(true)}
                    className="rounded-full bg-lhlBurntOrange px-[14px] py-[6px]"
                  >
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
                      <View className="h-[36px] w-[36px] rounded-full bg-lhlPlaceholderGrey" />
                      <View className="ml-[10px] flex-1 bg-lhlBackgroundColor">
                        <Text
                          numberOfLines={1}
                          className="font-['Roboto-Flex'] text-[13px] font-semibold text-lhlInk"
                        >
                          {m.first_name} {m.last_name}
                        </Text>
                        <Text
                          numberOfLines={1}
                          className="font-['Roboto-Flex'] text-[11px] text-lhlSecondaryTextGrey"
                        >
                          {m.email}
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
                          >
                            <Text className="font-['Roboto-Flex'] text-[11px] font-semibold text-lhlBurntOrange">
                              Swap
                            </Text>
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
                          >
                            <Text className="text-[14px] text-lhlDestructiveRed">🗑</Text>
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
                {analytics.data?.events.map((e) => (
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
                    {analytics.data?.events.length === 0 ? (
                      <Text className="font-['Roboto-Flex'] mt-[10px] text-center text-[12px] text-lhlSecondaryTextGrey">
                        No events to report on yet.
                      </Text>
                    ) : (
                      analytics.data?.events.map((e) => (
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
