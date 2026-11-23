import type { ApiEvent } from '@/app/components/EventCard';
import EventFlyerPlaceholder from '@/app/components/EventFlyerPlaceholder';
import { OVERLAY_TEXT } from '@/app/components/home/overlay';
import { formatDay, formatMonthDay, formatTime } from '@/app/components/home/when';
import { useThemeColors } from '@/app/lib/themeColors';
import { useRouter } from 'expo-router';
import { CaretRightIcon } from 'phosphor-react-native';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * The "TRENDING THIS WEEK" hero (LOOP-292): one wide photo card with a POPULAR
 * tag, the title, and "Tonight • 7:00 PM • UT Main Mall".
 *
 * Values are the Figma `featured-section`. The two fills below are fixed in
 * both themes on purpose, like Home's overlay colours: they sit on a photo that
 * is not themed.
 */
const HERO_HEIGHT = 206;
const HERO_SCRIM = 'rgba(2,11,18,0.55)'; // theme-exempt: darkens the photo for the title
const BADGE_FILL = 'rgba(242,165,111,0.38)'; // theme-exempt: translucent orange tag on a photo

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/**
 * The events behind "Trending this week" (LOOP-292), in the order the feed
 * ranked them. Exported because "See all" (view-all.tsx) must show the same set.
 *
 * The feed keeps an event until a week AFTER it ends (expires_at = end + 7d),
 * so its first entry can be long over. This drops anything that has ended and
 * anything starting more than a week out. Ranking is the feed's own, which is
 * personalised: "trending" here means "top of your ranked feed", not a global
 * popularity count.
 */
export function trendingThisWeek(events: ApiEvent[], now: Date): ApiEvent[] {
  const nowMs = now.getTime();
  return events.filter((event) => {
    const start = Date.parse(event.start_datetime);
    if (Number.isNaN(start)) return false;
    const end = event.end_datetime ? Date.parse(event.end_datetime) : start;
    return (Number.isNaN(end) ? start : end) >= nowMs && start <= nowMs + WEEK_MS;
  });
}

/** "Tonight", "Today", "Tomorrow", or "Sat 8/21". Started already reads "Happening now". */
function dayLabel(iso: string, now: Date): string {
  const start = new Date(iso);
  if (Number.isNaN(start.getTime())) return '';
  if (start.getTime() <= now.getTime()) return 'Happening now';

  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  // Rounded: a day is 23 or 25 hours across a DST change.
  const days = Math.round((dayStart(start) - dayStart(now)) / DAY_MS);
  if (days === 0) return start.getHours() >= 17 ? 'Tonight' : 'Today';
  if (days === 1) return 'Tomorrow';
  return `${formatDay(iso)} ${formatMonthDay(iso)}`;
}

type Props = {
  event: ApiEvent;
  now: Date;
  onSeeAll: () => void;
};

export default function ExploreTrendingHero({ event, now, onSeeAll }: Props) {
  const colors = useThemeColors();
  const router = useRouter();

  const flyerUri = event.image_url?.trim();
  const [failedFlyerUri, setFailedFlyerUri] = useState<string>();

  const when = [
    dayLabel(event.start_datetime, now),
    formatTime(event.start_datetime),
    event.location_short,
  ]
    .filter(Boolean)
    .join(' • ');

  return (
    <View style={{ marginBottom: 20 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <Text className="font-roboto-bold" style={{ fontSize: 16, color: colors.inkSecondary }}>
          TRENDING THIS WEEK
        </Text>
        <Pressable
          onPress={onSeeAll}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="See all trending events"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
        >
          <Text className="font-roboto-semibold" style={{ fontSize: 13, color: colors.accent }}>
            See all
          </Text>
          <CaretRightIcon size={14} color={colors.accent} weight="bold" />
        </Pressable>
      </View>

      {/* Shadow on the outer view, clipping on the inner one: iOS drops a
          shadow from a view that also has overflow: 'hidden'. */}
      <View
        style={{
          borderRadius: 16,
          backgroundColor: colors.placeholder,
          shadowColor: colors.ink,
          shadowOpacity: 0.1,
          shadowRadius: 4,
          shadowOffset: { width: 0, height: 3 },
          elevation: 3,
        }}
      >
        <Pressable
          onPress={() => router.push(`/event/${event.id}`)}
          accessibilityRole="button"
          accessibilityLabel={when ? `${event.title}, ${when}` : event.title}
          style={{
            height: HERO_HEIGHT,
            borderRadius: 16,
            overflow: 'hidden',
            justifyContent: 'space-between',
            paddingTop: 16,
            paddingLeft: 16,
            paddingRight: 20,
            paddingBottom: 20,
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
            <EventFlyerPlaceholder seed={event.id} variant="fractalGlass" />
          )}
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: HERO_SCRIM }]}
            pointerEvents="none"
          />

          <View
            style={{
              alignSelf: 'flex-start',
              borderRadius: 999,
              backgroundColor: BADGE_FILL,
              paddingHorizontal: 8,
              paddingVertical: 3.5,
            }}
          >
            <Text className="font-roboto-semibold" style={{ fontSize: 12, color: OVERLAY_TEXT }}>
              POPULAR
            </Text>
          </View>

          <View style={{ gap: 4 }}>
            <Text
              className="font-roboto-bold"
              style={{ fontSize: 22, color: OVERLAY_TEXT }}
              numberOfLines={2}
            >
              {event.title}
            </Text>
            {when ? (
              <Text
                className="font-roboto-semibold"
                style={{ fontSize: 14, color: OVERLAY_TEXT }}
                numberOfLines={1}
              >
                {when}
              </Text>
            ) : null}
          </View>
        </Pressable>
      </View>
    </View>
  );
}
