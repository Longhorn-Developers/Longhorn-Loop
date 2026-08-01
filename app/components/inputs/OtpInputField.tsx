import { useThemeColors } from '@/app/lib/themeColors';
import React, { useState } from 'react';
import { NativeSyntheticEvent, TextInput, TextInputKeyPressEventData, View } from 'react-native';

interface OtpInputProps {
  code: string[];
  error: boolean;
  inputs: React.RefObject<(TextInput | null)[]>;
  handleChange: (text: string, index: number) => void;
  handleKeyPress: (e: NativeSyntheticEvent<TextInputKeyPressEventData>, index: number) => void;
}

const OtpInput: React.FC<OtpInputProps> = ({
  code,
  error,
  inputs,
  handleChange,
  handleKeyPress,
}) => {
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const colors = useThemeColors();

  return (
    <View className="w-full flex-row justify-between">
      {code.map((digit, index) => {
        const isFocused = focusedIndex === index;

        let borderColor = colors.ink;
        if (error) {
          borderColor = colors.destructive;
        } else if (isFocused || digit) {
          borderColor = colors.brand;
        }

        const borderWidth = isFocused ? 2 : 1;

        return (
          <TextInput
            key={index}
            ref={(ref) => {
              if (inputs.current) {
                inputs.current[index] = ref;
              }
            }}
            className="h-14 w-12 rounded-lg font-['Roboto-Flex'] text-center text-xl font-semibold text-lhlInk"
            style={{
              borderColor,
              borderWidth,
              // Cast as any to bypass React Native's strict non-web layout types
              ...({
                outlineStyle: 'none',
                outlineColor: 'transparent',
              } as any),
            }}
            value={digit}
            onChangeText={(text) => {
              handleChange(text, index);
            }}
            onKeyPress={(e) => {
              handleKeyPress(e, index);
            }}
            onFocus={() => setFocusedIndex(index)}
            onBlur={() => setFocusedIndex(-1)}
            underlineColorAndroid="transparent"
            keyboardType="number-pad"
            maxLength={1}
            placeholder="-"
            selectTextOnFocus
            caretHidden={true}
          />
        );
      })}
    </View>
  );
};

export default OtpInput;
