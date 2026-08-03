import LonghornLoopLogo from '@/app/components/icons/LonghornLoopLogo';
import { useOnboarding } from '@/app/context/OnboardingContext';
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

// Inactive pagination dot. Fixed brand colour, not a theme token.
const DOT_INACTIVE = '#E8E3DC';

// The cream card and its shadow are baked into each hero image, so heroAspect
// is the image's own ratio.
interface Slide {
  id: string;
  hero: ImageSource;
  heroAspect: number;
  eyebrow: string;
  title: string;
  titleSize: number;
  subtitle: string;
}

const SLIDES: Slide[] = [
  {
    id: 'campus',
    hero: require('@/assets/images/onboarding-explore-hero.webp'),
    heroAspect: 634 / 742,
    eyebrow: 'STAY IN THE LOOP',
    title: 'Campus, all in one place',
    titleSize: 30,
    subtitle: "Every UT event and org, sorted by what's close, what's next, and what's worth your time.",
  },
  {
    id: 'people',
    hero: require('@/assets/images/onboarding-people-hero.webp'),
    heroAspect: 626 / 656,
    eyebrow: 'FIND YOUR PEOPLE',
    title: 'Make Campus Feel Smaller',
    titleSize: 26,
    subtitle: "See who's going, discover communities you'll love, and turn new faces into familiar ones.",
  },
  {
    id: 'yours',
    hero: require('@/assets/images/onboarding-yours-hero.webp'),
    heroAspect: 624 / 656,
    eyebrow: 'MAKE IT YOURS',
    title: 'Your Loop, Your Path',
    titleSize: 30,
    subtitle: 'Loop learns what matters to you and builds a feed around your interests.',
  },
];

export default function FrontPage() {
  const router = useRouter();
  const { update } = useOnboarding();
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
    <View style={{ width }} className="items-center pt-[30px]">
      <Image
        source={item.hero}
        style={{ width: width - CARD_MARGIN * 2, aspectRatio: item.heroAspect }}
        contentFit="contain"
      />

      <View style={{ width: width - TEXT_MARGIN * 2, marginTop: 14 }}>
        <Text className="text-center font-roboto-bold text-[16px] text-lhlBurntOrange">
          {item.eyebrow}
        </Text>

        <Text
          style={{ marginTop: 29, fontSize: item.titleSize }}
          className="text-center font-roboto-bold text-lhlInk"
        >
          {item.title}
        </Text>

        <Text
          style={{ marginTop: 12 }}
          className="text-center font-roboto text-[16px] leading-[22px] text-lhlInk"
        >
          {item.subtitle}
        </Text>
      </View>

      {/* Active dot is a 32x13 pill, the rest 13px circles. */}
      <View className="flex-row items-center" style={{ gap: 10, marginTop: 32 }}>
        {SLIDES.map((slide, i) =>
          i === index ? (
            <View key={slide.id} className="h-[13px] w-8 rounded-full bg-lhlBurntOrange" />
          ) : (
            <View
              key={slide.id}
              className="h-[13px] w-[13px] rounded-full"
              style={{ backgroundColor: DOT_INACTIVE }}
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
      />

      {/* Last slide swaps the single Continue for the two auth CTAs. */}
      <View className="gap-4 px-5 pb-2 pt-4">
        {isLastSlide ? (
          <>
            <PrimaryButton label="Get Started" isFilled onPress={() => router.push('/RegisterPage')} />
            <Pressable
              className="h-[55px] flex-row items-center justify-center rounded-lg border-2 border-lhlBorderColor bg-lhlSurface"
              onPress={() => router.push('/LoginPage')}
            >
              <Text className="font-roboto-semibold text-xl text-lhlBurntOrange">
                Already Have an Account
              </Text>
            </Pressable>
          </>
        ) : (
          <PrimaryButton label="Continue" isFilled onPress={goNext} />
        )}
      </View>

      {/* Dev-only bypass: skip auth and onboarding straight to the feed. */}
      {__DEV__ && (
        <Pressable
          className="items-center pb-2"
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
