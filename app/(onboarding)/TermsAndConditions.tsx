import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import PrimaryButton from '../components/buttons/PrimaryButton';
import FlowLayout from '../components/layouts/FlowLayout';

const TERMS = [
  {
    id: 'responsible',
    label: 'I agree to use Longhorn Journey responsibly and not post misleading or troll content.',
  },
  {
    id: 'visible',
    label: 'I understand that events I create will be visible to other UT students.',
  },
  {
    id: 'guidelines',
    label: 'I agree to respect the community guidelines and other users.',
  },
];

export default function TermsAndConditions() {
  const router = useRouter();
  const [checked, setChecked] = useState<Record<string, boolean>>({
    responsible: false,
    visible: false,
    guidelines: false,
  });

  const allChecked = Object.values(checked).every(Boolean);

  const toggleCheckbox = (id: string) => {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSubmit = () => {
    if (allChecked) {
      router.push('/OnboardingComplete');
    }
  };

  return (
    <FlowLayout
      title="Terms and Conditions"
      subTitle="By continuing, I acknowledge that:"
      onBackPress={() => router.back()}
      showProgressBar={true}
      startingPercentage={75}
      progressBarPercentage={100}
      footer={
        <View className="mt-[16px] mb-[42px]">
          <PrimaryButton label="Next" isFilled={allChecked} onPress={handleSubmit} />
        </View>
      }
    >
      {/* Checkboxes List */}
      <View className="mt-[42px] mx-[16px] gap-5">
        {TERMS.map((term) => {
          const isSelected = checked[term.id];

          return (
            <Pressable
              key={term.id}
              onPress={() => toggleCheckbox(term.id)}
              className="flex-row items-center gap-3"
              style={{ outlineStyle: 'none' } as any}
            >
              {/* Checkbox UI */}
              <View
                className={`w-4 h-4 border rounded sm items-center justify-center ${
                  isSelected ? 'bg-lhlBurntOrange border-lhlBurntOrange' : 'border-black'
                }`}
              >
                {isSelected && (
                  <Text className="text-white text-[10px] leading-none font-bold">✓</Text>
                )}
              </View>

              {/* Label Text */}
              <Text className="font-['Roboto-Flex'] text-[12px]  font-normal text-lhlBurntOrange flex-1">
                {term.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </FlowLayout>
  );
}
