import LhlPillCross from '@/assets/icons/LhlPillCross';
import { useThemeColors } from '@/app/lib/themeColors';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, TextInputProps, View } from 'react-native';

/** Form-field default. Deliberately unchanged — see the `height` prop. */
const DEFAULT_HEIGHT = 33;

interface TextInputFieldProps extends TextInputProps {
  label?: string;
  leftIcon?: React.ReactNode;
  clearable?: boolean;
  borderRadius?: number; // px
  forceFocusStyles?: boolean;
  /**
   * Control height in px.
   *
   * Opt-in rather than a blanket change: 33 is below the 44pt tap-target floor
   * everywhere it is used, but this component backs eleven screens' worth of
   * form fields and raising all of them is a design call, not a bug fix. Only
   * Explore's search bar overrides it today (LOOP-283 flagged the same
   * hit-target problem for that screen's other controls). If the team decides
   * to lift the floor app-wide, change DEFAULT_HEIGHT and drop the overrides.
   */
  height?: number;
  /**
   * Forwarded to the inner TextInput, so a parent can blur/focus it.
   *
   * React 19 passes `ref` as an ordinary prop, which matters here: it is
   * destructured out below rather than left in `...props`, because the spread
   * lands AFTER the internal `ref` on the TextInput and would silently
   * overwrite it — breaking focusInput() and the clear button with it.
   */
  ref?: React.Ref<TextInput>;
}

export default function TextInputField({
  label,
  leftIcon,
  clearable,
  borderRadius = 4,
  forceFocusStyles = false,
  height = DEFAULT_HEIGHT,
  ref,
  ...props
}: TextInputFieldProps) {
  const colors = useThemeColors();
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const blurTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Callback ref that feeds both the internal ref and the caller's, so
  // forwarding costs the component none of its own control over the input.
  const setInputRef = useCallback(
    (node: TextInput | null) => {
      inputRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as React.RefObject<TextInput | null>).current = node;
    },
    [ref],
  );

  // A blur schedules a 100ms timer so handleClear() can still fire. If the
  // field unmounts inside that window the timer is still pending and will call
  // setState on a dead component. Harmless in React 19, but it keeps the
  // component alive for no reason and hides real leaks, so clear it.
  useEffect(
    () => () => {
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    },
    [],
  );

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
      {/* Label is 600; the input below stays regular. */}
      {label && (
        <Pressable onPress={focusInput}>
          <Text className="font-roboto-semibold text-[16px] text-lhlInk">{label}</Text>
        </Pressable>
      )}

      {/* INPUT CONTAINER */}
      <Pressable
        onPress={focusInput}
        className={`
          mt-[6px]
          flex-row items-center
          border
          px-[9px] gap-2
          ${borderColorClass}
          bg-lhlSurface
        `}
        // height moved out of the className: NativeWind needs static classes at
        // build time, so `h-[${height}px]` would not compile to anything.
        style={{
          borderRadius: borderRadius,
          height,
        }}
      >
        {/* Left Icon */}
        {leftIcon && <View>{leftIcon}</View>}

        {/* Text Input */}
        {/*
          text-lhlInk is load-bearing: without an explicit colour the platform
          default is black, which is invisible against the dark-mode surface.
          That was the "dark mode is not working" report on every search field.
        */}
        <TextInput
          ref={setInputRef}
          accessibilityLabel={label}
          accessibilityRole="text"
          className={`
            flex-1 font-['Roboto-Flex'] text-[14px] text-lhlInk
            focus:ring-0 focus:outline-none
            placeholder:text-lhlMutedText
          `}
          underlineColorAndroid="transparent"
          onFocus={handleFocus}
          onBlur={handleBlur}
          {...props}
        />
        {/* Clear Button */}
        {/*
          Bare cross, not LhlXCircleIcon. The circled variant was never in the
          Figma and the bug bash called it out explicitly. Colour comes from the
          theme so it survives dark mode.
        */}
        {clearable && (isFocused || forceFocusStyles) && (
          <Pressable
            onPressIn={(e) => e.preventDefault?.()}
            onPress={handleClear}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear text"
          >
            <LhlPillCross size={11} color={colors.inkSecondary} />
          </Pressable>
        )}
      </Pressable>
    </View>
  );
}
