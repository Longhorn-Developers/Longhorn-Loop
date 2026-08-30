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
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { SvgProps } from 'react-native-svg';

/**
 * The icon column, and the reason it exists.
 *
 * The Figma gives each row its own icon size and its own gap -- eye 24 at
 * gap 14, pencil 20 at 16, megaphone 19 at 16, trash 20 at 16. Laid out
 * literally that puts the four labels at x = 38, 36, 35 and 36: the design is
 * itself misaligned, by up to 3px, because the icons came from three different
 * icon sets and nobody normalised them.
 *
 * So the icons keep their Figma sizes -- they are drawn with different amounts
 * of internal padding and forcing them all to 20 would make the eye look
 * shrunken -- but they are centred in a fixed 24pt column. Centres line up,
 * every label starts at the same x, and the row no longer reads as ragged.
 */
const ICON_COLUMN = 24;
const ICON_GAP = 14;

/** Drag further than this and the sheet closes instead of springing back. */
const DISMISS_DISTANCE = 90;
/** Or flick faster than this, however far you actually got. */
const DISMISS_VELOCITY = 0.6;

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
  iconSize,
  label,
  onPress,
  destructive,
  styles,
  colors,
}: {
  Icon: React.FC<SvgProps>;
  iconSize: number;
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
      <View style={styles.iconColumn}>
        <Icon
          width={iconSize}
          height={iconSize}
          color={destructive ? colors.destructive : colors.ink}
        />
      </View>
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

  /**
   * Entrance, drag and exit all run through one value, which is why the Modal
   * is animationType="none". Letting the Modal do its own slide and layering a
   * drag transform on top means two animations fighting over the same pixels on
   * dismiss -- the sheet drops, then the Modal slides the already-gone sheet
   * down again.
   */
  const translateY = useRef(new Animated.Value(0)).current;
  // Height lives in both a ref and state on purpose: the interpolation below
  // needs a re-render to pick up a new value, while the PanResponder is built
  // once and would otherwise close over the first render's zero forever.
  const [sheetHeight, setSheetHeight] = useState(0);
  const sheetHeightRef = useRef(0);

  useEffect(() => {
    if (!visible) return;
    // Start below the fold and come up. Until the first layout lands we do not
    // know how far "below" is, so the sheet simply appears in place for that
    // one frame rather than flying in from an arbitrary distance.
    translateY.setValue(sheetHeightRef.current || 0);
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: true,
      damping: 26,
      stiffness: 260,
      mass: 0.9,
    }).start();
    // sheetHeight is deliberately not a dependency: re-running this on a
    // measurement change would replay the entrance mid-interaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Held in a ref so the PanResponder, which is built once, always calls the
  // current version rather than the one from mount.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const closeWithSlide = () => {
    Animated.timing(translateY, {
      toValue: sheetHeightRef.current || 400,
      duration: 180,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) closeRef.current();
    });
  };

  const closeRefSlide = useRef(closeWithSlide);
  closeRefSlide.current = closeWithSlide;

  /**
   * The grabber was decorative, which is the one thing a grabber must never be.
   * It is the universal "drag me" affordance, so a sheet that draws one and
   * then ignores the drag reads as broken rather than as fixed.
   *
   * PanResponder rather than react-native-gesture-handler: GH needs its own
   * root view inside a Modal to receive touches on Android, and this is a
   * single-axis drag that the core responder system handles fine.
   */
  const pan = useRef(
    PanResponder.create({
      // Claim the gesture only once it is clearly a downward drag. A lower
      // threshold steals taps meant for the rows underneath.
      onMoveShouldSetPanResponder: (_evt, g) => g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_evt, g) => {
        // Downward only. Dragging up would peel the sheet off the bottom edge
        // and show the backdrop underneath it.
        translateY.setValue(Math.max(0, g.dy));
      },
      onPanResponderRelease: (_evt, g) => {
        if (g.dy > DISMISS_DISTANCE || g.vy > DISMISS_VELOCITY) {
          closeRefSlide.current();
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            damping: 26,
            stiffness: 260,
          }).start();
        }
      },
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;

  // The scrim fades with the drag, so a half-dismissed sheet looks half
  // dismissed rather than fully modal right up until it vanishes.
  const backdropOpacity = translateY.interpolate({
    inputRange: [0, Math.max(sheetHeight, 1)],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  // The sheet is driven by which card was tapped, so `event` is null between
  // dismissal and the next open. Rendering nothing is better than rendering a
  // sheet about no event for one frame.
  if (!event) return null;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={closeWithSlide}>
      {/* Tapping the dimmed area closes, which is what a bottom sheet trains
          people to expect. The sheet itself swallows the press so a stray tap
          inside it does not dismiss. */}
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={closeWithSlide} accessibilityLabel="Close" />
      </Animated.View>

      <Animated.View
        style={[styles.sheet, { transform: [{ translateY }] }]}
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          sheetHeightRef.current = h;
          setSheetHeight(h);
        }}
      >
        {/* The drag handle is this whole band, not the 5pt pill. A 5pt-tall
            target is under half the platform minimum, so the affordance would
            be visible and still essentially unusable. */}
        <View {...pan.panHandlers} style={styles.grabberArea}>
          <View style={styles.grabber} />
        </View>

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
            iconSize={24}
            label="View Event Page"
            onPress={onViewEventPage}
            styles={styles}
            colors={colors}
          />
          <ActionRow
            Icon={PencilIcon}
            iconSize={20}
            label="Edit Event Details"
            onPress={onEditDetails}
            styles={styles}
            colors={colors}
          />
          <ActionRow
            Icon={MegaphoneIcon}
            iconSize={19}
            label="Post Announcement"
            onPress={onPostAnnouncement}
            styles={styles}
            colors={colors}
          />
          <ActionRow
            Icon={TrashIcon}
            iconSize={20}
            label="Delete Event"
            onPress={onDeleteEvent}
            destructive
            styles={styles}
            colors={colors}
          />
        </View>
      </Animated.View>
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
      paddingBottom: 34,
    },
    grabberArea: {
      // 12 above + 13 below reproduces the Figma's spacing around the pill
      // while giving the drag a 30pt band to start in.
      paddingTop: 12,
      paddingBottom: 13,
      alignItems: 'center',
    },
    grabber: {
      width: 81,
      height: 5,
      borderRadius: 999,
      backgroundColor: c.ink,
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
      // No gap. Each row is already a 44pt tap target, which sets an even
      // 44pt pitch on its own; adding the Figma's 16 on top of that spaced
      // them 60 apart and the list read as four separate things.
      gap: 0,
    },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: ICON_GAP,
      // The row is the tap target, not the label. 44 clears the platform
      // minimum without the list looking airy.
      minHeight: 44,
    },
    iconColumn: {
      width: ICON_COLUMN,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    actionLabel: {
      fontSize: 14,
      fontWeight: '500' as const,
      color: c.ink,
    },
  });
