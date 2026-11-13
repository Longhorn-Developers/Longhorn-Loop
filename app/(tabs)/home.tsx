import BellFilledIcon from '@/assets/images/bell-filled.svg';
import BellIcon from '@/assets/images/bell.svg';
import MoonIcon from '@/assets/images/moon.svg';
import SunIcon from '@/assets/images/sun.svg';
import SunriseIcon from '@/assets/images/sunrise.svg';
import { ApiEvent } from '@/app/components/EventCard';
import CompactEventRow from '@/app/components/home/CompactEventRow';
import FlyerCard from '@/app/components/home/FlyerCard';
import EventPostedModal from '@/app/components/EventPostedModal';
import { HEADER_GAP, SECTION_GAP } from '@/app/components/home/layout';
import OrgsForYouRow from '@/app/components/home/OrgsForYouRow';
import SectionHeader from '@/app/components/home/SectionHeader';
import SpotlightMosaic from '@/app/components/home/SpotlightMosaic';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { api } from '@/app/lib/api';
import { feed as feedKeys, notifications as notificationKeys } from '@/app/lib/queryKeys';
import { useSavedEvents } from '@/app/lib/useSavedEvents';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
import { useThemeColors } from '@/app/lib/themeColors';

// Time-of-day greeting and the glyph that goes with it. Read from the DEVICE
// clock on purpose: "good morning" is about where the person is, so the server's
// timezone (UTC on Workers) would greet a student in Austin with "good evening"
// all afternoon.
function getGreeting(): { text: string; Icon: typeof SunIcon } {
  const hour = new Date().getHours();
  if (hour < 12) return { text: 'Good morning,', Icon: SunriseIcon };
  if (hour < 17) return { text: 'Good afternoon,', Icon: SunIcon };
  return { text: 'Good evening,', Icon: MoonIcon };
}

// Shape of the /feed/home response. Each section is a carousel; the first is
// always "Upcoming", followed by one section per interest bucket. Ranking and
// bucket selection are entirely server-driven (server/src/routes/feed.worker.ts).
type FeedSection = {
  key: string;
  label: string;
  bucketId?: string;
  events: ApiEvent[];
};
type FeedHomeResponse = { sections: FeedSection[] };

// Only the field the bell badge needs. The notifications screen has the full
// shape (app/notifications.tsx).
type NotificationsResponse = { notifications: { read_at: string | null }[] };

// The two card treatments. Same data, two densities (see FlyerCard and
// CompactEventRow), so a feed isn't one repeated large square.
type SectionVariant = 'flyer' | 'compact';

// How many rows a compact section shows. A flyer row scrolls sideways and can
// carry a dozen cards; the same dozen as stacked rows would be a screen and a
// half of one section. Three is what the design shows — "See all" has the rest.
const COMPACT_ROWS = 3;

function CarouselSection({
  section,
  variant,
  savedIds,
  onToggleSave,
  onViewAll,
}: {
  section: FeedSection;
  variant: SectionVariant;
  savedIds: Set<number>;
  onToggleSave: (eventId: number) => void;
  onViewAll?: () => void;
}) {
  if (section.events.length === 0) return null;

  return (
    <View style={{ marginBottom: SECTION_GAP }}>
      <SectionHeader
        // Bucket rows are there because the user picked that interest. Upcoming
        // is not a pick, so it has no reason to give and carries no eyebrow.
        eyebrow={section.bucketId ? 'Because You Picked' : undefined}
        title={section.label}
        onViewAll={onViewAll}
        style={{ paddingHorizontal: 20, marginBottom: HEADER_GAP }}
      />
      {variant === 'compact' ? (
        <View style={{ paddingHorizontal: 20, gap: 10 }}>
          {section.events.slice(0, COMPACT_ROWS).map((item) => (
            <CompactEventRow
              key={`${item.source}-${item.source_event_id}`}
              item={item}
              isSaved={savedIds.has(item.id)}
              onToggleSave={onToggleSave}
            />
          ))}
        </View>
      ) : (
        <FlatList
          data={section.events}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
          keyExtractor={(item) => `${item.source}-${item.source_event_id}`}
          renderItem={({ item }) => (
            <FlyerCard item={item} isSaved={savedIds.has(item.id)} onToggleSave={onToggleSave} />
          )}
        />
      )}
    </View>
  );
}

