// Followers / Following sheet (LOOP-312 design, LOOP-307 data; Figma
// "Followers Tab" and "Following Tab", 402 x 657).
//
// Opened from the Followers / Following counts on any profile -- yours,
// another person's, or an org's (Followers only: an org's "following" is
// other orgs, which isn't a list anyone has asked for). It is a bottom SHEET
// over the profile, not a tab in the profile's own tab row: that is what the
// frames draw, and it is also why opening it cannot shift the header.
//
// DATA. Server lists from app/lib/followList.ts: keyset pages, loaded as the
// list scrolls (FlatList onEndReached), and a name search that runs on the
// SERVER after a 300ms pause, so it finds people past the first page. Who may
// open a list, and the block filter, are the server's (see
// server/src/lib/followLists.ts).
//
// The sheet reuses DragDismissSheet with dragFrom="header": the list scrolls,
// and a pan over the whole surface would fight it for every vertical gesture
// (the same call ExploreFilterSheet made, for the same reason).

import TextInputField from '@/app/components/inputs/TextInputField';
import DragDismissSheet from '@/app/components/modals/DragDismissSheet';
import { AvatarDisplay, hasAvatar } from '@/app/components/profile/AvatarDisplay';
import ProfileTabRow from '@/app/components/profile/ProfileTabRow';
import {
  fetchFollowList,
  toggleFollow,
  type FollowListEntry,
  type FollowListKind,
  type FollowListSubject,
} from '@/app/lib/followList';
import { org as orgKeys, user as userKeys } from '@/app/lib/queryKeys';
import { hitSlopFor } from '@/app/lib/tapTarget';
import { useThemeColors } from '@/app/lib/themeColors';
import LhlSearchIcon from '@/assets/icons/LhlSearchIcon';
import SegmentCheckIcon from '@/assets/images/segment-check.svg';
import VerifiedIcon from '@/assets/images/verified.svg';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

/** Figma panel height. Capped to the window on short phones. */
const SHEET_HEIGHT = 657;
const AVATAR = 44;
const ROW_BUTTON_HEIGHT = 30;
const ROW_BUTTON_WIDTH = 94;
const SEARCH_DEBOUNCE_MS = 300;

const rowKey = (e: Pick<FollowListEntry, 'kind' | 'id'>) => `${e.kind}:${e.id}`;

export interface FollowListSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Whose lists these are. */
  subject: FollowListSubject;
  /** Which list the sheet opens on. Ignored for an org, which only has Followers. */
  initialKind: FollowListKind;
  followerCount: number;
  /** Omit for an org. */
  followingCount?: number;
  /** True on your own profile, the one place "Follow Back" is the right label. */
  ownProfile?: boolean;
  token: string | null;
}

