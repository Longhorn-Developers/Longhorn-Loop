import { useThemeColors } from '@/app/lib/themeColors';
import WalkIcon from '@/assets/images/walk.svg';
import React, { useCallback, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, type Region } from 'react-native-maps';

const EVENT_PIN = '#BF5700'; // theme-exempt: pin drawn over map tiles
const USER_PIN = '#2591D4'; // theme-exempt: user-location pin, matches design
const WALK_BADGE_TEXT = '#FFFFFF'; // theme-exempt: label on the blue badge, drawn over map tiles

export interface Coord {
  latitude: number;
  longitude: number;
}

interface EventLocationMapProps {
  event: Coord;
  /** Label shown on the event pin callout. */
  label: string;
  user: Coord | null;
  /** Straight-line path between user and event, drawn when both are known. */
  showRoute: boolean;
  /**
   * 'inline' is the card on the event page: a non-interactive snapshot framed on
   * the route, with a "You" bubble and a walk-time badge on the line. The
   * default is the modal's pannable map with plain pins.
   */
  variant?: 'modal' | 'inline';
  /** Shown on the route badge in the inline variant. */
  walkMinutes?: number | null;
}

// The native map: event pin, optional user pin, and a line between them. The
// .web sibling renders a fallback message.
export default function EventLocationMap({
  event,
  label,
  user,
  showRoute,
  variant = 'modal',
  walkMinutes = null,
}: EventLocationMapProps) {
  const colors = useThemeColors();
  const mapRef = useRef<MapView>(null);
  const inline = variant === 'inline';

  const region: Region = {
    latitude: event.latitude,
    longitude: event.longitude,
    // Tighter than the modal: the card is short, and a venue-sized frame reads
    // as "the building" rather than "somewhere on campus".
    latitudeDelta: inline ? 0.004 : 0.01,
    longitudeDelta: inline ? 0.004 : 0.01,
  };

  // Frame the whole route once both ends are known. initialRegion only centres
  // on the venue, so with a user position that is off to one side the "You" pin
  // would sit outside the card. Run from onMapReady because fitToCoordinates
  // before the native map exists is dropped.
  const fitRoute = useCallback(() => {
    if (!inline || !user) return;
    mapRef.current?.fitToCoordinates([user, event], {
      edgePadding: { top: 56, right: 48, bottom: 32, left: 48 },
      animated: false,
    });
  }, [inline, user, event]);

  if (inline) {
    const mid = user
      ? {
          latitude: (user.latitude + event.latitude) / 2,
          longitude: (user.longitude + event.longitude) / 2,
        }
      : null;
    return (
      // pointerEvents="none": the card sits inside the page's ScrollView, and a
      // live map would swallow the vertical drag that is meant to scroll it.
      <View style={styles.fill} pointerEvents="none">
        <MapView
          ref={mapRef}
          style={styles.fill}
          initialRegion={region}
          onMapReady={fitRoute}
          scrollEnabled={false}
          zoomEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
          toolbarEnabled={false}
        >
          <Marker coordinate={event} title={label} pinColor={EVENT_PIN} />
          {showRoute && user && (
            <Polyline coordinates={[user, event]} strokeColor={USER_PIN} strokeWidth={3} />
          )}
          {user && (
            // Anchor sits on the dot, not the middle of the view: the bubble and
            // its tail are above it, so the default (0.5, 0.5) would plant the
            // dot ~16px south of where the viewer actually is.
            <Marker coordinate={user} anchor={{ x: 0.5, y: 0.83 }}>
              <View style={styles.youWrap}>
                <View style={styles.youBubble}>
                  <Text style={styles.youText}>You</Text>
                </View>
                <View style={styles.youTail} />
                <View style={styles.youDot} />
              </View>
            </Marker>
          )}
          {mid && walkMinutes != null && (
            <Marker coordinate={mid} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={styles.walkBadge}>
                <WalkIcon width={13} height={13} color={WALK_BADGE_TEXT} />
                <Text style={styles.walkBadgeText}>{walkMinutes} min</Text>
              </View>
            </Marker>
          )}
        </MapView>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <MapView ref={mapRef} style={styles.fill} initialRegion={region}>
        <Marker coordinate={event} title={label} pinColor={EVENT_PIN} />
        {user && <Marker coordinate={user} title="You" pinColor={USER_PIN} />}
        {showRoute && user && (
          <Polyline coordinates={[user, event]} strokeColor={USER_PIN} strokeWidth={3} />
        )}
      </MapView>
      <View style={styles.caption} pointerEvents="none">
        <Text style={[styles.captionText, { color: colors.inkMuted }]}>UT Austin Campus</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // No fixed width: the bubble is as wide as its label, and a marker view is
  // clipped to its own bounds, so a width narrower than the bubble cut the
  // "You" off-centre. Sized to content, the tail and dot centre under it.
  youWrap: { alignItems: 'center', height: 48 },
  youBubble: {
    height: 26,
    paddingHorizontal: 12,
    borderRadius: 13,
    backgroundColor: USER_PIN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // lineHeight = fontSize + a little, and no font padding: Android adds
  // ascender/descender padding to Text that parks the glyphs above the
  // visual centre of a pill, which reads as "not centred" at this size.
  youText: {
    color: WALK_BADGE_TEXT,
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '600',
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  youTail: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: USER_PIN,
  },
  youDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: USER_PIN,
    borderWidth: 2.5,
    borderColor: WALK_BADGE_TEXT,
  },
  walkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 13,
    backgroundColor: USER_PIN,
  },
  walkBadgeText: {
    color: WALK_BADGE_TEXT,
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '600',
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  caption: { position: 'absolute', bottom: 8, left: 10 },
  captionText: { fontSize: 11 },
});
