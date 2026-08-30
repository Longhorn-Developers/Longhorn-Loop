import EventFlyerPlaceholder from '@/app/components/EventFlyerPlaceholder';
// Event card for the two-column "My Events" grid on the profile
// (Figma "Profile Main" frame).
//
// Distinct from components/EventCard, which is a fixed 180pt card built for
// the home screen's horizontal carousels. This one flexes to half the row so
// two sit side by side, and carries the poster-first layout the profile grid
// uses: image with a bookmark overlay, title, "Posted by <org> ✓", date, room.

import BookmarkGlyph from '@/app/components/icons/BookmarkGlyph';
import PencilIcon from '@/assets/images/pencil.svg';
import LocationIcon from '@/assets/images/location.svg';
import { formatEventDate, type ApiEvent } from '@/app/components/EventCard';
import { useThemeColors } from '@/app/lib/themeColors';
import { useRouter } from 'expo-router';
import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';

export interface ProfileEventCardProps {
  event: ApiEvent & { org_verified?: boolean; is_saved?: boolean };
  onToggleSave?: (eventId: number) => void;
  /**
   * Opens the Manage Event sheet. Only the Posted tab passes it — the same
   * card renders under Going and Saved, where these are other people's events
   * and there is nothing to manage. Absent means no pencil, which is also what
   * keeps the badge from replacing the save button on those tabs.
   */
  onManage?: (eventId: number) => void;
  /**
   * True while the Manage Event sheet is open for THIS card. Lights the pencil
   * so the sheet visibly belongs to a card rather than floating free -- four
   * tiles in a grid look alike, and the sheet covers the bottom half of the
   * screen including, often, the card you tapped.
   */
  managing?: boolean;
}

/**
 * Shared geometry for the card's top-right control. One constant because the
 * pencil and the bookmark are the same button wearing different glyphs, and
 * two copies of these numbers is how they came apart in the first place.
 */
const cornerButtonStyle = {
  position: 'absolute' as const,
  right: 8,
  top: 8,
  height: 26,
  width: 26,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  borderRadius: 999,
};

