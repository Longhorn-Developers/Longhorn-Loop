import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TextInputProps,
  Pressable,
} from 'react-native';
import { XCircleIcon } from 'phosphor-react-native';

interface TextInputFieldProps extends TextInputProps {
  label?: string;
  leftIcon?: React.ReactNode;
  clearable?: boolean;
}

const CLEARABLE_ICON_COLORS = {
  border: 'hsla(0,0%,78%,1)',
  active: 'hsla(27, 93%, 32%, 1)',
};

export default function TextInputField({
  label,
  leftIcon,
  clearable,
  ...props
}: TextInputFieldProps) {
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const blurTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // --- HANDLERS ---
  const handleFocus = (e: any) => {
    // Prevents timedout blur operation if focus is called
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    
    setIsFocused(true);
    props.onFocus?.(e);
  };

  const handleBlur = (e: any) => {
    // Timeout to allow handleClear() call
    blurTimeoutRef.current = setTimeout(() => {
      setIsFocused(false);
      blurTimeoutRef.current = null;
    }, 100);
    
    props.onBlur?.(e);
  };

  const focusInput = () => {
    inputRef.current?.focus();
  }

  const handleClear = () => {
    // Clears text and refocuses text input
    props.onChangeText?.('');
    focusInput();
  };

  // --- DERIVED VALUES ---
  const borderColorClass = isFocused
    ? 'border-lhlBurntOrange'
    : 'border-lhlBorderColor';

  const clearIconColor =
    isFocused && props.value
      ? CLEARABLE_ICON_COLORS.active
      : CLEARABLE_ICON_COLORS.border;

  // --- RENDER: TEXT INPUT FIELD ---
  return (
    <View className="mb-4">
      {/* LABEL */}
      {label && (
        <Pressable onPress={focusInput}>
          <Text className="font-semibold text-base mb-1">{label}</Text>
        </Pressable>
      )}

      {/* INPUT CONTAINER */}
      <View
        className={`
          flex-row items-center
          border rounded-lg
          px-3
          ${borderColorClass}
        `}
      >
        {/* Left Icon */}
        {leftIcon && <View>{leftIcon}</View>}

        {/* Text Input */}
        <TextInput
          ref={inputRef}
          accessibilityLabel={label}
          accessibilityRole="text"
          className={`
            flex-1 mx-2
            text-sm border-none
            focus:ring-0 focus:outline-none
            placeholder:text-lhlSecondaryTextGrey
          `}
          style={{ marginVertical: 6 }}
          underlineColorAndroid="transparent"
          onFocus={handleFocus}
          onBlur={handleBlur}
          {...props}
        />

        {/* Clear Button */}
        {clearable && isFocused && (
          <Pressable
            onPressIn={(e) => e.preventDefault?.()}
            onPress={handleClear}
          >
            <XCircleIcon
              size={22}
              weight="light"
              color={clearIconColor}
            />
          </Pressable>
        )}
      </View>
    </View>
  );
}