import BookmarkGlyph from '@/app/components/icons/BookmarkGlyph';
import LocationIcon from '@/assets/images/location.svg';
import { ApiEvent, formatEventDate } from '@/app/components/EventCard';
import { useThemeColors } from '@/app/lib/themeColors';
import React from 'react';
import { Image, Text, TouchableOpacity, View } from 'react-native';

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
  const colors = useThemeColors();

  return (
    <View
      style={{
        margin: 16,
        backgroundColor: colors.surface,
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
        borderColor: colors.border,
      }}
    >
      {/* Thumbnail */}
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 10,
          backgroundColor: colors.placeholder,
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
          style={{ fontSize: 14, fontWeight: '700', color: colors.ink, marginBottom: 2 }}
          numberOfLines={1}
        >
          {event.title}
        </Text>
        <Text style={{ fontSize: 12, color: colors.inkMuted, marginBottom: 2 }} numberOfLines={1}>
          {event.host_organization_name}
        </Text>
        <Text style={{ fontSize: 12, color: colors.inkMuted, marginBottom: 4 }}>
          {formatEventDate(event.start_datetime)}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <LocationIcon width={12} height={12} color={colors.ink} />
          <Text style={{ fontSize: 11, color: colors.inkMuted }} numberOfLines={1}>
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
            backgroundColor: colors.surfaceMuted,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 13, color: colors.inkMuted }}>✕</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => onToggleSave(event.id)}
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: isSaved ? colors.brandSoft : colors.surfaceMuted,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <BookmarkGlyph saved={isSaved} width={10} height={13} />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => onViewDetails(event.id)}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 5,
            backgroundColor: colors.brand,
            borderRadius: 8,
          }}
        >
          <Text style={{ fontSize: 11, fontWeight: '600', color: '#FFFFFF' }}>View</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
