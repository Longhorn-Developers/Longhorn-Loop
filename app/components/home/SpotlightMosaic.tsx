// The "Spotlight" block at the top of Home: three events, one tall card on the
// left and two stacked on the right.
//
// DELIBERATELY NOT A GRID. The asymmetry is the redesign: Home used to be rows
// of identically sized cards, which testers described as "scrolling for
// audiobooks or playlists", and the fix is that size now carries meaning — the
// big card is the pick. So there are exactly three fixed slots, in a fixed
// arrangement, and this takes no column count or item-size props. Fewer than
// three events renders nothing rather than a mosaic with a hole in it, and
// extras beyond three are ignored.
//
// Which three events, and in what order (slot 0 is the tall card), is the
// caller's decision — the "weekly top" ranking is still open (LOOP-273).

import type { ApiEvent } from '@/app/components/EventCard';
import EventFlyerPlaceholder from '@/app/components/EventFlyerPlaceholder';
import {
  DIM,
  OVERLAY_TEXT,
  PILL_FILL,
  SCRIM_CLEAR,
  SCRIM_DARK,
} from '@/app/components/home/overlay';
import { formatDay, formatTime } from '@/app/components/home/when';
import { useThemeColors, type ThemeColors } from '@/app/lib/themeColors';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

// Whole block height, and the gap between slots. The right-hand cards are each
// half of the height minus one gap.
const MOSAIC_HEIGHT = 190;
const GAP = 10;

/** "Sat · 1:00 PM" */
function formatWhen(iso: string): string {
  const day = formatDay(iso);
  return day ? `${day} · ${formatTime(iso)}` : '';
}

/** The corner tag: first category, else first classifier tag, else none. */
function tagFor(event: ApiEvent): string | null {
  const label = event.categories?.[0]?.name?.trim() || event.tags?.[0]?.trim();
  return label ? label.toUpperCase() : null;
}

function SpotlightCard({ event, large }: { event: ApiEvent; large: boolean }) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const tag = tagFor(event);
  const when = formatWhen(event.start_datetime);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={when ? `${event.title}, ${when}` : event.title}
      onPress={() => router.push(`/event/${event.id}`)}
      style={styles.card}
    >
      {event.image_url ? (
        <Image
          source={{ uri: event.image_url }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
      ) : (
        <EventFlyerPlaceholder seed={event.id} />
      )}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: DIM }]} pointerEvents="none" />
      <LinearGradient
        colors={[SCRIM_CLEAR, SCRIM_DARK]}
        locations={[0.35, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {tag ? (
        <View style={styles.tag}>
          <Text style={styles.tagText} numberOfLines={1}>
            {tag}
          </Text>
        </View>
      ) : null}

      <View style={styles.caption}>
        <Text style={[styles.title, large ? styles.titleLarge : null]} numberOfLines={2}>
          {event.title}
        </Text>
        {when ? <Text style={styles.when}>{when}</Text> : null}
      </View>
    </Pressable>
  );
}

export default function SpotlightMosaic({ events }: { events: ApiEvent[] }) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (events.length < 3) return null;
  const [tall, topRight, bottomRight] = events;

  return (
    <View style={styles.mosaic}>
      {/* Slightly wider than the right column, as in the design (~52 / 48). */}
      <View style={{ flex: 1.1 }}>
        <SpotlightCard event={tall} large />
      </View>
      <View style={{ flex: 1, gap: GAP }}>
        <SpotlightCard event={topRight} large={false} />
        <SpotlightCard event={bottomRight} large={false} />
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    mosaic: {
      flexDirection: 'row',
      height: MOSAIC_HEIGHT,
      gap: GAP,
    },
    card: {
      flex: 1,
      borderRadius: 16,
      overflow: 'hidden',
      backgroundColor: c.placeholder,
    },
    tag: {
      position: 'absolute',
      top: 8,
      left: 8,
      maxWidth: '80%',
      borderRadius: 10,
      backgroundColor: PILL_FILL,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    tagText: {
      color: OVERLAY_TEXT,
      fontFamily: 'Roboto-Flex-Medium',
      fontSize: 9,
      letterSpacing: 0.4,
    },
    caption: {
      position: 'absolute',
      left: 10,
      right: 10,
      bottom: 9,
    },
    title: {
      color: OVERLAY_TEXT,
      fontFamily: 'Roboto-Flex-SemiBold',
      fontSize: 12,
      lineHeight: 15,
    },
    titleLarge: {
      fontSize: 14,
      lineHeight: 17,
    },
    when: {
      color: OVERLAY_TEXT,
      fontFamily: 'Roboto-Flex-SemiBold',
      fontSize: 11,
      marginTop: 2,
    },
  });
