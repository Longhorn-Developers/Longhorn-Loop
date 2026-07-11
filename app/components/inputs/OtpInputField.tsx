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

  return (
    <View className="w-full flex-row justify-between">
      {code.map((digit, index) => {
        const isFocused = focusedIndex === index;

        let borderColor = 'black';
        if (error) {
          borderColor = '#EF4444'; // red-500
        } else if (isFocused || digit) {
          borderColor = 'hsla(27, 93%, 32%, 1)'; // lhlBurntOrange
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
            className="w-12 h-14 rounded-lg font-['Roboto-Flex'] text-center text-xl font-semibold"
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
