import LhlCaretDownIcon from '@/assets/icons/LhlCaretDownIcon';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import PillButton from '../buttons/PillButton';

interface PillDropdownFieldProps {
  titleText: string;
  label?: string;
  leftIcon?: React.ReactNode;
  options: string[];
  selectedValues: string[];
  onSelect: (values: string[]) => void;
  isOpen: boolean;
  onToggle: () => void;
  borderRadius?: number;
  maxPillTextLength?: number;
}

export default function PillDropdownField({
  titleText,
  label,
  leftIcon,
  options = [],
  selectedValues = [],
  onSelect,
  isOpen,
  onToggle,
  borderRadius = 4,
  maxPillTextLength = 50,
}: PillDropdownFieldProps) {
  const handlePillPress = (option: string) => {
    if (selectedValues.includes(option)) {
      onSelect(selectedValues.filter((item) => item !== option));
    } else {
      onSelect([...selectedValues, option]);
    }
  };

  const truncateText = (text: string) => {
    if (text.length > maxPillTextLength) {
      return `${text.slice(0, maxPillTextLength)}...`;
    }
    return text;
  };

  const headerStyle = {
    borderTopLeftRadius: borderRadius,
    borderTopRightRadius: borderRadius,
    borderBottomLeftRadius: isOpen ? 0 : borderRadius,
    borderBottomRightRadius: isOpen ? 0 : borderRadius,
    outlineStyle: 'none',
  } as any;

  const dropdownStyle = {
    borderBottomLeftRadius: borderRadius,
    borderBottomRightRadius: borderRadius,
  };

  return (
    <View className="w-full">
      {/* Optional Top Label */}
      {label && (
        <Pressable onPress={onToggle} className="mb-[6px]">
          <Text className="font-['Roboto-Flex'] font-semibold text-[16px] text-black">{label}</Text>
        </Pressable>
      )}

      {/* Main Header Area */}
      <Pressable
        onPress={onToggle}
        accessibilityRole="combobox"
        accessibilityState={{ expanded: isOpen }}
        className={`
          flex-row items-center
          border
          p-[9px] h-[38px] gap-[10px]
          bg-white
        `}
        style={headerStyle}
      >
        {/* Left Icon */}
        {leftIcon && <View>{leftIcon}</View>}

        {/* Title Text */}
        <Text
          numberOfLines={1}
          className="font-['Roboto-Flex'] text-[12px] font-semibold text-black"
        >
          {titleText}
        </Text>

        {/* Counter Pill */}
        {selectedValues.length > 0 && (
          <View className="h-[16px] px-[8px] bg-lhlBurntOrange rounded-full justify-center items-center">
            <Text className="font-['Roboto-Flex'] text-[12px] font-medium text-white">
              {selectedValues.length}
            </Text>
          </View>
        )}

        {/* Caret Icon*/}
        <View
          className={`ml-auto transition-transform duration-200 ${isOpen ? 'rotate-180' : 'rotate-0'}`}
        >
          <LhlCaretDownIcon color="#000" />
        </View>
      </Pressable>

      {/* Dropdown Options Area */}
      {isOpen && (
        <View className={`border-x border-b bg-white p-[10px]`} style={dropdownStyle}>
          <View className="flex-row flex-wrap gap-2">
            {options.map((option) => {
              const isSelected = selectedValues.includes(option);
              return (
                <PillButton
                  key={option}
                  label={truncateText(option)}
                  isSelected={isSelected}
                  onPress={() => handlePillPress(option)}
                  height={28}
                  gap={10}
                  textSize={12}
                  padding={9}
                  iconSize={8}
                />
              );
            })}
            {options.length === 0 && (
              <Text className="font-['Roboto-Flex'] text-[13px] text-neutral-400 italic px-1">
                No options available
              </Text>
            )}
          </View>
        </View>
      )}
    </View>
  );
}
