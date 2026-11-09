// Followers / Following sheet (LOOP-312 step 4, Figma "Followers Tab" and
// "Following Tab", 402 x 657).
//
// Opened from the Followers and Following counts on your own profile. It is a
// bottom SHEET over the profile, not a tab in the profile's own tab row --
// that is what the frames draw (grabber, 14pt top corners, profile dimmed
// behind) and it is also why switching to it cannot shift the header: the
// header never re-renders.
//
// DATA COMES FROM A STUB until LOOP-307 ships an endpoint. See
// app/lib/followList.ts for the seam and for why follow taps stay local while
// FOLLOW_LIST_IS_STUB is true.
//
// The sheet reuses DragDismissSheet with dragFrom="header": the list scrolls,
// and a pan over the whole surface would fight it for every vertical gesture
// (the same call ExploreFilterSheet made, for the same reason).

import TextInputField from '@/app/components/inputs/TextInputField';
import DragDismissSheet from '@/app/components/modals/DragDismissSheet';
import { AvatarDisplay, hasAvatar } from '@/app/components/profile/AvatarDisplay';
import ProfileTabRow from '@/app/components/profile/ProfileTabRow';
import { api } from '@/app/lib/api';
import {
  FOLLOW_LIST_IS_STUB,
  fetchFollowList,
  type FollowListEntry,
  type FollowListKind,
} from '@/app/lib/followList';
import { user as userKeys } from '@/app/lib/queryKeys';
import { hitSlopFor } from '@/app/lib/tapTarget';
import { useThemeColors } from '@/app/lib/themeColors';
import LhlSearchIcon from '@/assets/icons/LhlSearchIcon';
import SegmentCheckIcon from '@/assets/images/segment-check.svg';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

/** Figma panel height. Capped to the window on short phones. */
const SHEET_HEIGHT = 657;
const AVATAR = 44;
const ROW_BUTTON_HEIGHT = 30;
const ROW_BUTTON_WIDTH = 94;

export interface FollowListSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Whose lists these are. */
  userId: number;
  /** Which list the sheet opens on. */
  initialKind: FollowListKind;
  followerCount: number;
  followingCount: number;
  token: string | null;
}

export default function FollowListSheet({
  visible,
  onClose,
  userId,
  initialKind,
  followerCount,
  followingCount,
  token,
}: FollowListSheetProps) {
  const colors = useThemeColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { height: windowHeight } = useWindowDimensions();

  const [kind, setKind] = useState<FollowListKind>(initialKind);
  const [search, setSearch] = useState('');
  /**
   * Follow state the user has changed in this sheet, keyed by row id. Used
   * for every tap while the list is a stub (nothing may reach the server --
   * see app/lib/followList.ts), and as the optimistic value while a real
   * request is in flight once it isn't.
   */
  const [overrides, setOverrides] = useState<Record<number, boolean>>({});

  // Re-aim the sheet each time it opens: tapping Following should land on
  // Following even if Followers was the last tab looked at. Done on the
  // closed -> open transition during render, not in an effect, so the first
  // frame of the sheet already shows the right tab.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setKind(initialKind);
      setSearch('');
    }
  }

  const list = useQuery({
    queryKey: userKeys.followList(userId, kind),
    queryFn: () => fetchFollowList(userId, kind, token),
    enabled: visible && Number.isFinite(userId),
  });

  const follow = useMutation({
    mutationFn: ({ id, next }: { id: number; next: boolean }) =>
      next
        ? api.post(`/users/${id}/follow`, { token })
        : api.delete(`/users/${id}/follow`, { token }),
    onSettled: (_data, error, { id }) => {
      if (error) {
        setOverrides(({ [id]: _dropped, ...rest }) => rest);
      }
      // Counts on the profile header and both lists can move.
      queryClient.invalidateQueries({ queryKey: userKeys.followListAll(userId) });
      queryClient.invalidateQueries({ queryKey: userKeys.me() });
    },
  });

  const toggle = (entry: FollowListEntry) => {
    const next = !(overrides[entry.id] ?? entry.is_following);
    setOverrides((prev) => ({ ...prev, [entry.id]: next }));
    if (!FOLLOW_LIST_IS_STUB) follow.mutate({ id: entry.id, next });
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = list.data ?? [];
    if (!q) return all;
    return all.filter((r) => `${r.first_name} ${r.last_name}`.toLowerCase().includes(q));
  }, [list.data, search]);

  const header = (
    <View className="px-[20px] pt-[14px]">
      <ProfileTabRow<FollowListKind>
        tabs={[
          { key: 'followers', label: 'Followers', count: followerCount },
          { key: 'following', label: 'Following', count: followingCount },
        ]}
        value={kind}
        onChange={(next) => {
          setKind(next);
          setSearch('');
        }}
      />
      <View className="mt-[19px]">
        <TextInputField
          value={search}
          onChangeText={setSearch}
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

  return (
    <DragDismissSheet
      visible={visible}
      onClose={onClose}
      dragFrom="header"
      header={header}
      sheetStyle={{ height: Math.min(SHEET_HEIGHT, windowHeight * 0.85) }}
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        {list.isLoading ? (
          <ActivityIndicator className="mt-[24px]" color={colors.brand} />
        ) : rows.length === 0 ? (
          <Text className="font-roboto mt-[24px] text-center text-[14px] leading-[18px] text-lhlSecondaryTextGrey">
            {search.trim()
              ? 'No one matches that search.'
              : FOLLOW_LIST_IS_STUB
                ? // Release builds land here until LOOP-307: say so plainly
                  // rather than claiming nobody follows them.
                  'Follower lists are coming soon.'
                : kind === 'followers'
                  ? 'No followers yet.'
                  : 'Not following anyone yet.'}
          </Text>
        ) : (
          rows.map((entry, i) => (
            <FollowRow
              key={entry.id}
              entry={entry}
              kind={kind}
              isFollowing={overrides[entry.id] ?? entry.is_following}
              last={i === rows.length - 1}
              onToggle={() => toggle(entry)}
              onOpen={
                // Sample rows have no profile to open.
                FOLLOW_LIST_IS_STUB
                  ? undefined
                  : () => {
                      onClose();
                      router.push(`/user/${entry.id}`);
                    }
              }
            />
          ))
        )}
      </ScrollView>
    </DragDismissSheet>
  );
}

