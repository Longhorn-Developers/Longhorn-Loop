import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import PrimaryButton from '../components/buttons/PrimaryButton';
import FlowLayout from '../components/layouts/FlowLayout';

const TERMS = [
  {
    id: 'responsible',
    label: 'I agree to use Longhorn Loop responsibly and not post misleading or troll content.',
  },
  {
    id: 'visible',
    label: 'I understand that events I create will be visible to other UT students.',
  },
  {
    id: 'guidelines',
    label: 'I agree to respect the community guidelines and other users.',
  },
  {
    id: 'removed',
    label:
      'I acknowledge that violating the guidelines may result in my removal and a permanent ban.',
  },
] as const;

/** Every box starts unchecked. Derived from TERMS so the two cannot disagree —
 *  see the note on `allChecked`. */
const NONE_CHECKED: Record<string, boolean> = Object.fromEntries(
  TERMS.map((term) => [term.id, false]),
);

/**
 * The checkbox was a 16pt square with a 12pt label beside it, which is the
 * smallest interactive target in the app and sits on the one screen nobody can
 * skip. Apple's floor is 44pt and Android's is 48dp; the box itself is now 24pt
 * and the whole row is the target, padded out past 48.
 *
 * The row being pressable is the part that actually matters — people aim at the
 * words, not the box.
 */
const ROW_MIN_HEIGHT = 48;

export default function TermsAndConditions() {
  const router = useRouter();
  const [checked, setChecked] = useState<Record<string, boolean>>(NONE_CHECKED);

  // Over TERMS, not over the keys of `checked`. Those are not the same set: a
  // term nobody has tapped yet has no key, so `Object.values(checked).every()`
  // is asking "is everything I have seen ticked", which is true of an empty
  // object and true of three ticks out of four. Adding a fourth term to the
  // list is exactly how you would hit that, and it is what happened here.
  const allChecked = TERMS.every((term) => checked[term.id]);

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
      step={4}
      totalSteps={4}
      footer={
        <View className="mt-[16px] mb-[42px]">
          <PrimaryButton label="Next" isFilled={allChecked} onPress={handleSubmit} />
        </View>
      }
    >
      {/* No mx: FlowLayout already supplies the page gutter, and the rows'
          px-2 -mx-2 cancels out (it widens the press target, not the inset). */}
      <View className="mt-[32px] gap-2">
        {TERMS.map((term) => {
          const isSelected = checked[term.id];

          return (
            <Pressable
              key={term.id}
              onPress={() => toggleCheckbox(term.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isSelected }}
              accessibilityLabel={term.label}
              hitSlop={8}
              className="flex-row items-center gap-4 rounded-lg px-2 -mx-2"
              style={({ pressed }) => [
                { minHeight: ROW_MIN_HEIGHT, paddingVertical: 6, opacity: pressed ? 0.6 : 1 },
                { outlineStyle: 'none' } as any,
              ]}
            >
              {/* Checkbox UI */}
              <View
                className={`w-6 h-6 border-2 rounded-md items-center justify-center ${
                  isSelected ? 'bg-lhlBurntOrange border-lhlBurntOrange' : 'border-lhlInk'
                }`}
              >
                {isSelected && (
                  <Text className="text-white text-[15px] leading-none font-bold">✓</Text>
                )}
              </View>

              {/* Label Text */}
              <Text className="font-['Roboto-Flex'] text-[15px] leading-[21px] font-normal text-lhlAccent flex-1">
                {term.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </FlowLayout>
  );
}
