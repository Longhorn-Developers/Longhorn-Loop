// Orgs tab → My Orgs (LOOP-331).
//
// Figma: "Orgs - My Orgs Toggle" (10087:45065). Top to bottom:
//
//   1. Up next  -- the soonest upcoming event across the user's orgs.
//   2. NEEDS YOU -- NOT BUILT. Dues and join requests have no backend
//      (LOOP-340, LOOP-336), and a section of fake to-dos is worse than none.
//   3. YOUR ORGS -- All / Joined / Following.
//   4. UPCOMING -- events from those orgs.
//
// WHERE THE DATA COMES FROM
//   Joined    GET /orgs/mine       the management team (admin | editor) --
//                                  there is no regular-member role yet.
//   Following GET /orgs/following  new with this ticket. Until the Worker is
//                                  redeployed the deployed API 404s it, so an
//                                  error reads as "follows nothing" rather than
//                                  blanking the whole tab.
//   Upcoming  GET /orgs/:id/profile/events?tab=upcoming, one per org, capped
//             at UPCOMING_ORG_CAP. There is no cross-org events endpoint, and
//             the per-org one is what the org page already reads, so the two
//             screens share cache entries (org.publicEvents). The cap keeps a
//             user who follows forty orgs from firing forty requests; members'
//             orgs are taken first because they are the ones you show up to.
//
// The Up next card's buttons are "View event" and "Directions". The frame's
// "Check in" and "Room changed" chip need attendance and location history
// (LOOP-340); its "12 min walk from GDC" needs a home building nobody has set.

import type { ApiEvent } from '@/app/components/EventCard';
import {
  Chip,
  OrgLogo,
  RowCard,
  SectionHeading,
  UpcomingEventRow,
} from '@/app/components/orgs/OrgsUi';
import { api } from '@/app/lib/api';
import { org as orgKeys } from '@/app/lib/queryKeys';
import { useGoingEventIds } from '@/app/lib/useGoingEventIds';
import { useThemeColors } from '@/app/lib/themeColors';
import { ChevronRightIcon } from '@/assets/icons/LhlOrgsIcons';
import LocationIcon from '@/assets/images/location.svg';
import VerifiedIcon from '@/assets/images/verified.svg';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, Text, View } from 'react-native';

/** Most orgs whose upcoming events are fetched for the Upcoming list. */
const UPCOMING_ORG_CAP = 8;
/** Rows shown under UPCOMING before "See all". */
const UPCOMING_PREVIEW = 3;

interface MineOrg {
  id: number;
  name: string;
  profile_picture: string | null;
  verified: boolean;
  role: 'admin' | 'editor';
  event_count: number;
}

interface FollowedOrg {
  id: number;
  name: string;
  profile_picture: string | null;
  verified: boolean;
  category: string | null;
  follower_count: number;
}

/** One row of Your Orgs, after merging the two sources. */
export interface MyOrgRow {
  id: number;
  name: string;
  profile_picture: string | null;
  verified: boolean;
  relation: 'admin' | 'editor' | 'following';
  subtitle: string;
}

/** "1 event", "12 events". */
function plural(n: number, noun: string): string {
  return `${n.toLocaleString()} ${noun}${n === 1 ? '' : 's'}`;
}

type OrgFilter = 'all' | 'joined' | 'following';

interface OrgEventsResponse {
  events: ApiEvent[];
}

/**
 * Joined + Following as one list. Membership wins: an admin who also follows
 * their own org sees it once, badged ADMIN, not twice.
 */
export function useMyOrgs(token: string | null) {
  const mine = useQuery({
    queryKey: orgKeys.mine(),
    queryFn: () => api.get<{ organizations: MineOrg[] }>('/orgs/mine', { token }),
    enabled: !!token,
  });
  const following = useQuery({
    queryKey: orgKeys.following(),
    queryFn: () => api.get<{ organizations: FollowedOrg[] }>('/orgs/following', { token }),
    enabled: !!token,
    // See the file header: a 404 here is an un-deployed Worker, not a fault
    // worth retrying.
    retry: false,
  });

  const rows = useMemo<MyOrgRow[]>(() => {
    const joined = (mine.data?.organizations ?? []).map<MyOrgRow>((o) => ({
      id: o.id,
      name: o.name,
      profile_picture: o.profile_picture,
      verified: o.verified,
      relation: o.role,
      subtitle: `You’re an ${o.role} · ${plural(o.event_count, 'event')}`,
    }));
    const joinedIds = new Set(joined.map((o) => o.id));
    const followed = (following.data?.organizations ?? [])
      .filter((o) => !joinedIds.has(o.id))
      .map<MyOrgRow>((o) => ({
        id: o.id,
        name: o.name,
        profile_picture: o.profile_picture,
        verified: o.verified,
        relation: 'following',
        subtitle: [o.category, plural(o.follower_count, 'follower')].filter(Boolean).join(' · '),
      }));
    return [...joined, ...followed];
  }, [mine.data, following.data]);

  return { rows, isLoading: mine.isLoading };
}

