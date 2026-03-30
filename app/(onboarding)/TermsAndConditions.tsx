import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, SafeAreaView, ScrollView } from 'react-native';

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

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} className="px-6 pt-4">

        {/* Back Arrow */}
        <TouchableOpacity onPress={() => router.back()} className="mb-4 self-start">
          <Text className="text-2xl text-gray-800">←</Text>
        </TouchableOpacity>

        {/* Progress Bar */}
        <View className="h-1.5 bg-gray-200 rounded-full mb-8 overflow-hidden">
          <View className="h-full w-full bg-orange-700 rounded-full" />
        </View>

        {/* Title */}
        <Text className="text-2xl font-bold text-gray-900 mb-2">Terms and Conditions</Text>
        <Text className="text-sm text-gray-500 mb-7">By continuing, I acknowledge that:</Text>

        {/* Checkboxes */}
        <View className="gap-5">
          {TERMS.map((term) => (
            <TouchableOpacity
              key={term.id}
              className="flex-row items-start gap-3"
              onPress={() => toggleCheckbox(term.id)}
              activeOpacity={0.7}
            >
              <View
                className={`w-5 h-5 rounded border-2 items-center justify-center mt-0.5 shrink-0 ${
                  checked[term.id]
                    ? 'bg-orange-700 border-orange-700'
                    : 'bg-white border-gray-400'
                }`}
              >
                {checked[term.id] && (
                  <Text className="text-white text-xs font-bold">✓</Text>
                )}
              </View>
              <Text className="text-sm text-gray-700 leading-5 flex-1">{term.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Spacer */}
        <View className="flex-1" />

        {/* Next Button */}
        <TouchableOpacity
          className={`mt-10 mb-8 rounded-lg py-4 items-center justify-center ${
            allChecked
              ? 'bg-orange-700'
              : 'bg-transparent border border-gray-300'
          }`}
          onPress={allChecked ? () => {
            // Replace so the user can't swipe back to onboarding
            router.replace('/(tabs)/home');
          } : undefined}
          activeOpacity={allChecked ? 0.8 : 1}
        >
          <Text
            className={`text-base font-semibold ${
              allChecked ? 'text-white' : 'text-gray-400'
            }`}
          >
            Next
          </Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}
