// The two small pieces that make "required" visible in the create wizard.
//
// THE PROBLEM THEY REPLACE. Every step gated Continue behind a `canContinue`
// boolean and disabled the button when it was false. That is silent in the
// worst way: the button greys out, the user presses it, nothing happens, and
// nothing on screen says which field is missing. On the Event Details step
// there are three required fields and a disabled button tells you about none
// of them.
//
// So required fields are marked BEFORE you fill them in -- the asterisk -- and
// named AFTER you try to continue without one -- the message. The button stays
// pressable throughout, because a press is how someone asks "what's left?" and
// a disabled button refuses to answer.

import { useThemeColors } from '@/app/lib/themeColors';
import React from 'react';
import { Text, View } from 'react-native';

/**
 * The asterisk beside a required field's label.
 *
 * Carries its own accessibility label rather than leaning on the glyph: a
 * screen reader announces "*" as "star" or skips it entirely, neither of which
 * tells anyone the field is required.
 */
export function RequiredMark() {
  const colors = useThemeColors();
  return (
    <Text
      accessibilityLabel="required"
      style={{ color: colors.destructive, fontSize: 13, lineHeight: 16 }}
    >
      {' *'}
    </Text>
  );
}

/**
 * The message under a field the user skipped.
 *
 * Renders nothing until `show` is true, and `show` is only ever set by a
 * Continue press -- a form that turns red while you are still typing in the
 * first box is telling you off for not having finished yet.
 */
export function FieldError({ show, message }: { show: boolean; message: string }) {
  const colors = useThemeColors();
  if (!show) return null;
  return (
    <View
      accessibilityRole="alert"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 }}
    >
      <Text style={{ color: colors.destructive, fontSize: 11, lineHeight: 14 }}>!</Text>
      <Text
        style={{ color: colors.destructive, fontSize: 11, lineHeight: 14, flexShrink: 1 }}
      >
        {message}
      </Text>
    </View>
  );
}

/** Border colour for an input that is missing and has been asked for. */
export function useInvalidBorder(invalid: boolean): string | undefined {
  const colors = useThemeColors();
  return invalid ? colors.destructive : undefined;
}
