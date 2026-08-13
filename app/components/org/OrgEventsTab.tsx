// Events tab of the Org Management console (LOOP-136).
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
  const [sortRecent, setSortRecent] = useState(false);
  const [editing, setEditing] = useState<OrgEvent | null>(null);

  const sort = sortRecent ? 'recent' : 'date';

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

        {/* Two orderings, matching the profile's control: Date puts the next
            event out the door on top; Recent is newest-posted first, which is
            what you want just after posting something. */}
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

      {events.isLoading ? (
        <ActivityIndicator className="mt-[24px]" color={colors.brand} />
      ) : events.isError ? (
        <Text className="font-['Roboto-Flex'] mt-[24px] text-center text-[12px] text-lhlDestructiveRed">
          Could not load this organization’s events.
        </Text>
      ) : rows.length === 0 ? (
        <View className="items-center py-[30px]">
          <Text className="font-['Roboto-Flex'] text-center text-[13px] text-lhlSecondaryTextGrey">
            {isFiltered ? 'No events match that search.' : 'Events you post will show up here.'}
          </Text>
        </View>
      ) : (
        <View className="mt-[14px]">
          {rows.map((event) => (
            <OrgEventRow
              key={event.id}
              event={event}
              canManage={canManage}
              onEdit={() => setEditing(event)}
            />
          ))}
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
        ) : null}
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
              uses this one. */}
          <Text className="text-[13px] text-lhlAccent">✎</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