function RelationBadge({ relation }: { relation: MyOrgRow['relation'] }) {
  if (relation === 'admin' || relation === 'editor') {
    return (
      <View className="rounded-full border-[0.5px] border-lhlBurntOrange bg-lhlBrandTint px-[5px] py-[2px]">
        <Text className="font-roboto-medium text-[10px] text-lhlAccent">
          {relation === 'admin' ? 'ADMIN' : 'EDITOR'}
        </Text>
      </View>
    );
  }
  return (
    <View className="rounded-full bg-lhlSegmentTrack px-[5px] py-[2px]">
      <Text className="font-roboto-medium text-[10px] text-lhlSecondaryTextGrey">FOLLOWING</Text>
    </View>
  );
}

/** "TONIGHT · 6:00 PM", "TOMORROW · 6:00 PM", "THU 11/26 · 6:00 PM". */
function upNextEyebrow(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dayDiff = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
      86_400_000,
  );
  let when: string;
  if (dayDiff <= 0) when = d.getHours() >= 17 ? 'TONIGHT' : 'TODAY';
  else if (dayDiff === 1) when = 'TOMORROW';
  else
    when = `${d.toLocaleDateString([], { weekday: 'short' }).toUpperCase()} ${
      d.getMonth() + 1
    }/${d.getDate()}`;
  return `${when} · ${time}`;
}

/**
 * Walking directions to an event. Same URL shapes as useEventLocation's
 * openInMaps, built inline because that hook geocodes and asks for the
 * viewer's location on mount, which a list card has no business doing.
 */
function openDirections(event: ApiEvent) {
  const target =
    event.latitude != null && event.longitude != null
      ? `${event.latitude},${event.longitude}`
      : event.location_full || event.location_short
        ? encodeURIComponent(`${event.location_full || event.location_short}, Austin, TX`)
        : null;
  if (!target) return;
  const url =
    Platform.OS === 'ios'
      ? `http://maps.apple.com/?daddr=${target}&dirflg=w`
      : `https://www.google.com/maps/dir/?api=1&destination=${target}&travelmode=walking`;
  Linking.openURL(url).catch(() => {});
}

