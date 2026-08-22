import EventCard, { ApiEvent } from '@/app/components/EventCard';
import EventMiniCard from '@/app/components/EventMiniCard';
import MapViewWrapper, { LocatedEvent } from '@/app/components/MapViewWrapper';
import ExploreToggles, {
  ExploreSelection,
  selectionKey,
} from '@/app/components/explore/ExploreToggles';
import OrgResultRow, { OrgSearchResult } from '@/app/components/explore/OrgResultRow';
import TextInputField from '@/app/components/inputs/TextInputField';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { api } from '@/app/lib/api';
import { feed as feedKeys, org as orgKeys } from '@/app/lib/queryKeys';
import { useDebounced } from '@/app/lib/useDebounced';
import { useSavedEvents } from '@/app/lib/useSavedEvents';
import { useThemeColors } from '@/app/lib/themeColors';
import LhlSearchIcon from '@/assets/icons/LhlSearchIcon';
import { ORG_SEARCH_MIN_QUERY } from '@/shared/orgRegistration';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { CompassIcon, ListIcon, MapPin } from 'phosphor-react-native';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type EventsListResponse = { events: ApiEvent[] };
type BucketResponse = { bucketId: string; label: string; events: ApiEvent[]; total: number };
type OrgSearchResponse = { query: string; organizations: OrgSearchResult[] };
type ViewMode = 'list' | 'map';

const IS_WEB = Platform.OS === 'web';
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Client-side event matching (LOOP-175, interim).
 *
 * The server has no event search endpoint yet — GET /events/search is Jay's
 * LOOP-256 and is still in flight. Rather than block the search bar on it, this
 * filters the feed page already in memory. That is honest for the ~100 events a
 * feed request returns and wrong the moment the corpus outgrows one page.
 *
 * SWAP POINT: when LOOP-256 lands, delete `matchesEvent` and give
 * `eventsQuery` a `?q=` parameter. Nothing else in this screen has to change —
 * `visibleEvents` is already the single place results come from.
 */
function matchesEvent(event: ApiEvent, needle: string): boolean {
  const haystack = [
    event.title,
    event.host_organization_name,
    event.location_short,
    event.location_full,
    event.description,
    ...(event.tags ?? []),
    ...(event.categories ?? []).map((c) => c.name),
  ];

  return haystack.some((field) => field != null && field.toLowerCase().includes(needle));
}

