import BellIcon from '@/assets/images/bell.svg';
import HookemIcon from '@/assets/images/hookem.svg';
import EventCard, { ApiEvent } from '@/app/components/EventCard';
import { API_BASE_URL } from '@/app/config/api';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
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

// ---------- Main Screen ----------

export default function HomeScreen() {
  const router = useRouter();
  const { data } = useOnboarding();
  const token = data.token;
  const [upcoming, setUpcoming] = useState<ApiEvent[]>([]);
  const [freeFood, setFreeFood] = useState<ApiEvent[]>([]);
  const [social, setSocial] = useState<ApiEvent[]>([]);
  const [academic, setAcademic] = useState<ApiEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetchEvents();
  }, []);

  useEffect(() => {
    if (token) fetchSavedIds();
  }, [token]);

  // Re-fetch whenever the home tab regains focus. Keeps the feed fresh after
  // mutations on other screens (RSVP, save, report).
  useFocusEffect(
    useCallback(() => {
      fetchEvents();
      if (token) fetchSavedIds();
    }, [token]),
  );

  const fetchSavedIds = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/saved`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await res.json();
      if (res.ok && Array.isArray(result.events)) {
        setSavedIds(new Set(result.events.map((e: ApiEvent) => e.id)));
      }
    } catch (err) {
      console.error('Failed to fetch saved events:', err);
    }
  };

  const handleToggleSave = async (eventId: number) => {
    if (!token) return;

    const wasSaved = savedIds.has(eventId);

    // Optimistic update
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (wasSaved) next.delete(eventId);
      else next.add(eventId);
      return next;
    });

    try {
      const res = await fetch(`${API_BASE_URL}/saved/${eventId}`, {
        method: wasSaved ? 'DELETE' : 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Request failed');
    } catch (err) {
      console.error('Failed to toggle saved event:', err);
      // Revert on failure
      setSavedIds((prev) => {
        const next = new Set(prev);
        if (wasSaved) next.add(eventId);
        else next.delete(eventId);
        return next;
      });
    }
  };

  const fetchEvents = async () => {
    try {
      // Send the auth header so the backend can hide events this user has
      // reported (in addition to the global threshold filter).
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      const [upcomingRes, freeFoodRes, socialRes, academicRes] = await Promise.all([
        fetch(`${API_BASE_URL}/events?limit=10`, { headers }),
        fetch(`${API_BASE_URL}/events?limit=10&benefit=Free Food`, { headers }),
        fetch(`${API_BASE_URL}/events?limit=10&theme=Social`, { headers }),
        fetch(`${API_BASE_URL}/events?limit=10&category=Academic`, { headers }),
      ]);

      const [upcomingData, freeFoodData, socialData, academicData] = await Promise.all([
        upcomingRes.json(),
        freeFoodRes.json(),
        socialRes.json(),
        academicRes.json(),
      ]);

      setUpcoming(upcomingData.events || []);
      setFreeFood(freeFoodData.events || []);
      setSocial(socialData.events || []);
      setAcademic(academicData.events || []);
    } catch (err) {
      console.error('Failed to fetch events:', err);
    } finally {
      setLoading(false);
    }
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

        {/* Event Carousels — real data from API */}
        <CarouselSection
          title="Upcoming"
          data={upcoming}
          loading={loading}
          savedIds={savedIds}
          onToggleSave={handleToggleSave}
        />
        <CarouselSection
          title="Free Food"
          data={freeFood}
          loading={loading}
          savedIds={savedIds}
          onToggleSave={handleToggleSave}
        />
        <CarouselSection
          title="Social"
          data={social}
          loading={loading}
          savedIds={savedIds}
          onToggleSave={handleToggleSave}
        />
        <CarouselSection
          title="Academic"
          data={academic}
          loading={loading}
          savedIds={savedIds}
          onToggleSave={handleToggleSave}
        />

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
