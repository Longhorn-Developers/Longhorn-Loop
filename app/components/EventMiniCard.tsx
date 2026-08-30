// The preview card that slides up when you tap a pin on the Explore map.
//
// THE CARD IS THE BUTTON. It used to carry a small "View" pill in the actions
// column, which made the primary action the smallest thing on a card the width
// of the screen — and left the other 90% of it inert, so tapping the title or
// the thumbnail did nothing. Every map app puts the whole preview under one
// press. The pill is gone and `onViewDetails` moved onto the card itself; the
// prop is unchanged, so the caller did not have to move with it.
//
// The two remaining controls are the exceptions to that press, which is what
// nested touchables already do: a tap that lands on close or save is handled
// there and never reaches the card.
//
// TouchableOpacity rather than Pressable, and a plain style object rather than
// a ({ pressed }) => style function. Every other touchable in this file and on
// the Explore screen is a TouchableOpacity with an object style; a Pressable
// carrying a function style and no className is a different path through
// NativeWind's transform, and the first version of this card lost its
// background, border and row layout on device while rendering correctly on
// web. Not worth being clever about — activeOpacity gives the same dimming.
//
// Both were well under the platform minimums — an 11x12 glyph in a 28pt box
// against Apple's 44pt and Android's 48dp. They are 40pt boxes now, with
// hitSlop taking them past 48, and the glyphs inside grew to match. Dismiss
// sits above save because it is the one people reach for by muscle memory and
// the top-right corner is where a dismissible card trains them to look.

import EventFlyerPlaceholder from '@/app/components/EventFlyerPlaceholder';
import BookmarkGlyph from '@/app/components/icons/BookmarkGlyph';
import LocationIcon from '@/assets/images/location.svg';
import XCloseIcon from '@/assets/images/x-close.svg';
import { ApiEvent, formatEventDate } from '@/app/components/EventCard';
import { useThemeColors } from '@/app/lib/themeColors';
import React from 'react';
import { Image, Text, TouchableOpacity, View } from 'react-native';

/** 40pt visual + 4/6pt hitSlop clears both 44pt (iOS) and 48dp (Android). */
const ACTION_SIZE = 40;
const ACTION_HIT_SLOP = { top: 6, bottom: 6, left: 6, right: 6 };

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
    <TouchableOpacity
      onPress={() => onViewDetails(event.id)}
      accessibilityRole="button"
      accessibilityLabel={`View ${event.title}`}
      // The dimming is the only affordance that the card is pressable at all,
      // now that the pill is gone.
      activeOpacity={0.85}
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
        {event.image_url != null ? (
          <Image
            source={{ uri: event.image_url }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
          />
        ) : (
          <EventFlyerPlaceholder seed={event.id} />
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

      {/*
        Actions column. marginLeft on top of the row's gap: 12 — the title and
        location lines ran almost into the buttons, which is the bug bash's "need
        more whitespace to the left of the buttons".
      */}
      <View style={{ alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 8 }}>
        {/*
          The app's close glyph, not a literal ✕ character in a grey circle.
          Same asset RsvpSuccessToast uses, and the circled variant was called
          out at the bug bash (see the note in inputs/TextInputField.tsx — it
          was never in the Figma).
        */}
        <TouchableOpacity
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          hitSlop={ACTION_HIT_SLOP}
          style={{
            width: ACTION_SIZE,
            height: ACTION_SIZE,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <XCloseIcon width={15} height={16} color={colors.inkMuted} />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => onToggleSave(event.id)}
          accessibilityRole="button"
          accessibilityLabel={isSaved ? 'Remove from saved' : 'Save event'}
          accessibilityState={{ selected: isSaved }}
          hitSlop={ACTION_HIT_SLOP}
          style={{
            width: ACTION_SIZE,
            height: ACTION_SIZE,
            borderRadius: ACTION_SIZE / 2,
            backgroundColor: isSaved ? colors.brandSoft : colors.surfaceMuted,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <BookmarkGlyph saved={isSaved} width={14} height={18} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}
