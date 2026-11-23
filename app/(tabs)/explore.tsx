import ResultsErrorBoundary from '@/app/components/ErrorBoundary';
import { ApiEvent } from '@/app/components/EventCard';
import EventMiniCard from '@/app/components/EventMiniCard';
import MapViewWrapper, { LocatedEvent, MapRegion } from '@/app/components/MapViewWrapper';
import ExploreFilterButton from '@/app/components/explore/ExploreFilterButton';
import ExploreFilterSheet from '@/app/components/explore/ExploreFilterSheet';
import ExploreInterestGrid, {
  type InterestTile,
} from '@/app/components/explore/ExploreInterestsGrid';
import ExploreListPanel from '@/app/components/explore/ExploreListPanel';
import ExploreOrgFilterSheet from '@/app/components/explore/ExploreOrgFilterSheet';
import ExploreSortControl, { type EventSort } from '@/app/components/explore/ExploreSortControl';
import ExploreToggles, {
  ExploreSelection,
  isOrgSelection,
  selectionKey,
} from '@/app/components/explore/ExploreToggles';
import ExploreTrendingHero, {
  trendingThisWeek,
} from '@/app/components/explore/ExploreTrendingHero';
import OrgResultRow, { OrgSearchResult } from '@/app/components/explore/OrgResultRow';
import FlyerCard from '@/app/components/home/FlyerCard';
import TextInputField from '@/app/components/inputs/TextInputField';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { api } from '@/app/lib/api';
import { INTEREST_CATEGORIES } from '@/app/lib/interestCategories';
import { type ClusterMarker } from '@/app/lib/mapClusters';
import {
  EMPTY_ORG_FILTERS,
  activeOrgFilterCount,
  applyOrgFilterParams,
  type OrgFilters,
} from '@/app/lib/orgFilters';
import { feed as feedKeys, org as orgKeys, user as userKeys } from '@/app/lib/queryKeys';
import { useThemeColors } from '@/app/lib/themeColors';
import { useDebounced } from '@/app/lib/useDebounced';
import { useSavedEvents } from '@/app/lib/useSavedEvents';
import LhlSearchIcon from '@/assets/icons/LhlSearchIcon';
import { COLLEGES, collegeById, collegeForSource } from '@/shared/colleges';
import { EVENT_BENEFIT_OPTIONS } from '@/shared/eventBenefits';
import {
  EMPTY_FILTERS,
  activeFilterCount,
  applyFilters,
  describeFilters,
  facetCounts,
  hasActiveFilters,
  type ExploreFilters,
  type FilterContext,
} from '@/shared/exploreFilters';
import { ORG_SEARCH_MIN_QUERY, type OrgSortOption } from '@/shared/orgRegistration';
import { TAXONOMY_BUCKETS } from '@/shared/taxonomy';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter, type ErrorBoundaryProps } from 'expo-router';
import { BuildingsIcon, ListIcon, MapPin } from 'phosphor-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TextInputInstance } from 'react-native';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type EventsListResponse = { events: ApiEvent[] };
type OrgSearchResponse = {
  query: string;
  organizations: OrgSearchResult[];
  /** Opaque cursor for the next page, or null at the end of the directory. */
  nextCursor: string | null;
};

/**
 * Orgs per page.
 *
 * The list renders inside the events FlatList's header, which is a plain View
 * and not virtualised, so an unbounded directory would mount every row at once.
 * Capped and paged with "Show more" instead. 20 is enough to read as a
 * directory rather than a teaser, and under the endpoint's own
 * ORG_SEARCH_MAX_LIMIT of 25.
 */
const ORG_PAGE_SIZE = 20;
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
 * Engagement for the Trending chip (LOOP-292): RSVP 3, save 2, view 1, the
 * weights popularityScore uses in server/src/lib/scoring.ts. Duplicated, not
 * imported — server code can't be reached from the client — so keep the two in
 * step. Counts only; the server's log squash doesn't change an ordering.
 */
function engagement(event: ApiEvent): number {
  return event.rsvp_count * 3 + event.save_count * 2 + event.view_count;
}

/**
 * created_at is D1's 'YYYY-MM-DD HH:MM:SS' in UTC. That space-separated form is
 * not ISO 8601, and Hermes' Date.parse returns NaN for it, so it is rewritten
 * to ISO first. Missing or unparseable sorts last.
 */
