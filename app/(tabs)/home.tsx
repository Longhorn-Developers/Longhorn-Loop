import BellIcon from '@/assets/images/bell.svg';
import HookemIcon from '@/assets/images/hookem.svg';
import EventCard, { ApiEvent } from '@/app/components/EventCard';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { api } from '@/app/lib/api';
import { events as eventsKeys, saved as savedKeys } from '@/app/lib/queryKeys';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning,';
  if (hour < 17) return 'Good afternoon,';
  return 'Good evening,';
}

// Shape the events list endpoint returns.
type EventsListResponse = { events: ApiEvent[] };
type SavedListResponse = { events: ApiEvent[] };

// Tiny helper: fetch one carousel's worth of events.
function eventListQueryOptions(
  filterKey: string,
  search: string,
  token: string | null,
) {
  return {
    queryKey: eventsKeys.list({ filter: filterKey }),
    queryFn: () =>
      api.get<EventsListResponse>(`/events?${search}`, { token }),
    // Use a slightly longer staleTime so the four carousels don't re-fire
    // back-to-back. They still refetch on focus.
    staleTime: 30_000,
  };
}

function CarouselSection({
  title,
  data,
  loading,
  savedIds,
  onToggleSave,
}: {
  title: string;
  data: ApiEvent[];
  loading?: boolean;
  savedIds: Set<number>;
  onToggleSave: (eventId: number) => void;
}) {
  if (loading) {
    return (
      <View style={{ marginBottom: 28, paddingHorizontal: 20 }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#020B12', marginBottom: 12 }}>
          {title}
        </Text>
        <ActivityIndicator size="small" color="#BF5700" />
      </View>
    );
  }

  if (data.length === 0) return null;

  return (
    <View style={{ marginBottom: 28 }}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingHorizontal: 20,
          marginBottom: 12,
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#020B12' }}>{title}</Text>
        <TouchableOpacity>
          <Text style={{ fontSize: 22, color: '#9A9A9A' }}>›</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={data}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20 }}
        keyExtractor={(item) => `${item.source}-${item.source_event_id}`}
        renderItem={({ item }) => (
          <EventCard
            item={item}
            isSaved={savedIds.has(item.id)}
            onToggleSave={onToggleSave}
          />
        )}
      />
    </View>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const { data } = useOnboarding();
  const token = data.token || null;
  const queryClient = useQueryClient();

  // Four event carousels — each its own query so they cache independently.
  const upcomingQuery = useQuery(
    eventListQueryOptions('upcoming', 'limit=10', token),
  );
  const freeFoodQuery = useQuery(
    eventListQueryOptions('free-food', 'limit=10&benefit=Free Food', token),
  );
  const socialQuery = useQuery(
    eventListQueryOptions('social', 'limit=10&theme=Social', token),
  );
  const academicQuery = useQuery(
    eventListQueryOptions('academic', 'limit=10&category=Academic', token),
  );

  // Saved IDs — only run when signed in.
  const savedQuery = useQuery({
    queryKey: savedKeys.list(),
    queryFn: () => api.get<SavedListResponse>('/saved', { token }),
    enabled: !!token,
  });

  const savedIds = React.useMemo(
    () => new Set((savedQuery.data?.events ?? []).map((e) => e.id)),
    [savedQuery.data],
  );

  // Toggle save with optimistic UI. onMutate flips the cache instantly,
  // onError rolls back, onSettled re-fetches to sync with the server.
  const toggleSave = useMutation({
    mutationFn: async ({
      eventId,
      wasSaved,
    }: {
      eventId: number;
      wasSaved: boolean;
    }) => {
      if (wasSaved) {
        await api.delete(`/saved/${eventId}`, { token });
      } else {
        await api.post(`/saved/${eventId}`, { token });
      }
    },
    onMutate: async ({ eventId, wasSaved }) => {
      await queryClient.cancelQueries({ queryKey: savedKeys.list() });
      const previous = queryClient.getQueryData<SavedListResponse>(
        savedKeys.list(),
      );
      queryClient.setQueryData<SavedListResponse>(
        savedKeys.list(),
        (old) => {
          const list = old?.events ?? [];
          if (wasSaved) {
            return { events: list.filter((e) => e.id !== eventId) };
          }
          // We don't have the full event here; the placeholder shape is fine
          // for membership checks until onSettled re-fetches the real list.
          return {
            events: [...list, { id: eventId } as ApiEvent],
          };
        },
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(savedKeys.list(), context.previous);
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

  // While any carousel is on its first fetch we show the loader; subsequent
  // background refetches are silent.
  const loading =
    upcomingQuery.isPending ||
    freeFoodQuery.isPending ||
    socialQuery.isPending ||
    academicQuery.isPending;

  return (
    <SafeAreaView className="flex-1 bg-lhlBackgroundColor" edges={['left', 'right']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 90,
            paddingBottom: 16,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <View>
            <Text style={{ fontSize: 16, fontWeight: '400', color: '#9A9A9A' }}>
              {getGreeting()}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <Text style={{ fontSize: 32, fontWeight: '700', color: '#020B12' }}>
                {data.firstName || 'User'}
              </Text>
              <HookemIcon width={31} height={31} />
            </View>
          </View>

          {/* Bell */}
          <TouchableOpacity
            style={{ position: 'relative', padding: 4 }}
            onPress={() => router.push('/notifications')}
          >
            <BellIcon width={22} height={25} />
            <View
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                backgroundColor: '#EF4444',
                borderRadius: 8,
                width: 16,
                height: 16,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>1</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Divider */}
        <View
          style={{ height: 1, backgroundColor: '#D2DEE0', marginHorizontal: 20, marginBottom: 24 }}
        />

        <CarouselSection
          title="Upcoming"
          data={upcomingQuery.data?.events ?? []}
          loading={loading}
          savedIds={savedIds}
          onToggleSave={handleToggleSave}
        />
        <CarouselSection
          title="Free Food"
          data={freeFoodQuery.data?.events ?? []}
          loading={loading}
          savedIds={savedIds}
          onToggleSave={handleToggleSave}
        />
        <CarouselSection
          title="Social"
          data={socialQuery.data?.events ?? []}
          loading={loading}
          savedIds={savedIds}
          onToggleSave={handleToggleSave}
        />
        <CarouselSection
          title="Academic"
          data={academicQuery.data?.events ?? []}
          loading={loading}
          savedIds={savedIds}
          onToggleSave={handleToggleSave}
        />

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
