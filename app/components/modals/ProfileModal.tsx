// Shared centered modal shell for the Profile surface (LOOP-182).
//
// Figma — "Modals" frame, reviewed 2026-06-08:
//   https://www.figma.com/design/XQZyJCvQxoyyzdQSlAVvpn/LOOP-Design?node-id=2723-5334
//
// The shell is identical across Open Link / Invite Editor / Leave Without
// Saving, so it lives here and each modal composes it:
//   - 50% #09090B scrim over the whole screen
//   - 266pt white card, 10pt radius, 20pt horizontal / 30pt vertical padding
//   - optional circular graphic above the title
//   - centered Roboto Flex title (20pt SemiBold; 24pt on Open Link)
//   - centered 12pt body
//   - actions in a single row
//
// NOTE: this is deliberately NOT components/rsvp/ConfirmModal. That one is the
// older RSVP dialog (stacked full-width buttons, burnt-orange primary) and is a
// separate component in Figma. Don't merge the two without a design decision.

import React from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

export type ModalActionVariant = 'outline' | 'ink' | 'brand' | 'destructive';

interface ModalActionProps {
  label: string;
  onPress: () => void;
  variant?: ModalActionVariant;
  disabled?: boolean;
  /** Fills the row instead of sharing it (e.g. the Invite Editor "Done"). */
  fullWidth?: boolean;
  /** "large" matches the 20pt bold Done button in the invite confirmation. */
  size?: 'default' | 'large';
}

// `destructive` is the "Yes, Delete" button (LOOP-131).
//
// Solid red with a white label, as Figma draws it, and matching the "Yes,
// cancel RSVP" button in rsvp/ConfirmModal — the two destructive confirms had
// drifted into different treatments.
//
// It fills with `destructive-fill`, NOT `destructive`. That distinction is the
// whole point of the extra token: `destructive` is tuned to be read as text and
// lightens to #FF6B63 in dark so it clears 4.5:1 on the page, at which point
// white sitting ON it is 2.79:1 — well under AA, on the one button in the app
// you least want misread. `destructive-fill` stays dark enough to carry white
// in both themes (7.15:1 light, 4.98:1 dark). test_theme_tokens pins it.
const CONTAINER_BY_VARIANT: Record<ModalActionVariant, string> = {
  outline: 'bg-lhlSurface border border-lhlMutedBorder',
  ink: 'bg-lhlInk border border-lhlInk',
  brand: 'bg-lhlBurntOrange border border-lhlBurntOrange',
  destructive: 'bg-lhlDestructiveFill border border-lhlDestructiveFill',
};

/**
 * The same pill while a finger is on it.
 *
 * These buttons had NO press feedback at all -- the only thing that happened
 * on a tap was whatever the tap did, which on a slow request meant a dialog
 * that appeared to have ignored you. The outline variant deepens to the muted
 * surface with a darker edge; the filled ones deepen their own colour rather
 * than fading, so a destructive button still reads as destructive at the
 * moment of commitment.
 */
const PRESSED_BY_VARIANT: Record<ModalActionVariant, string> = {
  outline: 'bg-lhlSurfaceGrey border border-lhlSecondaryTextGrey',
  ink: 'bg-lhlSecondaryTextGrey border border-lhlSecondaryTextGrey',
  brand: 'bg-lhlAccent border border-lhlAccent',
  destructive: 'bg-lhlDestructiveRed border border-lhlDestructiveRed',
};

const TEXT_BY_VARIANT: Record<ModalActionVariant, string> = {
  outline: 'text-lhlInk',
  ink: 'text-white',
  brand: 'text-white',
  destructive: 'text-white',
};

