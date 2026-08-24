import EventFlyerPlaceholder from '@/app/components/EventFlyerPlaceholder';
// Events tab of the Org Management console (LOOP-136 design, LOOP-240 build).
//
// Figma: "Organization Management" frame, Events tab — search field, the
// All / General / Academic / Social chip row with a sort control beside it,
// then one row per event: thumbnail, title, "Fri, 2/26 • 4:00 PM · BLT 2.503",
// and a pencil that opens the edit overlay.
//
// The chip row is shared/profileEventFilters.ts, the same mapping the
// profile's My Events section uses, so the two identical-looking chip rows
// cannot come to mean different things. The date line is EventCard's
// formatEventDate for the same reason — one place in the app decides how an
// event date reads.
//
// Lives in its own file rather than inside app/org/[id]/index.tsx because the
// console screen was already long, and this tab owns a query, three filter
// controls and a modal of its own.
//
// The pencil is gated on can_manage from the server. That is presentation:
// PATCH /events/:id re-checks the caller's role on every request, so hiding
// the pencil is a courtesy, not the boundary.
//
// ---------------------------------------------------------------------------
// Three calls made in LOOP-240 that are not obvious from the markup:
//
// 1. UPCOMING / PAST ARE SECTIONS, NOT A TOGGLE. LOOP-132 asks the list to
//    distinguish the two, but the signed-off frame draws a flat list with no
//    fourth control — adding a segmented toggle would have been designing, not
//    building. So the same filtered result is split into two labelled runs. An
//    empty run renders nothing at all, header included, because a bare
//    "Upcoming" over blank space reads as a bug rather than as information.
//    Which side an event falls on is the server's `is_past`, computed from the
//    same SQL predicate the profile's history screen uses; this file
//    deliberately does no date arithmetic of its own.
//
// 2. THE ROWS ARE LOCAL, NOT ProfileEventCard. The ticket asked for that
//    component "so the console matches the profile past-events view" — but the
//    past-events view does not use it. app/profile/past.tsx has its own
//    PastEventCard; ProfileEventCard is the two-column My Events GRID on the
//    profile tab: 48%-width, a 150pt poster over a blurred fill, a bookmark
//    overlay, "Posted by <org> ✓", and a press that navigates to the event
//    detail. The console row is full-width, 48pt thumbnail, one meta line, and
//    a trailing pencil — a different shape with a different job, and no
//    trailing slot to hang the pencil off. Reusing it would have meant a
//    `variant` prop that swaps every element inside, i.e. two components in one
//    file. The part that genuinely must not drift between the surfaces — how a
//    date reads — is shared, via formatEventDate.
//
// 3. THERE IS NO DELETE AFFORDANCE, because there is nothing to call. The
//    ticket lists management affordances as "edit / delete", but
//    routes/events.worker.ts has no DELETE /events/:id and no archive route,
//    and PATCH /events/:id does not accept is_archived (is_archived is written
//    only by the LOOP-150 cleanup job). Building that endpoint is server work
//    and out of scope for a frontend ticket, and a delete button with no
//    endpoint behind it is worse than no button. Needs its own ticket.

import EditEventOverlay from '@/app/components/org/EditEventOverlay';
import TextInputField from '@/app/components/inputs/TextInputField';
import { formatEventDate } from '@/app/components/EventCard';
import { api } from '@/app/lib/api';
import { org as orgKeys } from '@/app/lib/queryKeys';
import { useThemeColors } from '@/app/lib/themeColors';
import LhlSearchIcon from '@/assets/icons/LhlSearchIcon';
import {
  PROFILE_EVENT_FILTERS,
  PROFILE_EVENT_FILTER_LABELS,
  type ProfileEventFilter,
} from '@/shared/profileEventFilters';
import { useQuery } from '@tanstack/react-query';
import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';

/** One row of GET /orgs/:orgId/events. */
export interface OrgEvent {
  id: number;
  title: string;
  description: string | null;
  start_datetime: string;
  end_datetime: string | null;
  location_short: string | null;
  location_full: string | null;
  image_url: string | null;
  theme: string | null;
  view_count: number;
  rsvp_count: number;
  save_count: number;
  /** Taxonomy bucket the edit overlay's tag picker opens on; null if untagged. */
  discovery_bucket: string | null;
  tags: string[];
  /**
   * Which section this row belongs to. Server-computed (PAST_EVENT_CONDITION)
   * rather than derived here — end_datetime is nullable on scraped events, and
   * that fallback should exist once.
   */
  is_past: boolean;
}

interface OrgEventsResponse {
  events: OrgEvent[];
  role: 'admin' | 'editor';
  can_manage: boolean;
}

export interface OrgEventsTabProps {
  orgId: number;
  token: string | null;
}

