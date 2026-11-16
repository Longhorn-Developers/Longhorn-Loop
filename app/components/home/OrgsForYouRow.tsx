// Home's "Orgs For You": a sideways row of org cards, each with its own Follow
// button, so following one is a single tap without leaving Home.
//
// WHERE THE ORGS COME FROM. There is no recommender: this is GET /orgs/search
// sorted by `trending` (most new followers in the last 7 days). That is "popular
// right now", not "matched to your interests" — the row is titled "for you"
// ahead of the data being able to back that up. When an interest-based source
// exists, only `queryFn` below changes.
//
// FOLLOW STATE. /orgs/search returns `is_following` for the signed-in viewer,
// so a card starts as "Following" for an org they already follow. A Worker
// that predates that field leaves it undefined, which reads as "Follow".
//
// A TOGGLE, OPTIMISTIC, AND KEPT IN THE QUERY CACHE. Tapping Follow follows;
// tapping Following unfollows. This was follow-only at first (a second tap was
// a no-op), but people expect the button to work both ways, and having to go
// to the org's profile page to undo a mis-tap was the complaint.
//
// The new state is written into this row's cached search response, not into
// component state. Component state reset whenever the card was recycled or Home
// remounted, so a followed org could flip back to "Follow" on its own. The
// cache survives both, and the server's `is_following` takes over on the next
// refetch. The follower count moves with it. If a write fails, the card goes
// back to its previous state. A followed card stays in the row until the next
// refetch rather than vanishing under the user's thumb.

import { HEADER_GAP, SECTION_GAP } from '@/app/components/home/layout';
import SectionHeader from '@/app/components/home/SectionHeader';
import { api } from '@/app/lib/api';
import { org as orgKeys } from '@/app/lib/queryKeys';
import { useThemeColors, type ThemeColors } from '@/app/lib/themeColors';
import { useOrgFollow } from '@/app/lib/useOrgFollow';
import FollowersIcon from '@/assets/images/followers.svg';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';

interface OrgForYou {
  id: number;
  name: string;
  profile_picture: string | null;
  category: string | null;
  follower_count: number;
  /** The viewer follows this org. Absent from older Workers. */
  is_following?: boolean;
}

interface OrgsForYouResponse {
  organizations: OrgForYou[];
}

const ROW_SIZE = 10;

/** 1234 -> "1.2k"; small numbers are shown as they are. */
function formatCount(n: number): string {
  if (n < 1000) return String(n);
  const k = Math.round(n / 100) / 10;
  return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
}

