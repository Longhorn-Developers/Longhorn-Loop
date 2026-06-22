import { useOnboarding } from '@/app/context/OnboardingContext';
import FlowLayout from '@/app/components/layouts/FlowLayout';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View, Text, Pressable, Image } from 'react-native';
import PrimaryButton from '@/app/components/buttons/PrimaryButton';

interface Avatar {
  id: number;
  label: string;
  image: ReturnType<typeof require>;
}

const avatars: Avatar[] = [
  { id: 1, label: 'Hungry Bevo', image: require('@/assets/images/avatars/hungry-bevo.png') },
  { id: 2, label: 'Silly Bevo', image: require('@/assets/images/avatars/silly-bevo.png') },
  { id: 3, label: 'Smart Bevo', image: require('@/assets/images/avatars/smart-bevo.png') },
  { id: 4, label: 'Happy Bevo', image: require('@/assets/images/avatars/happy-bevo.png') },
  { id: 5, label: 'Sad Bevo', image: require('@/assets/images/avatars/sad-bevo.png') },
  { id: 6, label: 'Sporty Bevo', image: require('@/assets/images/avatars/sporty-bevo.png') },
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
      subTitle="Choose the Bevo that represents you"
      onBackPress={() => router.back()}
    >
      {/* 2-column grid */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          marginTop: 32,
          paddingHorizontal: 16,
        }}
      >
        {avatars.map((avatar) => {
          const isSelected = selected === avatar.id;
          return (
            <Pressable
              key={avatar.id}
              onPress={() => handleSelect(avatar.id)}
              style={{
                width: '45%',
                alignItems: 'center',
                marginBottom: 24,
              }}
            >
              {/* Avatar circle */}
              <View
                style={{
                  width: 120,
                  height: 120,
                  borderRadius: 60,
                  overflow: 'hidden',
                  borderWidth: isSelected ? 3 : 0,
                  borderColor: '#BF5700',
                }}
              >
                <Image
                  source={avatar.image}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="cover"
                />

                {/* Checkmark overlay */}
                {isSelected && (
                  <View
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: 'rgba(0,0,0,0.25)',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        backgroundColor: 'rgba(255,255,255,0.9)',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text style={{ fontSize: 20, color: '#BF5700', fontWeight: '700' }}>✓</Text>
                    </View>
                  </View>
                )}
              </View>

              {/* Label */}
              <Text
                style={{
                  marginTop: 8,
                  fontSize: 14,
                  fontWeight: '600',
                  color: '#020B12',
                  textAlign: 'center',
                }}
              >
                {avatar.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Next Button */}
      <View className="mt-2 mx-2">
        <PrimaryButton
          label="Next"
          isFilled={selected !== null}
          onPress={handleNext}
        />
      </View>
    </FlowLayout>
  );
}
