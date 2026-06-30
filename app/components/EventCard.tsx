import BookmarkIcon from '@/assets/images/bookmark.svg';
import LocationIcon from '@/assets/images/location.svg';
import VerifiedIcon from '@/assets/images/verified.svg';
import { useRouter } from 'expo-router';
import React from 'react';
import { Image, Pressable, Text, TouchableOpacity, View } from 'react-native';

export interface ApiEvent {
  id: number;
  source: string;
  source_event_id: string;
  title: string;
  description: string | null;
  start_datetime: string;
  end_datetime: string | null;
  location_short: string | null;
  location_full: string | null;
  latitude: number | null;
  longitude: number | null;
  host_organization_id: number;
  host_organization_name: string;
  event_url: string | null;
  rsvp_url: string | null;
  image_url: string | null;
  image_aspect_ratio: string | null;
  theme: string | null;
  visibility: string;
  rsvp_total: number;
  org_profile_picture: string | null;
  categories: { id: string; name: string }[];
  benefits: string[];
  expires_at: string | null;
  is_featured: number;
  created_by_user_id: number | null;
  is_archived: number;
  archived_at: string | null;
}

// Formats an ISO datetime as "Fri, 4/29 • 6:00 PM".
export function formatEventDate(isoString: string): string {
  const date = new Date(isoString);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const day = days[date.getDay()];
  const month = date.getMonth() + 1;
  const dayNum = date.getDate();

  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const timeStr =
    minutes === 0
      ? `${hours}:00 ${ampm}`
      : `${hours}:${minutes.toString().padStart(2, '0')} ${ampm}`;

  return `${day}, ${month}/${dayNum} • ${timeStr}`;
}

interface EventCardProps {
  item: ApiEvent;
  isSaved: boolean;
  onToggleSave: (eventId: number) => void;
}

export default function EventCard({ item, isSaved, onToggleSave }: EventCardProps) {
  const router = useRouter();
  const hasImage = !!item.image_url;
  const hasBenefits = item.benefits && item.benefits.length > 0;

  const handlePress = () => {
    router.push(`/event/${item.id}`);
  };

  return (
    <Pressable
      onPress={handlePress}
      style={{ width: 180 }}
      className="mr-4 rounded-2xl overflow-hidden bg-white border border-lhlGrey"
    >
      <View style={{ backgroundColor: '#D9D9D9', height: 160 }} className="w-full">
        {hasImage && (
          <Image
            source={{ uri: item.image_url! }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
          />
        )}

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

        <TouchableOpacity
          onPress={(e) => {
            // Don't let the bookmark tap bubble up and trigger card navigation.
            e.stopPropagation();
            onToggleSave(item.id);
          }}
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
          <BookmarkIcon width={10} height={14} color={isSaved ? '#BF5700' : '#020B12'} />
        </TouchableOpacity>
      </View>

      <View style={{ padding: 12 }}>
        <Text
          style={{ fontSize: 14, fontWeight: '700', color: '#020B12', marginBottom: 2 }}
          numberOfLines={1}
        >
          {item.title}
        </Text>

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

        <Text style={{ fontSize: 12, color: '#9A9A9A', marginBottom: 4 }}>
          {formatEventDate(item.start_datetime)}
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <LocationIcon width={14} height={14} />
          <Text style={{ fontSize: 12, color: '#9A9A9A' }} numberOfLines={1}>
            {item.location_short || 'TBD'}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
