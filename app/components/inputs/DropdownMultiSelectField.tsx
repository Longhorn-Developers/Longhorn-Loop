import LhlCaretDownIcon from '@/assets/icons/LhlCaretDownIcon';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

interface DropdownMultiSelectFieldProps {
  label?: string;
  leftIcon?: React.ReactNode;
  placeholder?: string;
  options: string[];
  selectedValues: string[];
  onSelect: (values: string[]) => void;
  isOpen: boolean;
  onToggle: () => void;
  borderRadius?: number;
}

export default function DropdownMultiSelectField({
  label,
  leftIcon,
  placeholder,
  options = [],
  selectedValues = [],
  onSelect,
  isOpen,
  onToggle,
  borderRadius = 4,
}: DropdownMultiSelectFieldProps) {
  const borderColorClass = isOpen ? 'border-lhlBurntOrange' : 'border-lhlBorderColor';

  const handleSelect = (option: string) => {
    const NOT_APPLICABLE = 'Not Applicable';

    if (option === NOT_APPLICABLE) {
      if (selectedValues.includes(NOT_APPLICABLE)) {
        return;
      }
      onSelect([NOT_APPLICABLE]);
      return;
    }

    if (selectedValues.includes(option)) {
      if (selectedValues.length === 1) {
        return;
      }
      onSelect(selectedValues.filter((item) => item !== option));
    } else {
      const updatedValues = [...selectedValues, option].filter((item) => item !== NOT_APPLICABLE);
      onSelect(updatedValues);
    }
  };

  const displayText = selectedValues.length > 0 ? selectedValues.join(', ') : placeholder;

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
            selectedValues.length > 0 ? 'text-black' : 'text-neutral-400'
          }`}
        >
          {displayText}
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
          {options.map((option, index) => {
            const isSelected = selectedValues.includes(option);

            return (
              <Pressable
                key={option}
                onPress={() => handleSelect(option)}
                className={`
                  flex-row items-center justify-between
                  px-4 py-2 
                  active:bg-neutral-100 
                  border-neutral-100
                  ${index !== options.length - 1 ? 'border-b' : ''}
                `}
              >
                <Text className="font-['Roboto-Flex'] text-[14px] text-black">{option}</Text>

                {/* Custom Checkbox UI */}
                <View
                  className={`w-4 h-4 border rounded sm items-center justify-center ${
                    isSelected ? 'bg-lhlBurntOrange border-lhlBurntOrange' : 'border-black'
                  }`}
                >
                  {isSelected && (
                    <Text className="text-white text-[10px] leading-none font-bold">✓</Text>
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}
