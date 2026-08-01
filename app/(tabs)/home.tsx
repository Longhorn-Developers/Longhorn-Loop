import BellIcon from '@/assets/images/bell.svg';
import HookemIcon from '@/assets/images/hookem.svg';
import EventCard, { ApiEvent } from '@/app/components/EventCard';
import EventPostedModal from '@/app/components/EventPostedModal';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { api } from '@/app/lib/api';
import { feed as feedKeys, saved as savedKeys } from '@/app/lib/queryKeys';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
type SavedListResponse = { events: ApiEvent[] };

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
  const queryClient = useQueryClient();

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

  const firstName = data.firstName || 'User';
  const sections = feedQuery.data?.sections ?? [];

  // Saved IDs — only run when signed in.
  const savedQuery = useQuery({
    queryKey: savedKeys.list(),
    queryFn: () => api.get<SavedListResponse>('/saved', { token }),
    enabled: !!token,
  });

  const savedIds = React.useMemo(
    () => new Set((savedQuery.data?.events ?? []).map((e: ApiEvent) => e.id)),
    [savedQuery.data],
  );

  // Toggle save with optimistic UI.
  const toggleSave = useMutation<
    void,
    unknown,
    { eventId: number; wasSaved: boolean },
    { previous?: SavedListResponse }
  >({
    mutationFn: async ({ eventId, wasSaved }) => {
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
        if (wasSaved) {
          return { events: list.filter((e: ApiEvent) => e.id !== eventId) };
        }
        return {
          events: [...list, { id: eventId } as ApiEvent],
        };
      });
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
          >
            <BellIcon width={22} height={25} color={colors.ink} />
            <View
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                backgroundColor: colors.destructive,
                borderRadius: 8,
                width: 16,
                height: 16,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text
                style={{
                  color: '#fff', // theme-exempt: white count on the filled destructive badge
                  fontSize: 10,
                  fontWeight: '700',
                }}
              >
                1
              </Text>
            </View>
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
