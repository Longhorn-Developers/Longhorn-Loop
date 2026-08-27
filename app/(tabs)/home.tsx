import BellFilledIcon from '@/assets/images/bell-filled.svg';
import BellIcon from '@/assets/images/bell.svg';
import HookemIcon from '@/assets/images/hookem.svg';
import EventCard, { ApiEvent } from '@/app/components/EventCard';
import EventPostedModal from '@/app/components/EventPostedModal';
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

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning,';
  if (hour < 17) return 'Good afternoon,';
  return 'Good evening,';
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

function CarouselSection({
  section,
  savedIds,
  onToggleSave,
  onViewAll,
}: {
  section: FeedSection;
  savedIds: Set<number>;
  onToggleSave: (eventId: number) => void;
  onViewAll?: () => void;
}) {
  const colors = useThemeColors();

  if (section.events.length === 0) return null;

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
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>{section.label}</Text>
        {onViewAll && (
          <TouchableOpacity onPress={onViewAll}>
            <Text style={{ fontSize: 22, color: colors.inkMuted }}>›</Text>
          </TouchableOpacity>
        )}
      </View>
      <FlatList
        data={section.events}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20 }}
        keyExtractor={(item) => `${item.source}-${item.source_event_id}`}
        renderItem={({ item }) => (
          <EventCard item={item} isSaved={savedIds.has(item.id)} onToggleSave={onToggleSave} />
        )}
      />
    </View>
  );
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
  const sections = feedQuery.data?.sections ?? [];

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
            paddingBottom: 16,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <View>
            <Text style={{ fontSize: 16, fontWeight: '400', color: colors.inkMuted }}>
              {getGreeting()}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <Text style={{ fontSize: 32, fontWeight: '700', color: colors.ink }}>
                {firstName}
              </Text>
              <HookemIcon width={31} height={31} color={colors.ink} />
            </View>
          </View>

          {/* Bell */}
          <TouchableOpacity
            style={{ position: 'relative', padding: 4 }}
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
                  top: 0,
                  right: 0,
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

        {/* Divider */}
        <View
          style={{
            height: 1,
            backgroundColor: colors.divider,
            marginHorizontal: 20,
            marginBottom: 24,
          }}
        />

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
              savedIds={savedIds}
              onToggleSave={handleToggleSave}
              // "See all" only makes sense for bucket sections (Upcoming has no
              // dedicated endpoint).
              onViewAll={
                section.bucketId
                  ? () =>
                      router.push({
                        pathname: '/view-all' as any,
                        params: { title: section.label, bucketId: section.bucketId },
                      })
                  : undefined
              }
            />
          ))
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
