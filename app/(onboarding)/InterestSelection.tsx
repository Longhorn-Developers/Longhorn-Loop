import { useOnboarding } from '@/app/context/OnboardingContext';
import { INTEREST_CATEGORIES, ALL_INTEREST_TAGS } from '@/app/lib/interestCategories';
import { MAX_INTERESTS } from '@/shared/taxonomy';
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
  const [capHit, setCapHit] = useState(false);

  // Same cap Edit Profile enforces. Without it users pick 20 tags here and
  // then can't save their profile later, because the Worker rejects the write.
  // Removing is always allowed so nobody gets stuck at the limit.
  const applyTagSelection = (next: string[]) => {
    if (next.length <= selectedTags.length || next.length <= MAX_INTERESTS) {
      setSelectedTags(next);
      setCapHit(false);
      return;
    }
    setCapHit(true);
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
      startingPercentage={25}
      progressBarPercentage={50}
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
          {capHit
            ? `That's ${MAX_INTERESTS} — remove one to swap it out.`
            : 'Pick up to ' + MAX_INTERESTS}
        </Text>
        <Text className="font-['Roboto-Flex'] text-[12px] font-semibold text-lhlSecondaryTextGrey">
          {selectedTags.length} / {MAX_INTERESTS}
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
