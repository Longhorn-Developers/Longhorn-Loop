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
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type { SvgProps } from 'react-native-svg';

/**
 * THE ICON COLUMN, and why it is not just "centre them all".
 *
 * The Figma gives each row its own icon size and its own gap -- eye 24 at gap
 * 14, pencil 20 at 16, megaphone 19 at 16, trash 20 at 16 -- which puts the
 * four labels at x = 38, 36, 35 and 36. The design is itself misaligned,
 * because the icons came from three different sets and nobody normalised them.
 *
 * A fixed column fixes the LABELS. It does not fix the icons, and that was the
 * remaining visible problem: centring a 24pt eye and a 19pt megaphone in the
 * same column aligns their bounding boxes, and their bounding boxes are not
 * what you see. Each glyph is drawn with a different amount of empty space
 * inside its own box -- the Figma spells this out, eye ink starts at 9.94% of
 * its width, trash at 16.67% -- so centred boxes put the visible ink at four
 * different x positions, about 3pt apart. Which is exactly what "not lined up
 * properly" looks like.
 *
 * So the boxes are LEFT-aligned in the column, and each icon is nudged by the
 * difference between its own ink inset and a common one. The four glyphs then
 * start at the same x, which is the thing the eye is actually measuring.
 */
const ICON_COLUMN = 24;
const ICON_GAP = 16;
/** Where every glyph's ink should begin, measured from the column's left edge. */
const BASE_INK_LEFT = 2.5;

/** Fraction of its own box each glyph leaves empty on the left, from the Figma. */
function inkNudge(size: number, inkLeftRatio: number): number {
  return BASE_INK_LEFT - size * inkLeftRatio;
}

/** Projected past this fraction of the sheet's own height and it closes. */
const DISMISS_FRACTION = 0.32;
/**
 * Dismissal is decided on where the drag was GOING, not where it stopped.
 * Distance and velocity as two separate tests feels wrong at both ends: a slow
 * deliberate 40% drag springs back, and a fast flick that only travelled 20pt
 * does nothing. Projecting the throw the way a scroll view does gives one
 * number both gestures agree on. Seconds, because gesture-handler reports
 * velocity in points per second.
 */
const VELOCITY_PROJECTION_S = 0.14;
/** Vertical travel before the drag takes over from a row's tap. */
const DRAG_SLOP = 8;

const SPRING = { damping: 26, stiffness: 260, mass: 0.9 };

/**
 * iOS's rubber band. Pulling UP past the top yields less and less,
 * asymptotically, so the sheet feels attached to the bottom edge rather than
 * rigid (reads as broken) or loose (peels off and shows the backdrop under it).
 */
