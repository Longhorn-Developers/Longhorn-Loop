// Past events (LOOP-200) — the history of events a student created, attended
// (RSVP'd) or saved, still reachable after those events have ended.
//
// The organizing principle from the ticket: "purge from the DB" and "what a
// user can see" are separate concerns. This screen only ever shows events the
// user has a relationship with, so events nobody touched stay free for the
// cleanup job (LOOP-150) to purge without leaving holes in anyone's history.
//
// Cards are read-only: no save/RSVP affordances, since acting on an event that
// already ended is meaningless. Tapping still opens the detail screen.

import { formatEventDate, type ApiEvent } from '@/app/components/EventCard';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { api } from '@/app/lib/api';
import { user as userKeys } from '@/app/lib/queryKeys';
import ArrowLeftIcon from '@/assets/images/arrow-left.svg';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useThemeColors } from '@/app/lib/themeColors';

type PastGroup = 'created' | 'attended' | 'saved';

const TABS: { key: PastGroup; label: string; empty: string }[] = [
  { key: 'created', label: 'Created', empty: 'You haven’t created any events yet.' },
  { key: 'attended', label: 'Attended', empty: 'No past events you RSVP’d to.' },
  { key: 'saved', label: 'Saved', empty: 'No past events you saved.' },
];

interface PastEventsResponse {
  created: ApiEvent[];
  attended: ApiEvent[];
  saved: ApiEvent[];
}

function PastEventCard({ event, onPress }: { event: ApiEvent; onPress: () => void }) {
  const ended = event.end_datetime ?? event.start_datetime;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${event.title}, ended ${formatEventDate(ended)}`}
      onPress={onPress}
      // Muted treatment marks the whole card as past without hiding content.
      className="mb-[12px] flex-row items-center gap-[12px] rounded-[12px] border border-lhlMutedBorder bg-lhlSurface p-[10px]"
    >
      <View className="h-[64px] w-[64px] overflow-hidden rounded-[10px] bg-lhlPlaceholderGrey">
        {event.image_url ? (
          <Image
            source={{ uri: event.image_url }}
            style={{ width: '100%', height: '100%', opacity: 0.7 }}
          />
        ) : null}
      </View>

      <View className="flex-1 bg-lhlBackgroundColor">
        <View className="flex-row items-center gap-[6px]">
          <View className="rounded-full bg-lhlSurfaceGrey px-[8px] py-[2px]">
            <Text className="font-['Roboto-Flex'] text-[10px] font-semibold uppercase text-lhlSecondaryTextGrey">
              Ended
            </Text>
          </View>
          <Text className="font-['Roboto-Flex'] text-[11px] text-lhlSecondaryTextGrey">
            {formatEventDate(ended)}
          </Text>
        </View>

        <Text
          numberOfLines={2}
          className="font-['Roboto-Flex'] mt-[4px] text-[14px] font-semibold text-lhlInk"
        >
          {event.title}
        </Text>

        {event.host_organization_name ? (
          <Text
            numberOfLines={1}
            className="font-['Roboto-Flex'] mt-[2px] text-[11px] text-lhlSecondaryTextGrey"
          >
            {event.host_organization_name}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export default function PastEventsScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { data: onboarding } = useOnboarding();
  const token = onboarding.token || null;

  const [activeTab, setActiveTab] = useState<PastGroup>('created');

  // One request returns all three groups, so switching tabs is instant and
  // the counts in the tab bar are correct before any tab is opened.
  const { data, isLoading } = useQuery({
    queryKey: userKeys.pastEvents(),
    queryFn: () => api.get<PastEventsResponse>('/users/me/past-events', { token }),
    enabled: !!token,
  });

  const events = data?.[activeTab] ?? [];
  const activeMeta = TABS.find((t) => t.key === activeTab)!;

  if (!token) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-lhlBackgroundColor">
        <Text className="font-['Roboto-Flex'] text-[14px] text-lhlSecondaryTextGrey">
          Sign in to see your past events.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-lhlBackgroundColor" edges={['top']}>
      <View className="flex-row items-center px-[20px] py-[12px]">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
        >
          <ArrowLeftIcon width={22} height={22} color={colors.ink} />
        </Pressable>
        <Text className="font-['Roboto-Flex'] ml-[12px] text-[20px] font-semibold text-lhlInk">
          Past Events
        </Text>
      </View>

      {/* Tabs */}
      <View className="flex-row gap-[8px] px-[20px]">
        {TABS.map((tab) => {
          const isActive = tab.key === activeTab;
          const count = data?.[tab.key]?.length ?? 0;
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              onPress={() => setActiveTab(tab.key)}
              className={`flex-1 items-center rounded-full border py-[8px] ${
                isActive
                  ? 'border-lhlBurntOrange bg-lhlBurntOrange'
                  : 'border-lhlMutedBorder bg-lhlSurface'
              }`}
            >
              <Text
                className={`font-['Roboto-Flex'] text-[12px] font-semibold ${
                  isActive ? 'text-white' : 'text-lhlSecondaryTextGrey'
                }`}
              >
                {tab.label}
                {data ? ` (${count})` : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center bg-lhlBackgroundColor">
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : (
        <ScrollView
          className="mt-[16px] flex-1 px-[20px] bg-lhlBackgroundColor"
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          {events.length === 0 ? (
            <Text className="font-['Roboto-Flex'] mt-[40px] text-center text-[13px] text-lhlSecondaryTextGrey">
              {activeMeta.empty}
            </Text>
          ) : (
            events.map((event) => (
              <PastEventCard
                key={`${activeTab}-${event.id}`}
                event={event}
                onPress={() => router.push(`/event/${event.id}`)}
              />
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
