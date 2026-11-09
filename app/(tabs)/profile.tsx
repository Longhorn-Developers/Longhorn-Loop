// Profile tab -- your own profile.
//
// LOOP-312 redesign (Figma "Profile - My Events (Going/Saved/Posted) V4"),
// replacing the LOOP-123 "Profile Main" header. Layout, top to bottom:
//   cover band with the settings gear, avatar across its bottom edge
//   name, year · majors, Events / Followers / Following counts
//   Edit Profile + linked-social squares, bio
//   interest chips with "+"
//   Going / Saved / Posted tab row, search, category chips + date sort, grid
//
// Spacing follows the frame's auto-layout: 24 between identity, interests and
// My Events; 12 between tab row, search, chips and the grid.
//
// WHAT DID NOT CHANGE: the events query, its 300ms debounced search, the
// filter/sort state, pull-to-refresh and the Manage Event overlays are all as
// they were. LOOP-312 reworks the container, not the tabs.
//
// Followers / Following counts open FollowListSheet, which runs on a stub
// until LOOP-307 adds the endpoint -- see app/lib/followList.ts.
//
// Someone else's profile is app/user/[id].tsx; an org's is
// app/org/[id]/profile.tsx. Both share this screen's header components.

import OpenLinkModal, { useOpenLinkGuard } from '@/app/components/modals/OpenLinkModal';
import SettingsDrawer from '@/app/components/SettingsDrawer';
import EditEventOverlay, { type EventEditSource } from '@/app/components/org/EditEventOverlay';
import { AvatarDisplay } from '@/app/components/profile/AvatarDisplay';
import FollowListSheet from '@/app/components/profile/FollowListSheet';
import InterestChips from '@/app/components/profile/InterestChips';
import ProfileBio from '@/app/components/profile/ProfileBio';
import ProfileCounts from '@/app/components/profile/ProfileCounts';
import ProfileCover, {
  CoverIconButton,
  PROFILE_AVATAR_SIZE,
} from '@/app/components/profile/ProfileCover';
import ProfileEmptyState from '@/app/components/profile/ProfileEmptyState';
import ProfileEventCard from '@/app/components/profile/ProfileEventCard';
import ProfileTabRow from '@/app/components/profile/ProfileTabRow';
import OutlinedButton from '@/app/components/profile/OutlinedButton';
import PencilIcon from '@/assets/images/pencil.svg';
import LhlGearIcon from '@/assets/icons/LhlGearIcon';
import TextInputField from '@/app/components/inputs/TextInputField';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { ApiError, api } from '@/app/lib/api';
import { user as userKeys } from '@/app/lib/queryKeys';
import { useSavedEvents } from '@/app/lib/useSavedEvents';
import { getSocialPlatformUI, type LinkedSocial } from '@/app/lib/socialPlatforms';
import type { ApiEvent } from '@/app/components/EventCard';
import ManageEventSheet from '@/app/components/modals/ManageEventSheet';
import PostAnnouncementModal from '@/app/components/modals/PostAnnouncementModal';
import ConfirmModal from '@/app/components/rsvp/ConfirmModal';
import LhlSearchIcon from '@/assets/icons/LhlSearchIcon';
import type { FollowListKind } from '@/app/lib/followList';
import { hitSlopFor } from '@/app/lib/tapTarget';
import {
  PROFILE_EVENT_FILTERS,
  PROFILE_EVENT_FILTER_LABELS,
  type ProfileEventFilter,
  type ProfileEventTab,
} from '@/shared/profileEventFilters';
import type { AvatarConfig } from '@/shared/avatar';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
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
    avatar_config: AvatarConfig | null;
    profile_photo_url: string | null;
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

/** Filter chips and the sort pill, drawn at the frame's 28; hitSlop takes them to 44. */
const CHIP_HEIGHT = 28;

// Per-tab empty copy (LOOP-312 step 7): each tab says what would fill IT, so
// an empty Going tab next to a full Saved one reads as "nothing yet here"
// rather than "you have no events".
const TABS: {
  key: ProfileEventTab;
  label: string;
  emptyTitle: string;
  empty: string;
}[] = [
  {
    key: 'going',
    label: 'Going',
    emptyTitle: 'No events yet',
    empty: 'Events you RSVP to will show up here',
  },
  {
    key: 'saved',
    label: 'Saved',
    emptyTitle: 'Nothing saved yet',
    empty: 'Events you save will show up here',
  },
  {
    key: 'posted',
    label: 'Posted',
    emptyTitle: 'No posted events',
    empty: 'Events you create will show up here',
  },
];

