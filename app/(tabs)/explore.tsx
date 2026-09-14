import ResultsErrorBoundary from '@/app/components/ErrorBoundary';
import EventCard, { ApiEvent } from '@/app/components/EventCard';
import EventMiniCard from '@/app/components/EventMiniCard';
import MapViewWrapper, { LocatedEvent, MapRegion } from '@/app/components/MapViewWrapper';
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
import { useRouter, type ErrorBoundaryProps } from 'expo-router';
import { CompassIcon, ListIcon, MapPin } from 'phosphor-react-native';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
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
    ...(event.categories ?? []).map((c) => c?.name),
  ];

  // typeof, not `!= null` (LOOP-279). The types say every entry is a string,
  // but these come straight off the wire: `tags` and `categories` are joined
  // server-side from event_tags / event_categories, so a row with an unexpected
  // shape puts a non-string in here and `.toLowerCase()` throws mid-keystroke —
  // an unhandled throw in render, which in a release build is a hard crash and
  // not a red box. Worth noting `.some()` short-circuits: a needle that matches
  // the title never reaches the tags, so a bad tag only bites on queries that
  // miss everything above it. That is exactly the shape of a crash report that
  // names one specific search term.
  return haystack.some(
    (field) => typeof field === 'string' && field.toLowerCase().includes(needle),
  );
}

/**
 * Route-level backstop (LOOP-279). Expo Router renders this instead of the
 * screen when anything under `/explore` throws during render.
 *
 * The in-screen <ResultsErrorBoundary> below is the one that should normally
 * fire: it swaps only the results and leaves the search field alive, so the
 * user can type their way out. This exists because a boundary cannot catch a
 * throw in its own parent's render, and ExploreScreen does real work before it
 * mounts anything (the search filter, the located-events narrowing). Without
 * this, that class of throw escapes to the native handler, which in a release
 * build is a hard crash with no trace — `app/lib/monitoring.ts` is still a
 * documented no-op, so there would be nothing to symbolicate afterwards.
 *
 * `retry` remounts the route, which resets the query to empty.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const colors = useThemeColors();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}
      >
        <Text style={{ fontSize: 17, fontWeight: '600', color: colors.ink, textAlign: 'center' }}>
          Explore ran into a problem
        </Text>
        <Text
          style={{ fontSize: 14, color: colors.inkMuted, textAlign: 'center', marginTop: 8 }}
          // Shown, not hidden: TestFlight feedback is the only crash channel
          // this app has while monitoring is stubbed, and a tester who can read
          // the message can paste it into a report.
          selectable
        >
          {error?.message ?? 'Unknown error'}
        </Text>
        <TouchableOpacity
          onPress={() => void retry()}
          accessibilityRole="button"
          accessibilityLabel="Reload Explore"
          hitSlop={8}
          style={{ marginTop: 20 }}
        >
          <Text style={{ fontSize: 15, fontWeight: '600', color: colors.accent }}>Reload</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

/** The "Explore" title, and the list/map toggle measured against it. */
const HEADER_TITLE_SIZE = 32;

/**
 * Matches the title's line box (~1.2x its font size), so the toggle and the
 * word "Explore" occupy the same vertical band.
 */
const TOGGLE_HEIGHT = Math.round(HEADER_TITLE_SIZE * 1.2);
const TOGGLE_INSET = 3;
const TOGGLE_ICON_SIZE = 22;

/** Takes each 32x42 button to 44x50 — past the 44pt floor, same control height. */
const TOGGLE_HIT_SLOP = { top: 6, bottom: 6, left: 4, right: 4 };

