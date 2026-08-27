import LonghornLoopLogo from '@/app/components/icons/LonghornLoopLogo';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { useThemeColors } from '@/app/lib/themeColors';
import { Image, type ImageSource } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  FlatList,
  ListRenderItemInfo,
  Pressable,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PrimaryButton from '../components/buttons/PrimaryButton';

const CARD_MARGIN = 45;
const TEXT_MARGIN = 32;

const TITLE_SIZE = 28;

// The text block is content-sized, not the old fixed 194px (the height of the
// tallest possible copy), which left ~50px of slack below shorter slides.
const TEXT_PILL_GAP = 32;

// Keeps the hero from shrinking when the bottom content takes up more room.
const HERO_HEIGHT_RATIO = 0.86;

const BUTTON_HEIGHT = 55;
const BUTTON_GAP = 16;

// Figma's 90 was measured against the old fixed-height text block; against the
// content-sized one it drops the CTAs to the bottom edge. Fixed, not a flexible
// spacer — a growing spacer pins the footer to the bottom of the screen.
const PAGINATION_BUTTON_GAP = 48;

// Reserve room for both buttons on every slide so the layout doesn't jump when
// the second one appears. Bottom-aligned below, so the lone "Continue" lands on
// the same baseline as "Already Have An Account" on the last slide.
const FOOTER_HEIGHT = BUTTON_HEIGHT * 2 + BUTTON_GAP;

interface Slide {
  id: string;
  hero: ImageSource;
  eyebrow: string;
  title: string;
  subtitle: string;
}

const SLIDES: Slide[] = [
  {
    id: 'campus',
    hero: require('@/assets/images/onboarding-explore-hero.webp'),
    eyebrow: 'STAY IN THE LOOP',
    title: 'Campus, all in one place',
    subtitle:
      "Every UT event and org, sorted by what's close, what's next, and what's worth your time.",
  },
  {
    id: 'people',
    hero: require('@/assets/images/onboarding-two-phones-opposite.webp'),
    eyebrow: 'FIND YOUR PEOPLE',
    title: 'Make Campus Feel Smaller',
    subtitle:
      "See who's going, discover communities you'll love, and turn new faces into familiar ones.",
  },
  {
    id: 'yours',
    hero: require('@/assets/images/onboarding-bevo-walking-path.webp'),
    eyebrow: 'MAKE IT YOURS',
    title: 'Your Loop, Your Path',
    subtitle: 'Loop learns what matters to you and builds a feed around your interests.',
  },
];

export default function FrontPage() {
  const router = useRouter();
  const { update } = useOnboarding();
  const colors = useThemeColors();
  const { width } = useWindowDimensions();

  const listRef = useRef<FlatList<Slide>>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const activeSlide = SLIDES[activeIndex];
  const isLastSlide = activeIndex === SLIDES.length - 1;

  const goNext = () => {
    if (isLastSlide) return;

    listRef.current?.scrollToIndex({
      index: activeIndex + 1,
      animated: true,
    });
  };

  // Updates the text and pagination based on which hero is currently visible.
  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextIndex = Math.round(e.nativeEvent.contentOffset.x / width);

    if (nextIndex >= 0 && nextIndex < SLIDES.length && nextIndex !== activeIndex) {
      setActiveIndex(nextIndex);
    }
  };

  // Only this hero section physically moves when the user swipes.
  const renderHero = ({ item }: ListRenderItemInfo<Slide>) => (
    <View
      style={{
        width,
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: width - CARD_MARGIN * 2,
          height: '100%',
        }}
      >
        <Image
          source={item.hero}
          style={{
            width: '100%',
            height: '100%',
          }}
          contentFit="contain"
        />
      </View>
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-lhlBackgroundColor" edges={['top', 'bottom']}>
      {/* Header stays fixed */}
      <View
        className="flex-row items-center pt-6"
        style={{
          gap: 13,
          paddingLeft: CARD_MARGIN - 30,
        }}
      >
        <LonghornLoopLogo size={35} />

        <Text className="font-roboto-bold text-[22px] text-lhlInk">Longhorn Loop</Text>
      </View>

      {/* Only the image carousel moves */}
      <View
        style={{
          height: width * HERO_HEIGHT_RATIO,
          marginTop: 30,
        }}
      >
        <FlatList
          ref={listRef}
          data={SLIDES}
          keyExtractor={(item) => item.id}
          renderItem={renderHero}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          getItemLayout={(_, index) => ({
            length: width,
            offset: width * index,
            index,
          })}
        />
      </View>

      {/* This stays in place. Only the words change. */}
      <View
        style={{
          width: width - TEXT_MARGIN * 2,
          alignSelf: 'center',
          marginTop: 14,
        }}
      >
        <Text className="text-center font-roboto-bold text-[16px] text-lhlAccent">
          {activeSlide.eyebrow}
        </Text>

        <Text
          style={{
            marginTop: 29,
            fontSize: TITLE_SIZE,
          }}
          numberOfLines={2}
          className="text-center font-roboto-bold text-lhlInk"
        >
          {activeSlide.title}
        </Text>

        <Text
          style={{
            marginTop: 12,
          }}
          numberOfLines={3}
          className="text-center font-roboto text-[16px] leading-[22px] text-lhlInk"
        >
          {activeSlide.subtitle}
        </Text>
      </View>

      {/* Pagination doesn't move. Only the active pill changes. */}
      <View
        className="flex-row items-center justify-center"
        style={{ gap: 10, marginTop: TEXT_PILL_GAP }}
      >
        {SLIDES.map((slide, index) =>
          index === activeIndex ? (
            <View key={slide.id} className="h-[13px] w-8 rounded-full bg-lhlBurntOrange" />
          ) : (
            <View
              key={slide.id}
              className="h-[13px] w-[13px] rounded-full"
              style={{
                backgroundColor: colors.placeholder,
              }}
            />
          ),
        )}
      </View>

      <View style={{ height: PAGINATION_BUTTON_GAP }} />

      {/* Buttons stay fixed */}
      <View className="px-5 pb-2">
        <View
          style={{
            height: FOOTER_HEIGHT,
            gap: BUTTON_GAP,
            justifyContent: 'flex-end',
          }}
        >
          <PrimaryButton
            label={isLastSlide ? 'Get Started' : 'Continue'}
            isFilled
            onPress={isLastSlide ? () => router.push('/RegisterPage') : goNext}
          />

          {isLastSlide && (
            <Pressable
              style={{ height: BUTTON_HEIGHT }}
              className="flex-row items-center justify-center rounded-lg border border-lhlBorderColor bg-lhlSurface"
              onPress={() => router.push('/LoginPage')}
            >
              <Text className="font-roboto-semibold text-xl text-lhlAccent">
                Already Have an Account
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Dev-only bypass */}
      {__DEV__ && (
        <Pressable
          className="absolute bottom-1 left-0 right-0 items-center"
          onPress={() => {
            update({
              firstName: 'Dev',
              lastName: 'User',
              email: 'dev@utexas.edu',
            });

            router.replace('/(tabs)/home');
          }}
        >
          <Text className="text-xs text-lhlMutedText underline">[DEV] Skip to Home</Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}