/** lucide "sort-desc", the frame's glyph on the Date pill. */
function SortGlyph({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path
        d="m3 16 4 4 4-4M7 20V4M11 4h10M11 8h7M11 12h4"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export default function ProfileScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { data: onboarding } = useOnboarding();
  const token = onboarding.token || null;
  const { toggleSave } = useSavedEvents(token);

  const openLink = useOpenLinkGuard();

  const [tab, setTab] = useState<ProfileEventTab>('going');
  /**
   * Two pieces of state for one field. `searchInput` is what the TextInput
   * shows and must update on every keystroke; `search` is what the query key
   * uses and updates 300ms later.
   *
   * Without the split, every character typed minted a new query key and fired
   * a request -- and once a key had been visited its data was cached, so the
   * next fetch counted as a REFETCH and tripped the pull-to-refresh spinner.
   * Typing "party" flashed the spinner five times.
   */
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  React.useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);
  const [filter, setFilter] = useState<ProfileEventFilter>('all');
  const [sortRecent, setSortRecent] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [followSheet, setFollowSheet] = useState<FollowListKind | null>(null);
  const [editingEvent, setEditingEvent] = useState<EventEditSource | null>(null);

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

  /**
   * Manage Event, from the pencil on a Posted-tab card.
   *
   * One piece of state — the event being managed — with three overlays layered
   * on top of it. Keeping the event separate from which overlay is open is
   * what lets Delete and Post Announcement open OVER the sheet and still know
   * what they are acting on, and what makes "cancel" fall back to the sheet
   * rather than dumping the user back to the grid.
   */
  const queryClient = useQueryClient();
  const [managed, setManaged] = useState<ApiEvent | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [announcing, setAnnouncing] = useState(false);

  const closeAll = () => {
    setSheetOpen(false);
    setConfirmingDelete(false);
    setAnnouncing(false);
    setManaged(null);
  };

  const deleteEvent = useMutation({
    mutationFn: async () => {
      if (!managed) throw new Error('NO_EVENT');
      return api.delete(`/events/${managed.id}`, { token });
    },
    onSuccess: async () => {
      closeAll();
      // The archived event has to leave the Posted grid AND the counts on the
      // tab pills, and it may have been in someone's Going or Saved list too.
      await queryClient.invalidateQueries({ queryKey: userKeys.all });
    },
    onError: (error) => {
      Alert.alert(
        'Could not delete event',
        error instanceof ApiError && error.status === 403
          ? 'You do not have permission to delete this event.'
          : 'Something went wrong. Please try again.',
      );
    },
  });

  const postAnnouncement = useMutation({
    mutationFn: async ({ body, notify }: { body: string; notify: boolean }) => {
      if (!managed) throw new Error('NO_EVENT');
      return api.post(`/events/${managed.id}/announcements`, {
        token,
        body: { body, notify },
      });
    },
    onSuccess: () => {
      closeAll();
    },
    onError: () => {
      Alert.alert('Could not post announcement', 'Something went wrong. Please try again.');
    },
  });

  /**
   * Pull to refresh.
   *
   * Refetches BOTH queries, not just the visible collection. The counts on the
   * Going / Saved / Posted pills come back with the events payload, so
   * refreshing only the active tab would leave the other two showing numbers
   * from whenever they were last fetched — and those are the numbers a user
   * pulls down to check. The header goes too, since follower counts move for
   * the same reasons the collections do.
   *
   * THE SPINNER TRACKS THE PULL, NOT THE REQUEST. This used to read
   * `profileQuery.isRefetching || eventsQuery.isRefetching`, which sounds
   * right and is not: `tab` is part of the events query key, so switching to
   * Going / Saved / Posted mints a different key. The first visit to a tab is
   * a fresh load, but every visit after that has cached data, which makes the
   * fetch a REFETCH -- so react-query set the flag, RefreshControl showed the
   * spinner programmatically, and the whole list slid down as if the user had
   * pulled it. Tapping a tab you had already seen dragged the screen every
   * single time.
   *
   * A local boolean is the honest signal, because the question is "did the
   * user pull down", which is not something react-query can know. The error
   * path is covered by allSettled: it never rejects, so `finally` always runs
   * and the spinner cannot get stuck on a failed refresh.
   */
  const [pullRefreshing, setPullRefreshing] = useState(false);

  const onRefresh = React.useCallback(() => {
    setPullRefreshing(true);
    Promise.allSettled([profileQuery.refetch(), eventsQuery.refetch()]).finally(() =>
      setPullRefreshing(false),
    );
  }, [profileQuery, eventsQuery]);

  const profile = profileQuery.data?.user;
  const fullName = profile ? `${profile.first_name} ${profile.last_name}`.trim() : '';

  /**
   * The tab counts (and the Events count in the header, which is Posted) come
   * back with whichever tab's events were fetched last. `tab` is part of that
   * query key, so the first visit to a tab has no data yet -- and reading
   * counts straight off it blanked every number in the tab row and the header
   * for the length of a request. Holding the last counts seen keeps them on
   * screen until fresh ones land: no flicker, and no header shift walking
   * Going -> Saved -> Posted (a LOOP-312 acceptance check).
   */
  // Adjusted during render rather than in an effect: React's documented
  // pattern for state that follows a prop, and it avoids a second render with
  // the stale value.
  const latestCounts = eventsQuery.data?.counts;
  const [counts, setCounts] = useState<Record<ProfileEventTab, number> | undefined>(latestCounts);
  if (latestCounts && latestCounts !== counts) setCounts(latestCounts);

  const academicLine = profile
    ? [profile.year_classification, ...(profile.majors ?? [])].filter(Boolean).join(' · ')
    : '';

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
    /*
      The settings drawer WRAPS the screen rather than sitting over it.
      An overlay big enough to catch a right-edge drag is also big enough to
      swallow every tap underneath it; as a wrapper the gesture sees the touch
      first and hands it on when it turns out not to be a drag.
    */
    <SettingsDrawer open={menuOpen} onOpenChange={setMenuOpen}>
      {/* No top SafeAreaView edge: the cover runs up under the status bar and
          ProfileCover does its own inset maths. See its header. */}
      <View className="flex-1 bg-lhlBackgroundColor">
        {profileQuery.isLoading ? (
          <View className="flex-1 items-center justify-center bg-lhlBackgroundColor">
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : (
          <ScrollView
            className="flex-1 bg-lhlBackgroundColor"
            contentContainerStyle={{ paddingBottom: 32 }}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={pullRefreshing}
                onRefresh={onRefresh}
                tintColor={colors.brand}
                colors={[colors.brand]}
              />
            }
          >
            <ProfileCover
              avatar={profile ? <AvatarDisplay user={profile} size={PROFILE_AVATAR_SIZE} /> : null}
              right={
                // Was a 28pt hamburger; V4 draws a gear, and it ships as a
                // 44pt target (LOOP-312). It still opens the same drawer, which
                // also pulls in from the right edge -- but a gesture nobody has
                // discovered yet still needs a control.
                <CoverIconButton
                  accessibilityLabel="Settings"
                  accessibilityState={{ expanded: menuOpen }}
                  onPress={() => setMenuOpen(true)}
                >
                  <LhlGearIcon size={20} color={colors.ink} />
                </CoverIconButton>
              }
            />

            {/* --- Identity block (289 wide in the frame) --- */}
            <View className="w-[289px] max-w-full items-center self-center">
              <Text
                numberOfLines={1}
                className="font-roboto-bold mt-[8px] text-[20px] leading-[23px] text-lhlInk"
              >
                {fullName || 'Your profile'}
              </Text>

              {/* Year + majors on one line, per the frame. This replaces the
                  icon-led ProfileMetaRow pair; V4 drops the Background row, so
                  unique_classification is no longer shown on the profile (it
                  is still editable in Edit Profile). */}
              {academicLine ? (
                <Text
                  numberOfLines={1}
                  className="font-roboto-medium mt-[8px] text-[12px] leading-[14px] text-lhlSecondaryTextGrey"
                >
                  {academicLine}
                </Text>
              ) : null}

              <ProfileCounts
                events={counts?.posted}
                followers={profile?.follower_count ?? 0}
                following={profile?.following_count ?? 0}
                onPressFollowers={() => setFollowSheet('followers')}
                onPressFollowing={() => setFollowSheet('following')}
              />

              {/* Edit Profile + linked socials, one 36pt row. The pill is the
                  Figma's 148 wide with an 8pt radius; OutlinedButton's hitSlop
                  takes every control in the row to 44. */}
              <View className="mt-[10px] flex-row items-center gap-[8px]">
                <OutlinedButton
                  accessibilityLabel="Edit profile"
                  onPress={() => router.push('/profile/edit')}
                  borderRadius={8}
                  width={148}
                  gap={6}
                >
                  <Text className="font-roboto-medium text-[14px] leading-[16px] text-lhlInk">
                    Edit Profile
                  </Text>
                  <PencilIcon width={12} height={12} color={colors.ink} />
                </OutlinedButton>

                {profile?.socials?.map((social) => {
                  const meta = getSocialPlatformUI(social.platform);
                  if (!meta) return null;
                  const Icon = meta.icon;
                  return (
                    <OutlinedButton
                      key={social.platform}
                      accessibilityRole="link"
                      accessibilityLabel={`Open ${meta.label}`}
                      // Routed through the Open Link warning (LOOP-182).
                      onPress={() => openLink.request(social.url)}
                      borderRadius={8}
                    >
                      <Icon size={20} color={colors.ink} />
                    </OutlinedButton>
                  );
                })}
              </View>

              <ProfileBio bio={profile?.bio} editable />
            </View>

            {/* --- Interests --- */}
            <View className="mt-[24px] px-[20px]">
              <InterestChips
                tags={profile?.tags ?? []}
                onAdd={() => router.push('/profile/edit')}
              />
            </View>

            {/* --- My Events: tab row, search, chips, grid ---
                Everything from here down is the same queries and state as
                before LOOP-312; only the chrome around them changed. */}
            <View className="mt-[24px] px-[20px]">
              <ProfileTabRow<ProfileEventTab>
                tabs={TABS.map((t) => ({ key: t.key, label: t.label, count: counts?.[t.key] }))}
                value={tab}
                onChange={setTab}
              />

              <View className="mt-[12px]">
                <TextInputField
                  value={searchInput}
                  onChangeText={setSearchInput}
                  placeholder="Search events..."
                  autoCapitalize="none"
                  autoCorrect={false}
                  borderRadius={8}
                  // 44 rather than the form default 33, as on Explore's search
                  // bar -- the whole field is the tap target.
                  height={44}
                  clearable
                  leftIcon={<LhlSearchIcon size={14} color={colors.inkSecondary} />}
                />
              </View>

              {/* Category chips + date sort, all 28pt drawn / 44pt touched */}
              <View className="mt-[12px] flex-row items-center justify-between">
                <View className="flex-row gap-[8px]">
                  {PROFILE_EVENT_FILTERS.map((key) => {
                    const isActive = key === filter;
                    return (
                      <Pressable
                        key={key}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isActive }}
                        onPress={() => setFilter(key)}
                        hitSlop={hitSlopFor(CHIP_HEIGHT)}
                        className={`justify-center rounded-full px-[10px] ${
                          isActive
                            ? 'bg-lhlBurntOrange'
                            : 'border border-lhlBorderSoft bg-lhlSurfaceGrey'
                        }`}
                        style={{ height: CHIP_HEIGHT }}
                      >
                        <Text
                          className={`font-roboto-medium text-[12px] ${
                            isActive ? 'text-white' : 'text-lhlInk'
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
                  hitSlop={hitSlopFor(CHIP_HEIGHT)}
                  className="flex-row items-center gap-[4px] rounded-full bg-lhlSegmentTrack px-[9px]"
                  style={{ height: CHIP_HEIGHT }}
                >
                  <SortGlyph color={colors.ink} />
                  <Text className="font-roboto-medium text-[12px] text-lhlInk">
                    {sortRecent ? 'Recent' : 'Date'}
                  </Text>
                </Pressable>
              </View>

              {/* Grid, or this tab's own empty state */}
              {eventsQuery.isLoading ? (
                <ActivityIndicator className="mt-[24px]" color={colors.brand} />
              ) : (
                <View className="mt-[12px] flex-row flex-wrap justify-between">
                  {(eventsQuery.data?.events ?? []).length === 0 ? (
                    search.trim() || filter !== 'all' ? (
                      <ProfileEmptyState
                        title="No events match that search."
                        body="Try a different word or category."
                      />
                    ) : (
                      <ProfileEmptyState
                        title={activeTab.emptyTitle}
                        body={activeTab.empty}
                        action={
                          tab !== 'posted'
                            ? {
                                label: 'Explore Events',
                                onPress: () => router.push('/(tabs)/home'),
                              }
                            : {
                                label: 'Create an Event',
                                onPress: () => router.push('/(tabs)/create'),
                              }
                        }
                      />
                    )
                  ) : (
                    eventsQuery.data?.events.map((event) => (
                      <ProfileEventCard
                        key={event.id}
                        event={event}
                        onToggleSave={(eventId) => toggleSave(eventId, !!event.is_saved)}
                        managing={managed?.id === event.id}
                        onManage={
                          tab === 'posted'
                            ? () => {
                                setManaged(event);
                                setSheetOpen(true);
                              }
                            : undefined
                        }
                      />
                    ))
                  )}
                </View>
              )}
            </View>
          </ScrollView>
        )}

        {profile ? (
          <FollowListSheet
            visible={followSheet !== null}
            onClose={() => setFollowSheet(null)}
            userId={profile.id}
            initialKind={followSheet ?? 'followers'}
            followerCount={profile.follower_count}
            followingCount={profile.following_count}
            token={token}
          />
        ) : null}

        <OpenLinkModal {...openLink.modalProps} />
        {/*
        Rohan's edit overlay, reached from the sheet's "Edit Event
        Details" row rather than from a second pencil on the card. Two entry
        points to the same editor is one too many, and the sheet is where a
        host already is when they want to change something.
      */}
        <EditEventOverlay
          visible={editingEvent !== null}
          event={editingEvent}
          orgId={editingEvent?.host_organization_id}
          token={token}
          onClose={() => setEditingEvent(null)}
        />

        <ManageEventSheet
          visible={sheetOpen}
          event={managed}
          onClose={closeAll}
          onViewEventPage={() => {
            const id = managed?.id;
            closeAll();
            if (id) router.push(`/event/${id}`);
          }}
          onEditDetails={() => {
            const event = managed;
            closeAll();
            // ApiEvent is a superset of EventEditSource, so the row the sheet was
            // opened for is already everything the overlay needs — no refetch.
            if (event) setEditingEvent(event);
          }}
          onPostAnnouncement={() => {
            setSheetOpen(false);
            setAnnouncing(true);
          }}
          onDeleteEvent={() => {
            setSheetOpen(false);
            setConfirmingDelete(true);
          }}
        />

        <ConfirmModal
          visible={confirmingDelete}
          title={`Delete \u201C${managed?.title ?? ''}\u201D?`}
          emphasis={`You\u2019re about to delete your event \u201C${managed?.title ?? ''}\u201D`}
          body={
            'This permanently removes the event from Longhorn Loop. Anyone who saved or ' +
            "RSVP'd will no longer see it, and users will be notified. This can't be undone."
          }
          secondaryLabel="Keep Event"
          primaryLabel="Delete Event"
          primaryDestructive
          emphasisFirst
          onSecondary={() => {
            // Back to the sheet, not out to the grid: backing out of a
            // confirmation should undo the confirmation, not the whole errand.
            setConfirmingDelete(false);
            setSheetOpen(true);
          }}
          onPrimary={() => deleteEvent.mutate()}
        />

        <PostAnnouncementModal
          visible={announcing}
          eventTitle={managed?.title ?? ''}
          submitting={postAnnouncement.isPending}
          onCancel={() => {
            setAnnouncing(false);
            setSheetOpen(true);
          }}
          onPost={(body, notify) => postAnnouncement.mutate({ body, notify })}
        />
      </View>
    </SettingsDrawer>
  );
}
