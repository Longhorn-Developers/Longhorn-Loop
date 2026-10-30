import { useThemeColors } from '@/app/lib/themeColors';
import React, { useState } from 'react';
import { Platform, Text, TextInput, View } from 'react-native';

interface OtpInputProps {
  /** One entry per box; its length is the code length. */
  code: string[];
  error: boolean;
  /** The single real input — focus it to put the keypad up. */
  inputRef: React.RefObject<TextInput | null>;
  onChangeCode: (code: string[]) => void;
}

/**
 * Six (or four) boxes drawn over ONE invisible TextInput (LOOP-280).
 *
 * It used to be one TextInput per box with maxLength={1}, which broke three
 * ways on iOS, all reported from TestFlight:
 *
 *   - Autofill from Mail / Messages filled only the first box. iOS delivers
 *     the whole code to the focused field in one onChangeText; maxLength={1}
 *     truncated it to its first digit before any splitting code could see it.
 *   - The keypad dropped and came back between digits. Every digit moved
 *     focus to a different TextInput, i.e. a new keyboard session.
 *   - Landing on a box sometimes needed a second tap to get the keypad.
 *
 * With one input there is one keyboard session for the whole code, autofill
 * and paste arrive as a single string that is split across the boxes here,
 * and backspace is the platform's own deletion — no per-box onKeyPress
 * bookkeeping, which every screen using this had copied.
 *
 * The input is laid over the whole row (not off-screen) so a tap anywhere on
 * the boxes lands on it natively: that is what makes the keypad appear on the
 * first tap, and long-press still offers Paste.
 */
const OtpInput: React.FC<OtpInputProps> = ({ code, error, inputRef, onChangeCode }) => {
  const [focused, setFocused] = useState(false);
  const colors = useThemeColors();
  const length = code.length;
  const value = code.join('');
  // The box the next digit goes into; the last box once the code is full.
  const activeIndex = Math.min(value.length, length - 1);

  const handleChangeText = (text: string) => {
    // slice(0, length) also absorbs the iOS quirk of delivering a one-time
    // code twice ("123456123456") on some autofill paths.
    const digits = text.replace(/[^0-9]/g, '').slice(0, length);
    onChangeCode(Array.from({ length }, (_, i) => digits[i] ?? ''));
  };

  return (
    <View className="w-full flex-row justify-between">
      {code.map((digit, index) => {
        const isActive = focused && index === activeIndex;

        // Near-black at rest — heavier than the usual control border, since an
        // empty code box is the thing to aim at. ink, not '#000', so it inverts
        // in dark mode.
        let borderColor = colors.ink;
        if (error) {
          borderColor = colors.destructive;
        } else if (isActive || digit) {
          borderColor = colors.brand;
        }

        return (
          <View
            key={index}
            // bg-lhlSurface, not bg-white: these had no fill and showed the
            // page through, so they never sat on the same surface as the app's
            // other inputs.
            className="h-14 w-12 items-center justify-center rounded-lg bg-lhlSurface"
            style={{ borderColor, borderWidth: isActive ? 2 : 1 }}
          >
            {digit ? (
              <Text className="font-roboto-semibold text-xl text-lhlInk">{digit}</Text>
            ) : (
              <Text className="font-roboto-semibold text-xl text-lhlSecondaryTextGrey">-</Text>
            )}
          </View>
        );
      })}

      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={handleChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        // iOS reads textContentType for the "From Mail/Messages" suggestion;
        // Android and web read autoComplete, under different names.
        textContentType="oneTimeCode"
        autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
        maxLength={length}
        caretHidden
        accessibilityLabel={`${length}-digit verification code`}
        underlineColorAndroid="transparent"
        // Near-zero, not 0: UIKit's hit-testing ignores views with alpha
        // below 0.01, so a fully transparent input would never take the tap.
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          opacity: 0.011,
          color: 'transparent',
          // Cast as any to bypass React Native's strict non-web layout types
          ...({ outlineStyle: 'none' } as any),
        }}
      />
    </View>
  );
};

export default OtpInput;