/** The 44pt tap-target floor, met with height rather than hitSlop. */
const SEARCH_BAR_HEIGHT = 44;

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

  const bucketId = selection.kind === 'bucket' ? selection.id : null;
  const activeSelectionKey = selectionKey(selection);

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
  // until that endpoint grows one (LOOP-264).
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

  /**
   * Identity of the grid. Changing it remounts the list.
   *
   * This is the crash fix (LOOP-279), and it replaces an earlier scroll-to-top
   * effect that only mostly worked. The bug: VirtualizedList keeps a render
   * window of cell frames keyed by index. Editing the query rewrites `data`
   * underneath that window, and if the list is still scrolled to an offset that
   * only existed for the LONGER previous list, it asks for a frame at an index
   * the new data no longer has and throws ("Tried to get frame for out of range
   * index"). An unhandled throw in render is a red box in dev and a hard crash
   * in a release build, which is what a tester reports as "broke when I typed".
   *
   * Why the old fix was not enough: `listRef.current.scrollToOffset(...)` from
   * a useEffect runs AFTER commit, and the native scroll it asks for lands
   * later still. The list has already reconciled the shrunken `data` against
   * the old offset by then, so the throw beats the correction. Racing it with
   * useLayoutEffect just narrows the window instead of closing it.
   *
   * Remounting closes it: a new list starts at offset 0 with no cached frames,
   * so there is no stale window left to read. The cost is rebuilding ~100 cells
   * at each debounce boundary — cheap, and the content is changing wholesale at
   * that moment anyway. Note this keys off `needle` (the DEBOUNCED query), not
   * `query`, so it is once per typing pause, not once per keystroke.
   */
  const gridKey = `explore-grid-${activeSelectionKey}-${isSearching ? needle : ''}`;

  // Type-narrowed subset: only events with non-null coordinates go on the map.
  // Driven by visibleEvents so the pins honour the search too.
  const locatedEvents: LocatedEvent[] = useMemo(
    () => visibleEvents.filter((e): e is LocatedEvent => e.latitude != null && e.longitude != null),
    [visibleEvents],
  );

  // Toggle: tapping the active pin dismisses the card; tapping a new pin selects it.
  const handlePinPress = useCallback((eventId: number) => {
    setSelectedEventId((prev) => (prev === eventId ? null : eventId));
  }, []);

  const handleViewDetails = useCallback(
    (eventId: number) => {
      router.push(`/event/${eventId}`);
    },
    [router],
  );

  /**
   * Where the map camera was when it last settled.
   *
   * Lives up here rather than inside MapViewWrapper because the point is to
   * survive that component unmounting: body() below returns a spinner instead
   * of the map whenever the events query has no data yet, which happens every
   * time the query key changes. A ref inside the map would die with it.
   *
   * A ref, not state -- nothing should re-render because the camera moved.
   */
  const lastRegion = useRef<MapRegion | null>(null);
  const handleRegionSettled = useCallback((region: MapRegion) => {
    lastRegion.current = region;
  }, []);

  /**
   * Handed to the map as a GETTER rather than as `initialRegion={lastRegion.current}`.
   *
   * Two reasons, and they point the same way. The lint one: reading `.current`
   * in the render body is `react-hooks/refs` ("Cannot access refs during
   * render") and fails CI. The real one: an uncontrolled MapView reads its
   * initial region exactly once, at mount, so passing it as a rendered value
   * was always misleading — the map re-reads nothing on later renders. A getter
   * the map calls from a useState initializer makes the mount-only read
   * explicit instead of suppressing the warning about it.
   */
  const getLastRegion = useCallback(() => lastRegion.current ?? undefined, []);

  /**
   * Drop focus on the search field.
   *
   * Both calls are needed. `Keyboard.dismiss()` is what actually retracts the
   * keyboard on iOS and Android, but it is a no-op on web, where the caret and
   * the focus ring would otherwise stay put; `blur()` handles that and also
   * guarantees onBlur fires, which is what clears the field's orange border.
   */
  const searchRef = useRef<TextInput>(null);
  const dismissSearch = useCallback(() => {
    searchRef.current?.blur();
    Keyboard.dismiss();
  }, []);

  /** Stable identity: an inline arrow re-renders every Marker (see MapViewWrapper). */
  const handleMapPress = useCallback(() => {
    setSelectedEventId(null);
    dismissSearch();
  }, [dismissSearch]);

  const handleSelect = useCallback((next: ExploreSelection) => {
    setSelection(next);
    setSelectedEventId(null);
  }, []);

  const keyExtractor = useCallback(
    (item: ApiEvent) => `${item.source}-${item.source_event_id}`,
    [],
  );

  const renderItem = useCallback(
    ({ item }: { item: ApiEvent }) => (
      <EventCard
        item={item}
        isSaved={savedIds.has(item.id)}
        onToggleSave={handleToggleSave}
        style={{ flex: 1, width: undefined, marginRight: 0 }}
      />
    ),
    [savedIds, handleToggleSave],
  );

  const selectedEvent =
    selectedEventId != null ? (visibleEvents.find((e) => e.id === selectedEventId) ?? null) : null;

  // Orgs is a list-only destination — there is nothing to pin on a map.
  const showList = viewMode === 'list' || IS_WEB || selection.kind === 'orgs';
  const showOrgSection = selection.kind === 'orgs' || isSearching;
  const showEventSection = selection.kind !== 'orgs';

  /**
   * The pinned header — title, view toggle, search field, feed toggles.
   *
   * Rendered as a SIBLING of the list, never as ListHeaderComponent. It holds a
   * focused, controlled TextInput, and VirtualizedList reserves the right to
   * unmount and remount its header as the render window moves. Remounting a
   * native text input mid-keystroke is how you lose focus, drop characters, and
   * on Android crash outright. The ticket asks for the search bar "pinned to the
   * top" anyway, so this is both the correct fix and the requested behaviour.
   *
   * Only genuine CONTENT — org results, the Events label — scrolls with the list.
   */
  const pinnedHeader = (
    <>
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
          <Text style={{ fontSize: HEADER_TITLE_SIZE, fontWeight: '700', color: colors.ink }}>
            Explore
          </Text>
        </View>

        {/* Toggle hidden on web — react-native-maps has no web renderer — and on
            the Orgs feed, which has nothing to map.

            Sized against the title rather than by eye: the control is
            TOGGLE_HEIGHT tall so its box matches the line box of "Explore"
            beside it, which is what stops it reading as a small thing floating
            next to a big one. The icons grew with it — 18px glyphs in a 38px
            control were the smallest tap targets on the screen and the hardest
            to see. hitSlop takes each button past the 44pt floor without
            making the control any taller than the title. */}
        {!IS_WEB && selection.kind !== 'orgs' && (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              height: TOGGLE_HEIGHT,
              backgroundColor: colors.surfaceMuted,
              borderRadius: 10,
              padding: TOGGLE_INSET,
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
              hitSlop={TOGGLE_HIT_SLOP}
              style={{
                height: TOGGLE_HEIGHT - TOGGLE_INSET * 2,
                paddingHorizontal: 10,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 8,
                backgroundColor: viewMode === 'list' ? colors.surface : 'transparent',
              }}
            >
              <ListIcon
                size={TOGGLE_ICON_SIZE}
                color={viewMode === 'list' ? colors.accent : colors.inkMuted}
                weight="bold"
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setViewMode('map')}
              accessibilityRole="button"
              accessibilityLabel="Map view"
              accessibilityState={{ selected: viewMode === 'map' }}
              hitSlop={TOGGLE_HIT_SLOP}
              style={{
                height: TOGGLE_HEIGHT - TOGGLE_INSET * 2,
                paddingHorizontal: 10,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 8,
                backgroundColor: viewMode === 'map' ? colors.surface : 'transparent',
              }}
            >
              <MapPin
                size={TOGGLE_ICON_SIZE}
                color={viewMode === 'map' ? colors.accent : colors.inkMuted}
                weight="bold"
              />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Search (LOOP-175) */}
      {/*
        SEARCH_BAR_HEIGHT overrides the 33px form-field default. That default is
        the smallest tap target on this screen and the one the user is aimed at
        first — the same hit-target complaint LOOP-283 raises about the section
        arrows. 44 is the platform floor, and unlike the arrows it can be met
        with real height rather than hitSlop, because a search bar is supposed
        to look like a big soft target. The glyph and text scale with it or the
        control reads as an empty box with something small floating in it.

        Height only here, not in the shared component: TextInputField backs
        every form in the app and raising all of them is a design decision.
      */}
      <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
        <TextInputField
          ref={searchRef}
          value={query}
          onChangeText={setQuery}
          placeholder="Search events and orgs..."
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          // Dismisses on the keyboard's own Search key, so the field is not the
          // one place on the screen with no way out.
          onSubmitEditing={dismissSearch}
          clearable
          borderRadius={999}
          height={SEARCH_BAR_HEIGHT}
          leftIcon={<LhlSearchIcon size={18} color={colors.inkSecondary} />}
        />
      </View>

      {/* Feed selector (LOOP-177) */}
      <ExploreToggles selection={selection} onSelect={handleSelect} />

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

  const orgSection = showOrgSection ? (
    <View style={{ paddingBottom: 8 }}>
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

  const body = () => {
    if (eventsQuery.isPending) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      );
    }

    if (eventsQuery.isError) {
      return (
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}
        >
          <Text style={{ fontSize: 16, color: colors.inkMuted, textAlign: 'center' }}>
            Could not load events. Check your connection.
          </Text>
        </View>
      );
    }

    if (showList) {
      return (
        <FlatList
          key={gridKey}
          data={showEventSection ? visibleEvents : []}
          extraData={savedIds}
          keyExtractor={keyExtractor}
          numColumns={2}
          columnWrapperStyle={{ gap: 12 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, gap: 12 }}
          showsVerticalScrollIndicator={false}
          // persistTaps "handled": a tap on dead space in the list dismisses
          // the keyboard, but a tap on a card still opens the card instead of
          // being eaten as a dismiss. dismissMode "on-drag": starting a scroll
          // counts as leaving the field, which is what a scroll means.
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          // Android detaches clipped subviews by default. Combined with a data
          // array that changes on every keystroke, that is the other reliable
          // way to end up reading a detached cell. Cheap to disable here: the
          // page is capped at ~100 events.
          removeClippedSubviews={false}
          ListHeaderComponent={orgSection}
          ListEmptyComponent={
            showEventSection ? (
              <Text style={{ color: colors.inkMuted, textAlign: 'center', marginTop: 40 }}>
                {isSearching ? `No events match “${debouncedQuery}”.` : 'No events found.'}
              </Text>
            ) : null
          }
          renderItem={renderItem}
        />
      );
    }

    return (
      <View style={{ flex: 1 }}>
        <MapViewWrapper
          events={locatedEvents}
          selectedEventId={selectedEventId}
          onPinPress={handlePinPress}
          onMapPress={handleMapPress}
          getInitialRegion={getLastRegion}
          onRegionSettled={handleRegionSettled}
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
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['left', 'right']}>
      {/*
        Tap anywhere off the search field to leave it.

        Four handlers cover the screen between them, and each has to live where
        it does. This Pressable takes the header — the title row, the padding
        around the search bar, the gaps — which is everything up here that owns
        no touch handler of its own. Below it, the list dismisses via
        keyboardShouldPersistTaps / keyboardDismissMode and the map via
        onMapPress, because a ScrollView claims the responder for touches inside
        it and a native map swallows its own; neither would ever bubble a tap up
        to a wrapper.

        Which is also why this wraps ONLY the header and not the whole screen.
        A Pressable around body() would sit over the MapView, and Pressable
        answers onStartShouldSetResponder with true — on the default view of
        this screen that risks eating the first touch of a pan. Nothing is lost
        by staying up here: the region below the header is always either the
        list or the map, and both already handle it.

        accessible={false} keeps this out of the screen reader's element list.
        It is a fallback gesture, not a control.
      */}
      <Pressable onPress={dismissSearch} accessible={false} android_disableSound>
        {/*
          The header stays OUTSIDE the boundary on purpose (LOOP-279). If
          results throw, the search field has to survive — the fallback's "try
          again" is useless if the only way out of a bad query is to kill the
          app. Resetting on `needle` means editing the query clears the fallback
          on its own.
        */}
        {pinnedHeader}
      </Pressable>
      <ResultsErrorBoundary
        label="explore.results"
        resetKeys={[needle, activeSelectionKey, showList]}
        message="Could not show these results. Try a different search."
      >
        {body()}
      </ResultsErrorBoundary>
    </SafeAreaView>
  );
}