function UpNextCard({ event }: { event: ApiEvent }) {
  const router = useRouter();
  const colors = useThemeColors();
  const where = event.location_short || event.location_full;
  const canDirect = (event.latitude != null && event.longitude != null) || !!where;
  return (
    <View className="mx-[20px] gap-[10px] rounded-[10px] border border-lhlBrandTint bg-lhlSurface px-[12px] py-[14px]">
      <Text className="font-roboto-semibold text-[12px] text-lhlAccent">
        {upNextEyebrow(event.start_datetime)}
      </Text>
      <View className="gap-[4px]">
        <View className="flex-row items-center gap-[6px]">
          <Text numberOfLines={1} className="font-roboto-semibold shrink text-[16px] text-lhlInk">
            {event.title}
          </Text>
          {event.org_verified ? (
            <VerifiedIcon width={14} height={14} accessibilityLabel="Verified organization" />
          ) : null}
        </View>
        {where ? (
          <View className="flex-row items-center gap-[4px]">
            <LocationIcon width={13} height={13} color={colors.ink} />
            <Text numberOfLines={1} className="font-roboto shrink text-[12px] text-lhlInk">
              {where}
            </Text>
          </View>
        ) : null}
        <Text className="font-roboto-medium text-[12px] text-lhlInk">
          {[event.host_organization_name, `${(event.rsvp_count ?? 0).toLocaleString()} going`]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      <View className="h-[30px] flex-row gap-[7px]">
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/event/${event.id}`)}
          className="flex-1 items-center justify-center rounded-[8px] bg-lhlBurntOrange"
        >
          <Text className="font-roboto-semibold text-[12px] text-white">View event</Text>
        </Pressable>
        {canDirect ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Directions to ${where ?? event.title}`}
            onPress={() => openDirections(event)}
            className="flex-1 items-center justify-center rounded-[8px] bg-lhlBrandTint"
          >
            <Text className="font-roboto-semibold text-[12px] text-lhlAccent">Directions</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export default function MyOrgsPanel({
  token,
  onDiscover,
}: {
  token: string | null;
  /** Switches the screen to Discover -- the empty state's way out. */
  onDiscover: () => void;
}) {
  const router = useRouter();
  const colors = useThemeColors();
  const [filter, setFilter] = useState<OrgFilter>('all');
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const { rows, isLoading } = useMyOrgs(token);
  const going = useGoingEventIds(token);

  const joinedCount = rows.filter((r) => r.relation !== 'following').length;
  const followingCount = rows.length - joinedCount;
  const visibleRows = rows.filter((r) =>
    filter === 'all'
      ? true
      : filter === 'joined'
        ? r.relation !== 'following'
        : r.relation === 'following',
  );

  // Joined orgs come first in `rows`, so slicing takes them before follows.
  const eventOrgIds = rows.slice(0, UPCOMING_ORG_CAP).map((r) => r.id);
  const eventQueries = useQueries({
    queries: eventOrgIds.map((id) => ({
      queryKey: orgKeys.publicEvents(id, 'upcoming'),
      queryFn: () =>
        api.get<OrgEventsResponse>(`/orgs/${id}/profile/events?tab=upcoming`, { token }),
      enabled: !!token,
    })),
  });
  // Merged and sorted on every render: at most UPCOMING_ORG_CAP x 100 rows,
  // and useQueries hands back a fresh array each render anyway, so a memo
  // keyed on it would never hit.
  const upcoming: ApiEvent[] = [];
  const seen = new Set<number>();
  for (const q of eventQueries) {
    for (const e of q.data?.events ?? []) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      upcoming.push(e);
    }
  }
  upcoming.sort(
    (a, b) => new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime(),
  );

  if (isLoading) {
    return <ActivityIndicator className="mt-[40px]" color={colors.brand} />;
  }

  if (rows.length === 0) {
    return (
      <View className="mx-[20px] mt-[32px] items-center rounded-[16px] border border-lhlBorderSoft bg-lhlSurface px-[20px] py-[28px]">
        <Text className="font-roboto-semibold text-center text-[16px] text-lhlInk">
          No orgs yet
        </Text>
        <Text className="font-roboto mt-[6px] text-center text-[13px] leading-[18px] text-lhlSecondaryTextGrey">
          Follow organizations to see their events and meetings here.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={onDiscover}
          className="mt-[14px] h-[36px] items-center justify-center rounded-[8px] bg-lhlBurntOrange px-[20px]"
        >
          <Text className="font-roboto-semibold text-[12px] text-white">Discover orgs</Text>
        </Pressable>
      </View>
    );
  }

  const nextUp = upcoming[0];
  const listed = showAllUpcoming ? upcoming : upcoming.slice(0, UPCOMING_PREVIEW);

  return (
    <View className="gap-[24px] pt-[24px]">
      {nextUp ? <UpNextCard event={nextUp} /> : null}

      <View className="gap-[12px] px-[20px]">
        <SectionHeading
          title="Your Orgs"
          right={
            <View className="flex-row gap-[4px]">
              <Chip
                label={`All ${rows.length}`}
                selected={filter === 'all'}
                onPress={() => setFilter('all')}
              />
              <Chip
                label={`Joined ${joinedCount}`}
                selected={filter === 'joined'}
                onPress={() => setFilter('joined')}
              />
              <Chip
                label={`Following ${followingCount}`}
                selected={filter === 'following'}
                onPress={() => setFilter('following')}
              />
            </View>
          }
        />
        {visibleRows.length === 0 ? (
          <Text className="font-roboto text-[13px] text-lhlSecondaryTextGrey">
            {filter === 'joined'
              ? 'You’re not on any org’s team yet.'
              : 'You’re not following any orgs yet.'}
          </Text>
        ) : (
          visibleRows.map((row) => (
            <RowCard
              key={row.id}
              accessibilityLabel={row.name}
              onPress={() => router.push(`/org/${row.id}/profile`)}
            >
              <OrgLogo name={row.name} uri={row.profile_picture} size={44} />
              <View className="flex-1 gap-[2px]">
                <View className="flex-row items-center gap-[8px]">
                  <Text
                    numberOfLines={1}
                    className="font-roboto-semibold shrink text-[16px] leading-[19px] text-lhlInk"
                  >
                    {row.name}
                  </Text>
                  <RelationBadge relation={row.relation} />
                </View>
                {row.subtitle ? (
                  <Text
                    numberOfLines={1}
                    className="font-roboto text-[12px] text-lhlSecondaryTextGrey"
                  >
                    {row.subtitle}
                  </Text>
                ) : null}
              </View>
              <ChevronRightIcon size={18} color={colors.ink} />
            </RowCard>
          ))
        )}
      </View>

      <View className="gap-[16px] px-[20px]">
        <SectionHeading
          title="Upcoming"
          onSeeAll={
            upcoming.length > UPCOMING_PREVIEW && !showAllUpcoming
              ? () => setShowAllUpcoming(true)
              : undefined
          }
        />
        {upcoming.length === 0 ? (
          <Text className="font-roboto text-[13px] text-lhlSecondaryTextGrey">
            No upcoming events from your orgs.
          </Text>
        ) : (
          <View className="gap-[12px]">
            {listed.map((e) => (
              <UpcomingEventRow key={e.id} event={e} going={going.has(e.id)} />
            ))}
          </View>
        )}
      </View>
    </View>
  );
}