export default function FollowListSheet({
  visible,
  onClose,
  subject,
  initialKind,
  followerCount,
  followingCount,
  ownProfile = false,
  token,
}: FollowListSheetProps) {
  const colors = useThemeColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { height: windowHeight } = useWindowDimensions();

  const isOrg = subject.type === 'org';
  const [kind, setKind] = useState<FollowListKind>(isOrg ? 'followers' : initialKind);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  /**
   * Follow state changed in this sheet, keyed by rowKey. The optimistic value
   * while a request is in flight; dropped again if it fails.
   */
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  // Re-aim the sheet each time it opens: tapping Following should land on
  // Following even if Followers was the last tab looked at. Done on the
  // closed -> open transition during render, not in an effect, so the first
  // frame of the sheet already shows the right tab.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setKind(isOrg ? 'followers' : initialKind);
      setSearchInput('');
      setSearch('');
      setOverrides({});
    }
  }

  // The search runs on the server, so wait for typing to pause rather than
  // firing a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  const queryKey = isOrg
    ? orgKeys.followers(subject.id, search)
    : userKeys.followList(subject.id, kind, search);

  const list = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) =>
      fetchFollowList(subject, kind, { cursor: pageParam, q: search, token }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: visible && Number.isFinite(subject.id) && !!token,
  });

  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.entries) ?? [], [list.data]);

  const follow = useMutation({
    mutationFn: ({ entry, next }: { entry: FollowListEntry; next: boolean }) =>
      toggleFollow(entry, next, token),
    onError: (_err, { entry }) => {
      setOverrides(({ [rowKey(entry)]: _dropped, ...rest }) => rest);
    },
    onSettled: (_data, _err, { entry }) => {
      // The viewer's own Following list and count moved, and so did the
      // follower count on whoever was tapped.
      queryClient.invalidateQueries({ queryKey: userKeys.all });
      if (entry.kind === 'org') {
        queryClient.invalidateQueries({ queryKey: orgKeys.publicProfile(entry.id) });
        queryClient.invalidateQueries({ queryKey: orgKeys.followersAll(entry.id) });
      }
    },
  });

  const toggle = (entry: FollowListEntry) => {
    const next = !(overrides[rowKey(entry)] ?? entry.is_following);
    setOverrides((prev) => ({ ...prev, [rowKey(entry)]: next }));
    follow.mutate({ entry, next });
  };

  const open = (entry: FollowListEntry) => {
    onClose();
    if (entry.kind === 'org') router.push(`/org/${entry.id}/profile`);
    else if (entry.is_self) router.push('/(tabs)/profile');
    else router.push(`/user/${entry.id}`);
  };

  const header = (
    <View className="px-[20px] pt-[14px]">
      <ProfileTabRow<FollowListKind>
        tabs={
          isOrg
            ? [{ key: 'followers', label: 'Followers', count: followerCount }]
            : [
                { key: 'followers', label: 'Followers', count: followerCount },
                { key: 'following', label: 'Following', count: followingCount },
              ]
        }
        value={kind}
        onChange={(next) => {
          setKind(next);
          setSearchInput('');
          setSearch('');
        }}
      />
      <View className="mt-[19px]">
        <TextInputField
          value={searchInput}
          onChangeText={setSearchInput}
          placeholder={kind === 'followers' ? 'Search followers...' : 'Search following...'}
          autoCapitalize="none"
          autoCorrect={false}
          borderRadius={8}
          height={44}
          clearable
          leftIcon={<LhlSearchIcon size={14} color={colors.inkSecondary} />}
        />
      </View>
    </View>
  );

  const empty = list.isLoading ? (
    <ActivityIndicator className="mt-[24px]" color={colors.brand} />
  ) : list.isError ? (
    <Pressable accessibilityRole="button" onPress={() => list.refetch()} className="mt-[24px]">
      <Text className="font-roboto text-center text-[14px] leading-[18px] text-lhlSecondaryTextGrey">
        Couldn’t load this list. Tap to try again.
      </Text>
    </Pressable>
  ) : (
    <Text className="font-roboto mt-[24px] text-center text-[14px] leading-[18px] text-lhlSecondaryTextGrey">
      {search
        ? 'No one matches that search.'
        : kind === 'followers'
          ? 'No followers yet.'
          : 'Not following anyone yet.'}
    </Text>
  );

  return (
    <DragDismissSheet
      visible={visible}
      onClose={onClose}
      dragFrom="header"
      header={header}
      sheetStyle={{ height: Math.min(SHEET_HEIGHT, windowHeight * 0.85) }}
    >
      <FlatList
        style={{ flex: 1 }}
        data={rows}
        keyExtractor={rowKey}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={empty}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage();
        }}
        ListFooterComponent={
          list.isFetchingNextPage ? (
            <ActivityIndicator className="mt-[12px]" color={colors.brand} />
          ) : undefined
        }
        renderItem={({ item, index }) => (
          <FollowRow
            entry={item}
            followBack={ownProfile && kind === 'followers'}
            isFollowing={overrides[rowKey(item)] ?? item.is_following}
            last={index === rows.length - 1}
            onToggle={() => toggle(item)}
            onOpen={() => open(item)}
          />
        )}
      />
    </DragDismissSheet>
  );
}

