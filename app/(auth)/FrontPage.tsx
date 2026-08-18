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

// Side margins from the design: hero card at 45px, copy block at 32px.
const CARD_MARGIN = 45;
const TEXT_MARGIN = 32;

/**
 * NOTHING BELOW THE HERO IS ALLOWED TO MOVE BETWEEN SLIDES.
 *
 * Every measurement here that looks over-specified is holding one of the three
 * things that used to shift as you swiped:
 *
 *  1. Each hero declared its own aspect ratio (634/742, 626/656, 624/656), so
 *     slide 1's card was ~10% taller than the other two and everything under it
 *     started lower.
 *  2. Each title declared its own size (30, 26, 30) and the copy wraps to a
 *     different number of lines per slide, so the pagination dots sat at three
 *     different heights.
 *  3. The footer grew by a whole button on the last slide, which pushed the
 *     carousel viewport shorter and moved the artwork up mid-swipe.
 *
 * The fix in each case is to reserve the worst case and let the flexible part
 * absorb the slack, rather than letting content decide the layout.
 */

/** The copy block is a fixed box: eyebrow + up to 2 title lines + up to 3 of
 *  body, measured at the widest phone wrap. Shorter copy leaves space rather
 *  than pulling the dots up. */
const TEXT_BLOCK_HEIGHT = 194;

/** One size for all three titles. Per-slide sizes were the design compensating
 *  for the longest string; the reserved block does that job now. */
const TITLE_SIZE = 28;

const BUTTON_HEIGHT = 55;
const BUTTON_GAP = 16;
/** Reserved on EVERY slide, not just the last, so the primary CTA does not jump
 *  when the second button appears. */
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
    hero: require('@/assets/images/onboarding-people-hero.webp'),
    eyebrow: 'FIND YOUR PEOPLE',
    title: 'Make Campus Feel Smaller',
    subtitle:
      "See who's going, discover communities you'll love, and turn new faces into familiar ones.",
  },
  {
    id: 'yours',
    hero: require('@/assets/images/onboarding-yours-hero.webp'),
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

  const isLastSlide = activeIndex >= SLIDES.length - 1;

  const goNext = () => {
    listRef.current?.scrollToIndex({ index: activeIndex + 1, animated: true });
  };

  // onScroll rather than onMomentumScrollEnd, which doesn't fire on web.
  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    setActiveIndex((prev) => (prev === next ? prev : next));
  };

  const renderSlide = ({ item, index }: ListRenderItemInfo<Slide>) => (
    <View style={{ width, height: '100%' }} className="items-center pt-[30px]">
      {/* The hero takes whatever the fixed blocks below do not, so the card
          scales with the device instead of overflowing a small one — and it is
          the same box on all three slides, which is what stops the shift. */}
      <View style={{ width: width - CARD_MARGIN * 2, flex: 1 }}>
        <Image source={item.hero} style={{ width: '100%', height: '100%' }} contentFit="contain" />
      </View>

      <View style={{ width: width - TEXT_MARGIN * 2, height: TEXT_BLOCK_HEIGHT, marginTop: 14 }}>
        <Text className="text-center font-roboto-bold text-[16px] text-lhlAccent">
          {item.eyebrow}
        </Text>

        <Text
          style={{ marginTop: 29, fontSize: TITLE_SIZE }}
          numberOfLines={2}
          className="text-center font-roboto-bold text-lhlInk"
        >
          {item.title}
        </Text>

        <Text
          style={{ marginTop: 12 }}
          numberOfLines={3}
          className="text-center font-roboto text-[16px] leading-[22px] text-lhlInk"
        >
          {item.subtitle}
        </Text>
      </View>

      {/* Active dot is a 32x13 pill, the rest 13px circles. */}
      <View className="flex-row items-center pb-2" style={{ gap: 10 }}>
        {SLIDES.map((slide, i) =>
          i === index ? (
            <View key={slide.id} className="h-[13px] w-8 rounded-full bg-lhlBurntOrange" />
          ) : (
            <View
              key={slide.id}
              className="h-[13px] w-[13px] rounded-full"
              style={{ backgroundColor: colors.placeholder }}
            />
          ),
        )}
      </View>
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-lhlBackgroundColor" edges={['top', 'bottom']}>
      <View className="flex-row items-center pt-6" style={{ gap: 13, paddingLeft: CARD_MARGIN }}>
        <LonghornLoopLogo size={35} />
        <Text className="font-roboto-bold text-[22px] text-lhlInk">Longhorn Loop</Text>
      </View>

      <FlatList
        ref={listRef}
        className="flex-1"
        data={SLIDES}
        keyExtractor={(s) => s.id}
        renderItem={renderSlide}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        // Every item is exactly one screen wide, so we can tell the list that
        // instead of making it measure — scrollToIndex warns without this.
        getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
      />

      {/* Fixed height: the last slide adds a button, and without the reservation
          that resize propagates up into the carousel and moves the artwork. */}
      <View className="px-5 pb-2 pt-4">
        <View style={{ height: FOOTER_HEIGHT, gap: BUTTON_GAP }}>
          <PrimaryButton
            label={isLastSlide ? 'Get Started' : 'Continue'}
            isFilled
            onPress={isLastSlide ? () => router.push('/RegisterPage') : goNext}
          />
          {isLastSlide && (
            <Pressable
              style={{ height: BUTTON_HEIGHT }}
              className="flex-row items-center justify-center rounded-lg border-2 border-lhlBorderColor bg-lhlSurface"
              onPress={() => router.push('/LoginPage')}
            >
              <Text className="font-roboto-semibold text-xl text-lhlAccent">
                Already Have an Account
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Dev-only bypass: skip auth and onboarding straight to the feed.
          Absolutely positioned so a dev build lays out identically to the one
          testers get — otherwise we tune spacing against a screen 20px shorter
          than the real thing. */}
      {__DEV__ && (
        <Pressable
          className="absolute bottom-1 left-0 right-0 items-center"
          onPress={() => {
            update({ firstName: 'Dev', lastName: 'User', email: 'dev@utexas.edu' });
            router.replace('/(tabs)/home');
          }}
        >
          <Text className="text-xs text-lhlMutedText underline">[DEV] Skip to Home</Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}
