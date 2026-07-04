import EventCard, { ApiEvent } from '@/app/components/EventCard';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { api } from '@/app/lib/api';
import { events as eventsKeys, saved as savedKeys } from '@/app/lib/queryKeys';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, FlatList, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type EventsListResponse = { events: ApiEvent[] };
type SavedListResponse = { events: ApiEvent[] };

export default function ViewAllScreen() {
  const router = useRouter();
  const { title, search } = useLocalSearchParams<{ title: string; search: string }>();
  const { data } = useOnboarding();
  const token = data.token || null;
  const queryClient = useQueryClient();

  const eventsQuery = useQuery({
    queryKey: eventsKeys.list({ filter: `view-all-${search}` }),
    queryFn: () => api.get<EventsListResponse>(`/events?${search}&limit=50`, { token }),
    staleTime: 30_000,
  });

  const savedQuery = useQuery({
    queryKey: savedKeys.list(),
    queryFn: () => api.get<SavedListResponse>('/saved', { token }),
    enabled: !!token,
  });

  const savedIds = React.useMemo(
    () => new Set((savedQuery.data?.events ?? []).map((e: ApiEvent) => e.id)),
    [savedQuery.data],
  );

  const toggleSave = useMutation({
    mutationFn: async ({ eventId, wasSaved }: { eventId: number; wasSaved: boolean }) => {
      if (wasSaved) {
        await api.delete(`/saved/${eventId}`, { token });
      } else {
        await api.post(`/saved/${eventId}`, { token });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: savedKeys.list() });
    },
  });

  const handleToggleSave = (eventId: number) => {
    if (!token) return;
    toggleSave.mutate({ eventId, wasSaved: savedIds.has(eventId) });
  };

  const events = eventsQuery.data?.events ?? [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 20,
          paddingVertical: 16,
          borderBottomWidth: 1,
          borderBottomColor: '#E5E7EB',
        }}
      >
        <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 16 }}>
          <Text style={{ fontSize: 24, color: '#374151' }}>←</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 20, fontWeight: '700', color: '#020B12' }}>
          {title || 'Events'}
        </Text>
      </View>

      {eventsQuery.isPending ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#BF5700" />
        </View>
      ) : events.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
          <Text style={{ fontSize: 16, color: '#9CA3AF', textAlign: 'center' }}>
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
