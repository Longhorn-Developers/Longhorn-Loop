import LhlXCircleIcon from '@/assets/icons/LhlXCircleIcon';
import React, { useRef, useState } from 'react';
import { Pressable, Text, TextInput, TextInputProps, View } from 'react-native';

interface TextInputFieldProps extends TextInputProps {
  label?: string;
  leftIcon?: React.ReactNode;
  clearable?: boolean;
  borderRadius?: number; // px
  forceFocusStyles?: boolean;
}

export default function TextInputField({
  label,
  leftIcon,
  clearable,
  borderRadius = 4,
  forceFocusStyles = false,
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
  };

  const handleClear = () => {
    // Clears text and refocuses text input
    props.onChangeText?.('');
    focusInput();
  };

  // --- DERIVED VALUES ---
  const borderColorClass =
    isFocused || forceFocusStyles ? 'border-lhlBurntOrange' : 'border-lhlBorderColor';

  // --- RENDER: TEXT INPUT FIELD ---
  return (
    <View>
      {/* LABEL */}
      {label && (
        <Pressable onPress={focusInput}>
          <Text className="font-['Roboto-Flex'] font-semibold text-[16px]">{label}</Text>
        </Pressable>
      )}

      {/* INPUT CONTAINER */}
      <Pressable
        onPress={focusInput}
        className={`
          mt-[6px]
          flex-row items-center
          border
          px-[9px] h-[33px] gap-2
          ${borderColorClass}
          bg-white
        `}
        style={{
          borderRadius: borderRadius,
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
            flex-1 font-['Roboto-Flex'] text-[14px]
            focus:ring-0 focus:outline-none
            placeholder:text-black
          `}
          underlineColorAndroid="transparent"
          onFocus={handleFocus}
          onBlur={handleBlur}
          {...props}
        />
        {/* Clear Button */}
        {clearable && (isFocused || forceFocusStyles) && (
          <Pressable onPressIn={(e) => e.preventDefault?.()} onPress={handleClear} hitSlop={8}>
            <LhlXCircleIcon size={13} color={'#000'} />
          </Pressable>
        )}
      </Pressable>
    </View>
  );
}
