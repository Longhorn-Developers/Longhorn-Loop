// What your event will look like once it is posted.
//
// "Preview Event" sat next to "Post Event" on the last step and did nothing —
// its handler was a comment and an empty body. It is the scarier of the two
// buttons to leave broken: the whole reason to press it is that you are not
// sure yet, and a button that does nothing reads as "the app ate my draft".
//
// WHAT THIS RENDERS
//
// The event detail page (app/event/[id]/index.tsx) as it would look with the
// current draft — same gradient, poster, title, meta row, description, chips
// and host block, in the same order. It is a separate component rather than
// the real screen because that one is a route: it reads an id from the URL,
// fetches the event, and owns RSVP, save, share and report. None of that has
// an answer for a draft that does not exist yet.
//
// The cost is drift — two files that are supposed to look the same. If this
// diverges enough to matter, the fix is to lift the presentational half of
// the detail screen into a shared component and feed it either a fetched
// event or a draft. Not worth doing pre-emptively for a preview.
//
// WHAT IT DOES NOT DO
//
// It does not post. You look, you go back to step 6, you post — the actions
// stay where the user left them, and the preview never becomes a second place
// where an event can be published from.

import EventFlyerPlaceholder from '@/app/components/EventFlyerPlaceholder';
import ExpandableText from '@/app/components/ExpandableText';
import ArrowLeftIcon from '@/assets/images/arrow-left.svg';
import CalendarIcon from '@/assets/images/calendar.svg';
import MapIcon from '@/assets/images/map.svg';
import { useCreateEvent } from '@/app/context/CreateEventContext';
import type { ThemeColors } from '@/app/lib/themeColors';
import { useThemeColors } from '@/app/lib/themeColors';
import { LOCATION_PLACEHOLDER, VENUE_TYPE_LABELS } from '@/shared/venueType';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** Matches posterAspectRatio's portrait default on the detail screen. */
const POSTER_ASPECT = 0.72;

function formatShortDate(iso: string): string {
  const date = new Date(iso);
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const day = date.getDate();
  const suffix = (n: number) => {
    if (n >= 11 && n <= 13) return 'th';
    switch (n % 10) {
      case 1:
        return 'st';
      case 2:
        return 'nd';
      case 3:
        return 'rd';
      default:
        return 'th';
    }
  };
  return `${months[date.getMonth()]} ${day}${suffix(day)}`;
}