function createdAtMs(event: ApiEvent): number {
  if (!event.created_at) return 0;
  const ms = Date.parse(`${event.created_at.replace(' ', 'T')}Z`);
  return Number.isNaN(ms) ? 0 : ms;
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

const TOGGLE_BUTTON_HEIGHT = 30;
const TOGGLE_BUTTON_WIDTH = 34;
const TOGGLE_INSET = 3;
const TOGGLE_HEIGHT = TOGGLE_BUTTON_HEIGHT + TOGGLE_INSET * 2;
const TOGGLE_ICON_SIZE = 19;

const TOGGLE_HIT_SLOP = { top: 7, bottom: 7, left: 2, right: 2 };

/** The 44pt tap-target floor, met with height rather than hitSlop. */
const SEARCH_BAR_HEIGHT = 44;

/** Figma: 20px page gutters, 18px between the two columns. */
const GUTTER = 20;
const COLUMN_GAP = 18;

export default function ExploreScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { data } = useOnboarding();
  const token = data.token || null;
  const { savedIds, toggleSave: handleToggleSave } = useSavedEvents(token);

  const { width: screenWidth } = useWindowDimensions();
  // Sized from the screen, like View All, so a lone card on an odd last row
  // stays one column wide instead of stretching across the page.
  const cardWidth = Math.floor((screenWidth - GUTTER * 2 - COLUMN_GAP) / 2);

  // Default to map on native (the primary feature); web is locked to list.
  const [viewMode, setViewMode] = useState<ViewMode>(IS_WEB ? 'list' : 'map');
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [selection, setSelection] = useState<ExploreSelection>({ kind: 'all' });
  const [eventSort, setEventSort] = useState<EventSort>('trending');
  // Deep link from Home's "Orgs For You" → "See all": `?view=orgs` opens the org
  // directory instead of the events feed. Explore is a tab and stays mounted, so
  // the initial state above never sees the param on a second visit — it has to
  // be applied here, then cleared so switching tabs doesn't re-apply it and pin
  // the user to Orgs.
  const { view, interest } = useLocalSearchParams<{
    view?: string;
    interest?: string;
  }>();
  useEffect(() => {
    if (view === 'orgs') {
      setSelection({ kind: 'orgs' });
      router.setParams({ view: undefined });
    }
  }, [view, router]);
  const [query, setQuery] = useState('');

  // --- Filters ("College Lens") -------------------------------------------
  const [filters, setFilters] = useState<ExploreFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    if (!interest) return;

    if (INTEREST_CATEGORIES.some((category) => category.id === interest)) {
      setSelection({ kind: 'all' });
      setViewMode('list');
      setQuery('');
      setFilters({ ...EMPTY_FILTERS, interests: [interest] });
    }

    router.setParams({ interest: undefined });
  }, [interest, router]);

  /**
   * Org filters (LOOP-293) are their own state, not a field on `filters`:
   * they go to the server as query params, the event filters never leave the
   * device, and switching tabs must not carry one set into the other's badge.
   */
  const [orgFilters, setOrgFilters] = useState<OrgFilters>(EMPTY_ORG_FILTERS);

  /**
   * `now` is state rather than a fresh `new Date()` per render.
   *
   * It is a dependency of every memo below, so a value that changed on every
   * render would defeat all of them and re-filter ~100 events continuously.
   * Refreshed when the sheet opens, which is the only moment a stale "Today"
   * boundary could actually mislead anyone — a session left open across
   * midnight re-reads the clock the next time the user goes to filter.
   */
  const [now, setNow] = useState(() => new Date());

  const openFilters = useCallback(() => {
    setNow(new Date());
    setFiltersOpen(true);
  }, []);

  const debouncedQuery = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  const needle = debouncedQuery.toLowerCase();
  const isSearching = debouncedQuery.length >= ORG_SEARCH_MIN_QUERY;

  const activeSelectionKey = selectionKey(selection);
  const orgMode = isOrgSelection(selection);

  /**
   * One request, one page, every filter applied over it in memory.
   *
   * This used to branch to GET /feed/bucket/:id when an interest pill was
   * active. Interests are now one of four filter groups, and the others
   * (college, time, perks) have no endpoint at all — so a server round trip
   * could satisfy at most a quarter of the sheet and the rest would still be
   * filtered locally. Splitting the work across two places would also break the
   * live counts, which are the design's whole thesis: a chip can only promise
   * "47" if the 47 is computed from the same set the list is drawn from.
   *
   * The honest limit: this is exact for the ~100 events a feed page returns and
   * wrong the moment the corpus outgrows one page — the same caveat
   * `matchesEvent` above already carries. When GET /feed/explore learns these
   * as query parameters, shared/exploreFilters.ts is the predicate to hand it,
   * and `facetCounts` is what the response then has to include.
   */
  const eventsQuery = useQuery({
    queryKey: feedKeys.explore({ limit: '100' }),
    queryFn: () => api.get<EventsListResponse>('/feed/explore?limit=100', { token }),
    staleTime: 30_000,
  });

  // The user's own interests (LOOP-292), for Browse by Interest. Same key as the
  // Profile tab, so it is usually already cached, and editing interests there
  // invalidates it here too.
  const meQuery = useQuery({
    queryKey: userKeys.me(),
    queryFn: () => api.get<{ user: { tags: string[] } }>('/users/me', { token }),
    enabled: !!token,
    staleTime: 30_000,
  });

  /**
   * The org directory, a page at a time.
   *
   * GET /orgs/search grew a browse-all mode in LOOP-264. An OMITTED query
   * means "the whole directory" server-side; a query that is present but
   * shorter than ORG_SEARCH_MIN_QUERY returns nothing, so `q` is only ever set
   * once the user has typed enough to search.
   *
   * Sort by destination (LOOP-293):
   *   New Orgs  -> newest, most recently added to Loop first.
   *   Orgs, or a search from Trending -> az. While searching, the server ranks
   *     exact and prefix matches first and alphabetises WITHIN each tier, so
   *     typing an org's exact name puts it at the top (orgs.worker.ts
   *     sortKeysFor — it used to be name-first, which buried exact matches).
   *
   * Org filters apply only on the org destinations. A search from Trending
   * shows org matches alongside events, and an org filter the user can't see
   * from there (its sheet is the event one) must not silently narrow them.
   */
  const orgSort: OrgSortOption = selection.kind === 'newOrgs' ? 'newest' : 'az';
  const orgRequest = useMemo(() => {
    const params = new URLSearchParams({ sort: orgSort, limit: String(ORG_PAGE_SIZE) });
    if (isSearching) params.set('q', debouncedQuery);
    if (orgMode) applyOrgFilterParams(params, orgFilters);
    return params.toString();
  }, [orgSort, isSearching, debouncedQuery, orgMode, orgFilters]);

  const orgsQuery = useInfiniteQuery({
    queryKey: orgKeys.directory(orgRequest),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams(orgRequest);
      if (pageParam) params.set('cursor', pageParam);
      return api.get<OrgSearchResponse>(`/orgs/search?${params.toString()}`, { token });
    },
    // undefined, not null: undefined is what tells TanStack there is no next
    // page, and null would be read as a real cursor value.
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // Runs for the org destinations even with nothing typed — that is the
    // directory — and for a search from any tab, because org results show
    // there too.
    enabled: !!token && (orgMode || isSearching),
    staleTime: 30_000,
  });

  const allEvents = useMemo(() => eventsQuery.data?.events ?? [], [eventsQuery.data]);

  /**
   * THE PIPELINE, in the order the user thinks about it:
   *
   *   allEvents  --search-->  searchedEvents  --filters-->  visibleEvents
   *
   * Search first, filters second, and the facet counts are computed over
   * `searchedEvents`. That ordering is the whole reason the counts can be
   * trusted: with a query typed, a chip that says 12 has to mean "12 of the
   * things matching your search", not 12 of the whole page — otherwise it
   * promises 12 and the list shows 3.
   */
  const searchedEvents = useMemo(
    () => (isSearching ? allEvents.filter((e) => matchesEvent(e, needle)) : allEvents),
    [allEvents, isSearching, needle],
  );

  /**
   * Everything the filter module needs that lives outside it: how to read a
   * college off an event, what tags belong to which bucket, and what time it
   * is. Assembled here so shared/exploreFilters.ts stays free of both the
   * taxonomy import and the clock.
   */
  const filterContext: FilterContext = useMemo(
    () => ({
      collegeOf: collegeForSource,
      bucketTags: Object.fromEntries(TAXONOMY_BUCKETS.map((b) => [b.id, b.tags])),
      now,
    }),
    [now],
  );

  const visibleEvents = useMemo(
    () => applyFilters(searchedEvents, filters, filterContext),
    [searchedEvents, filters, filterContext],
  );

  // Newest and A-Z override everything. "Trending" is the default order for
  // whichever chip is selected: the feed's own ranking, or engagement on the
  // Trending chip. The map keeps visibleEvents: pin order means nothing there.
  const listEvents = useMemo(() => {
    if (eventSort === 'newest') {
      return [...visibleEvents].sort((a, b) => createdAtMs(b) - createdAtMs(a));
    }
    if (eventSort === 'az') {
      return [...visibleEvents].sort((a, b) => a.title.localeCompare(b.title));
    }
    return selection.kind === 'trending'
      ? [...visibleEvents].sort((a, b) => engagement(b) - engagement(a))
      : visibleEvents;
  }, [eventSort, selection.kind, visibleEvents]);

  const heroEvent = useMemo(() => {
    const trending = trendingThisWeek(allEvents, now);
    return trending.find((e) => e.image_url) ?? trending[0] ?? null;
  }, [allEvents, now]);

  // Only on the plain All Events view. With a search or any filter on, the
  // hero would push the results the user asked for off the screen.
  const showHero =
    !orgMode &&
    selection.kind === 'all' &&
    !isSearching &&
    !hasActiveFilters(filters) &&
    heroEvent !== null;

  const openTrending = useCallback(
    () =>
      router.push({
        pathname: '/view-all' as any,
        params: { title: 'Trending this week', section: 'trending' },
      }),
    [router],
  );

  const counts = useMemo(
    () =>
      facetCounts(searchedEvents, filters, filterContext, {
        collegeIds: COLLEGES.map((c) => c.id),
        bucketIds: TAXONOMY_BUCKETS.map((b) => b.id),
        perkNames: [...EVENT_BENEFIT_OPTIONS],
      }),
    [searchedEvents, filters, filterContext],
  );

  // The user's own buckets first, busiest first, then everyone else's. The
  // grid shows the first four, so a user with fewer than four interests gets
  // the busiest other buckets to fill the row. Buckets come from tags the same
  // way the feed derives them (feed.worker.ts loadUserInterest). Empty buckets
  // are dropped: "0 active events" is a dead end, even for a bucket they picked.
  const interestTiles: InterestTile[] = useMemo(() => {
    const myTags = new Set(meQuery.data?.user?.tags ?? []);
    const mine = new Set(
      INTEREST_CATEGORIES.filter((c) => c.tags.some((t) => myTags.has(t))).map((c) => c.id),
    );
    const withCounts = INTEREST_CATEGORIES.map((c) => ({
      ...c,
      count: counts.interests[c.id] ?? 0,
    }))
      .filter((c) => c.count > 0)
      .sort((a, b) => b.count - a.count);
    return [
      ...withCounts.filter((c) => mine.has(c.id)),
      ...withCounts.filter((c) => !mine.has(c.id)),
    ];
  }, [counts, meQuery.data]);

  /** "47 events · Cockrell · this week" — the line above the results. */
  const resultSummary = useMemo(() => {
    const parts = describeFilters(filters, (id) => collegeById(id)?.short);
    const noun = visibleEvents.length === 1 ? 'event' : 'events';
    return [`${visibleEvents.length} ${noun}`, ...parts].join(' · ');
  }, [filters, visibleEvents.length]);

  const showInterests =
    !orgMode &&
    selection.kind === 'all' &&
    !isSearching &&
    !hasActiveFilters(filters) &&
    interestTiles.length > 0;
  /**
   * Every loaded page, flattened. Keyset pagination already guarantees no
   * overlap between pages, but the de-dupe by id stays as a backstop: a
   * duplicate here is a duplicate React key, which drops a row on native and
   * warns loudly on web — a worse failure than one org silently skipped.
   */
  const orgResults = useMemo(() => {
    const seen = new Set<number>();
    return (orgsQuery.data?.pages ?? [])
      .flatMap((page) => page.organizations)
      .filter((org) => (seen.has(org.id) ? false : (seen.add(org.id), true)));
  }, [orgsQuery.data]);

  const orgFilterCount = activeOrgFilterCount(orgFilters);
  const orgFilterKey = [
    orgFilters.verifiedOnly ? 'v' : '',
    orgFilters.categories.join('+'),
    orgFilters.hasUpcomingEvents ? 'u' : '',
  ].join('|');

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
   * THE FILTERS BELONG IN THIS KEY for exactly the same reason the query does.
   * Applying one shrinks `data` under the same render window — narrowing 100
   * events to 3 while scrolled to row 40 is the identical out-of-range read.
   * Spelled out field by field rather than via a count, because swapping one
   * college for another leaves the count unchanged while replacing every row.
   *
   * Remounting closes it: a new list starts at offset 0 with no cached frames,
   * so there is no stale window left to read. The cost is rebuilding ~100 cells
   * at each debounce boundary — cheap, and the content is changing wholesale at
   * that moment anyway. Note this keys off `needle` (the DEBOUNCED query), not
   * `query`, so it is once per typing pause, not once per keystroke.
   */
  const filterKey = [
    filters.collegeId ?? '',
    filters.interests.join('+'),
    filters.when,
    filters.perks.join('+'),
  ].join('|');
  const gridKey = `explore-grid-${activeSelectionKey}-${eventSort}-${isSearching ? needle : ''}-${
    orgMode ? orgFilterKey : filterKey
  }`;

  // Type-narrowed subset: only events with non-null coordinates go on the map.
  // Driven by visibleEvents so the pins honour the search and the filters too.
  const locatedEvents: LocatedEvent[] = useMemo(
    () => visibleEvents.filter((e): e is LocatedEvent => e.latitude != null && e.longitude != null),
    [visibleEvents],
  );

  /**
   * What the filters excluded, for the map to draw grey.
   *
   * Excluded by FILTERS only, not by search: a pin dropped because it doesn't
   * match what you typed isn't a thing you narrowed away, it's a thing you
   * didn't ask about, and greying every event on campus during a search would
   * bury the handful of matches under 200 grey pins.
   */
  const dimmedEvents: LocatedEvent[] = useMemo(() => {
    const visible = new Set(visibleEvents.map((e) => e.id));
    return searchedEvents.filter(
      (e): e is LocatedEvent => e.latitude != null && e.longitude != null && !visible.has(e.id),
    );
  }, [searchedEvents, visibleEvents]);

  /**
   * The tapped cluster's events, or null when no cluster is open.
   *
   * The events rather than a coordinate: the map already worked out which
   * events belong to that bubble, and re-deriving it here would put a second
   * copy of the grouping rule on this screen.
   */
  const [clusterEvents, setClusterEvents] = useState<ApiEvent[] | null>(null);

  /**
   * ONE MARKER, ONE ANSWER. A single pin gets the mini card it always had; a
   * counted bubble gets the list panel. They are mutually exclusive because
   * both anchor to the bottom of the map and would otherwise overlap — and
   * because a pin is one event and a bubble is a building, which are two
   * different questions deserving two different answers.
   */
  const handlePinPress = useCallback((eventId: number) => {
    setClusterEvents(null);
    setSelectedEventId((prev) => (prev === eventId ? null : eventId));
  }, []);

  const handleClusterPress = useCallback((cluster: ClusterMarker<LocatedEvent>) => {
    setSelectedEventId(null);
    setClusterEvents(cluster.events);
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

  /**
   * A ref, not state — nothing should re-render because the camera moved.
   *
   * This briefly WAS state, when the list panel was scoped to the viewport and
   * genuinely needed to know. That cost a full re-render of this screen, the
   * map and the list on every settled pan, and it was the jitter people
   * reported. The panel is scoped to a tapped cluster now, so nothing on screen
   * depends on the camera and the ref is enough again.
   */
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
  const searchRef = useRef<TextInputInstance>(null);
  const dismissSearch = useCallback(() => {
    searchRef.current?.blur();
    Keyboard.dismiss();
  }, []);

  /** Stable identity: an inline arrow re-renders every Marker (see MapViewWrapper). */
  const handleMapPress = useCallback(() => {
    setSelectedEventId(null);
    // Bare map also closes the venue panel — one tap should not leave one of
    // the two marker answers open behind a dismissed other.
    setClusterEvents(null);
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
      <FlyerCard
        item={item}
        isSaved={savedIds.has(item.id)}
        onToggleSave={handleToggleSave}
        width={cardWidth}
        placeholderVariant="fractalGlass"
      />
    ),
    [savedIds, handleToggleSave, cardWidth],
  );

  const selectedEvent =
    selectedEventId != null ? (visibleEvents.find((e) => e.id === selectedEventId) ?? null) : null;

  // The org destinations are list-only — there is nothing to pin on a map.
  // They render orgs as the list's own rows (see body()); `orgSection` is only
  // the org block that rides above the events when searching from Trending.
  const showList = viewMode === 'list' || IS_WEB || orgMode;
  const showOrgSection = !orgMode && isSearching;
  const showEventSection = !orgMode;

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
          paddingTop: 70,
          paddingBottom: 12,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <View style={{ gap: 2 }}>
          <Text className="font-roboto-semibold" style={{ fontSize: 13, color: colors.accent }}>
            DISCOVER CAMPUS
          </Text>
          <Text className="font-roboto-medium" style={{ fontSize: 24, color: colors.ink }}>
            Explore
          </Text>
        </View>

        {/* Toggle hidden on web — react-native-maps has no web renderer — and on
            the Orgs feed, which has nothing to map. */}
        {!IS_WEB && !orgMode && (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              height: TOGGLE_HEIGHT,
              backgroundColor: colors.segmentTrack,
              borderRadius: 8,
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
                width: TOGGLE_BUTTON_WIDTH,
                height: TOGGLE_BUTTON_HEIGHT,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 6,
                borderWidth: 1,
                borderColor: viewMode === 'list' ? colors.brandSoft : 'transparent',
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
                width: TOGGLE_BUTTON_WIDTH,
                height: TOGGLE_BUTTON_HEIGHT,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 6,
                borderWidth: 1,
                borderColor: viewMode === 'map' ? colors.brandSoft : 'transparent',
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
          placeholder="Search events or orgs..."
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          // Dismisses on the keyboard's own Search key, so the field is not the
          // one place on the screen with no way out.
          onSubmitEditing={dismissSearch}
          clearable
          borderRadius={8}
          height={SEARCH_BAR_HEIGHT}
          leftIcon={<LhlSearchIcon size={18} color={colors.inkSecondary} />}
          rightAccessory={
            <ExploreFilterButton
              activeCount={orgMode ? orgFilterCount : activeFilterCount(filters)}
              open={filtersOpen}
              onPress={openFilters}
            />
          }
        />
      </View>

      {/* Feed selector (LOOP-177) + the Filters entry point */}
      <ExploreToggles
        selection={selection}
        interests={filters.interests}
        onSelect={handleSelect}
        onChangeInterests={(interests) => setFilters((prev) => ({ ...prev, interests }))}
      />

      <View
        style={{
          height: 1,
          backgroundColor: colors.divider,
          marginHorizontal: 20,
          marginTop: 14,
          marginBottom: showEventSection && hasActiveFilters(filters) ? 10 : 16,
        }}
      />

      {/* The active filters, stated in words, after the sheet has closed.
          Without this the only evidence that a filter is on is a shorter list,
          which reads as "the app has nothing" rather than "you asked for this"
          — the single most common way a filtered view gets mistaken for a bug. */}
      {showEventSection && hasActiveFilters(filters) ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingHorizontal: 20,
            marginBottom: 14,
          }}
        >
          <Text style={{ flex: 1, fontSize: 12.5, fontWeight: '700', color: colors.inkSecondary }}>
            {resultSummary}
          </Text>
          <TouchableOpacity
            onPress={() => setFilters(EMPTY_FILTERS)}
            accessibilityRole="button"
            accessibilityLabel="Clear all filters"
            hitSlop={10}
          >
            <Text style={{ fontSize: 12.5, fontWeight: '700', color: colors.accent }}>Clear</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </>
  );

  /**
   * Why the org list is empty, said in words, with the one-tap way out
   * (LOOP-293). A bare blank list after a search reads as "still loading" or
   * "broken"; the same mistake the event list's filter summary exists to stop.
   */
  const orgFiltersApplied = orgMode && orgFilterCount > 0;
  const orgEmptyState = (
    <View style={{ alignItems: 'center', paddingVertical: 32, paddingHorizontal: 24, gap: 8 }}>
      <BuildingsIcon size={32} color={colors.inkMuted} />
      <Text
        className="font-roboto-semibold"
        style={{ fontSize: 15, color: colors.ink, textAlign: 'center' }}
      >
        {isSearching
          ? `No organizations match “${debouncedQuery}”`
          : orgFiltersApplied
            ? 'No organizations match these filters'
            : 'No organizations yet'}
      </Text>
      {isSearching || orgFiltersApplied ? (
        <Text
          className="font-roboto"
          style={{ fontSize: 13, color: colors.inkMuted, textAlign: 'center' }}
        >
          {isSearching
            ? 'Check the spelling, or try part of the name.'
            : 'Try turning a filter off.'}
        </Text>
      ) : null}
      {orgFiltersApplied ? (
        <TouchableOpacity
          onPress={() => setOrgFilters(EMPTY_ORG_FILTERS)}
          accessibilityRole="button"
          accessibilityLabel="Clear organization filters"
          hitSlop={10}
          style={{ marginTop: 4 }}
        >
          <Text className="font-roboto-bold" style={{ fontSize: 14, color: colors.accent }}>
            Clear filters
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
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

      {orgsQuery.isPending ? (
        <ActivityIndicator color={colors.accent} style={{ paddingVertical: 12 }} />
      ) : orgResults.length === 0 ? (
        orgEmptyState
      ) : (
        <View style={{ gap: 12 }}>
          {orgResults.map((org) => (
            <OrgResultRow key={org.id} org={org} />
          ))}

          {/* Paged rather than infinite-scrolling on purpose: this list lives
              in a non-virtualised header, and an auto-loading list there would
              keep mounting rows until the directory ran out. A button makes
              the cost the user's choice and keeps the page bounded. */}
          {orgsQuery.hasNextPage ? (
            <TouchableOpacity
              onPress={() => orgsQuery.fetchNextPage()}
              disabled={orgsQuery.isFetchingNextPage}
              accessibilityRole="button"
              accessibilityLabel="Show more organizations"
              accessibilityState={{ disabled: orgsQuery.isFetchingNextPage }}
              style={{
                marginTop: 10,
                minHeight: 44,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              {orgsQuery.isFetchingNextPage ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <Text style={{ fontSize: 13.5, fontWeight: '700', color: colors.accent }}>
                  Show more
                </Text>
              )}
            </TouchableOpacity>
          ) : (
            /* The end of the directory, said out loud. Without it a list that
               simply stops looks like one that failed to load the rest. */
            <Text
              style={{
                marginTop: 10,
                textAlign: 'center',
                fontSize: 11.5,
                color: colors.inkMuted,
              }}
            >
              {orgResults.length} {orgResults.length === 1 ? 'organization' : 'organizations'}
              {isSearching ? '' : ' · that’s all of them'}
            </Text>
          )}
        </View>
      )}
    </View>
  ) : undefined;

  let resultsHeading = 'UPCOMING';

  if (selection.kind === 'trending') {
    resultsHeading = 'TRENDING';
  } else if (selection.kind === 'all' && filters.interests.length === 1) {
    if (filters.interests[0] === 'social') {
      resultsHeading = 'SOCIAL';
    } else if (filters.interests[0] === 'education') {
      resultsHeading = 'CAREER';
    }
  }

  // "UPCOMING" and how many events are in it (LOOP-292). It scrolls with the
  // list: it holds no text input, so the pinned-header rule doesn't apply.
  const resultsHeader = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <Text className="font-roboto-bold" style={{ fontSize: 16, color: colors.inkSecondary }}>
        {resultsHeading}
      </Text>
      <ExploreSortControl
        count={listEvents.length}
        sort={eventSort}
        onChange={setEventSort}
        categoryLabel={
          resultsHeading === 'SOCIAL'
            ? 'Social'
            : resultsHeading === 'CAREER'
              ? 'Career'
              : undefined
        }
      />
    </View>
  );

  /**
   * The org destinations' list (LOOP-293). The orgs are the FlatList's own
   * rows here, not a header above an empty event grid, so the list is
   * virtualised and can page itself in on scroll via onEndReached — the
   * "Show more" button below the Trending-search org block exists only
   * because that block lives in a non-virtualised header.
   *
   * Not gated on eventsQuery: the org list has nothing to wait for from the
   * event feed, and an events outage should not blank the directory.
   */
  const orgList = () => (
    <FlatList
      key={gridKey}
      data={orgsQuery.isPending ? [] : orgResults}
      keyExtractor={(org) => String(org.id)}
      renderItem={({ item }) => <OrgResultRow org={item} />}
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 12 }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      onEndReached={() => {
        // isFetching, not just isFetchingNextPage: onEndReached can fire again
        // while the first page is still landing, and a fetchNextPage then
        // would run without the cursor the first page is about to supply.
        if (orgsQuery.hasNextPage && !orgsQuery.isFetching) void orgsQuery.fetchNextPage();
      }}
      onEndReachedThreshold={0.5}
      ListEmptyComponent={
        orgsQuery.isPending ? (
          <ActivityIndicator color={colors.accent} style={{ paddingVertical: 24 }} />
        ) : orgsQuery.isError ? (
          <Text style={{ color: colors.inkMuted, textAlign: 'center', paddingVertical: 24 }}>
            Could not load organizations. Check your connection.
          </Text>
        ) : (
          orgEmptyState
        )
      }
      ListFooterComponent={
        orgResults.length === 0 ? undefined : orgsQuery.isFetchingNextPage ? (
          <ActivityIndicator color={colors.accent} style={{ paddingVertical: 12 }} />
        ) : !orgsQuery.hasNextPage ? (
          // The end of the list, said out loud. Without it a list that simply
          // stops looks like one that failed to load the rest.
          <Text
            style={{ textAlign: 'center', fontSize: 11.5, color: colors.inkMuted, paddingTop: 4 }}
          >
            {orgResults.length} {orgResults.length === 1 ? 'organization' : 'organizations'}
            {isSearching || orgFiltersApplied ? '' : ' · that’s all of them'}
          </Text>
        ) : undefined
      }
    />
  );

  const body = () => {
    if (orgMode) return orgList();

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
          data={showEventSection ? listEvents : []}
          extraData={savedIds}
          keyExtractor={keyExtractor}
          numColumns={2}
          columnWrapperStyle={{ gap: COLUMN_GAP }}
          contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 32, gap: 14 }} // persistTaps "handled": a tap on dead space in the list dismisses
          showsVerticalScrollIndicator={false}
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
          ListHeaderComponent={
            <>
              {orgSection}
              {showHero && heroEvent ? (
                <ExploreTrendingHero event={heroEvent} now={now} onSeeAll={openTrending} />
              ) : null}
              {showInterests ? (
                <ExploreInterestGrid
                  tiles={interestTiles.slice(0, 4)}
                  onSeeAll={() =>
                    router.push({
                      pathname: '/view-all' as any,
                      params: {
                        section: 'interests',
                        title: 'Browse by Interest',
                        interestCounts: JSON.stringify(
                          interestTiles.map(({ id, count }) => [id, count]),
                        ),
                      },
                    })
                  }
                  onSelect={(id) => setFilters((prev) => ({ ...prev, interests: [id] }))}
                />
              ) : null}
              {showEventSection ? resultsHeader : null}
            </>
          }
          ListEmptyComponent={
            showEventSection ? (
              <View style={{ marginTop: 40, alignItems: 'center', paddingHorizontal: 24 }}>
                <Text style={{ color: colors.inkMuted, textAlign: 'center' }}>
                  {isSearching
                    ? `No events match “${debouncedQuery}”.`
                    : hasActiveFilters(filters)
                      ? 'No events match these filters.'
                      : 'No events found.'}
                </Text>
                {/* An empty list caused by a filter gets the way out, right
                    here. You can only reach this state from a search or from
                    filters that were non-empty when they were applied and have
                    since gone stale, so the recovery has to be one tap. */}
                {hasActiveFilters(filters) ? (
                  <TouchableOpacity
                    onPress={() => setFilters(EMPTY_FILTERS)}
                    accessibilityRole="button"
                    accessibilityLabel="Clear all filters"
                    style={{ marginTop: 12 }}
                    hitSlop={10}
                  >
                    <Text style={{ fontSize: 14, fontWeight: '700', color: colors.accent }}>
                      Clear filters
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : undefined
          }
          renderItem={renderItem}
        />
      );
    }

    return (
      <View style={{ flex: 1 }}>
        <MapViewWrapper
          events={locatedEvents}
          dimmedEvents={dimmedEvents}
          selectedEventId={selectedEventId}
          onPinPress={handlePinPress}
          onClusterPress={handleClusterPress}
          onMapPress={handleMapPress}
          getInitialRegion={getLastRegion}
          onRegionSettled={handleRegionSettled}
        />

        {/* One pin: the mini card, unchanged. */}
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

        {/* One building: the list panel, opened by its bubble and showing only
            that bubble's events. */}
        <ExploreListPanel
          visible={clusterEvents !== null}
          events={clusterEvents ?? []}
          onClose={() => setClusterEvents(null)}
          onSelectEvent={handleViewDetails}
        />
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
        resetKeys={[needle, activeSelectionKey, showList, filterKey, orgFilterKey]}
        message="Could not show these results. Try a different search."
      >
        {body()}
      </ResultsErrorBoundary>

      {/* OUTSIDE the boundary, for the same reason the header is: the sheet is
          how you change what the results are. If a bad filter combination is
          what threw, the control that lets you undo it has to survive the
          fallback — and the fallback's reset keys include the filters, so
          changing one clears it.

          Filters apply live: the list and pins behind the sheet change as you
          tap. The footer button carries the count and dismisses; it is not a
          commit step, so there is no draft state to desync from what you can
          already see. */}
      {/* One button, two sheets: the org destinations get the org sheet, with
          no interest or date groups at all (LOOP-293). */}
      {orgMode ? (
        <ExploreOrgFilterSheet
          visible={filtersOpen}
          filters={orgFilters}
          onChange={setOrgFilters}
          onClose={() => setFiltersOpen(false)}
        />
      ) : (
        <ExploreFilterSheet
          visible={filtersOpen}
          filters={filters}
          counts={counts}
          totalEvents={searchedEvents.length}
          unit={showList ? 'events' : 'pins'}
          onChange={setFilters}
          onClose={() => setFiltersOpen(false)}
        />
      )}
    </SafeAreaView>
  );
}
