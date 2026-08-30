// The Manage Event sheet, opened by the pencil on a card in the profile's
// Posted tab.
//
// A bottom sheet rather than a menu or a new screen, because the four actions
// are about one specific event and the sheet carries a summary of that event at
// the top. Half of them are destructive-ish; a full-screen push would lose the
// context of which card you tapped, and a tiny popover would leave no room to
// say which event you are about to cancel.
//
// Delete is last and red. It is the only irreversible one, and putting it
// anywhere but the end of the list puts it under a thumb reaching for
// something else.

import type { ApiEvent } from '@/app/components/EventCard';
import EventFlyerPlaceholder from '@/app/components/EventFlyerPlaceholder';
import { formatEventDate } from '@/app/components/EventCard';
import EyeIcon from '@/assets/images/eye.svg';
import MegaphoneIcon from '@/assets/images/megaphone.svg';
import PencilIcon from '@/assets/images/pencil.svg';
import TrashIcon from '@/assets/images/trash.svg';
import type { ThemeColors } from '@/app/lib/themeColors';
import { useThemeColors } from '@/app/lib/themeColors';
import React, { useMemo } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { SvgProps } from 'react-native-svg';

export interface ManageEventSheetProps {
  visible: boolean;
  event: ApiEvent | null;
  onClose: () => void;
  onViewEventPage: () => void;
  onEditDetails: () => void;
  onPostAnnouncement: () => void;
  onDeleteEvent: () => void;
}

function ActionRow({
  Icon,
  label,
  onPress,
  destructive,
  styles,
  colors,
}: {
  Icon: React.FC<SvgProps>;
  label: string;
  onPress: () => void;
  destructive?: boolean;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.actionRow, pressed && { opacity: 0.6 }]}
    >
      <Icon width={20} height={20} color={destructive ? colors.destructive : colors.ink} />
      <Text style={[styles.actionLabel, destructive && { color: colors.destructive }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function ManageEventSheet({
  visible,
  event,
  onClose,
  onViewEventPage,
  onEditDetails,
  onPostAnnouncement,
  onDeleteEvent,
}: ManageEventSheetProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // The sheet is driven by which card was tapped, so `event` is null between
  // dismissal and the next open. Rendering nothing is better than rendering a
  // sheet about no event for one frame.
  if (!event) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Tapping the dimmed area closes, which is what a bottom sheet trains
          people to expect. The sheet itself swallows the press so a stray tap
          inside it does not dismiss. */}
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.sheet}>
        <View style={styles.grabber} />

        <Text style={styles.heading}>Manage Event</Text>

        {/* Which event this is about. Not decoration: four of these cards look
            alike in a grid, and the sheet is where you confirm you tapped the
            right one before deleting it. */}
        <View style={styles.summary}>
          <View style={styles.thumb}>
            {event.image_url ? (
              <Image
                source={{ uri: event.image_url }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="cover"
              />
            ) : (
              <EventFlyerPlaceholder seed={event.id} />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.summaryTitle} numberOfLines={1}>
              {event.title}
            </Text>
            <Text style={styles.summaryMeta} numberOfLines={1}>
              {formatEventDate(event.start_datetime)}
              {event.location_short ? ` · ${event.location_short}` : ''}
            </Text>
          </View>
          {/* Echoes the pencil on the card you tapped to get here, so the sheet
              reads as "this is the one you picked". Decorative on purpose --
              Edit Event Details is the row below, and two controls doing the
              same thing a centimetre apart is how you get mis-taps. */}
          <PencilIcon width={16} height={16} color={colors.ink} />
        </View>

        <View style={styles.actions}>
          <ActionRow
            Icon={EyeIcon}
            label="View Event Page"
            onPress={onViewEventPage}
            styles={styles}
            colors={colors}
          />
          <ActionRow
            Icon={PencilIcon}
            label="Edit Event Details"
            onPress={onEditDetails}
            styles={styles}
            colors={colors}
          />
          <ActionRow
            Icon={MegaphoneIcon}
            label="Post Announcement"
            onPress={onPostAnnouncement}
            styles={styles}
            colors={colors}
          />
          <ActionRow
            Icon={TrashIcon}
            label="Delete Event"
            onPress={onDeleteEvent}
            destructive
            styles={styles}
            colors={colors}
          />
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.4)', // theme-exempt: scrim over both themes
    },
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: c.surface,
      borderTopLeftRadius: 14,
      borderTopRightRadius: 14,
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 34,
    },
    grabber: {
      alignSelf: 'center',
      width: 81,
      height: 5,
      borderRadius: 999,
      backgroundColor: c.ink,
      marginBottom: 13,
    },
    heading: {
      fontSize: 16,
      fontWeight: '600' as const,
      color: c.ink,
      marginBottom: 12,
    },
    summary: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
      padding: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surfaceMuted,
      marginBottom: 19,
    },
    thumb: {
      width: 41,
      height: 41,
      borderRadius: 20,
      overflow: 'hidden',
      backgroundColor: c.placeholder,
      flexShrink: 0,
    },
    summaryTitle: {
      fontSize: 14,
      fontWeight: '600' as const,
      color: c.ink,
    },
    summaryMeta: {
      fontSize: 12,
      fontWeight: '400' as const,
      color: c.inkSecondary,
      marginTop: 2,
    },
    actions: {
      gap: 16,
    },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
      // The row is the tap target, not the label. 44 clears the platform
      // minimum without the list looking airy.
      minHeight: 44,
    },
    actionLabel: {
      fontSize: 14,
      fontWeight: '500' as const,
      color: c.ink,
    },
  });