function formatShortTime(iso: string): string {
  const date = new Date(iso);
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return minutes === 0
    ? `${hours}:00 ${ampm}`
    : `${hours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
}

export default function EventPreview() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { data, setPreviewing } = useCreateEvent();

  const close = () => setPreviewing(false);

  // Perks first, then the interest tags, matching how the detail screen builds
  // its chip row (event.benefits before event.tags).
  const chips = [...data.benefits, ...data.interestTags];

  // An unfinished draft is the normal case here — you preview precisely because
  // you are not done. Every field below falls back to what the real page would
  // show for a missing value rather than collapsing the layout, so the preview
  // keeps the shape of the finished thing.
  const title = data.title.trim() || 'Untitled event';
  const hostName = data.poster?.name ?? 'You';
  const locationLabel =
    data.locationFull.trim() ||
    (data.venueType === 'online' ? LOCATION_PLACEHOLDER.online : 'Location TBD');

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        <SafeAreaView edges={['top']} style={{ backgroundColor: colors.background }}>
          <View style={{ position: 'relative' }}>
            {/* Same two-layer gradient as the detail screen, so the preview
                reads as the page rather than a form with a picture on it. */}
            <LinearGradient
              // theme-exempt: warm under-layer, only ever seen through the 15%
              // window in the layer above.
              colors={['rgba(146,141,135,1)', 'rgba(248,239,229,1)']}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <LinearGradient
              colors={[colors.background, 'rgba(146,141,135,0.15)', colors.background]}
              locations={[0, 0.5144, 1]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={StyleSheet.absoluteFill}
            />

            <View
              style={{
                paddingTop: 8,
                paddingBottom: 24,
                paddingHorizontal: 24,
                alignItems: 'center',
              }}
            >
              <TouchableOpacity
                onPress={close}
                style={styles.backButton}
                accessibilityRole="button"
                accessibilityLabel="Back to editing"
              >
                <ArrowLeftIcon width={20} height={20} color={colors.ink} />
              </TouchableOpacity>

              <View style={styles.previewPill}>
                <Text style={styles.previewPillText}>Preview</Text>
              </View>

              <View style={[styles.poster, { aspectRatio: POSTER_ASPECT }]}>
                {data.imageUrl ? (
                  <Image
                    source={{ uri: data.imageUrl }}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode="contain"
                  />
                ) : (
                  // No id yet, so no stable seed — the colourway is whatever
                  // the placeholder picks for null. The posted event gets its
                  // own once the row exists.
                  <EventFlyerPlaceholder />
                )}
              </View>
            </View>
          </View>
        </SafeAreaView>

        <View style={{ paddingHorizontal: 20, paddingTop: 20 }}>
          <Text style={styles.title}>{title}</Text>

          <View style={{ flexDirection: 'row', gap: 16, marginBottom: 24 }}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={styles.metaIconBadge}>
                {/* theme-exempt: white glyph on the brand badge, as on detail. */}
                <CalendarIcon width={16} height={16} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.metaPrimary}>
                  {data.startDatetime ? formatShortDate(data.startDatetime) : 'Date TBD'}
                </Text>
                {data.startDatetime ? (
                  <Text style={styles.metaSecondary}>{formatShortTime(data.startDatetime)}</Text>
                ) : null}
              </View>
            </View>

            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={styles.metaIconBadge}>
                <MapIcon width={16} height={16} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.metaPrimary} numberOfLines={2}>
                  {locationLabel}
                </Text>
                {/* The detail page has no venue-type line, but a preview is
                    where you catch having picked the wrong one. */}
                <Text style={styles.metaSecondary}>{VENUE_TYPE_LABELS[data.venueType]}</Text>
              </View>
            </View>
          </View>

          {data.description.trim() ? (
            <View style={{ marginBottom: 18 }}>
              <Text style={styles.sectionHeader}>About This Event</Text>
              <ExpandableText style={styles.bodyText}>{data.description.trim()}</ExpandableText>
            </View>
          ) : null}

          {chips.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 22 }}>
              {chips.map((label, i) => (
                <View key={`chip-${i}-${label}`} style={styles.chip}>
                  <Text style={styles.chipText}>{label}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <View style={{ marginBottom: 18 }}>
            <Text style={styles.sectionHeader}>Hosted by</Text>
            <Text style={styles.metaPrimary}>{hostName}</Text>
          </View>

          {/* The one action. Deliberately not a second Post button — see the
              note at the top of this file. */}
          <TouchableOpacity
            onPress={close}
            style={styles.doneButton}
            accessibilityRole="button"
            accessibilityLabel="Back to editing"
          >
            <Text style={styles.doneButtonText}>Back to Editing</Text>
          </TouchableOpacity>

          <Text style={styles.footnote}>
            Nothing has been posted yet — you can still change anything.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    backButton: {
      alignSelf: 'flex-start',
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    previewPill: {
      backgroundColor: c.brandSoft,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 4,
      marginBottom: 12,
    },
    previewPillText: {
      fontSize: 12,
      fontWeight: '700' as const,
      color: c.brand,
      letterSpacing: 0.5,
    },
    poster: {
      width: '100%',
      borderRadius: 12,
      overflow: 'hidden',
      backgroundColor: c.placeholder,
    },
    title: {
      fontSize: 22,
      fontWeight: '700' as const,
      color: c.ink,
      marginBottom: 16,
    },
    metaIconBadge: {
      width: 32,
      height: 32,
      borderRadius: 8,
      backgroundColor: c.brand,
      alignItems: 'center',
      justifyContent: 'center',
    },
    metaPrimary: {
      fontSize: 14,
      fontWeight: '600' as const,
      color: c.ink,
    },
    metaSecondary: {
      fontSize: 12,
      fontWeight: '400' as const,
      color: c.inkMuted,
      marginTop: 2,
    },
    sectionHeader: {
      fontSize: 16,
      fontWeight: '700' as const,
      color: c.ink,
      marginBottom: 8,
    },
    bodyText: {
      fontSize: 14,
      color: c.ink,
      lineHeight: 21,
    },
    chip: {
      backgroundColor: c.surfaceMuted,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 6,
    },
    chipText: {
      fontSize: 13,
      color: c.ink,
      fontWeight: '500' as const,
    },
    doneButton: {
      backgroundColor: c.brand,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 4,
    },
    doneButtonText: {
      color: '#fff', // theme-exempt: white label on the filled brand button
      fontSize: 15,
      fontWeight: '700' as const,
    },
    footnote: {
      fontSize: 12,
      color: c.inkMuted,
      textAlign: 'center',
      marginTop: 10,
    },
  });
