import BellIcon from '@/assets/images/bell.svg';
import HookemIcon from '@/assets/images/hookem.svg';
import EventCard, { ApiEvent } from '@/app/components/EventCard';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { api } from '@/app/lib/api';
import { events as eventsKeys, saved as savedKeys } from '@/app/lib/queryKeys';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

// Maps onboarding interest categories → event API query params.
// Each entry produces a carousel on the home screen.
interface CarouselDef {
  key: string;
  title: string;
  search: string;
}

// Tags the user picks during onboarding → parent category id.
// We only need the parent category to decide which carousels to show.
const TAG_TO_CATEGORY: Record<string, string> = {};

// The interest categories and their tags (mirrored from InterestSelection).
const INTEREST_CATEGORIES: { id: string; label: string; tags: string[] }[] = [
  { id: 'music', label: 'Music', tags: ['Rock & Alternative', 'Hip Hop & Rap', 'Electronic & EDM', 'Country & Folk', 'Jazz & Blues', 'Classical & Opera', 'Pop & Top 40', 'R&B & Soul', 'Indie & Underground', 'Latin & Reggaeton', 'K-Pop & J-Pop'] },
  { id: 'arts', label: 'Arts & Culture', tags: ['Art Exhibitions & Galleries', 'Theater & Broadway', 'Dance Performances', 'Film & Cinema', 'Photography', 'Sculpture & Installation Art', 'Poetry & Spoken Word', 'Street Art & Graffiti', 'Cultural Festivals', 'Museum Tours', 'Anime'] },
  { id: 'sports', label: 'Sports & Fitness', tags: ['Football & Soccer', 'Basketball', 'Baseball & Softball', 'Tennis & Racquet Sports', 'Running & Marathon', 'Yoga & Meditation', 'Cycling & Biking', 'Swimming & Water Sports', 'Martial Arts & Boxing', 'Extreme Sports', 'Golf', 'CrossFit & HIIT'] },
  { id: 'food', label: 'Food & Drink', tags: ['Wine Tasting', 'Craft Beer & Breweries', 'Cocktails & Mixology', 'Fine Dining', 'Street Food & Food Trucks', 'Vegan & Vegetarian', 'Coffee & Tea', 'Baking & Pastries', 'International Cuisine', 'Cooking Classes', 'Food Festivals'] },
  { id: 'tech', label: 'Technology', tags: ['Startup & Entrepreneurship', 'AI & Machine Learning', 'Blockchain & Crypto', 'Web Development', 'Mobile Apps', 'Cybersecurity', 'Gaming & Esports', 'VR & AR', 'Robotics', 'Tech Conferences', 'Hackathons'] },
  { id: 'health', label: 'Health & Wellness', tags: ['Mindfulness & Meditation', 'Nutrition & Diet', 'Mental Health Awareness', 'Fitness Challenges', 'Spa & Self-Care', 'Alternative Medicine', 'Health Fairs'] },
  { id: 'business', label: 'Business', tags: ['Networking Events', 'Career Fairs', 'Workshops & Seminars', 'Leadership Summits', 'Investment & Finance', 'Marketing & Branding', 'Real Estate'] },
  { id: 'outdoors', label: 'Outdoors', tags: ['Hiking & Trails', 'Camping', 'Fishing', 'Kayaking & Canoeing', 'Rock Climbing', 'Gardening & Botany', 'Bird Watching', 'Nature Photography'] },
  { id: 'learning', label: 'Learning & Education', tags: ['Book Clubs', 'Language Learning', 'STEM Workshops', 'History Lectures', 'Creative Writing', 'Study Groups', 'Academic Competitions'] },
  { id: 'nightlife', label: 'Nightlife', tags: ['Club Events', 'Live DJ Sets', 'Bar Crawls', 'Karaoke Nights', 'Comedy Shows', 'Late-Night Events', 'Theme Parties'] },
  { id: 'spirituality', label: 'Spirituality', tags: ['Meditation Retreats', 'Religious Services', 'Interfaith Dialogues', 'Prayer Groups', 'Spiritual Workshops', 'Community Service'] },
  { id: 'performing', label: 'Performing Arts', tags: ['Stand-up Comedy', 'Improv Shows', 'Musical Theater', 'Orchestra & Symphony', 'Circus & Acrobatics', 'Spoken Word & Poetry Slams', 'Drag Shows'] },
  { id: 'science', label: 'Science', tags: ['Astronomy & Stargazing', 'Biology & Ecology', 'Chemistry Demos', 'Physics Talks', 'Environmental Science', 'Space Exploration', 'Citizen Science'] },
  { id: 'shopping', label: 'Shopping & Fashion', tags: ['Thrift & Vintage', 'Pop-Up Markets', 'Fashion Shows', 'Streetwear', 'Sustainable Fashion', 'DIY & Crafts', 'Flea Markets'] },
  { id: 'travel', label: 'Travel', tags: ['Study Abroad Info', 'Travel Meetups', 'Cultural Exchange', 'Road Trip Planning', 'Budget Travel Tips', 'Adventure Travel'] },
  { id: 'gaming', label: 'Gaming', tags: ['Video Game Tournaments', 'Board Game Nights', 'Tabletop RPGs', 'LAN Parties', 'Game Dev Meetups', 'Retro Gaming', 'Card Games'] },
  { id: 'home', label: 'Home & Lifestyle', tags: ['Interior Design', 'Home Organization', 'Sustainable Living', 'Budgeting & Finance', 'Meal Prep', 'DIY Home Projects'] },
  { id: 'networking', label: 'Networking', tags: ['Professional Mixers', 'Alumni Events', 'Mentorship Programs', 'Industry Panels', 'Speed Networking', 'Co-working Sessions'] },
  { id: 'pets', label: 'Pets & Animals', tags: ['Dog-Friendly Events', 'Pet Adoption', 'Animal Rescue', 'Wildlife Conservation', 'Equestrian', 'Pet Training'] },
];

