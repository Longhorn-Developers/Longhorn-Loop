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
import EditEventOverlay, { type EventEditSource } from '@/app/components/org/EditEventOverlay';
import { AvatarDisplay } from '@/app/components/profile/AvatarDisplay';
import ProfileBio from '@/app/components/profile/ProfileBio';
import ProfileEventCard from '@/app/components/profile/ProfileEventCard';
import ProfileMetaRow from '@/app/components/profile/ProfileMetaRow';
import { GlobeIcon, GraduationCapIcon } from '@/assets/icons/LhlProfileMetaIcons';
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
import SegmentBookmarkIcon from '@/assets/images/segment-bookmark.svg';
import SegmentCalendarIcon from '@/assets/images/segment-calendar.svg';
import SegmentCheckIcon from '@/assets/images/segment-check.svg';
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
import type { SvgProps } from 'react-native-svg';
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

// Icon sizes come straight from the Figma and differ on purpose: the
// checkmark is a solid glyph that reads heavy at 15, the outline bookmark and
// calendar read thin at 12. Matching optical weight, not box size.
const TABS: {
  key: ProfileEventTab;
  label: string;
  empty: string;
  Icon: React.FC<SvgProps>;
  iconSize: number;
}[] = [
  {
    key: 'going',
    label: 'Going',
    empty: 'Events you RSVP to will show up here',
    Icon: SegmentCheckIcon,
    iconSize: 12,
  },
  {
    key: 'saved',
    label: 'Saved',
    empty: 'Events you save will show up here',
    Icon: SegmentBookmarkIcon,
    iconSize: 15,
  },
  {
    key: 'posted',
    label: 'Posted',
    empty: 'Events you create will show up here',
    Icon: SegmentCalendarIcon,
    iconSize: 15,
  },
];

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
          refreshControl={
            <RefreshControl
              refreshing={pullRefreshing}
              onRefresh={onRefresh}
              tintColor={colors.brand}
              colors={[colors.brand]}
            />
          }
        >
          {/* --- Hamburger: org management + settings --- */}
          <View className="absolute right-[20px] top-[6px] z-20 items-end">
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

            {menuOpen ? (
              <View className="mt-[6px] w-[220px] overflow-hidden rounded-[10px] border border-lhlMutedBorder bg-lhlSurface">
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
                    <Text className="font-['Roboto-Flex'] text-[13px] text-lhlInk">
                      {item.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>

          {/* --- Header --- */}
          <View className="items-center px-[20px]">
            <View className="h-[92px] w-[92px] overflow-hidden rounded-full bg-lhlPlaceholderGrey">
              {profile ? <AvatarDisplay user={profile} size={92} /> : null}
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

            <ProfileBio bio={profile?.bio} editable />
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

            {/*
              Segmented control, Figma "Frame 482".

              One track with three segments inside it, not three separate
              pills. The old version was three bordered buttons with a gap
              between them, which reads as three independent toggles -- any
              number of which might be on. A single groove with one filled
              segment is the shape that says "pick exactly one of these".

              The selected segment is painted the PAGE colour rather than a
              lighter grey, so it reads as a hole punched through the groove.
              That is also why the whole row has no border: the groove itself
              is the boundary.

              Labels and icons stay full-strength ink on every segment, per the
              Figma. The fill is doing the work of showing which one is on, and
              dimming the other two as well would say it twice.
            */}
            <View className="mt-[10px] flex-row items-center gap-[4px] rounded-[16px] bg-lhlSegmentTrack p-[4px]">
              {TABS.map((t) => {
                const isActive = t.key === tab;
                const count = counts?.[t.key];
                return (
                  <Pressable
                    key={t.key}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: isActive }}
                    onPress={() => setTab(t.key)}
                    className={`flex-1 flex-row items-center justify-center gap-[6px] rounded-[16px] px-[16px] py-[4px] ${
                      isActive ? 'bg-lhlBackgroundColor' : ''
                    }`}
                  >
                    <t.Icon width={t.iconSize} height={t.iconSize} color={colors.ink} />
                    <Text className="font-['Roboto-Flex'] text-[12px] leading-[14px] text-lhlInk">
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
                value={searchInput}
                onChangeText={setSearchInput}
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
    </SafeAreaView>
  );
}