/** Pill button used inside ProfileModal. */
export function ModalAction({
  label,
  onPress,
  variant = 'outline',
  disabled = false,
  fullWidth = false,
  size = 'default',
}: ModalActionProps) {
  // Ordinary state, not a `({ pressed }) => ...` callback: NativeWind's jsx
  // runtime drops a function-valued style prop, silently.
  const [pressed, setPressed] = React.useState(false);

  // Figma draws these at 29–36pt tall. We settle on 36 so every action clears a
  // comfortable touch target without visibly departing from the design.
  const textClass = size === 'large' ? 'text-[20px] font-bold' : 'text-[13px] font-medium';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      className={[
        // px-[12px], not the 24 this started with. Width comes from `flex-1` /
        // `w-full`, so horizontal padding sets no minimum here — it only eats
        // into the label. At 24 the two buttons in a 266pt card got 110pt each
        // and left 62pt of text room, which truncated "Yes, Delete" to an
        // ellipsis while the shorter "Cancel" beside it looked fine.
        'h-[36px] items-center justify-center rounded-full px-[12px]',
        fullWidth ? 'w-full' : 'flex-1',
        pressed && !disabled ? PRESSED_BY_VARIANT[variant] : CONTAINER_BY_VARIANT[variant],
        disabled ? 'opacity-40' : '',
      ].join(' ')}
    >
      <Text
        numberOfLines={1}
        // The label must never wrap (the pill is a fixed 36pt tall) but it also
        // must never truncate — these buttons say what they will do. Shrinking
        // slightly is the better failure mode, and it keeps a long label
        // readable at the larger system font sizes too.
        adjustsFontSizeToFit
        minimumFontScale={0.85}
        className={`font-['Roboto-Flex'] text-center ${textClass} ${TEXT_BY_VARIANT[variant]}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export interface ProfileModalProps {
  visible: boolean;
  title: string;
  body?: string;
  /** Circular graphic above the title. Pass an <Image /> for a real avatar. */
  icon?: React.ReactNode;
  /** Renders the grey placeholder circle the design uses when no icon exists. */
  showIconPlaceholder?: boolean;
  /** Open Link is 24pt; every other modal in the frame is 20pt. */
  titleSize?: 20 | 24;
  /** Content between the body and the actions (e.g. the invite search field). */
  children?: React.ReactNode;
  /** One or more <ModalAction /> elements. */
  actions?: React.ReactNode;
  /** Android back button and scrim tap. Must behave like the safe action. */
  onDismiss: () => void;
  /**
   * Widens the card from 266 to 320.
   *
   * 266 is the Figma's width and right for a title, a sentence and two
   * buttons. It is not enough once a dialog carries an input: the delete
   * confirmation has to show a full @my.utexas.edu address inside a text field
   * and be typed into, and at 266 the field is narrower than the address it is
   * asking for.
   *
   * A prop rather than a new width for everyone, because four other modals
   * share this shell and none of them needs the room.
   */
  wide?: boolean;
  /** Set false for flows where an accidental tap shouldn't discard state. */
  dismissOnBackdropPress?: boolean;
}

export default function ProfileModal({
  visible,
  title,
  body,
  icon,
  showIconPlaceholder = false,
  titleSize = 20,
  children,
  actions,
  onDismiss,
  dismissOnBackdropPress = true,
  wide = false,
}: ProfileModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <Pressable
        // 50% #09090B scrim. Written as rgba because NativeWind can't apply an
        // opacity modifier to the hsla() token in tailwind.config.js.
        style={{ backgroundColor: 'rgba(9, 9, 11, 0.5)' }}
        className="flex-1 items-center justify-center px-6"
        onPress={dismissOnBackdropPress ? onDismiss : undefined}
      >
        {/* Absorbs taps so pressing the card itself never closes the modal. */}
        <Pressable
          onPress={() => {}}
          className={`${
            wide ? 'w-[320px] max-w-full' : 'w-[266px]'
          } items-center rounded-[10px] bg-lhlSurface px-[20px] py-[30px]`}
        >
          {icon || showIconPlaceholder ? (
            <View className="mb-[14px]">
              {icon ?? <View className="h-[60px] w-[60px] rounded-full bg-lhlPlaceholderGrey" />}
            </View>
          ) : null}

          <Text
            className={`font-['Roboto-Flex'] text-center font-semibold text-lhlInk ${
              titleSize === 24 ? 'text-[24px]' : 'text-[20px]'
            }`}
          >
            {title}
          </Text>

          {body ? (
            <Text className="font-['Roboto-Flex'] mt-[9px] text-center text-[12px] font-medium text-lhlInk">
              {body}
            </Text>
          ) : null}

          {children ? <View className="mt-[12px] w-full">{children}</View> : null}

          {actions ? (
            <View className="mt-[16px] w-full flex-row items-center justify-center gap-[6px]">
              {actions}
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