function FollowRow({
  entry,
  kind,
  isFollowing,
  last,
  onToggle,
  onOpen,
}: {
  entry: FollowListEntry;
  kind: FollowListKind;
  isFollowing: boolean;
  last: boolean;
  onToggle: () => void;
  onOpen?: () => void;
}) {
  const colors = useThemeColors();
  const name = `${entry.first_name} ${entry.last_name}`.trim();
  const initials = `${entry.first_name[0] ?? ''}${entry.last_name[0] ?? ''}`.toUpperCase();
  const subtitle = [entry.year_classification, ...entry.majors].filter(Boolean).join(' · ');

  return (
    <View
      className={`flex-row items-center justify-between py-[12px] ${
        last ? '' : 'border-b-[0.6px] border-lhlBorderSoft'
      }`}
    >
      <Pressable
        accessibilityRole={onOpen ? 'button' : undefined}
        accessibilityLabel={onOpen ? `Open ${name}'s profile` : name}
        disabled={!onOpen}
        onPress={onOpen}
        className="flex-1 flex-row items-center gap-[9px] pr-[10px]"
        style={{ minHeight: AVATAR }}
      >
        <View
          className="items-center justify-center overflow-hidden rounded-full bg-lhlPlaceholderGrey"
          style={{ width: AVATAR, height: AVATAR }}
        >
          {hasAvatar(entry) ? (
            <AvatarDisplay user={entry} size={AVATAR} />
          ) : (
            <Text className="font-roboto-bold text-[16px] text-lhlSecondaryTextGrey">
              {initials}
            </Text>
          )}
        </View>
        <View className="flex-1">
          <Text
            numberOfLines={1}
            className="font-roboto-semibold text-[12px] leading-[19px] text-lhlInk"
          >
            {name}
          </Text>
          {subtitle ? (
            <Text numberOfLines={1} className="font-roboto text-[12px] leading-[19px] text-lhlInk">
              {subtitle}
            </Text>
          ) : null}
        </View>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isFollowing ? `Unfollow ${name}` : `Follow ${name}`}
        accessibilityState={{ selected: isFollowing }}
        onPress={onToggle}
        hitSlop={hitSlopFor(ROW_BUTTON_HEIGHT)}
        // Following: the tinted brand pill with a tick. Not following: the
        // outlined neutral pill -- "Follow Back" on your followers list, where
        // the relationship is already half there, plain "Follow" otherwise.
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
          {isFollowing ? 'Following' : kind === 'followers' ? 'Follow Back' : 'Follow'}
        </Text>
      </Pressable>
    </View>
  );
}
