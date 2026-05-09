import BellIcon from '@/assets/images/bell.svg';
import BookmarkIcon from '@/assets/images/bookmark.svg';
import HookemIcon from '@/assets/images/hookem.svg';
import LocationIcon from '@/assets/images/location.svg';
import VerifiedIcon from '@/assets/images/verified.svg';
import { API_BASE_URL } from '@/app/config/api';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// ---------- Types ----------

interface ApiEvent {
  id: number;
  source: string;
  source_event_id: string;
  title: string;
  description: string | null;
  start_datetime: string;
  end_datetime: string | null;
  location_short: string | null;
  location_full: string | null;
  host_organization_id: number;
  host_organization_name: string;
  event_url: string | null;
  image_url: string | null;
  image_aspect_ratio: string | null;
  theme: string | null;
  visibility: string;
  rsvp_total: number;
  org_profile_picture: string | null;
  categories: { id: string; name: string }[];
  benefits: string[];
}

// ---------- Helpers ----------

/**
 * Format ISO datetime to "Fri, 4/29 • 6:00 PM"
 */
function formatEventDate(isoString: string): string {
  const date = new Date(isoString);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const day = days[date.getDay()];
  const month = date.getMonth() + 1;
  const dayNum = date.getDate();

  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const timeStr = minutes === 0 ? `${hours}:00 ${ampm}` : `${hours}:${minutes.toString().padStart(2, '0')} ${ampm}`;

  return `${day}, ${month}/${dayNum} • ${timeStr}`;
}

/**
 * Get a greeting based on time of day
 */
function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning,';
  if (hour < 17) return 'Good afternoon,';
  return 'Good evening,';
}

// ---------- Components ----------

function EventCard({ item }: { item: ApiEvent }) {
  const hasImage = !!item.image_url;
  const hasBenefits = item.benefits && item.benefits.length > 0;

  return (
    <View style={{ width: 180 }} className="mr-4 rounded-2xl overflow-hidden bg-white border border-lhlGrey">
      {/* Image area */}
      <View style={{ backgroundColor: '#D9D9D9', height: 160 }} className="w-full">
        {hasImage && (
          <Image
            source={{ uri: item.image_url! }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
          />
        )}

        {/* Benefits badge (e.g., Free Food) */}
        {hasBenefits && (
          <View
            style={{
              position: 'absolute',
              bottom: 8,
              left: 8,
              backgroundColor: '#BF5700',
              borderRadius: 12,
              paddingHorizontal: 8,
              paddingVertical: 3,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 10, fontWeight: '600' }}>
              {item.benefits[0]}
            </Text>
          </View>
        )}

        {/* Bookmark button */}
        <TouchableOpacity
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            backgroundColor: 'white',
            borderRadius: 999,
            width: 34,
            height: 34,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: '#000',
            shadowOpacity: 0.15,
            shadowRadius: 4,
            elevation: 3,
          }}
        >
          <BookmarkIcon width={10} height={14} />
        </TouchableOpacity>
      </View>

      {/* Card Info */}
      <View style={{ padding: 12 }}>
        {/* Title */}
        <Text
          style={{ fontSize: 14, fontWeight: '700', color: '#020B12', marginBottom: 2 }}
          numberOfLines={1}
        >
          {item.title}
        </Text>

        {/* Posted by + org profile pic */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
          {item.org_profile_picture && (
            <Image
              source={{ uri: item.org_profile_picture }}
              style={{ width: 14, height: 14, borderRadius: 7, marginRight: 4 }}
            />
          )}
          <Text style={{ fontSize: 12, color: '#020B12', flex: 1 }} numberOfLines={1}>
            {item.host_organization_name}
          </Text>
          <VerifiedIcon width={16} height={16} style={{ marginLeft: 4, flexShrink: 0 }} />
        </View>

        {/* Date */}
        <Text style={{ fontSize: 12, color: '#9A9A9A', marginBottom: 4 }}>
          {formatEventDate(item.start_datetime)}
        </Text>

        {/* Location */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <LocationIcon width={14} height={14} />
          <Text style={{ fontSize: 12, color: '#9A9A9A' }} numberOfLines={1}>
            {item.location_short || 'TBD'}
          </Text>
        </View>
      </View>
    </View>
  );
}

function CarouselSection({
  title,
  data,
  loading,
}: {
  title: string;
  data: ApiEvent[];
  loading?: boolean;
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
        renderItem={({ item }) => <EventCard item={item} />}
      />
    </View>
  );
}

// ---------- Main Screen ----------

export default function HomeScreen() {
  const [upcoming, setUpcoming] = useState<ApiEvent[]>([]);
  const [freeFood, setFreeFood] = useState<ApiEvent[]>([]);
  const [social, setSocial] = useState<ApiEvent[]>([]);
  const [academic, setAcademic] = useState<ApiEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchEvents();
  }, []);

  const fetchEvents = async () => {
    try {
      // Fetch multiple sections in parallel
      const [upcomingRes, freeFoodRes, socialRes, academicRes] = await Promise.all([
        fetch(`${API_BASE_URL}/events?limit=10`),
        fetch(`${API_BASE_URL}/events?limit=10&benefit=Free Food`),
        fetch(`${API_BASE_URL}/events?limit=10&theme=Social`),
        fetch(`${API_BASE_URL}/events?limit=10&category=Academic`),
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
              <Text style={{ fontSize: 32, fontWeight: '700', color: '#020B12' }}>User</Text>
              <HookemIcon width={31} height={31} />
            </View>
          </View>

          {/* Bell */}
          <TouchableOpacity style={{ position: 'relative', padding: 4 }}>
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
        <CarouselSection title="Upcoming" data={upcoming} loading={loading} />
        <CarouselSection title="Free Food" data={freeFood} loading={loading} />
        <CarouselSection title="Social" data={social} loading={loading} />
        <CarouselSection title="Academic" data={academic} loading={loading} />

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
