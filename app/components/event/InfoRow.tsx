// One row layout for the event detail screen's header block: a leading glyph or
// avatar, one or two lines of text, and an optional action on the right.
//
// The redesign repeats this pattern three times — the host (avatar / name +
// verified check / Follow), the date (calendar badge / weekday + time range /
// Add to GCal) and the location (map badge / address + city, walk time /
// chevron) — and they had been written out as three near-identical layouts.
// They share this, so spacing and type stay in step.
//
// TWO KINDS OF RIGHT-HAND SIDE, ON PURPOSE
//   `chevron`  is part of the row's own tap target: the whole row is one button
//              and the arrow just says so.
//   `trailing` is a separate control (Follow, Add to GCal) and sits OUTSIDE the
//              pressable. Nesting a button inside a button makes iOS VoiceOver
//              treat the pair as one element and the inner button unreachable.

import ChevronIcon from '@/assets/images/dropdown-arrow.svg';
import { useThemeColors, type ThemeColors } from '@/app/lib/themeColors';
import React, { useMemo, type ReactNode } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

interface InfoRowProps {
  /** A `RowBadge` or `RowAvatar`. */
  leading: ReactNode;
  title: string;
  titleLines?: number;
  /** Rendered inline after the title, e.g. the verified check. */
  titleAccessory?: ReactNode;
  subtitle?: string;
  /** Makes the leading + text (+ chevron) one button. Omit for a plain row. */
  onPress?: () => void;
  /** Only used with `onPress`. Without it the screen reader reads the text. */
  accessibilityLabel?: string;
  chevron?: boolean;
  /** An independent action on the right — see the header. */
  trailing?: ReactNode;
  /**
   * Padding for a row that lives inside a card. The padding is on the pressable
   * itself rather than around it, so the dead space at the row's edges still
   * counts as a tap.
   */
  inset?: boolean;
  style?: StyleProp<ViewStyle>;
}

export default function InfoRow({
  leading,
  title,
  titleLines = 1,
  titleAccessory,
  subtitle,
  onPress,
  accessibilityLabel,
  chevron = false,
  trailing,
  inset = false,
  style,
}: InfoRowProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const mainStyle = [
    styles.main,
    inset ? styles.mainInset : null,
    // With a trailing control the right padding belongs to that control's
    // wrapper; without one it belongs here, so the chevron isn't flush.
    inset && !trailing ? styles.mainInsetRight : null,
  ];

  const content = (
    <>
      {leading}
      <View style={{ flex: 1 }}>
        <View style={styles.titleLine}>
          <Text style={styles.title} numberOfLines={titleLines}>
            {title}
          </Text>
          {titleAccessory}
        </View>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {chevron ? (
        // No dedicated right-chevron asset; the dropdown arrow turned a quarter
        // turn, the same one-asset-flipped approach ExpandableText takes.
        <ChevronIcon
          width={16}
          height={16}
          color={colors.ink}
          style={{ transform: [{ rotate: '-90deg' }] }}
        />
      ) : null}
    </>
  );

  return (
    <View style={[styles.row, style]}>
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          onPress={onPress}
          style={mainStyle}
        >
          {content}
        </Pressable>
      ) : (
        <View style={mainStyle}>{content}</View>
      )}
      {trailing ? <View style={inset ? styles.trailingInset : null}>{trailing}</View> : null}
    </View>
  );
}

/** The beige square behind a glyph. Pass the icon as a child, coloured `ink`. */
export function RowBadge({ children }: { children: ReactNode }) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <View style={styles.badge}>{children}</View>;
}

/** A round picture, or the first initial on the brand colour when there is none. */
export function RowAvatar({ uri, name }: { uri?: string | null; name: string }) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (uri) return <Image source={{ uri }} style={styles.avatar} />;
  return (
    <View style={[styles.avatar, styles.avatarFallback]}>
      {/* theme-exempt: initial sits on the brand-coloured fill */}
      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
        {name[0]?.toUpperCase() ?? '?'}
      </Text>
    </View>
  );
}

interface RowButtonProps {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  /** A completed toggle (Following): outline instead of the soft fill. */
  active?: boolean;
  /** A write is in flight: dimmed and not tappable. */
  pending?: boolean;
  /** 'pill' is fully round (Follow); the default is the squarer action button. */
  shape?: 'rounded' | 'pill';
  /** A glyph before the label, e.g. the route card's Directions arrow. */
  icon?: ReactNode;
  /** Which side of the label the icon sits on. Add to GCal puts it after. */
  iconPosition?: 'start' | 'end';
  /** Unavailable rather than busy: not tappable, dimmed harder than `pending`. */
  disabled?: boolean;
}

/** The soft-brand action on the right of a row. */
export function RowButton({
  label,
  onPress,
  accessibilityLabel,
  active = false,
  pending = false,
  shape = 'rounded',
  icon,
  iconPosition = 'start',
  disabled = false,
}: RowButtonProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: active, disabled: pending || disabled }}
      disabled={pending || disabled}
      onPress={onPress}
      style={[
        styles.button,
        shape === 'pill' ? styles.buttonPill : null,
        // Soft brand fill while unset, outline once done: the same inversion
        // FollowControl uses for a completed toggle.
        active ? styles.buttonActive : null,
        pending ? { opacity: 0.6 } : null,
        disabled ? { opacity: 0.5 } : null,
      ]}
    >
      {iconPosition === 'start' ? icon : null}
      <Text style={[styles.buttonText, active ? { color: colors.ink } : null]}>{label}</Text>
      {iconPosition === 'end' ? icon : null}
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    main: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    mainInset: {
      paddingVertical: 10,
      paddingLeft: 12,
    },
    mainInsetRight: {
      paddingRight: 12,
    },
    trailingInset: {
      paddingVertical: 10,
      paddingRight: 12,
    },
    titleLine: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    title: {
      fontFamily: 'RobotoFlex_600SemiBold',
      fontSize: 14,
      fontWeight: '600',
      color: c.ink,
      flexShrink: 1,
    },
    subtitle: {
      fontFamily: 'RobotoFlex_400Regular',
      fontSize: 14,
      fontWeight: '400',
      color: c.ink,
      marginTop: 2,
    },
    badge: {
      width: 34,
      height: 34,
      borderRadius: 8,
      backgroundColor: c.segmentTrack,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
    },
    avatarFallback: {
      backgroundColor: c.brand,
      alignItems: 'center',
      justifyContent: 'center',
    },
    button: {
      minWidth: 84,
      flexDirection: 'row',
      gap: 6,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.brandSoft,
      backgroundColor: c.brandSoft,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    buttonPill: {
      borderRadius: 999,
      paddingHorizontal: 16,
      paddingVertical: 7,
    },
    buttonActive: {
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    buttonText: {
      fontFamily: 'RobotoFlex_600SemiBold',
      fontSize: 13,
      fontWeight: '600',
      color: c.brand,
    },
  });
