import EventCard, { ApiEvent } from '@/app/components/EventCard';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { api } from '@/app/lib/api';
import { events as eventsKeys, feed as feedKeys } from '@/app/lib/queryKeys';
import { useSavedEvents } from '@/app/lib/useSavedEvents';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, FlatList, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useThemeColors } from '@/app/lib/themeColors';

type EventsListResponse = { events: ApiEvent[] };

export default function ViewAllScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  // Home carousels pass `bucketId` (ranked feed). A legacy `search` param is
  // still honored for any caller building a raw /events query.
  const { title, bucketId, search } = useLocalSearchParams<{
    title: string;
    bucketId?: string;
    search?: string;
  }>();
  const { data } = useOnboarding();
  const token = data.token || null;
  const { savedIds, toggleSave: handleToggleSave } = useSavedEvents(token);

  const eventsQuery = useQuery({
    queryKey: bucketId
      ? feedKeys.bucket(bucketId)
      : eventsKeys.list({ filter: `view-all-${search}` }),
    queryFn: () =>
      bucketId
        ? api.get<EventsListResponse>(`/feed/bucket/${bucketId}?limit=50`, { token })
        : api.get<EventsListResponse>(`/events?${search}&limit=50`, { token }),
    staleTime: 30_000,
  });

  const events = eventsQuery.data?.events ?? [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 20,
          paddingVertical: 16,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 16 }}>
          <Text style={{ fontSize: 24, color: colors.inkSecondary }}>←</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink }}>
          {title || 'Events'}
        </Text>
      </View>

      {eventsQuery.isPending ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : events.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
          <Text style={{ fontSize: 16, color: colors.inkMuted, textAlign: 'center' }}>
            No events found in this category right now.
          </Text>
        </View>
      ) : (
        <FlatList
          data={events}
          contentContainerStyle={{ padding: 20, gap: 16 }}
          keyExtractor={(item) => `${item.source}-${item.source_event_id}`}
          renderItem={({ item }) => (
            <EventCard
              item={item}
              isSaved={savedIds.has(item.id)}
              onToggleSave={handleToggleSave}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}
