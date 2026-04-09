import BellIcon from '@/assets/images/bell.svg';
import BookmarkIcon from '@/assets/images/bookmark.svg';
import HookemIcon from '@/assets/images/hookem.svg';
import LocationIcon from '@/assets/images/location.svg';
import VerifiedIcon from '@/assets/images/verified.svg';
import React from 'react';
import {
  FlatList,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const UPCOMING_EVENTS = [
  { id: '1', title: 'Casino Night', org: 'SAN JAC', location: 'BLT 2.503', date: 'Fri, 2/26 • 4:00 PM', verified: true, color: '#B4B2B2' },
  { id: '2', title: "Women's History Month", org: 'Convergent', location: 'BLT 2.503', date: 'Fri, 2/26 • 4:00 PM', verified: true, color: '#B4B2B2' },
  { id: '3', title: 'Hackathon 2026', org: 'IEEE', location: 'EER 1.518', date: 'Sat, 3/27 • 9:00 AM', verified: true, color: '#B4B2B2' },
  { id: '4', title: 'Longhorn Startup Fair', org: 'Texas Venture Labs', location: 'GDC Atrium', date: 'Mon, 3/29 • 2:00 PM', verified: false, color: '#B4B2B2' },
];

const INTEREST_1 = [
  { id: '1', title: 'Game Night in WCP!', org: 'Convergent', location: 'MCP 2.120', date: 'Fri, 2/26 • 4:00 PM', verified: true, color: '#1B3A6B' },
  { id: '2', title: 'Boutique Day', org: 'Project Princess', location: 'Union Ballroom', date: 'Fri, 2/26 • 4:00 PM', verified: false, color: '#6B1B4A' },
  { id: '3', title: 'Board Game Bonanza', org: 'UT Game Club', location: 'SAC 2.302', date: 'Sat, 2/27 • 3:00 PM', verified: true, color: '#2D4A1B' },
];

const INTEREST_2 = [
  { id: '1', title: 'Jazz Night', org: 'UT Jazz Ensemble', location: 'Bates Recital Hall', date: 'Fri, 3/5 • 7:00 PM', verified: true, color: '#3D1B6B' },
  { id: '2', title: 'Open Mic Night', org: 'Cactus Cafe', location: 'Cactus Cafe', date: 'Sat, 3/6 • 8:00 PM', verified: false, color: '#6B3D1B' },
  { id: '3', title: 'Battle of the Bands', org: 'KVRX Radio', location: "Emo's Austin", date: 'Sun, 3/7 • 6:00 PM', verified: true, color: '#1B4A6B' },
];

const INTEREST_3 = [
  { id: '1', title: 'Rock Climbing Social', org: 'UT Climbing Club', location: 'Gregory Gym', date: 'Fri, 3/12 • 5:00 PM', verified: true, color: '#4A3D1B' },
  { id: '2', title: '5K Fun Run', org: 'Longhorn Running', location: 'Zilker Park', date: 'Sat, 3/13 • 8:00 AM', verified: true, color: '#1B6B3D' },
  { id: '3', title: 'Yoga on the Lawn', org: 'UT Wellness', location: 'Main Mall', date: 'Sun, 3/14 • 10:00 AM', verified: false, color: '#6B1B1B' },
];

type Event = {
  id: string;
  title: string;
  org: string;
  location: string;
  date: string;
  verified: boolean;
  color: string;
};

function EventCard({ item }: { item: Event }) {
  return (
    <View style={{ width: 180 }} className="mr-4 rounded-2xl overflow-hidden bg-white border border-lhlGrey">
      {/* Image area */}
      <View style={{ backgroundColor: '#D9D9D9', height: 160 }} className="w-full">
        {/* Bookmark button — white circle with shadow */}
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

        {/* Posted by + verified badge */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
          <Text style={{ fontSize: 12, color: '#020B12', flex: 1 }} numberOfLines={1}>
            Posted by {item.org}
          </Text>
          {item.verified && (
            <VerifiedIcon width={16} height={16} style={{ marginLeft: 4, flexShrink: 0 }} />
          )}
        </View>

        {/* Date */}
        <Text style={{ fontSize: 12, color: '#9A9A9A', marginBottom: 4 }}>
          {item.date}
        </Text>

        {/* Location */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <LocationIcon width={14} height={14} />
          <Text style={{ fontSize: 12, color: '#9A9A9A' }} numberOfLines={1}>
            {item.location}
          </Text>
        </View>
      </View>
    </View>
  );
}

function CarouselSection({ title, data }: { title: string; data: Event[] }) {
  return (
    <View style={{ marginBottom: 28 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 12 }}>
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
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <EventCard item={item} />}
      />
    </View>
  );
}

export default function HomeScreen() {
  return (
    <SafeAreaView className="flex-1 bg-lhlBackgroundColor" edges={['left', 'right']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={{ paddingHorizontal: 20, paddingTop: 90, paddingBottom: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <Text style={{ fontSize: 16, fontWeight: '400', color: '#9A9A9A' }}>
              Good morning,
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <Text style={{ fontSize: 32, fontWeight: '700', color: '#020B12' }}>
                User
              </Text>
              <HookemIcon width={31} height={31} />
            </View>
          </View>

          {/* Bell */}
          <TouchableOpacity style={{ position: 'relative', padding: 4 }}>
            <BellIcon width={22} height={25} />
            <View style={{
              position: 'absolute',
              top: 0,
              right: 0,
              backgroundColor: '#EF4444',
              borderRadius: 8,
              width: 16,
              height: 16,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>1</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Divider */}
        <View style={{ height: 1, backgroundColor: '#D2DEE0', marginHorizontal: 20, marginBottom: 24 }} />

        {/* Carousels */}
        <CarouselSection title="Upcoming" data={UPCOMING_EVENTS} />
        <CarouselSection title="Interest 1" data={INTEREST_1} />
        <CarouselSection title="Interest 2" data={INTEREST_2} />
        <CarouselSection title="Interest 3" data={INTEREST_3} />

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}