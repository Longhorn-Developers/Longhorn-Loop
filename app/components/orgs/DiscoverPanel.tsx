// Orgs tab → Discover (LOOP-332).
//
// Figma: "Orgs - Discover Toggle" (10022:36190). Search, a category chip row,
// then three sections while browsing -- TRENDING THIS WEEK, BROWSE BY
// CATEGORY, ALL ORGS -- collapsing to just the results list once the user
// searches or picks a category, because a trending hero above a filtered list
// would be answering a question they didn't ask.
//
// Everything reads GET /orgs/search, the one org-directory endpoint:
//   * Trending: sort=trending&limit=1. The hero's "↗ +N this week" chip is the
//     response's followers_this_week, which is the very number the sort ranks
//     by (new with this ticket; absent on an older Worker, so the chip simply
//     doesn't render until it's deployed).
//   * All Orgs: the same paged list Explore's Orgs toggle uses, drawn with the
//     same card (explore/OrgResultRow), so an org looks identical in both.
//
// DEVIATIONS FROM THE FRAME, on purpose:
//   * The search placeholder says "Search orgs...", not "Search events or
//     orgs...". This field searches orgs only; events are Explore's job, and a
//     placeholder that promises events would be a lie on the first keystroke.
//   * Category tiles show no "12 orgs" count. The search endpoint returns pages,
//     not totals, and counting would mean walking every page of every
//     category on each visit.
//   * The chips are ORG_CATEGORIES (shared/orgRegistration.ts) -- the taxonomy
//     orgs are actually filed under -- not the frame's Tech / Arts / Social,
//     which no org row carries.
//   * The frame's filter-sheet button beside the search is left off: the
//     category chips ARE the filter here. Explore keeps the full sheet.

import TextInputField from '@/app/components/inputs/TextInputField';
import OrgResultRow, {
  followerLabel,
  type OrgSearchResult,
} from '@/app/components/explore/OrgResultRow';
import { Chip, OrgLogo, SectionHeading } from '@/app/components/orgs/OrgsUi';
import { api } from '@/app/lib/api';
import { org as orgKeys } from '@/app/lib/queryKeys';
import { useDebounced } from '@/app/lib/useDebounced';
import { useOrgFollow } from '@/app/lib/useOrgFollow';
import { useThemeColors } from '@/app/lib/themeColors';
import { TrendUpIcon } from '@/assets/icons/LhlOrgsIcons';
import LhlSearchIcon from '@/assets/icons/LhlSearchIcon';
import VerifiedIcon from '@/assets/images/verified.svg';
import { ORG_CATEGORIES, ORG_SEARCH_MIN_QUERY, type OrgCategory } from '@/shared/orgRegistration';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

const PAGE_SIZE = 20;

type DiscoverOrg = OrgSearchResult & {
  is_following?: boolean;
  followers_this_week?: number;
};

interface SearchResponse {
  organizations: DiscoverOrg[];
  nextCursor: string | null;
}

/** Display names for the category chips and tiles. */
const CATEGORY_LABEL: Record<OrgCategory, string> = {
  Professional: 'Professional',
  Sports: 'Sports',
  Cultural: 'Cultural',
  Academic: 'Academic',
  'Media / Publication': 'Media',
};

