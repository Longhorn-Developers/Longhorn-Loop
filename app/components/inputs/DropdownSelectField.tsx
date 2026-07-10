import LhlCaretDownIcon from '@/assets/icons/LhlCaretDownIcon';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

interface DropdownSelectFieldProps {
  label?: string;
  leftIcon?: React.ReactNode;
  placeholder?: string;
  options: string[];
  selectedValue: string;
  onSelect: (value: string) => void;
  isOpen: boolean;
  onToggle: () => void;
  borderRadius?: number;
}

export default function DropdownSelectField({
  label,
  leftIcon,
  placeholder,
  options = [],
  selectedValue,
  onSelect,
  isOpen,
  onToggle,
  borderRadius = 4,
}: DropdownSelectFieldProps) {
  const borderColorClass = isOpen ? 'border-lhlBurntOrange' : 'border-lhlBorderColor';

  return (
    <View>
      {label && (
        <Pressable onPress={onToggle}>
          <Text className="font-['Roboto-Flex'] font-semibold text-[16px]">{label}</Text>
        </Pressable>
      )}

      <Pressable
        onPress={onToggle}
        accessibilityRole="combobox"
        accessibilityState={{ expanded: isOpen }}
        className={`
          mt-[6px]
          flex-row items-center
          border
          px-[9px] h-[33px] gap-2
          ${borderColorClass}
          bg-white
        `}
        style={
          {
            borderRadius: borderRadius,
            outlineStyle: 'none',
          } as any
        }
      >
        {leftIcon && <View>{leftIcon}</View>}

        <Text
          numberOfLines={1}
          className={`flex-1 font-['Roboto-Flex'] text-[14px] ${
            selectedValue ? 'text-black' : 'text-neutral-400'
          }`}
        >
          {selectedValue || placeholder}
        </Text>

        <View className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : 'rotate-0'}`}>
          <LhlCaretDownIcon color="#000" />
        </View>
      </Pressable>

      {isOpen && (
        <View
          className="mt-1 border border-lhlBorderColor bg-white overflow-hidden"
          style={{ borderRadius: borderRadius }}
        >
          {options.map((option, index) => (
            <Pressable
              key={option}
              onPress={() => {
                onSelect(option);
                onToggle();
              }}
              className={`
                px-4 py-2 
                active:bg-neutral-100 
                border-neutral-100
                ${index !== options.length - 1 ? 'border-b' : ''}
              `}
            >
              <Text className="font-['Roboto-Flex'] text-[14px] text-black">{option}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