// Which treatment a section gets. TEMPORARY: the design alternates, so the
// interest-bucket rows alternate flyer / compact / flyer / ... in the order the
// server sends them (CAREER flyer, ENTERTAINMENT compact, TECHNOLOGY flyer in the
// Figma). Upcoming is not a bucket and is always flyer-led. Which bucket gets
// which treatment is a feed-shape question for Kamsi, not a styling one — when it
// is answered this is the one place to change.
function variantFor(section: FeedSection, sections: FeedSection[]): SectionVariant {
  if (!section.bucketId) return 'flyer';
  const bucketIndex = sections.filter((s) => s.bucketId).findIndex((s) => s.key === section.key);
  return bucketIndex % 2 === 0 ? 'flyer' : 'compact';
}

export default function HomeScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { data } = useOnboarding();
  const token = data.token || null;

  // Bookmark state + toggle, shared with Explore, View All, the event detail
  // screen and the profile grid so one save updates all of them.
  const { savedIds, toggleSave: handleToggleSave } = useSavedEvents(token);

  // Success modal after posting an event. Router sets ?justPostedEvent=1
  // on redirect from OptionalExtras. We mirror it to local state so the
  // modal survives the immediate query-param clear.
  const params = useLocalSearchParams<{ justPostedEvent?: string }>();
  const [showEventPosted, setShowEventPosted] = React.useState(false);
  React.useEffect(() => {
    if (params.justPostedEvent === '1') {
      setShowEventPosted(true);
      // Clear the param so tab switches don't retrigger the modal.
      router.setParams({ justPostedEvent: undefined });
    }
  }, [params.justPostedEvent, router]);

  // The whole personalized home feed in one request. Works signed-out too
  // (server returns just the Upcoming section).
  const feedQuery = useQuery({
    queryKey: feedKeys.home(),
    queryFn: () => api.get<FeedHomeResponse>('/feed/home', { token }),
    staleTime: 30_000,
  });

  // Unread count for the bell. The badge used to be a hardcoded "1" that showed
  // on an empty notifications screen — bug bash: "notifications have a (1)
  // unread sign even though there are no notifications". GET /notifications
  // already returns read_at per row, so the real number is one filter away.
  //
  // Caveat: nothing marks a notification read yet (LOOP-213 owns
  // PATCH /notifications/:id/read), so in practice this counts everything the
  // user has. That is still honest — it matches what the screen shows, and it
  // hits zero when the screen is empty, which the literal never did.
  const notificationsQuery = useQuery({
    queryKey: notificationKeys.list(),
    queryFn: () => api.get<NotificationsResponse>('/notifications', { token }),
    enabled: !!token,
    staleTime: 30_000,
  });
  const unreadCount = (notificationsQuery.data?.notifications ?? []).filter(
    (n) => !n.read_at,
  ).length;

  const firstName = data.firstName || 'User';
  const greeting = getGreeting();
  const feedSections = feedQuery.data?.sections ?? [];
  // Personalized rows first (the user's own buckets), Upcoming last. The server
  // sends Upcoming first; it is reordered here rather than there so it works
  // against whichever Worker version the app is pointed at. Order within each
  // group is the server's, and the flyer/compact alternation counts only the
  // bucket rows, so moving Upcoming doesn't change which bucket gets which card.
  const sections = [
    ...feedSections.filter((s) => s.bucketId),
    ...feedSections.filter((s) => !s.bucketId),
  ];
  const spotlightEvents = sections.find((s) => s.key === 'upcoming')?.events.slice(0, 3) ?? [];

  return (
    <SafeAreaView className="flex-1 bg-lhlBackgroundColor" edges={['left', 'right']}>
      <EventPostedModal
        visible={showEventPosted}
        onClose={() => setShowEventPosted(false)}
        onViewInProfile={() => {
          setShowEventPosted(false);
          // TODO: once the profile screen has an events section, deep-link
          // to it (e.g. /(tabs)/profile?tab=events). For now, just land
          // the user on Profile.
          router.push('/(tabs)/profile');
        }}
      />
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 90,
            paddingBottom: 24,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <View>
            {/* Orange caps eyebrow with its time-of-day glyph, then the name large —
                as in the redesign. (The Hook 'em hand that used to sit after the
                name is not in the new frame and has been dropped.) */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <greeting.Icon width={16} height={16} color={colors.brand} />
              <Text
                style={{
                  fontFamily: 'Roboto-Flex-SemiBold',
                  fontSize: 13,
                  letterSpacing: 0.4,
                  color: colors.brand,
                }}
              >
                {greeting.text.toUpperCase()}
              </Text>
            </View>
            <Text
              style={{
                fontFamily: 'Roboto-Flex-Bold',
                fontSize: 32,
                lineHeight: 38,
                color: colors.ink,
                marginTop: 2,
              }}
            >
              {firstName}
            </Text>
          </View>

          {/* Bell */}
          <TouchableOpacity
            // A round white button, as in the redesign. The badge below hangs off
            // its top-right edge, so this must not clip its children.
            style={{
              position: 'relative',
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.borderSoft,
            }}
            onPress={() => router.push('/notifications')}
            accessibilityRole="button"
            accessibilityLabel={
              unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
            }
          >
            {/* Weight carries the state, not just the count pill. An outline
                bell means nothing is waiting; a filled one means something is.
                That reads at a glance and without relying on colour, which
                matters for the ~8% of men with a red-green deficiency — and it
                still works if the badge is clipped at the screen edge.

                Both weights are ink. The filled bell used to be brand orange,
                which made the icon compete with the count pill sitting on top
                of it — two orange things overlapping, and the state you were
                meant to read was the shape. Orange stays on the badge, where it
                is the only thing wearing it. */}
            {unreadCount > 0 ? (
              <BellFilledIcon width={22} height={25} color={colors.ink} />
            ) : (
              <BellIcon width={22} height={25} color={colors.ink} />
            )}
            {unreadCount > 0 ? (
              <View
                style={{
                  position: 'absolute',
                  top: -2,
                  right: -2,
                  // Brand, not destructive. An unread notification is not an
                  // error, and red on this header read as an alert state — bug
                  // bash: "make notification symbol color burnt orange instead
                  // of red".
                  backgroundColor: colors.brand,
                  borderRadius: 8,
                  minWidth: 16,
                  height: 16,
                  paddingHorizontal: 3,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text
                  style={{
                    color: '#fff', // theme-exempt: white count on the filled brand badge
                    fontSize: 10,
                    fontWeight: '700',
                  }}
                >
                  {/* Two digits is the most that fits the pill legibly. */}
                  {unreadCount > 9 ? '9+' : unreadCount}
                </Text>
              </View>
            ) : null}
          </TouchableOpacity>
        </View>

        {/* Spotlight: a fixed three-slot mosaic (tall card + two stacked).

            PLACEHOLDER SOURCE: the first three Upcoming events. Which events
            belong here — the "weekly top" ranking — is undecided (LOOP-273), so
            this is deliberately the dumbest thing that fills the slots and is
            the one line to replace once that lands. Until then these three also
            appear in the Upcoming carousel below. Renders nothing with fewer
            than three events. */}
        {spotlightEvents.length >= 3 ? (
          <View style={{ paddingHorizontal: 20, marginBottom: SECTION_GAP }}>
            <SectionHeader
              eyebrow="Your Top Picks"
              title="Spotlight"
              style={{ marginBottom: HEADER_GAP }}
            />
            <SpotlightMosaic events={spotlightEvents} />
          </View>
        ) : null}

        {/* Orgs worth following, with a Follow button on each card. Renders
            nothing signed out, while loading, or when there is nothing to
            offer. */}
        <OrgsForYouRow token={token} />

        {/* Server-driven carousels: Upcoming + one per interest bucket. */}
        {feedQuery.isPending ? (
          <View style={{ paddingVertical: 40 }}>
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        ) : (
          sections.map((section) => (
            <CarouselSection
              key={section.key}
              section={section}
              variant={variantFor(section, sections)}
              savedIds={savedIds}
              onToggleSave={handleToggleSave}
              // Every section leads somewhere: a bucket to its ranked list,
              // Upcoming to the same events from the home feed (see view-all.tsx).
              onViewAll={() =>
                router.push({
                  pathname: '/view-all' as any,
                  params: section.bucketId
                    ? { title: section.label, bucketId: section.bucketId }
                    : { title: section.label, section: section.key },
                })
              }
            />
          ))
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
