import BookmarkIcon from '@/assets/images/bookmark.svg';
import LocationIcon from '@/assets/images/location.svg';
import { ApiEvent, formatEventDate } from '@/app/components/EventCard';
import React from 'react';
import { Image, Text, TouchableOpacity, View } from 'react-native';

const BURNT_ORANGE = '#BF5700';
const TEXT_PRIMARY = '#020B12';
const TEXT_MUTED = '#9A9A9A';
const BORDER_GREY = '#E5E5E5';
const BG_WHITE = '#FFFFFF';
const BG_LIGHT = '#F1F1F1';
const BG_SAVED = '#FFF3EC';

interface EventMiniCardProps {
  event: ApiEvent;
  isSaved: boolean;
  onToggleSave: (eventId: number) => void;
  onDismiss: () => void;
  onViewDetails: (eventId: number) => void;
}

export default function EventMiniCard({
  event,
  isSaved,
  onToggleSave,
  onDismiss,
  onViewDetails,
}: EventMiniCardProps) {
  return (
    <View
      style={{
        margin: 16,
        backgroundColor: BG_WHITE,
        borderRadius: 16,
        padding: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        shadowColor: '#000',
        shadowOpacity: 0.12,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 6,
        borderWidth: 1,
        borderColor: BORDER_GREY,
      }}
    >
      {/* Thumbnail */}
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 10,
          backgroundColor: '#D9D9D9',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {event.image_url != null && (
          <Image
            source={{ uri: event.image_url }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
          />
        )}
      </View>

      {/* Info */}
      <View style={{ flex: 1 }}>
        <Text
          style={{ fontSize: 14, fontWeight: '700', color: TEXT_PRIMARY, marginBottom: 2 }}
          numberOfLines={1}
        >
          {event.title}
        </Text>
        <Text style={{ fontSize: 12, color: TEXT_MUTED, marginBottom: 2 }} numberOfLines={1}>
          {event.host_organization_name}
        </Text>
        <Text style={{ fontSize: 12, color: TEXT_MUTED, marginBottom: 4 }}>
          {formatEventDate(event.start_datetime)}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <LocationIcon width={12} height={12} />
          <Text style={{ fontSize: 11, color: TEXT_MUTED }} numberOfLines={1}>
            {event.location_short ?? 'TBD'}
          </Text>
        </View>
      </View>

      {/* Actions column */}
      <View style={{ alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <TouchableOpacity
          onPress={onDismiss}
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: BG_LIGHT,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 13, color: TEXT_MUTED }}>✕</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => onToggleSave(event.id)}
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: isSaved ? BG_SAVED : BG_LIGHT,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <BookmarkIcon width={10} height={13} color={isSaved ? BURNT_ORANGE : TEXT_PRIMARY} />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => onViewDetails(event.id)}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 5,
            backgroundColor: BURNT_ORANGE,
            borderRadius: 8,
          }}
        >
          <Text style={{ fontSize: 11, fontWeight: '600', color: '#FFFFFF' }}>View</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