export default function OrgEventsTab({ orgId, token }: OrgEventsTabProps) {
  const colors = useThemeColors();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ProfileEventFilter>('all');
  const [sortAlpha, setSortAlpha] = useState(false);
  const [editing, setEditing] = useState<OrgEvent | null>(null);

  const sort = sortAlpha ? 'alpha' : 'date';

  const events = useQuery({
    queryKey: orgKeys.events(orgId, { q: search.trim(), filter, sort }),
    queryFn: () => {
      const params = new URLSearchParams({ filter, sort });
      if (search.trim()) params.set('q', search.trim());
      return api.get<OrgEventsResponse>(`/orgs/${orgId}/events?${params.toString()}`, { token });
    },
    enabled: !!token && Number.isFinite(orgId),
  });

  const canManage = events.data?.can_manage ?? false;
  const rows = events.data?.events ?? [];
  const isFiltered = search.trim().length > 0 || filter !== 'all';

  // Partitioned, not re-sorted: the server already ordered the whole result,
  // and filter() is stable, so each section keeps whichever ordering the sort
  // control asked for.
  const upcoming = rows.filter((event) => !event.is_past);
  const past = rows.filter((event) => event.is_past);

  return (
    <View className="mt-[20px]">
      <TextInputField
        value={search}
        onChangeText={setSearch}
        placeholder="Search events..."
        autoCapitalize="none"
        autoCorrect={false}
        borderRadius={8}
        clearable
        leftIcon={<LhlSearchIcon size={14} color={colors.inkSecondary} />}
      />

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
                  isActive ? 'bg-lhlBurntOrange' : 'border border-lhlMutedBorder bg-lhlSurface'
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

        {/* Date <-> A-Z, per the Figma frame. The label names the ordering
            currently in effect; the accessibility label names what a press
            will DO, since a screen reader user gets no visual before/after to
            compare against. Both halves of the toggle have to move with the
            server's `sort` param — see the route comment in orgs.worker.ts. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={sortAlpha ? 'Sort by date' : 'Sort alphabetically by title'}
          onPress={() => setSortAlpha((v) => !v)}
          className="flex-row items-center gap-[4px] rounded-full border border-lhlMutedBorder bg-lhlSurface px-[10px] py-[5px]"
        >
          <Text className="font-['Roboto-Flex'] text-[11px] text-lhlSecondaryTextGrey">
            {sortAlpha ? 'A-Z' : 'Date'}
          </Text>
        </Pressable>
      </View>

      {events.isLoading ? (
        <ActivityIndicator className="mt-[24px]" color={colors.brand} />
      ) : events.isError ? (
        <Text className="font-['Roboto-Flex'] mt-[24px] text-center text-[12px] text-lhlDestructiveRed">
          Could not load this organization’s events.
        </Text>
      ) : rows.length === 0 ? (
        // The two empties are one node because they are one situation: nothing
        // to show. Splitting "no events yet" per section would promise an
        // Upcoming list to an org that has never posted anything.
        <View className="items-center py-[30px]">
          <Text className="font-['Roboto-Flex'] text-center text-[13px] text-lhlSecondaryTextGrey">
            {isFiltered ? 'No events match that search.' : 'No events yet.'}
          </Text>
        </View>
      ) : (
        <View className="mt-[14px]">
          {/* Sections render only when populated, so an org with nothing
              upcoming shows a Past list rather than an empty promise. When
              only one section survives the filter its header is still drawn:
              it is the thing telling you the other side is empty. */}
          <OrgEventSection
            title="Upcoming"
            events={upcoming}
            canManage={canManage}
            onEdit={setEditing}
          />
          <OrgEventSection title="Past" events={past} canManage={canManage} onEdit={setEditing} />
        </View>
      )}

      <EditEventOverlay
        visible={editing !== null}
        event={editing}
        orgId={orgId}
        token={token}
        onClose={() => setEditing(null)}
      />
    </View>
  );
}

/**
 * One labelled run of the list. Renders nothing — not even its header — when
 * empty, which is what makes it safe to drop both sections in unconditionally.
 */
function OrgEventSection({
  title,
  events,
  canManage,
  onEdit,
}: {
  title: string;
  events: OrgEvent[];
  canManage: boolean;
  onEdit: (event: OrgEvent) => void;
}) {
  if (events.length === 0) return null;

  return (
    <View className="mb-[6px]">
      <Text
        accessibilityRole="header"
        className="font-['Roboto-Flex'] mb-[8px] text-[11px] font-semibold uppercase tracking-[0.6px] text-lhlSecondaryTextGrey"
      >
        {title}
      </Text>
      {events.map((event) => (
        <OrgEventRow
          key={event.id}
          event={event}
          canManage={canManage}
          onEdit={() => onEdit(event)}
        />
      ))}
    </View>
  );
}

function OrgEventRow({
  event,
  canManage,
  onEdit,
}: {
  event: OrgEvent;
  canManage: boolean;
  onEdit: () => void;
}) {
  const location = event.location_short ?? event.location_full;

  return (
    <View className="mb-[10px] flex-row items-center rounded-[10px] border border-lhlMutedBorder bg-lhlSurface px-[12px] py-[10px]">
      <View className="h-[48px] w-[48px] overflow-hidden rounded-[8px] bg-lhlPlaceholderGrey">
        {event.image_url ? (
          <Image
            source={{ uri: event.image_url }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
          />
        ) : (
          <EventFlyerPlaceholder />
        )}
      </View>

      <View className="ml-[10px] flex-1">
        <Text
          numberOfLines={1}
          className="font-['Roboto-Flex'] text-[13px] font-semibold text-lhlInk"
        >
          {event.title}
        </Text>
        <Text
          numberOfLines={1}
          className="font-['Roboto-Flex'] mt-[3px] text-[11px] text-lhlSecondaryTextGrey"
        >
          {formatEventDate(event.start_datetime)}
          {location ? ` · ${location}` : ''}
        </Text>
      </View>

      {canManage ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Edit ${event.title}`}
          onPress={onEdit}
          hitSlop={10}
          className="ml-[8px] h-[30px] w-[30px] items-center justify-center rounded-full border border-lhlMutedBorder bg-lhlSurface"
        >
          {/* Text glyph rather than an SVG: there is no pencil in
              assets/images, and the profile header's Edit Profile pill already
              uses this one.

              The only management affordance on the row. A delete control would
              sit beside it, and doesn't, because no endpoint deletes or
              archives an event — see note 3 in the file header. */}
          <Text className="text-[13px] text-lhlAccent">✎</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