export default function ProfileEventCard({
  event,
  onToggleSave,
  onManage,
  managing,
}: ProfileEventCardProps) {
  const router = useRouter();
  const colors = useThemeColors();
  const isSaved = !!event.is_saved;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={event.title}
      onPress={() => router.push(`/event/${event.id}`)}
      // Half the row minus the gap. Set here rather than by the parent so the
      // card is self-contained wherever the grid is reused.
      className="mb-[16px] w-[48%] overflow-hidden rounded-[12px] border border-lhlMutedBorder bg-lhlSurface"
    >
      <View className="h-[150px] w-full bg-lhlPlaceholderGrey">
        {event.image_url ? (
          <>
            {/* Blurred fill behind a contained poster, matching EventCard, so
                portrait flyers don't get cropped or letterboxed onto grey. */}
            <Image
              source={{ uri: event.image_url }}
              style={{ position: 'absolute', width: '100%', height: '100%', opacity: 0.55 }}
              blurRadius={18}
              resizeMode="cover"
            />
            <Image
              source={{ uri: event.image_url }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="contain"
            />
          </>
        ) : (
          <EventFlyerPlaceholder seed={event.id} />
        )}

        {/*
          The perk tag, matching components/EventCard. It was only ever on that
          card, so an event with Free Food showed the tag in the home carousels
          and nothing on your own profile — the same event looking different
          depending on where you found it.

          Bottom-RIGHT for the same reason it moved there on EventCard:
          EventFlyerPlaceholder anchors its artwork bottom-left, where the tower
          is, so a tag in that corner lands on it every time a flyerless event
          renders. Save sits top-right, so the corner is free.

          A grid tile is about half the width of a carousel card, so the pill is
          a step down from EventCard's — 9px text in tighter padding — and only
          ever shows the first perk. Two would wrap and eat the poster.
        */}
        {event.benefits?.length ? (
          <View className="absolute bottom-[8px] right-[8px] rounded-[10px] bg-lhlBurntOrange px-[7px] py-[2px]">
            <Text
              numberOfLines={1}
              // theme-exempt: white on the filled brand pill in both themes,
              // same as the EventCard tag it mirrors.
              className="font-['Roboto-Flex'] text-[9px] font-semibold text-white"
            >
              {event.benefits[0]}
            </Text>
          </View>
        ) : null}

        {/*
          The pencil takes the save button's corner on the Posted tab. Your own
          event is not something you save, so nothing is lost by the swap, and
          two round buttons stacked in one corner on a 150pt tile would leave
          neither comfortably tappable.
        */}
        {/*
          Pencil and bookmark are the SAME button in every respect that shows:
          same 26pt circle, same corner, same 13pt glyph, same press feedback.
          They were built separately and had drifted, so the pencil sat in a
          circle that behaved differently from the one it replaces -- and since
          only one of the two is ever mounted, the difference showed up as the
          Posted tab feeling subtly unlike Going and Saved rather than as two
          buttons that look wrong side by side.

          Pressed goes to a light grey fill rather than dimming: a 26pt control
          under a fingertip is entirely hidden at the moment of the press, so
          the feedback has to survive being covered, and a colour that persists
          for the frames after the finger lifts does that where a fade does not.

          The pencil additionally lights brand-orange while its sheet is open.
          That is not decoration either: the sheet can cover the card it came
          from, and on the way back you want to see which of four near-identical
          tiles you were working on.
        */}
        {onManage ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Manage ${event.title}`}
            accessibilityState={{ expanded: !!managing }}
            hitSlop={8}
            onPress={(e) => {
              // Otherwise the tap also opens the event detail underneath.
              e.stopPropagation();
              onManage(event.id);
            }}
            style={({ pressed }) => [
              cornerButtonStyle,
              {
                backgroundColor: managing
                  ? colors.brand
                  : pressed
                    ? colors.surfaceMuted
                    : colors.surface,
              },
            ]}
          >
            {/* theme-exempt: white on the filled brand circle, as on every
                other brand-filled control. */}
            <PencilIcon width={13} height={13} color={managing ? '#FFFFFF' : colors.ink} />
          </Pressable>
        ) : onToggleSave ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isSaved ? `Unsave ${event.title}` : `Save ${event.title}`}
            hitSlop={8}
            onPress={(e) => {
              // Otherwise the tap also opens the event detail underneath.
              e.stopPropagation();
              onToggleSave(event.id);
            }}
            style={({ pressed }) => [
              cornerButtonStyle,
              { backgroundColor: pressed ? colors.surfaceMuted : colors.surface },
            ]}
          >
            <BookmarkGlyph saved={isSaved} width={13} height={13} />
          </Pressable>
        ) : null}
      </View>

      <View className="px-[10px] py-[9px]">
        <Text
          numberOfLines={2}
          className="font-['Roboto-Flex'] text-[13px] font-semibold leading-[17px] text-lhlInk"
        >
          {event.title}
        </Text>

        {event.host_organization_name ? (
          <View className="mt-[4px] flex-row items-center">
            <Text
              numberOfLines={1}
              className="font-['Roboto-Flex'] shrink text-[10px] text-lhlSecondaryTextGrey"
            >
              Posted by {event.host_organization_name}
            </Text>
            {event.org_verified ? (
              <Text
                className="ml-[3px] text-[10px] text-lhlAccent"
                accessibilityLabel="Verified organization"
              >
                ✓
              </Text>
            ) : null}
          </View>
        ) : null}

        <Text className="font-['Roboto-Flex'] mt-[5px] text-[10px] text-lhlSecondaryTextGrey">
          {formatEventDate(event.start_datetime)}
        </Text>

        {event.location_short ? (
          <View className="mt-[3px] flex-row items-center gap-[3px]">
            <LocationIcon width={9} height={9} color={colors.inkSecondary} />
            <Text
              numberOfLines={1}
              className="font-['Roboto-Flex'] shrink text-[10px] text-lhlSecondaryTextGrey"
            >
              {event.location_short}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