function resist(overshoot: number, dimension: number): number {
  'worklet';
  return (1 - 1 / ((overshoot * 0.55) / dimension + 1)) * dimension;
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
  inkLeftRatio,
  label,
  onPress,
  destructive,
  styles,
  colors,
}: {
  Icon: React.FC<SvgProps>;
  iconSize: number;
  inkLeftRatio: number;
  label: string;
  onPress: () => void;
  destructive?: boolean;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}) {
  const [pressed, setPressed] = useState(false);

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
      /*
        NO `style={({ pressed }) => ...}` CALLBACK, and this is the third place
        in this feature that has had to learn it.

        babel.config runs babel-preset-expo with jsxImportSource: 'nativewind',
        so every JSX element in the app goes through NativeWind's jsx runtime --
        className or not. A `style` prop given as a FUNCTION does not survive
        that: whatever the callback returns is dropped, silently.

        Here that took the whole row style with it, not just the pressed colour,
        because the callback was returning [styles.actionRow, ...]. Losing
        actionRow means losing flexDirection: 'row', so the label rendered
        UNDERNEATH the icon instead of beside it, and the pressed highlight
        never appeared either. One dropped prop, two symptoms, and neither of
        them looks like "your style prop was ignored".

        Pressed is ordinary state and the style is a plain object.
      */
      style={{
        ...styles.actionRow,
        ...(pressed ? { backgroundColor: colors.surfaceMuted } : null),
      }}
    >
      <View style={styles.iconColumn}>
        <Icon
          width={iconSize}
          height={iconSize}
          color={destructive ? colors.destructive : colors.ink}
          style={{ marginLeft: inkNudge(iconSize, inkLeftRatio) }}
        />
      </View>
      <Text style={destructive ? { ...styles.actionLabel, color: colors.destructive } : styles.actionLabel}>
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
   * GESTURE-HANDLER AND REANIMATED, after two failed attempts with
   * PanResponder + Animated.
   *
   * app.json runs newArchEnabled. Under Fabric, once a native animated node
   * owns a view's transform, a setValue() from JS is not reliably delivered to
   * that view -- so the entrance spring played, and then every frame of the
   * drag wrote a value nothing read. The gesture was firing the whole time and
   * moving nothing, which is why the second attempt felt identical to the
   * first.
   *
   * Shared values do not have that failure mode: the drag and the springs are
   * the same value on the same (UI) thread. This mirrors the swipe in
   * app/notifications.tsx, which is the one gesture in this codebase already
   * proven to work on device.
   *
   * GestureHandlerRootView is REQUIRED here and is the usual reason a gesture
   * silently does nothing inside a Modal: a Modal is its own native view
   * hierarchy, so the root view at the top of the app does not cover it.
   */
  const translateY = useSharedValue(0);
  const startY = useSharedValue(0);
  const sheetH = useSharedValue(0);

  const finishClose = useCallback(() => {
    translateY.value = 0;
    onClose();
  }, [onClose, translateY]);

  useEffect(() => {
    if (!visible) return;
    // Start below the fold and come up. Until the first layout lands we do not
    // know how far "below" is, so the sheet appears in place for that one frame
    // rather than flying in from an arbitrary distance.
    translateY.value = sheetH.value;
    translateY.value = withSpring(0, SPRING);
  }, [visible, translateY, sheetH]);

  const closeWithSlide = useCallback(() => {
    translateY.value = withTiming(sheetH.value || 400, { duration: 180 }, (finished) => {
      if (finished) runOnJS(finishClose)();
    });
  }, [translateY, sheetH, finishClose]);

  /**
   * activeOffsetY is what lets the action rows keep their taps: the pan does
   * not activate until the finger has travelled 8pt vertically, so a press
   * never becomes a drag. failOffsetX gives up entirely on a clearly sideways
   * movement. This is the part PanResponder made hard and gesture-handler
   * makes declarative.
   */
  const pan = Gesture.Pan()
    .activeOffsetY([-DRAG_SLOP, DRAG_SLOP])
    .failOffsetX([-24, 24])
    .onStart(() => {
      // Catch a sheet mid-flight where it actually is, rather than snapping.
      startY.value = translateY.value;
    })
    .onUpdate((e) => {
      const raw = startY.value + e.translationY;
      // Down tracks the finger exactly; up resists.
      translateY.value = raw >= 0 ? raw : -resist(-raw, sheetH.value || 400);
    })
    .onEnd((e) => {
      const height = sheetH.value || 400;
      const projected = translateY.value + e.velocityY * VELOCITY_PROJECTION_S;
      if (projected > height * DISMISS_FRACTION) {
        translateY.value = withTiming(height, { duration: 180 }, (finished) => {
          if (finished) runOnJS(finishClose)();
        });
      } else {
        translateY.value = withSpring(0, SPRING);
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  // The scrim fades with the drag, so a half-dismissed sheet looks half
  // dismissed rather than fully modal right up until it vanishes.
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: sheetH.value > 0 ? Math.max(0, 1 - translateY.value / sheetH.value) : 1,
  }));

  // The sheet is driven by which card was tapped, so `event` is null between
  // dismissal and the next open. Rendering nothing is better than rendering a
  // sheet about no event for one frame.
  if (!event) return null;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={closeWithSlide}>
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        {/* Tapping the dimmed area closes, which is what a bottom sheet trains
            people to expect. */}
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={closeWithSlide}
            accessibilityLabel="Close"
          />
        </Animated.View>

        <GestureDetector gesture={pan}>
          <Animated.View
            style={[styles.sheet, sheetStyle]}
            onLayout={(e) => {
              sheetH.value = e.nativeEvent.layout.height;
            }}
          >
            {/* The pill is the affordance; the drag lives on the whole sheet,
                the way it does on a system sheet whose content does not
                scroll. */}
            <View style={styles.grabberArea}>
              <View style={styles.grabber} />
            </View>

            <Text style={styles.heading}>Manage Event</Text>

            {/* Which event this is about. Not decoration: four of these cards
                look alike in a grid, and the sheet is where you confirm you
                tapped the right one before deleting it. */}
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
              {/* Echoes the pencil on the card you tapped to get here, so the
                  sheet reads as "this is the one you picked". Decorative on
                  purpose -- Edit Event Details is the row below, and two
                  controls doing the same thing a centimetre apart is how you
                  get mis-taps. */}
              <PencilIcon width={16} height={16} color={colors.ink} />
            </View>

            <View style={styles.actions}>
              <ActionRow
                Icon={EyeIcon}
                iconSize={24}
                inkLeftRatio={0.0994}
                label="View Event Page"
                onPress={onViewEventPage}
                styles={styles}
                colors={colors}
              />
              <ActionRow
                Icon={PencilIcon}
                iconSize={20}
                inkLeftRatio={0.125}
                label="Edit Event Details"
                onPress={onEditDetails}
                styles={styles}
                colors={colors}
              />
              <ActionRow
                Icon={MegaphoneIcon}
                iconSize={19}
                inkLeftRatio={0.125}
                label="Post Announcement"
                onPress={onPostAnnouncement}
                styles={styles}
                colors={colors}
              />
              <ActionRow
                Icon={TrashIcon}
                iconSize={20}
                inkLeftRatio={0.1667}
                label="Delete Event"
                onPress={onDeleteEvent}
                destructive
                styles={styles}
                colors={colors}
              />
            </View>
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
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
      // No gap. Each row is already a 44pt tap target, which sets an even 44pt
      // pitch on its own; the Figma's 16 on top of that spaced them 60 apart
      // and the list read as four unrelated things.
      gap: 0,
    },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: ICON_GAP,
      // The row is the tap target, not the label. 44 clears the platform
      // minimum without the list looking airy.
      minHeight: 44,
      // Bleeds the pressed highlight out to the sheet's edges, the way a list
      // row highlights edge to edge rather than in a floating rectangle.
      marginHorizontal: -20,
      paddingHorizontal: 20,
    },
    iconColumn: {
      width: ICON_COLUMN,
      // LEFT, not centre. Centring aligns bounding boxes, and the boxes are
      // not what you see -- each glyph sits at a different inset inside its
      // own box, so centred boxes put the visible ink 3pt apart.
      alignItems: 'flex-start',
      justifyContent: 'center',
      flexShrink: 0,
    },
    actionLabel: {
      fontSize: 14,
      fontWeight: '500' as const,
      color: c.ink,
    },
  });
