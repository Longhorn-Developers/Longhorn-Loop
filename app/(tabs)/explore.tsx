import EventCard, { ApiEvent } from '@/app/components/EventCard';
import EventMiniCard from '@/app/components/EventMiniCard';
import MapViewWrapper, { LocatedEvent } from '@/app/components/MapViewWrapper';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { api } from '@/app/lib/api';
import { explore as exploreKeys, saved as savedKeys } from '@/app/lib/queryKeys';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ListIcon, MapPin } from 'phosphor-react-native';
import React, { useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const BURNT_ORANGE = '#BF5700';
const TEXT_PRIMARY = '#020B12';
const TEXT_MUTED = '#9A9A9A';
const BG_OFFWHITE = '#F9F8F6';
const DIVIDER = '#D2DEE0';
const TOGGLE_BG = '#EFEFEF';
const TOGGLE_ACTIVE_BG = '#FFFFFF';

type EventsListResponse = { events: ApiEvent[] };
type SavedListResponse = { events: ApiEvent[] };
type ViewMode = 'list' | 'map';

const IS_WEB = Platform.OS === 'web';

export default function ExploreScreen() {
  const router = useRouter();
  const { data } = useOnboarding();
  const token = data.token || null;
  const queryClient = useQueryClient();

  // Default to map on native (the primary feature); web is locked to list.
  const [viewMode, setViewMode] = useState<ViewMode>(IS_WEB ? 'list' : 'map');
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);

  // GET /events is a public endpoint — no auth required, no `enabled` guard needed.
  const eventsQuery = useQuery({
    queryKey: exploreKeys.events({ limit: '100' }),
    queryFn: () => api.get<EventsListResponse>('/events?limit=100', { token }),
    staleTime: 30_000,
  });

  const savedQuery = useQuery({
    queryKey: savedKeys.list(),
    queryFn: () => api.get<SavedListResponse>('/saved', { token }),
    enabled: !!token,
  });

  const savedIds = React.useMemo(
    () => new Set((savedQuery.data?.events ?? []).map((e) => e.id)),
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
    onMutate: async ({ eventId, wasSaved }) => {
      await queryClient.cancelQueries({ queryKey: savedKeys.list() });
      const previous = queryClient.getQueryData<SavedListResponse>(savedKeys.list());
      queryClient.setQueryData<SavedListResponse>(savedKeys.list(), (old) => {
        const list = old?.events ?? [];
        if (wasSaved) return { events: list.filter((e) => e.id !== eventId) };
        return { events: [...list, { id: eventId } as ApiEvent] };
      });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(savedKeys.list(), context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: savedKeys.list() }),
  });

  const handleToggleSave = (eventId: number) => {
    if (!token) return;
    toggleSave.mutate({ eventId, wasSaved: savedIds.has(eventId) });
  };

  // Toggle: tapping the active pin dismisses the card; tapping a new pin selects it.
  const handlePinPress = (eventId: number) => {
    setSelectedEventId((prev) => (prev === eventId ? null : eventId));
  };

  const handleViewDetails = (eventId: number) => {
    router.push(`/event/${eventId}`);
  };

  const allEvents = eventsQuery.data?.events ?? [];

  // Type-narrowed subset: only events with non-null coordinates go on the map.
  const locatedEvents: LocatedEvent[] = allEvents.filter(
    (e): e is LocatedEvent => e.latitude != null && e.longitude != null,
  );

  const selectedEvent =
    selectedEventId != null ? (allEvents.find((e) => e.id === selectedEventId) ?? null) : null;

  if (eventsQuery.isPending) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: BG_OFFWHITE,
          alignItems: 'center',
          justifyContent: 'center',
        }}
        edges={['left', 'right']}
      >
        <ActivityIndicator size="large" color={BURNT_ORANGE} />
      </SafeAreaView>
    );
  }

  if (eventsQuery.isError) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: BG_OFFWHITE,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 24,
        }}
        edges={['left', 'right']}
      >
        <Text style={{ fontSize: 16, color: TEXT_MUTED, textAlign: 'center' }}>
          Could not load events. Check your connection.
        </Text>
      </SafeAreaView>
    );
  }

  const showList = viewMode === 'list' || IS_WEB;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG_OFFWHITE }} edges={['left', 'right']}>
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
        <Text style={{ fontSize: 32, fontWeight: '700', color: TEXT_PRIMARY }}>Explore</Text>

        {/* Toggle hidden on web — react-native-maps has no web renderer */}
        {!IS_WEB && (
          <View
            style={{
              flexDirection: 'row',
              backgroundColor: TOGGLE_BG,
              borderRadius: 10,
              padding: 3,
            }}
          >
            <TouchableOpacity
              onPress={() => {
                setViewMode('list');
                setSelectedEventId(null);
              }}
              style={{
                padding: 7,
                borderRadius: 8,
                backgroundColor: viewMode === 'list' ? TOGGLE_ACTIVE_BG : 'transparent',
              }}
            >
              <ListIcon
                size={18}
                color={viewMode === 'list' ? BURNT_ORANGE : TEXT_MUTED}
                weight="bold"
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setViewMode('map')}
              style={{
                padding: 7,
                borderRadius: 8,
                backgroundColor: viewMode === 'map' ? TOGGLE_ACTIVE_BG : 'transparent',
              }}
            >
              <MapPin
                size={18}
                color={viewMode === 'map' ? BURNT_ORANGE : TEXT_MUTED}
                weight="bold"
              />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Divider */}
      <View
        style={{ height: 1, backgroundColor: DIVIDER, marginHorizontal: 20, marginBottom: 16 }}
      />

      {/* Content */}
      {showList ? (
        <FlatList
          key="explore-grid"
          data={allEvents}
          keyExtractor={(item) => `${item.source}-${item.source_event_id}`}
          numColumns={2}
          columnWrapperStyle={{ gap: 12 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, gap: 12 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <Text style={{ color: TEXT_MUTED, textAlign: 'center', marginTop: 40 }}>
              No events found.
            </Text>
          }
          renderItem={({ item }) => (
            <EventCard
              item={item}
              isSaved={savedIds.has(item.id)}
              onToggleSave={handleToggleSave}
              style={{ flex: 1, width: undefined, marginRight: 0 }}
            />
          )}
        />
      ) : (
        // Map view — dismissal via MapView.onPress (background tap) or pin toggle.
        // No overlay needed: MapView.onPress fires only on background taps, not marker taps.
        <View style={{ flex: 1 }}>
          <MapViewWrapper
            events={locatedEvents}
            selectedEventId={selectedEventId}
            onPinPress={handlePinPress}
            onMapPress={() => setSelectedEventId(null)}
          />

          {/* Mini preview card anchored to bottom, rendered above the map */}
          {selectedEvent != null && (
            <View
              style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}
              pointerEvents="box-none"
            >
              <EventMiniCard
                event={selectedEvent}
                isSaved={savedIds.has(selectedEvent.id)}
                onToggleSave={handleToggleSave}
                onDismiss={() => setSelectedEventId(null)}
                onViewDetails={handleViewDetails}
              />
            </View>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}