function TrendingCard({ org, token }: { org: DiscoverOrg; token: string | null }) {
  const router = useRouter();
  const colors = useThemeColors();
  const [following, setFollowing] = useState(!!org.is_following);
  const follow = useOrgFollow(org.id, token, {
    onSuccess: (r) => setFollowing(r.following),
  });
  const weekly = org.followers_this_week ?? 0;
  const followers = followerLabel(org.follower_count);

  // The Follow pill is a SIBLING of the card's Pressable, laid over it, not a
  // child: a button inside a button is invalid HTML on web (React warns, and
  // some browsers swallow the inner tap) and ambiguous to screen readers.
  return (
    <View className="overflow-hidden rounded-[10px] border border-lhlBorderSoft bg-lhlSurface">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${org.name}, trending this week`}
        onPress={() => router.push(`/org/${org.id}/profile`)}
      >
        {/* The frame's pale band is the org cover at low opacity, so it tracks
          the token into dark mode instead of being a second hard-coded pink. */}
        <View className="h-[64px] bg-lhlOrgCover/40" />
        <View className="px-[10px] pb-[12px]">
          <View className="mt-[-32px] flex-row items-end">
            <View className="rounded-[12px] border-[3px] border-lhlSurface">
              <OrgLogo name={org.name} uri={org.profile_picture} size={64} radius={10} />
            </View>
          </View>

          <View className="mt-[8px] flex-row items-center gap-[6px]">
            <Text numberOfLines={1} className="font-roboto-semibold shrink text-[16px] text-lhlInk">
              {org.name}
            </Text>
            {org.verified ? (
              <VerifiedIcon width={15} height={15} accessibilityLabel="Verified organization" />
            ) : null}
          </View>
          {org.bio?.trim() ? (
            <Text
              numberOfLines={2}
              className="font-roboto mt-[4px] text-[12px] leading-[17px] text-lhlInk"
            >
              {org.bio.trim()}
            </Text>
          ) : null}
          <View className="mt-[6px] flex-row items-center gap-[8px]">
            {followers ? (
              <Text className="font-roboto-medium text-[12px] text-lhlInk">{followers}</Text>
            ) : null}
            {weekly > 0 ? (
              <View className="flex-row items-center gap-[3px] rounded-full border-[0.5px] border-lhlBurntOrange bg-lhlBrandTint px-[6px] py-[2px]">
                <TrendUpIcon size={10} color={colors.accent} />
                <Text className="font-roboto-medium text-[10px] text-lhlAccent">
                  +{weekly.toLocaleString()} this week
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={following ? `Unfollow ${org.name}` : `Follow ${org.name}`}
        accessibilityState={{ selected: following, busy: follow.isPending }}
        disabled={follow.isPending}
        onPress={() => follow.mutate(!following)}
        className={`absolute right-[10px] top-[74px] h-[24px] items-center justify-center rounded-[6px] px-[12px] ${
          following ? 'border border-lhlDivider bg-lhlSurface' : 'bg-lhlBurntOrange'
        }`}
      >
        <Text
          className={`font-roboto-semibold text-[12px] ${
            following ? 'text-lhlSecondaryTextGrey' : 'text-white'
          }`}
        >
          {following ? 'Following' : 'Follow'}
        </Text>
      </Pressable>
    </View>
  );
}

function CategoryTile({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Browse ${label} orgs`}
      onPress={onPress}
      className="h-[44px] flex-1 flex-row items-center gap-[10px] rounded-[10px] border border-lhlBorderSoft bg-lhlSurface px-[10px]"
    >
      <View className="h-[28px] w-[28px] items-center justify-center rounded-full bg-lhlBrandTint">
        <Text className="font-roboto-bold text-[12px] text-lhlAccent">{label.charAt(0)}</Text>
      </View>
      <Text numberOfLines={1} className="font-roboto-medium shrink text-[14px] text-lhlInk">
        {label}
      </Text>
    </Pressable>
  );
}

