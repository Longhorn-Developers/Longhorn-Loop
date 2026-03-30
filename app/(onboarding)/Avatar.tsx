import { useOnboarding } from '@/app/context/OnboardingContext';
import FlowLayout from '@/app/components/layouts/FlowLayout';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import PrimaryButton from '@/app/components/buttons/PrimaryButton';

interface Avatar {
  id: number;
  label: string;
  color: string;
}

const avatars: Avatar[] = [
  { id: 1, label: '🤠', color: '#F97316' },
  { id: 2, label: '🐂', color: '#EA580C' },
  { id: 3, label: '🎓', color: '#C2410C' },
  { id: 4, label: '🌵', color: '#9A3412' },
  { id: 5, label: '⭐', color: '#7C2D12' },
];

export default function AvatarSelector() {
  const router = useRouter();
  const { update } = useOnboarding();
  const [selected, setSelected] = useState<number | null>(null);

  const handleSelect = (id: number) => {
    setSelected(id);
  };

  const handleNext = () => {
    if (selected) {
      update({ avatar: selected });
      router.push('/TermsAndConditions');
    }
  };

  return (
    <FlowLayout
      title="Select Avatar"
      subTitle="Choose the figure that represents you"
      onBackPress={() => router.back()}
    >
      {/* Avatar horizontal scroll */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="mt-10"
        contentContainerStyle={{ gap: 16, paddingVertical: 8 }}
      >
        {avatars.map((avatar) => {
          const isSelected = selected === avatar.id;
          return (
            <Pressable
              key={avatar.id}
              onPress={() => handleSelect(avatar.id)}
              className={`w-[100px] h-[100px] rounded-xl items-center justify-center border-2 ${
                isSelected ? 'border-orange-700' : 'border-gray-200'
              }`}
              style={{ backgroundColor: avatar.color + '20' }}
            >
              <Text style={{ fontSize: 40 }}>{avatar.label}</Text>

              {/* Checkmark indicator */}
              {isSelected && (
                <View className="absolute top-1 right-1 w-5 h-5 bg-orange-700 rounded-full items-center justify-center">
                  <Text className="text-white text-xs font-bold">✓</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Selected indicator text */}
      {selected && (
        <Text className="mt-4 text-sm text-gray-500 text-center">
          Avatar {selected} selected
        </Text>
      )}

      {/* Next Button */}
      <View className="mt-[42px] mx-2">
        <PrimaryButton
          label="Next"
          isFilled={selected !== null}
          onPress={handleNext}
        />
      </View>
    </FlowLayout>
  );
}
