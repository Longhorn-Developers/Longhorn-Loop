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

/**
 * Dismissal is decided on where the drag was GOING, not where it stopped.
 *
 * Distance and velocity as two separate tests is the naive version and it
 * feels wrong at both ends: a slow, deliberate 40% drag springs back, and a
 * fast flick that only travelled 20pt does nothing. Projecting the throw the
 * way a scroll view does -- current offset plus velocity times a time
 * constant -- gives one number that both gestures agree on.
 */
const VELOCITY_PROJECTION_MS = 140;
/** Projected past this fraction of the sheet's own height and it closes. */
const DISMISS_FRACTION = 0.32;
/** Below this the gesture is a tap, not a drag, and the row underneath keeps it. */
const DRAG_SLOP = 5;
/**
 * iOS's rubber band. Pulling UP past the top does not translate 1:1 -- it
 * yields less and less, asymptotically, so the sheet feels attached rather
 * than either rigid (nothing happens, feels broken) or loose (it slides up and
 * exposes the backdrop under it).
 */
const RUBBER_BAND = 0.55;
function resist(overshoot: number, dimension: number): number {
  return (1 - 1 / ((overshoot * RUBBER_BAND) / dimension + 1)) * dimension;
}

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

  /**
   * EVERY ANIMATION HERE IS JS-DRIVEN, and that is not an oversight.
   *
   * The obvious setup -- useNativeDriver: true for the springs, setValue() for
   * the drag -- is the thing that made the first two attempts at this feel
   * dead. app.json runs newArchEnabled, so once a native animated node has
   * taken ownership of a view's transform, a setValue() from JS is not
   * reliably delivered to that view under Fabric. The entrance spring played
   * (native), and then every frame of the drag wrote a value nothing read.
   *
   * A single translateY on one small view is nowhere near the budget where the
   * native driver earns its keep, so the fix is to stop mixing the two: the JS
   * driver reads and writes the same value the drag does, every time.
   */
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
    offsetY.current = sheetHeightRef.current || 0;
    dragStart.current = 0;
    translateY.setValue(sheetHeightRef.current || 0);
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: false,
      damping: 26,
      stiffness: 260,
      mass: 0.9,
    }).start(({ finished }) => {
      if (finished) offsetY.current = 0;
    });
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
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) {
        offsetY.current = 0;
        closeRef.current();
      }
    });
  };

  const closeRefSlide = useRef(closeWithSlide);
  closeRefSlide.current = closeWithSlide;

  // Where the sheet actually is, updated as the drag runs. `translateY` cannot
  // be read synchronously once the native driver owns it, and release needs the
  // current offset to project the throw.
  const offsetY = useRef(0);
  const dragStart = useRef(0);

  // Mirrors the animated value into a plain ref. Reading an Animated.Value
  // synchronously otherwise means __getValue(), which is private.
  useEffect(() => {
    const id = translateY.addListener(({ value }) => {
      offsetY.current = value;
    });
    return () => translateY.removeListener(id);
  }, [translateY]);

  const springHome = () => {
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: false,
      damping: 26,
      stiffness: 260,
      mass: 0.9,
    }).start(({ finished }) => {
      if (finished) offsetY.current = 0;
    });
  };

  /**
   * The drag, and why it is on the whole sheet rather than the grabber.
   *
   * A grabber that alone responds to dragging is a smaller version of the same
   * bug as a grabber that does nothing: it looks draggable everywhere and is
   * draggable in one 30pt band. Every system sheet -- iOS, Maps, the share
   * sheet -- lets you push down from anywhere on a sheet whose content does not
   * itself scroll. This one does not scroll, so the whole thing takes the
   * gesture.
   *
   * That means stealing the touch back from the action rows, which are
   * Pressables and claim the responder the moment a finger lands. The CAPTURE
   * variant is the only phase that can take over from a child that already
   * holds it -- the non-capture `onMoveShouldSetPanResponder` is never
   * consulted once the row has claimed the touch, which is why the previous
   * version had to live on a band with nothing pressable in it. The slop
   * threshold is what keeps taps working: no movement, no capture, the row
   * keeps its press.
   *
   * PanResponder rather than react-native-gesture-handler: GH needs its own
   * root view inside a Modal to receive touches on Android, and this is a
   * single-axis drag the core responder system handles fine.
   */
  const pan = useRef(
    PanResponder.create({
      // Never claim on touch-down -- that would swallow every tap on a row.
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,

      // Two paths, deliberately. CAPTURE is the only phase that can take the
      // touch back from an action row, which is a Pressable and claims the
      // responder the instant a finger lands. The plain handler covers the
      // parts of the sheet with no pressable child -- the heading, the summary
      // card, the grabber -- where nothing has claimed anything and the
      // bubbling phase is what gets consulted.
      onMoveShouldSetPanResponderCapture: (_evt, g) =>
        Math.abs(g.dy) > DRAG_SLOP && Math.abs(g.dy) > Math.abs(g.dx),
      onMoveShouldSetPanResponder: (_evt, g) =>
        Math.abs(g.dy) > DRAG_SLOP && Math.abs(g.dy) > Math.abs(g.dx),

      onPanResponderGrant: () => {
        // Grabbing a sheet mid-flight should catch it where it is, not snap it
        // somewhere. The listener below keeps offsetY in step with the running
        // animation, so this is exact without waiting on stopAnimation's
        // asynchronous callback -- which lands a frame or two late, and by then
        // the first move has already been handled from a stale origin.
        translateY.stopAnimation();
        dragStart.current = offsetY.current;
      },

      onPanResponderMove: (_evt, g) => {
        const raw = dragStart.current + g.dy;
        const height = sheetHeightRef.current || 400;
        // Down tracks the finger exactly. Up resists, so the sheet gives a
        // little and then stops -- "attached", not "stuck" and not "loose".
        const next = raw >= 0 ? raw : -resist(-raw, height);
        offsetY.current = next;
        translateY.setValue(next);
      },

      onPanResponderRelease: (_evt, g) => {
        const height = sheetHeightRef.current || 400;
        const projected = offsetY.current + g.vy * VELOCITY_PROJECTION_MS;
        if (projected > height * DISMISS_FRACTION) {
          closeRefSlide.current();
        } else {
          springHome();
        }
      },

      // A system interruption (a call, the app backgrounding) should leave the
      // sheet where it belongs rather than wherever the finger abandoned it.
      onPanResponderTerminate: () => springHome(),
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
        {...pan.panHandlers}
        style={[styles.sheet, { transform: [{ translateY }] }]}
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          sheetHeightRef.current = h;
          setSheetHeight(h);
        }}
      >
        {/* The pill is now purely the affordance -- the drag lives on the
            sheet. It still gets its own padded band so it reads as a handle and
            not as a stray rule. */}
        <View style={styles.grabberArea}>
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
      // 12 above + 13 below is the Figma's spacing around the pill.
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
