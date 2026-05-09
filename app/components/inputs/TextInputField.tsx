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
  borderRadius?: number; // px
}

const CLEARABLE_ICON_COLORS = {
  border: 'hsla(0,0%,78%,1)', // lhlBorderColor
  active: 'hsla(27, 93%, 32%, 1)', // lhlBurntOrange
};

export default function TextInputField({
  label,
  leftIcon,
  clearable,
  borderRadius=8,
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
    <View>
      {/* LABEL */}
      {label && (
        <Pressable onPress={focusInput}>
          <Text className="font-semibold text-base mb-1">{label}</Text>
        </Pressable>
      )}

      {/* INPUT CONTAINER */}
      <Pressable
        onPress={focusInput}
        className={`
          flex-row items-center
          border
          px-3 h-[48] gap-2
          ${borderColorClass}
          bg-white
        `}
        style={{
          borderRadius: borderRadius
        }}
      >
        {/* Left Icon */}
        {leftIcon && <View>{leftIcon}</View>}

        {/* Text Input */}
        <TextInput
          ref={inputRef}
          accessibilityLabel={label}
          accessibilityRole="text"
          className={`
            flex-1
            text-base border-none
            focus:ring-0 focus:outline-none
            placeholder:text-lhlSecondaryTextGrey
          `}
          style={{ height: '100%', textAlignVertical: 'center', fontSize: 16 }}
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
      </Pressable>
    </View>
  );
}