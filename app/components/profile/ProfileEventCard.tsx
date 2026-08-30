import EventFlyerPlaceholder from '@/app/components/EventFlyerPlaceholder';
// Event card for the two-column "My Events" grid on the profile
// (Figma "Profile Main" frame).
//
// Distinct from components/EventCard, which is a fixed 180pt card built for
// the home screen's horizontal carousels. This one flexes to half the row so
// two sit side by side, and carries the poster-first layout the profile grid
// uses: image with a bookmark overlay, title, "Posted by <org> ✓", date, room.

import BookmarkGlyph from '@/app/components/icons/BookmarkGlyph';
import LocationIcon from '@/assets/images/location.svg';
import { formatEventDate, type ApiEvent } from '@/app/components/EventCard';
import { useThemeColors } from '@/app/lib/themeColors';
import { useRouter } from 'expo-router';
import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';

export interface ProfileEventCardProps {
  event: ApiEvent & { org_verified?: boolean; is_saved?: boolean };
  onToggleSave?: (eventId: number) => void;
  onEdit?: (event: ApiEvent) => void;
}

export default function ProfileEventCard({ event, onToggleSave, onEdit }: ProfileEventCardProps) {
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

        {onToggleSave ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isSaved ? `Unsave ${event.title}` : `Save ${event.title}`}
            hitSlop={8}
            onPress={(e) => {
              // Otherwise the tap also opens the event detail underneath.
              e.stopPropagation();
              onToggleSave(event.id);
            }}
            className="absolute right-[8px] top-[8px] h-[26px] w-[26px] items-center justify-center rounded-full bg-lhlSurface/90"
          >
            <BookmarkGlyph saved={isSaved} width={13} height={13} />
          </Pressable>
        ) : null}

        {onEdit ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit ${event.title}`}
            hitSlop={8}
            onPress={(e) => {
              e.stopPropagation();
              onEdit(event);
            }}
            className="absolute left-[8px] top-[8px] flex-row items-center rounded-full bg-lhlSurface/90 px-[9px] py-[5px]"
          >
            <Text className="font-['Roboto-Flex'] text-[10px] font-semibold text-lhlAccent">
              Edit
            </Text>
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
