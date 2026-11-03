// Home's compact event row (the ENTERTAINMENT section in the redesign): a small
// square thumbnail, then title, org and one "date • time • place" line, with the
// bookmark on the right.
//
// The same data as FlyerCard at a lower density. That is the point: a feed made
// of one repeated large card reads as "a wall of squares" (tester feedback), and
// alternating in a row of these breaks it up.

import type { ApiEvent } from '@/app/components/EventCard';
import EventFlyerPlaceholder from '@/app/components/EventFlyerPlaceholder';
import BookmarkGlyph from '@/app/components/icons/BookmarkGlyph';
import { formatDay, formatMonthDay, formatTime } from '@/app/components/home/when';
import { useThemeColors } from '@/app/lib/themeColors';
import VerifiedIcon from '@/assets/images/verified.svg';
import { useRouter } from 'expo-router';
import React from 'react';
import { Image, Pressable, Text, TouchableOpacity, View } from 'react-native';

interface CompactEventRowProps {
  item: ApiEvent;
  isSaved: boolean;
  onToggleSave: (eventId: number) => void;
}

export default function CompactEventRow({ item, isSaved, onToggleSave }: CompactEventRowProps) {
  const colors = useThemeColors();
  const router = useRouter();

  // "Fri 2/26 • 4:00 PM • BLT 2.503", with any missing piece simply left out.
  const day = formatDay(item.start_datetime);
  const detail = [
    day ? `${day} ${formatMonthDay(item.start_datetime)}` : '',
    day ? formatTime(item.start_datetime) : '',
    item.location_short ?? '',
  ]
    .filter(Boolean)
    .join(' • ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.title}
      onPress={() => router.push(`/event/${item.id}`)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: colors.surface,
        borderRadius: 14,
        padding: 10,
        shadowColor: '#000', // theme-exempt: a shadow is black in both themes
        shadowOpacity: 0.06,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
      }}
    >
      <View
        style={{
          width: 60,
          height: 60,
          borderRadius: 10,
          overflow: 'hidden',
          backgroundColor: colors.placeholder,
        }}
      >
        {item.image_url ? (
          <Image
            source={{ uri: item.image_url }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
          />
        ) : (
          <EventFlyerPlaceholder seed={item.id} />
        )}
      </View>

      <View style={{ flex: 1 }}>
        <Text
          style={{ fontFamily: 'Roboto-Flex-SemiBold', fontSize: 14, color: colors.ink }}
          numberOfLines={1}
        >
          {item.title}
        </Text>
        {item.host_organization_name ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
            <Text
              style={{
                fontFamily: 'Roboto-Flex',
                fontSize: 12,
                color: colors.inkSecondary,
                flexShrink: 1,
              }}
              numberOfLines={1}
            >
              {item.host_organization_name}
            </Text>
            {item.org_verified ? (
              <VerifiedIcon width={12} height={12} style={{ flexShrink: 0 }} />
            ) : null}
          </View>
        ) : null}
        {detail ? (
          <Text
            style={{
              fontFamily: 'Roboto-Flex',
              fontSize: 11,
              color: colors.inkMuted,
              marginTop: 4,
            }}
            numberOfLines={1}
          >
            {detail}
          </Text>
        ) : null}
      </View>

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={isSaved ? 'Remove from saved' : 'Save event'}
        onPress={(e) => {
          // Stop the tap so it doesn't also open the event.
          e.stopPropagation();
          onToggleSave(item.id);
        }}
        hitSlop={8}
        style={{ padding: 4 }}
      >
        <BookmarkGlyph saved={isSaved} width={14} height={18} />
      </TouchableOpacity>
    </Pressable>
  );
}