export default function DiscoverPanel({ token }: { token: string | null }) {
  const colors = useThemeColors();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<OrgCategory | null>(null);
  const debounced = useDebounced(query.trim(), 300);
  const searching = debounced.length >= ORG_SEARCH_MIN_QUERY;
  const browsing = !searching && category === null;

  const trending = useQuery({
    queryKey: orgKeys.directory('orgs-tab:trending'),
    queryFn: () => api.get<SearchResponse>('/orgs/search?sort=trending&limit=1', { token }),
    enabled: !!token && browsing,
  });

  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  // Searching sorts A–Z, whose match tier comes first (LOOP-293): the org
  // literally called what you typed beats a longer name containing it.
  params.set('sort', searching ? 'az' : 'trending');
  if (searching) params.set('q', debounced);
  if (category) params.set('category', category);
  const request = params.toString();

  const list = useInfiniteQuery({
    // Prefixed so this never shares an entry with Explore's directory query,
    // whose request strings are built differently (see orgKeys.directory).
    queryKey: orgKeys.directory(`orgs-tab:${request}`),
    queryFn: ({ pageParam }) =>
      api.get<SearchResponse>(
        `/orgs/search?${request}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        { token },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!token,
  });
  const orgs = list.data?.pages.flatMap((p) => p.organizations) ?? [];
  const hero = trending.data?.organizations[0];

  const pairs: OrgCategory[][] = [];
  for (let i = 0; i < ORG_CATEGORIES.length; i += 2) pairs.push(ORG_CATEGORIES.slice(i, i + 2));

  return (
    <View className="gap-[20px] pt-[16px]">
      <View className="gap-[12px]">
        <View className="px-[20px]">
          <TextInputField
            value={query}
            onChangeText={setQuery}
            placeholder="Search orgs..."
            autoCapitalize="none"
            autoCorrect={false}
            borderRadius={8}
            clearable
            leftIcon={<LhlSearchIcon size={16} color={colors.ink} />}
          />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}
        >
          <Chip
            tone="brand"
            label="All Orgs"
            selected={category === null}
            onPress={() => setCategory(null)}
          />
          {ORG_CATEGORIES.map((c) => (
            <Chip
              key={c}
              tone="brand"
              label={CATEGORY_LABEL[c]}
              selected={category === c}
              onPress={() => setCategory(category === c ? null : c)}
            />
          ))}
        </ScrollView>
      </View>

      {browsing && hero ? (
        <View className="gap-[10px] px-[20px]">
          <SectionHeading eyebrow="Right Now on Campus" title="Trending This Week" />
          <TrendingCard org={hero} token={token} />
        </View>
      ) : null}

      {browsing ? (
        <View className="gap-[10px] px-[20px]">
          <SectionHeading eyebrow="Find Your Thing" title="Browse by Category" />
          <View className="gap-[8px]">
            {pairs.map((pair) => (
              <View key={pair.join()} className="flex-row gap-[8px]">
                {pair.map((c) => (
                  <CategoryTile key={c} label={CATEGORY_LABEL[c]} onPress={() => setCategory(c)} />
                ))}
                {/* Odd count: a spacer keeps the last tile half-width. */}
                {pair.length === 1 ? <View className="flex-1" /> : null}
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View className="gap-[12px] px-[20px]">
        <SectionHeading
          eyebrow={browsing ? 'Everything On Campus' : undefined}
          title={searching ? 'Results' : category ? `${CATEGORY_LABEL[category]} Orgs` : 'All Orgs'}
        />
        {list.isLoading ? (
          <ActivityIndicator className="mt-[12px]" color={colors.brand} />
        ) : list.isError ? (
          <Pressable accessibilityRole="button" onPress={() => list.refetch()}>
            <Text className="font-roboto text-[13px] text-lhlSecondaryTextGrey">
              Couldn’t load organizations. Tap to try again.
            </Text>
          </Pressable>
        ) : orgs.length === 0 ? (
          <Text className="font-roboto text-[13px] text-lhlSecondaryTextGrey">
            {searching ? `No orgs match “${debounced}”.` : 'No orgs here yet.'}
          </Text>
        ) : (
          <View className="gap-[12px]">
            {orgs.map((o) => (
              <OrgResultRow key={o.id} org={o} />
            ))}
            {list.hasNextPage ? (
              <Pressable
                accessibilityRole="button"
                disabled={list.isFetchingNextPage}
                onPress={() => list.fetchNextPage()}
                className="h-[36px] items-center justify-center rounded-[8px] border border-lhlDivider bg-lhlSurface"
              >
                {list.isFetchingNextPage ? (
                  <ActivityIndicator color={colors.brand} />
                ) : (
                  <Text className="font-roboto-semibold text-[12px] text-lhlSecondaryTextGrey">
                    Show more
                  </Text>
                )}
              </Pressable>
            ) : null}
          </View>
        )}
      </View>
    </View>
  );
}