function OrgCard({ org, token }: { org: OrgForYou; token: string | null }) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const queryClient = useQueryClient();

  // Read from the cached row (see the header), so it survives remounts.
  const following = org.is_following ?? false;

  // Writes this org's follow state, and the matching follower count, into the
  // cached row. Used for the optimistic flip and to undo it on failure.
  const setCachedFollowing = (next: boolean) => {
    queryClient.setQueryData<OrgsForYouResponse>(orgKeys.forYou(), (old) =>
      old
        ? {
            ...old,
            organizations: old.organizations.map((o) =>
              o.id === org.id && (o.is_following ?? false) !== next
                ? {
                    ...o,
                    is_following: next,
                    follower_count: Math.max(0, o.follower_count + (next ? 1 : -1)),
                  }
                : o,
            ),
          }
        : old,
    );
  };

  const follow = useOrgFollow(org.id, token);

  // Most orgs have no category (every scraped row), so the line is often just
  // the follower count.
  const meta = org.category ?? '';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View ${org.name}`}
      onPress={() => router.push(`/org/${org.id}/profile`)}
      style={styles.card}
    >
      {org.profile_picture ? (
        <Image source={{ uri: org.profile_picture }} style={styles.logo} />
      ) : (
        <View style={[styles.logo, styles.logoFallback]}>
          {/* theme-exempt: initial sits on the brand-coloured fill */}
          <Text style={{ color: '#fff', fontSize: 22, fontWeight: '700' }}>
            {org.name[0]?.toUpperCase() ?? '?'}
          </Text>
        </View>
      )}

      {/* Two lines reserved even for a short name, so the Follow buttons line up
          across cards of different name lengths. */}
      <Text style={styles.name} numberOfLines={2}>
        {org.name}
      </Text>

      <View style={styles.meta}>
        {meta ? (
          <Text style={styles.metaText} numberOfLines={1}>
            {meta} ·
          </Text>
        ) : null}
        <FollowersIcon width={13} height={13} color={colors.inkMuted} />
        <Text style={styles.metaText}>{formatCount(org.follower_count)}</Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={following ? `Unfollow ${org.name}` : `Follow ${org.name}`}
        accessibilityState={{ selected: following, disabled: follow.isPending }}
        // Disabled while a write is in flight so a quick double tap can't send
        // follow and unfollow out of order.
        disabled={follow.isPending}
        onPress={() => {
          const next = !following;
          setCachedFollowing(next);
          // Per-call callbacks, not the hook's options: by the time either
          // runs, `following` has already re-rendered as `next`, so the undo
          // has to come from this tap's own value.
          follow.mutate(next, {
            // Settle on what the server says it did (normally `next` already).
            onSuccess: ({ following: confirmed }) => setCachedFollowing(confirmed),
            onError: () => setCachedFollowing(!next),
          });
        }}
        // Soft brand fill while unfollowed, outline once followed.
        style={[styles.followButton, following ? styles.followButtonActive : null]}
      >
        <Text style={[styles.followText, following ? { color: colors.ink } : null]}>
          {following ? 'Following' : 'Follow'}
        </Text>
      </Pressable>
    </Pressable>
  );
}

export default function OrgsForYouRow({ token }: { token: string | null }) {
  const router = useRouter();

  const orgsQuery = useQuery({
    queryKey: orgKeys.forYou(),
    queryFn: () =>
      api.get<OrgsForYouResponse>(`/orgs/search?sort=trending&limit=${ROW_SIZE}`, { token }),
    // The endpoint is auth-gated.
    enabled: !!token,
    staleTime: 60_000,
  });

  const orgs = orgsQuery.data?.organizations ?? [];
  // Nothing to offer, still loading, or the request failed: no row at all. A
  // recommendation row that shows an error or a skeleton is worse than the page
  // simply being one section shorter.
  if (orgs.length === 0) return null;

  return (
    <View style={{ marginBottom: SECTION_GAP }}>
      <SectionHeader
        eyebrow="You Might Like"
        title="Orgs For You"
        // Explore's Orgs view is the full directory; `view=orgs` opens it there
        // rather than on the events feed.
        onViewAll={() => router.push({ pathname: '/(tabs)/explore', params: { view: 'orgs' } })}
        style={{ paddingHorizontal: 20, marginBottom: HEADER_GAP }}
      />
      <FlatList
        data={orgs}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
        keyExtractor={(o) => String(o.id)}
        renderItem={({ item }) => <OrgCard org={item} token={token} />}
      />
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    card: {
      width: 116,
      alignItems: 'center',
      backgroundColor: c.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.borderSoft,
      paddingHorizontal: 10,
      paddingTop: 14,
      paddingBottom: 12,
    },
    logo: {
      width: 64,
      height: 64,
      borderRadius: 32,
    },
    logoFallback: {
      backgroundColor: c.brand,
      alignItems: 'center',
      justifyContent: 'center',
    },
    name: {
      fontFamily: 'Roboto-Flex-SemiBold',
      fontSize: 14,
      lineHeight: 18,
      color: c.ink,
      textAlign: 'center',
      marginTop: 10,
      minHeight: 36,
    },
    meta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 3,
      marginTop: 6,
      marginBottom: 10,
    },
    metaText: {
      fontFamily: 'Roboto-Flex',
      fontSize: 13,
      color: c.inkMuted,
      flexShrink: 1,
    },
    followButton: {
      alignSelf: 'stretch',
      alignItems: 'center',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.brandSoft,
      backgroundColor: c.brandSoft,
      paddingVertical: 7,
    },
    followButtonActive: {
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    followText: {
      fontFamily: 'Roboto-Flex-SemiBold',
      fontSize: 14,
      color: c.brand,
    },
  });
