import type { ApiEvent } from '@/app/components/EventCard';
import type { ThemeColors } from '@/app/lib/themeColors';
import { useThemeColors } from '@/app/lib/themeColors';
import { useEventLocation } from '@/app/lib/useEventLocation';
import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import EventLocationMap from './EventLocationMap';

interface EventLocationMapModalProps {
  visible: boolean;
  onClose: () => void;
  event: ApiEvent;
  // Auth token, so a coordinate resolved from the location label can be
  // written back to the server for this event (backfill). Optional: without it
  // the map still shows, the coordinate just isn't persisted.
  token?: string | null;
}

export default function EventLocationMapModal({
  visible,
  onClose,
  event,
  token,
}: EventLocationMapModalProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Resolution, the viewer's position and the walk estimate live in
  // useEventLocation, shared with the inline route card on the event page.
  // `enabled` keeps the old behaviour of only geocoding once the modal opens.
  const {
    coord,
    resolving,
    user,
    locating,
    walkMinutes,
    requestUserLocation,
    openInMaps,
    hasLocation,
  } = useEventLocation(event, token, { enabled: visible });

  const locationName = event.location_short || event.location_full || null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <TouchableOpacity style={styles.close} onPress={onClose} hitSlop={12}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>

          {!hasLocation ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No location listed for this event.</Text>
            </View>
          ) : (
            <>
              <View style={styles.headerText}>
                {locationName && <Text style={styles.title}>{locationName}</Text>}
                <Text style={styles.subtitle} numberOfLines={2}>
                  {event.title}
                </Text>
              </View>

              <View style={styles.mapFrame}>
                {resolving ? (
                  <View style={styles.mapLoading}>
                    <ActivityIndicator color={colors.brand} />
                  </View>
                ) : coord ? (
                  <EventLocationMap
                    event={coord}
                    label={locationName || event.title}
                    user={user}
                    showRoute={user != null}
                  />
                ) : (
                  <View style={styles.mapLoading}>
                    <Text style={styles.emptyText}>
                      Couldn&apos;t place this address on the map.
                    </Text>
                  </View>
                )}

                {coord && (
                  <TouchableOpacity
                    style={styles.distancePill}
                    onPress={requestUserLocation}
                    disabled={locating}
                  >
                    {locating ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.distancePillText}>
                        {walkMinutes != null
                          ? `${walkMinutes} min walk`
                          : 'Tap to see current distance'}
                      </Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>

              <TouchableOpacity
                style={styles.openButton}
                onPress={() => openInMaps()}
                activeOpacity={0.85}
              >
                <Text style={styles.openButtonText}>Open in Maps</Text>
              </TouchableOpacity>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    scrim: {
      flex: 1,
      backgroundColor: c.scrim,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    },
    card: {
      width: '100%',
      maxWidth: 400,
      backgroundColor: c.background,
      borderRadius: 16,
      padding: 16,
      gap: 20,
    },
    close: {
      position: 'absolute',
      top: 12,
      right: 14,
      zIndex: 2,
    },
    closeText: {
      fontSize: 16,
      color: c.ink,
    },
    headerText: {
      paddingTop: 8,
      gap: 6,
      paddingRight: 24,
    },
    title: {
      fontSize: 23,
      fontWeight: '500',
      color: c.ink,
    },
    subtitle: {
      fontSize: 15,
      color: c.ink,
    },
    mapFrame: {
      height: 260,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surfaceMuted,
      overflow: 'hidden',
    },
    mapLoading: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
    },
    distancePill: {
      position: 'absolute',
      bottom: 12,
      alignSelf: 'center',
      backgroundColor: c.inkSecondary,
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingVertical: 12,
      minWidth: 170,
      alignItems: 'center',
    },
    distancePillText: {
      color: '#FFFFFF',
      fontSize: 12,
    },
    openButton: {
      height: 55,
      borderRadius: 8,
      backgroundColor: c.brand,
      alignItems: 'center',
      justifyContent: 'center',
    },
    openButtonText: {
      color: '#FFFFFF',
      fontSize: 20,
      fontWeight: '500',
    },
    emptyState: {
      paddingVertical: 40,
      paddingHorizontal: 16,
      alignItems: 'center',
    },
    emptyText: {
      fontSize: 15,
      color: c.inkMuted,
      textAlign: 'center',
      lineHeight: 22,
    },
  });
