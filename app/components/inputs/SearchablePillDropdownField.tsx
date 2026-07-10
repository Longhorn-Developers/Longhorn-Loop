import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import PillButton from '../buttons/PillButton';
import TextInputField from './TextInputField';

interface SearchablePillDropdownFieldProps {
  label?: string;
  leftIcon?: React.ReactNode;
  placeholder?: string;
  options: string[];
  selectedValues: string[];
  onSelect: (values: string[]) => void;
  borderRadius?: number;
  maxPillTextLength?: number;
}

export default function SearchablePillDropdownField({
  label,
  leftIcon,
  placeholder = 'Search...',
  options = [],
  selectedValues = [],
  onSelect,
  borderRadius = 4,
  maxPillTextLength = 50,
}: SearchablePillDropdownFieldProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  const handlePillPress = (option: string) => {
    if (selectedValues.includes(option)) {
      onSelect(selectedValues.filter((item) => item !== option));
    } else {
      onSelect([...selectedValues, option]);
    }
    setSearchQuery('');
  };

  const filteredOptions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];

    return options.filter((option) => option.toLowerCase().includes(query));
  }, [searchQuery, options]);

  const truncateText = (text: string) => {
    if (text.length > maxPillTextLength) {
      return `${text.slice(0, maxPillTextLength)}...`;
    }
    return text;
  };

  const hasText = searchQuery.trim().length > 0;
  const shouldShowDropdown = hasText && (isFocused || hasText);

  return (
    <View className="w-full">
      <TextInputField
        label={label}
        leftIcon={leftIcon}
        placeholder={placeholder}
        value={searchQuery}
        onChangeText={setSearchQuery}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        borderRadius={borderRadius}
        clearable={true}
        forceFocusStyles={shouldShowDropdown || isFocused}
      />

      {shouldShowDropdown && (
        <View
          className="mt-1 border border-lhlBorderColor bg-white p-[6px]"
          style={{ borderRadius }}
        >
          {filteredOptions.length > 0 ? (
            <>
              <Text className="font-['Roboto-Flex'] text-[12px] font-medium text-neutral-500 mb-[10px] ml-[10px]">
                {filteredOptions.length} result{filteredOptions.length !== 1 ? 's' : ''} - tap to
                select tag(s)
              </Text>

              <View className="flex-row flex-wrap gap-2">
                {filteredOptions.map((option) => {
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
              </View>
            </>
          ) : (
            <View className="py-4 items-center justify-center">
              <Text className="font-['Roboto-Flex'] text-[12px] text-neutral-500">
                No results for{' '}
                <Text className="font-['Roboto-Flex'] font-semibold text-neutral-500">
                  {`"${searchQuery.trim()}"`}
                </Text>
              </Text>
            </View>
          )}
        </View>
      )}

      {!shouldShowDropdown && selectedValues.length > 0 && (
        <View className="flex-row flex-wrap gap-2 mt-2">
          {selectedValues.map((option) => (
            <PillButton
              key={option}
              label={truncateText(option)}
              isSelected={true}
              onPress={() => handlePillPress(option)}
              height={28}
              gap={10}
              textSize={12}
              padding={9}
              iconSize={8}
            />
          ))}
        </View>
      )}
    </View>
  );
}
