import { useOnboarding } from '@/app/context/OnboardingContext';
import { INTEREST_CATEGORIES, ALL_INTEREST_TAGS } from '@/app/lib/interestCategories';
import { useThemeColors } from '@/app/lib/themeColors';
import SearchIcon from '@/assets/images/search_icon_create_acc.svg';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import InlineAlert from '../components/alerts/InlineAlert';
import PrimaryButton from '../components/buttons/PrimaryButton';
import PillDropdownField from '../components/inputs/PillDropdownField';
import SearchablePillDropdownField from '../components/inputs/SearchablePillDropdownField';
import FlowLayout from '../components/layouts/FlowLayout';

// Categories/tags live in app/lib/interestCategories.ts

export default function CategorySelectorScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { update } = useOnboarding();

  const [inlineError, setInlineError] = useState('');

  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // No cap: the Worker accepts any number of interests, so onboarding and Edit
  // Profile both let the user take as many as they want.
  const applyTagSelection = (next: string[]) => {
    setSelectedTags(next);
  };
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  const handleToggleDropdown = (id: string) => {
    setOpenDropdownId((prev) => (prev === id ? null : id));
  };

  const handleSubmit = () => {
    if (selectedTags.length === 0) {
      setInlineError('Please select at least one tag.');
      return;
    }

    setInlineError('');

    update({
      selectedTags,
    });

    router.push('/Avatar');
  };

  const allFilled = selectedTags.length > 0;

  return (
    <FlowLayout
      title="Tell Us About You!"
      subTitle="Pick tags from any category and we'll use them to customize your experience."
      onBackPress={() => router.back()}
      showProgressBar={true}
      step={2}
      totalSteps={4}
      footer={
        <View className="mt-[16px] mb-[42px]">
          <PrimaryButton label="Next" isFilled={allFilled} onPress={handleSubmit} />
        </View>
      }
    >
      {inlineError && (
        <View className="mt-4">
          <InlineAlert message={inlineError} />
        </View>
      )}

      <View className="mt-[16px] flex-row items-center justify-between">
        <Text className="font-['Roboto-Flex'] text-[12px] text-lhlSecondaryTextGrey">
          Pick as many as you like
        </Text>
        <Text className="font-['Roboto-Flex'] text-[12px] font-semibold text-lhlSecondaryTextGrey">
          {selectedTags.length} selected
        </Text>
      </View>

      <View className="mt-[10px]">
        <SearchablePillDropdownField
          leftIcon={<SearchIcon width={15} height={15} color={colors.inkMuted} />}
          placeholder="Search for interests, events, activities..."
          options={ALL_INTEREST_TAGS}
          selectedValues={selectedTags}
          onSelect={applyTagSelection}
        />
      </View>

      <View className="mt-[16px] gap-[16px]">
        {INTEREST_CATEGORIES.map((category) => {
          const IconComponent = category.icon;

          const currentCategorySelectedTags = selectedTags.filter((tag) =>
            category.tags.includes(tag),
          );

          const handleCategorySelect = (updatedCategoryTags: string[]) => {
            const cleanGlobalTags = selectedTags.filter((tag) => !category.tags.includes(tag));
            applyTagSelection([...cleanGlobalTags, ...updatedCategoryTags]);
          };

          return (
            <View key={category.id}>
              <PillDropdownField
                titleText={category.label}
                leftIcon={<IconComponent width={16} height={16} />}
                options={category.tags}
                selectedValues={currentCategorySelectedTags}
                onSelect={handleCategorySelect}
                isOpen={openDropdownId === category.id}
                onToggle={() => handleToggleDropdown(category.id)}
              />
            </View>
          );
        })}
      </View>
    </FlowLayout>
  );
}