// Build TAG_TO_CATEGORY lookup at module load.
for (const cat of INTEREST_CATEGORIES) {
  for (const tag of cat.tags) {
    TAG_TO_CATEGORY[tag] = cat.id;
  }
}

// Maps a category id to an event API query string.
// Uses the closest available filter (theme, category, or benefit).
const CATEGORY_TO_QUERY: Record<string, string> = {
  music: 'theme=Music',
  arts: 'theme=Arts',
  sports: 'theme=Sports',
  food: 'benefit=Free Food',
  tech: 'theme=Technology',
  health: 'theme=Health',
  business: 'theme=Business',
  outdoors: 'theme=Outdoors',
  learning: 'category=Academic',
  nightlife: 'theme=Social',
  spirituality: 'theme=Spirituality',
  performing: 'theme=Arts',
  science: 'category=Academic',
  shopping: 'theme=Social',
  travel: 'theme=Social',
  gaming: 'theme=Social',
  home: 'theme=Social',
  networking: 'theme=Business',
  pets: 'theme=Social',
};

// Derive carousel definitions from user's selected tags.
function buildCarousels(userTags: string[]): CarouselDef[] {
  // Always start with Upcoming.
  const carousels: CarouselDef[] = [
    { key: 'upcoming', title: 'Upcoming', search: 'limit=10' },
  ];

  // Derive unique categories from user tags, in order of first appearance.
  const seen = new Set<string>();
  for (const tag of userTags) {
    const catId = TAG_TO_CATEGORY[tag];
    if (catId && !seen.has(catId)) {
      seen.add(catId);
      const cat = INTEREST_CATEGORIES.find((c) => c.id === catId);
      const query = CATEGORY_TO_QUERY[catId];
      if (cat && query) {
        carousels.push({
          key: catId,
          title: cat.label,
          search: `limit=10&${query}`,
        });
      }
    }
  }

  // If user has no tags (or very few), pad with defaults so the home screen
  // isn't empty.
  if (carousels.length < 3) {
    const defaults: CarouselDef[] = [
      { key: 'free-food', title: 'Free Food', search: 'limit=10&benefit=Free Food' },
      { key: 'social', title: 'Social', search: 'limit=10&theme=Social' },
      { key: 'academic', title: 'Academic', search: 'limit=10&category=Academic' },
    ];
    for (const d of defaults) {
      if (!carousels.some((c) => c.key === d.key)) {
        carousels.push(d);
      }
    }
  }

  // Cap at 5 carousels to keep scrolling manageable.
  return carousels.slice(0, 5);
}

// Tiny helper: fetch one carousel's worth of events.
function eventListQueryOptions(filterKey: string, search: string, token: string | null) {
  return {
    queryKey: eventsKeys.list({ filter: filterKey }),
    queryFn: () => api.get<EventsListResponse>(`/events?${search}`, { token }),
    staleTime: 30_000,
  };
}

function CarouselSection({
  title,
  data,
  loading,
  savedIds,
  onToggleSave,
  onViewAll,
}: {
  title: string;
  data: ApiEvent[];
  loading?: boolean;
  savedIds: Set<number>;
  onToggleSave: (eventId: number) => void;
  onViewAll?: () => void;
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
        <TouchableOpacity onPress={onViewAll}>
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
          <EventCard item={item} isSaved={savedIds.has(item.id)} onToggleSave={onToggleSave} />
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

  // Fetch user profile to get their tags for dynamic carousels.
  type UserProfile = { user: { first_name?: string; tags?: string[] } };
  const profileQuery = useQuery({
    queryKey: ['user', 'me'],
    queryFn: () => api.get<UserProfile>('/users/me', { token }),
    enabled: !!token,
    staleTime: 60_000,
  });

  const userTags = profileQuery.data?.user?.tags ?? data.selectedTags ?? [];
  const firstName = profileQuery.data?.user?.first_name || data.firstName || 'User';

  // Build carousels from the user's interest tags.
  const carousels = React.useMemo(() => buildCarousels(userTags), [userTags]);

  // Create a query for each carousel. useQueries would be ideal but we keep
  // it simple with individual useQuery calls via a child component.

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
  const toggleSave = useMutation<void, unknown, { eventId: number; wasSaved: boolean }, { previous?: SavedListResponse }>({
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
                {firstName}
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

        {/* Dynamic carousels */}
        {carousels.map((carousel) => (
          <DynamicCarousel
            key={carousel.key}
            carousel={carousel}
            token={token}
            savedIds={savedIds}
            onToggleSave={handleToggleSave}
          />
        ))}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// Each carousel is its own component so it has its own useQuery hook.
function DynamicCarousel({
  carousel,
  token,
  savedIds,
  onToggleSave,
}: {
  carousel: CarouselDef;
  token: string | null;
  savedIds: Set<number>;
  onToggleSave: (eventId: number) => void;
}) {
  const router = useRouter();
  const query = useQuery(eventListQueryOptions(carousel.key, carousel.search, token));

  return (
    <CarouselSection
      title={carousel.title}
      data={query.data?.events ?? []}
      loading={query.isPending}
      savedIds={savedIds}
      onToggleSave={onToggleSave}
      onViewAll={() =>
        router.push({
          pathname: '/view-all' as any,
          params: { title: carousel.title, search: carousel.search },
        })
      }
    />
  );
}