export default function ExploreScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { data } = useOnboarding();
  const token = data.token || null;
  const { savedIds, toggleSave: handleToggleSave } = useSavedEvents(token);

  // Default to map on native (the primary feature); web is locked to list.
  const [viewMode, setViewMode] = useState<ViewMode>(IS_WEB ? 'list' : 'map');
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [selection, setSelection] = useState<ExploreSelection>({ kind: 'trending' });
  const [query, setQuery] = useState('');

  const debouncedQuery = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  const needle = debouncedQuery.toLowerCase();
  const isSearching = debouncedQuery.length >= ORG_SEARCH_MIN_QUERY;

  // The event feed behind the current toggle. `orgs` has no event feed of its
  // own, so it borrows trending's — searching from the Orgs tab should still
  // be able to fall back to events without a second round trip.
  const bucketId = selection.kind === 'bucket' ? selection.id : null;

  const eventsQuery = useQuery({
    queryKey: bucketId ? feedKeys.bucket(bucketId) : feedKeys.explore({ limit: '100' }),
    queryFn: () =>
      bucketId
        ? api
            .get<BucketResponse>(`/feed/bucket/${bucketId}?limit=100`, { token })
            .then((r) => ({ events: r.events }))
        : api.get<EventsListResponse>('/feed/explore?limit=100', { token }),
    staleTime: 30_000,
  });

  // Orgs come from the one org list endpoint that exists (GET /orgs/search).
  // It refuses queries shorter than ORG_SEARCH_MIN_QUERY and has no browse-all
  // mode, which is why the Orgs toggle shows a prompt rather than a directory
  // until that endpoint grows one.
  const orgsQuery = useQuery({
    queryKey: orgKeys.search(debouncedQuery),
    queryFn: () =>
      api.get<OrgSearchResponse>(`/orgs/search?q=${encodeURIComponent(debouncedQuery)}`, { token }),
    enabled: !!token && isSearching,
    staleTime: 30_000,
  });

  const allEvents = useMemo(() => eventsQuery.data?.events ?? [], [eventsQuery.data]);

  const visibleEvents = useMemo(
    () => (isSearching ? allEvents.filter((e) => matchesEvent(e, needle)) : allEvents),
    [allEvents, isSearching, needle],
  );

  const orgResults = orgsQuery.data?.organizations ?? [];

  // Type-narrowed subset: only events with non-null coordinates go on the map.
  // Driven by visibleEvents so the pins honour the search too.
  const locatedEvents: LocatedEvent[] = useMemo(
    () => visibleEvents.filter((e): e is LocatedEvent => e.latitude != null && e.longitude != null),
    [visibleEvents],
  );

  // Toggle: tapping the active pin dismisses the card; tapping a new pin selects it.
  const handlePinPress = (eventId: number) => {
    setSelectedEventId((prev) => (prev === eventId ? null : eventId));
  };

  const handleViewDetails = (eventId: number) => {
    router.push(`/event/${eventId}`);
  };

  const handleSelect = (next: ExploreSelection) => {
    setSelection(next);
    setSelectedEventId(null);
  };

  const selectedEvent =
    selectedEventId != null ? (visibleEvents.find((e) => e.id === selectedEventId) ?? null) : null;

  // Orgs is a list-only destination — there is nothing to pin on a map.
  const showList = viewMode === 'list' || IS_WEB || selection.kind === 'orgs';
  const showOrgSection = selection.kind === 'orgs' || isSearching;
  const showEventSection = selection.kind !== 'orgs';

  const header = (
    <>
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <CompassIcon size={28} color={colors.ink} weight="bold" />
          <Text style={{ fontSize: 32, fontWeight: '700', color: colors.ink }}>Explore</Text>
        </View>

        {/* Toggle hidden on web — react-native-maps has no web renderer — and on
            the Orgs feed, which has nothing to map. */}
        {!IS_WEB && selection.kind !== 'orgs' && (
          <View
            style={{
              flexDirection: 'row',
              backgroundColor: colors.surfaceMuted,
              borderRadius: 10,
              padding: 3,
            }}
          >
            <TouchableOpacity
              onPress={() => {
                setViewMode('list');
                setSelectedEventId(null);
              }}
              accessibilityRole="button"
              accessibilityLabel="List view"
              accessibilityState={{ selected: viewMode === 'list' }}
              style={{
                padding: 7,
                borderRadius: 8,
                backgroundColor: viewMode === 'list' ? colors.surface : 'transparent',
              }}
            >
              <ListIcon
                size={18}
                color={viewMode === 'list' ? colors.accent : colors.inkMuted}
                weight="bold"
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setViewMode('map')}
              accessibilityRole="button"
              accessibilityLabel="Map view"
              accessibilityState={{ selected: viewMode === 'map' }}
              style={{
                padding: 7,
                borderRadius: 8,
                backgroundColor: viewMode === 'map' ? colors.surface : 'transparent',
              }}
            >
              <MapPin
                size={18}
                color={viewMode === 'map' ? colors.accent : colors.inkMuted}
                weight="bold"
              />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Search (LOOP-175) */}
      <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
        <TextInputField
          value={query}
          onChangeText={setQuery}
          placeholder="Search events and orgs..."
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearable
          borderRadius={999}
          leftIcon={<LhlSearchIcon size={14} color={colors.inkSecondary} />}
        />
      </View>

      {/* Feed selector (LOOP-177) */}
      <ExploreToggles selection={selection} onSelect={handleSelect} />

      {/* Divider */}
      <View
        style={{
          height: 1,
          backgroundColor: colors.divider,
          marginHorizontal: 20,
          marginTop: 14,
          marginBottom: 16,
        }}
      />
    </>
  );

  if (eventsQuery.isPending) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: colors.background }}
        edges={['left', 'right']}
      >
        {header}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (eventsQuery.isError) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: colors.background }}
        edges={['left', 'right']}
      >
        {header}
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}
        >
          <Text style={{ fontSize: 16, color: colors.inkMuted, textAlign: 'center' }}>
            Could not load events. Check your connection.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const orgSection = showOrgSection ? (
    <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
      <Text
        style={{
          fontSize: 13,
          fontWeight: '700',
          color: colors.inkMuted,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          marginBottom: 4,
        }}
      >
        Organizations
      </Text>

      {!isSearching ? (
        <Text style={{ color: colors.inkMuted, paddingVertical: 12 }}>
          Search to find an organization.
        </Text>
      ) : orgsQuery.isPending ? (
        <ActivityIndicator color={colors.accent} style={{ paddingVertical: 12 }} />
      ) : orgResults.length === 0 ? (
        <Text style={{ color: colors.inkMuted, paddingVertical: 12 }}>
          No organizations match “{debouncedQuery}”.
        </Text>
      ) : (
        orgResults.map((org) => <OrgResultRow key={org.id} org={org} />)
      )}
    </View>
  ) : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['left', 'right']}>
      {showList ? (
        <FlatList
          key={`explore-grid-${selectionKey(selection)}`}
          data={showEventSection ? visibleEvents : []}
          keyExtractor={(item) => `${item.source}-${item.source_event_id}`}
          numColumns={2}
          columnWrapperStyle={{ gap: 12 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, gap: 12 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={{ marginHorizontal: -16 }}>
              {header}
              {orgSection}
              {showEventSection && showOrgSection && (
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: '700',
                    color: colors.inkMuted,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    paddingHorizontal: 16,
                    marginBottom: 8,
                  }}
                >
                  Events
                </Text>
              )}
            </View>
          }
          ListEmptyComponent={
            showEventSection ? (
              <Text style={{ color: colors.inkMuted, textAlign: 'center', marginTop: 40 }}>
                {isSearching ? `No events match “${debouncedQuery}”.` : 'No events found.'}
              </Text>
            ) : null
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
          {header}
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
        </View>
      )}
    </SafeAreaView>
  );
}
