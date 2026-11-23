// Home's large, flyer-led event card (the CAREER / TECHNOLOGY rows in the
// redesign): the flyer fills the whole card, a date pill top-left, bookmark
// top-right, and org, title and place over a dark scrim at the bottom.
//
// The other Home treatment is CompactEventRow. They carry the same event data at
// two densities — which one a section gets is the caller's decision, not this
// card's. EventCard (the older uniform card) is still what Explore, View All and
// Profile use; only Home moved to these.

import type { ApiEvent } from '@/app/components/EventCard';
import EventFlyerPlaceholder from '@/app/components/EventFlyerPlaceholder';
import {
  DIM,
  OVERLAY_TEXT,
  PILL_FILL,
  SCRIM_CLEAR,
  SCRIM_DARK,
} from '@/app/components/home/overlay';
import { formatDay, formatMonthDay, formatTimeCompact } from '@/app/components/home/when';
import BookmarkGlyph from '@/app/components/icons/BookmarkGlyph';
import { useThemeColors } from '@/app/lib/themeColors';
import LocationIcon from '@/assets/images/location.svg';
import VerifiedIcon from '@/assets/images/verified.svg';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

// Home's carousel width. The card keeps this shape (164 x 236) at any width, so
// the See all grid can size it to a column and get the same card.
export const FLYER_CARD_WIDTH = 164;
const FLYER_CARD_ASPECT = 236 / 164;

// The date pill and the save button share the top edge of a 164pt card. At the
// old 10 / 8 insets a long label ("Wed 12/31 · 12:30 PM") ran into the button.
// Both now sit close to their corners: the pill's ~12pt radius against the
// card's 16 is nearly concentric at this inset, so it reads as tucked into the
// curve, not floating near it. The pill's maxWidth also stops short of the
// button (single line, ellipsized) so the two can never overlap, whatever the
// label length or card width.
const CORNER_INSET = 6;
// 36, up from 32: the save button is the one control on the card you aim for
// rather than tap anywhere, and 32 was easy to miss and open the event instead.
// Any bigger and it starts crowding the date pill on a 164pt card.
const SAVE_BUTTON_SIZE = 36;
// Minimum space kept between the pill's right end and the save button.
const PILL_SAVE_GAP = 6;

interface FlyerCardProps {
  item: ApiEvent;
  isSaved: boolean;
  onToggleSave: (eventId: number) => void;
  /** Card width; the height follows from the card's fixed proportions. */
  width?: number;
  placeholderVariant?: 'tower' | 'fractalGlass';
}

export default function FlyerCard({
  item,
  isSaved,
  onToggleSave,
  width = FLYER_CARD_WIDTH,
  placeholderVariant,
}: FlyerCardProps) {
  const colors = useThemeColors();
  const router = useRouter();

  const flyerUri = item.image_url?.trim();
  const [failedFlyerUri, setFailedFlyerUri] = useState<string>();

  // "Sat 8/21 · 1 PM". Dropped entirely for an unparseable date rather than
  // showing a pill that says " · ".
  const day = formatDay(item.start_datetime);
  const when = day
    ? `${day} ${formatMonthDay(item.start_datetime)} · ${formatTimeCompact(item.start_datetime)}`
    : '';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={when ? `${item.title}, ${when}` : item.title}
      onPress={() => router.push(`/event/${item.id}`)}
      style={{
        width,
        height: Math.round(width * FLYER_CARD_ASPECT),
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: colors.placeholder,
      }}
    >
      {flyerUri && flyerUri !== failedFlyerUri ? (
        <Image
          source={{ uri: flyerUri }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onError={() => setFailedFlyerUri(flyerUri)}
        />
      ) : (
        <EventFlyerPlaceholder seed={item.id} variant={placeholderVariant} />
      )}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: DIM }]} pointerEvents="none" />
      <LinearGradient
        colors={[SCRIM_CLEAR, SCRIM_DARK]}
        locations={[0.4, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {when ? (
        <View
          style={{
            position: 'absolute',
            top: CORNER_INSET,
            left: CORNER_INSET,
            maxWidth: width - CORNER_INSET * 2 - SAVE_BUTTON_SIZE - PILL_SAVE_GAP,
            borderRadius: 12,
            backgroundColor: PILL_FILL,
            paddingHorizontal: 9,
            paddingVertical: 4,
          }}
        >
          <Text
            style={{ color: OVERLAY_TEXT, fontFamily: 'Roboto-Flex-Medium', fontSize: 11 }}
            numberOfLines={1}
          >
            {when}
          </Text>
        </View>
      ) : null}

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={isSaved ? 'Remove from saved' : 'Save event'}
        onPress={(e) => {
          // Stop the tap so it doesn't also open the event.
          e.stopPropagation();
          onToggleSave(item.id);
        }}
        style={{
          position: 'absolute',
          top: CORNER_INSET,
          right: CORNER_INSET,
          backgroundColor: colors.surface,
          borderRadius: 999,
          width: SAVE_BUTTON_SIZE,
          height: SAVE_BUTTON_SIZE,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <BookmarkGlyph saved={isSaved} width={12} height={17} />
      </TouchableOpacity>

      <View style={{ position: 'absolute', left: 12, right: 12, bottom: 12 }}>
        {item.host_organization_name ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
            <Text
              style={{
                color: OVERLAY_TEXT,
                fontFamily: 'Roboto-Flex-Medium',
                fontSize: 13,
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

        <Text
          style={{
            color: OVERLAY_TEXT,
            fontFamily: 'Roboto-Flex-Bold',
            fontSize: 18,
            lineHeight: 22,
          }}
          numberOfLines={2}
        >
          {item.title}
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
          {/* location.svg paints from currentColor at 50% opacity, so it is told
              to be white here and dims itself. */}
          <LocationIcon width={13} height={13} color={OVERLAY_TEXT} />
          <Text
            style={{ color: OVERLAY_TEXT, fontFamily: 'Roboto-Flex', fontSize: 13, flexShrink: 1 }}
            numberOfLines={1}
          >
            {item.location_short || 'TBD'}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