function FollowRow({
  entry,
  followBack,
  isFollowing,
  last,
  onToggle,
  onOpen,
}: {
  entry: FollowListEntry;
  /** Your own Followers list: they follow you, so "Follow Back". */
  followBack: boolean;
  isFollowing: boolean;
  last: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const colors = useThemeColors();
  const isOrg = entry.kind === 'org';
  const name = isOrg ? entry.name : `${entry.first_name} ${entry.last_name}`.trim();
  const initials = isOrg
    ? (entry.name[0] ?? '').toUpperCase()
    : `${entry.first_name[0] ?? ''}${entry.last_name[0] ?? ''}`.toUpperCase();
  const subtitle = isOrg
    ? entry.category
    : [entry.year_classification, ...entry.majors].filter(Boolean).join(' · ');
  const isSelf = !isOrg && entry.is_self;

  return (
    <View
      className={`flex-row items-center justify-between py-[12px] ${
        last ? '' : 'border-b-[0.6px] border-lhlBorderSoft'
      }`}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isOrg ? `Open ${name}` : `Open ${name}'s profile`}
        onPress={onOpen}
        className="flex-1 flex-row items-center gap-[9px] pr-[10px]"
        style={{ minHeight: AVATAR }}
      >
        <View
          className="items-center justify-center overflow-hidden rounded-full bg-lhlPlaceholderGrey"
          style={{ width: AVATAR, height: AVATAR }}
        >
          {isOrg && entry.profile_picture ? (
            <Image
              source={{ uri: entry.profile_picture }}
              style={{ width: AVATAR, height: AVATAR }}
            />
          ) : !isOrg && hasAvatar(entry) ? (
            <AvatarDisplay user={entry} size={AVATAR} />
          ) : (
            <Text className="font-roboto-bold text-[16px] text-lhlSecondaryTextGrey">
              {initials}
            </Text>
          )}
        </View>
        <View className="flex-1">
          <View className="flex-row items-center gap-[4px]">
            <Text
              numberOfLines={1}
              className="font-roboto-semibold shrink text-[12px] leading-[19px] text-lhlInk"
            >
              {name}
            </Text>
            {isOrg && entry.verified ? (
              <VerifiedIcon width={12} height={12} accessibilityLabel="Verified organization" />
            ) : null}
          </View>
          {subtitle ? (
            <Text numberOfLines={1} className="font-roboto text-[12px] leading-[19px] text-lhlInk">
              {subtitle}
            </Text>
          ) : null}
        </View>
      </Pressable>

      {/* No button on your own row: following yourself isn't a thing. */}
      {isSelf ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isFollowing ? `Unfollow ${name}` : `Follow ${name}`}
          accessibilityState={{ selected: isFollowing }}
          onPress={onToggle}
          hitSlop={hitSlopFor(ROW_BUTTON_HEIGHT)}
          // Following: the tinted brand pill with a tick. Not following: the
          // outlined neutral pill -- "Follow Back" on YOUR Followers list,
          // where they already follow you, plain "Follow" everywhere else
          // (on someone else's list they follow that person, not you).
          className={`flex-row items-center justify-center gap-[6px] rounded-[8px] px-[8px] ${
            isFollowing ? 'bg-lhlBrandSoft' : 'border border-lhlDivider bg-lhlSurface'
          }`}
          style={{ height: ROW_BUTTON_HEIGHT, minWidth: ROW_BUTTON_WIDTH }}
        >
          {isFollowing ? <SegmentCheckIcon width={14} height={14} color={colors.accent} /> : null}
          <Text
            className={`font-roboto-semibold text-[12px] ${
              isFollowing ? 'text-lhlAccent' : 'text-lhlSecondaryTextGrey'
            }`}
          >
            {isFollowing ? 'Following' : followBack && !isOrg ? 'Follow Back' : 'Follow'}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
