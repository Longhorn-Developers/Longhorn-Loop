import LonghornLoopLogo from '@/app/components/icons/LonghornLoopLogo';
import { useThemeColors } from '@/app/lib/themeColors';
import { Image, type ImageSource } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  FlatList,
  ListRenderItemInfo,
  Pressable,
  StyleSheet,
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

// Two lines are reserved for the title whether or not this slide needs them.
// "Make Campus Feel Smaller" wraps to two; the other two titles are one line —
// so without the reservation the pagination and the CTA below it sat 33pt lower
// on slide two and hopped back up on slide three. Only the title is pinned, not
// the whole copy block: the title is the part that actually varies today, and
// reserving the block wholesale is what left the slack under the short slides.
const TITLE_LINE_HEIGHT = 34;
const TITLE_BLOCK_HEIGHT = TITLE_LINE_HEIGHT * 2;

// The text block is content-sized, not the old fixed 194px (the height of the
// tallest possible copy), which left ~50px of slack below shorter slides.
// Trimmed from 32 alongside the other margins in this file to close the gap
// against a real-device comparison against Figma -- see PAGINATION_BUTTON_GAP.
const TEXT_PILL_GAP = 20;

// Keeps the hero from shrinking when the bottom content takes up more room.
const HERO_HEIGHT_RATIO = 0.86;

// The artwork's own aspect ratio, from the 312x328 Figma card. The hero box is
// declared at this ratio rather than filling the band, so all three slides draw
// the card at exactly one size.
//
// Without it the box is the full band and `contentFit="contain"` sizes each
// image against whichever edge it hits first — so an asset exported at a
// different ratio silently renders taller and narrower than its neighbours, and
// the art appears to change size as you swipe. That is what happened when slide
// one was still on the old 634x742 export while slides two and three had moved
// to 936x984: same box, three different pictures inside it.
//
// Declared here it is the box that is fixed. A future asset at the wrong ratio
// letterboxes inside a constant frame, which reads as a smaller picture rather
// than as the layout moving.
const HERO_ASPECT = 312 / 328;

const BUTTON_HEIGHT = 55;
const BUTTON_GAP = 16;

// Figma's 90 was measured against the old fixed-height text block. Against
// the content-sized one, and now that this is a genuinely fixed gap (not a
// `flex: 1` spacer -- see where it's used below), 90 sat the CTAs noticeably
// lower than the mock: measured against a real device screenshot, the total
// margin/gap stack between the hero and the buttons was running ~70-90px
// heavier than Figma even with the old flex approach, because on most phones
// there was no slack left for a growing spacer to collapse into -- it was
// already at its floor. Trimmed here and at the other margins in this file
// that aren't protecting against a specific bug (TITLE_BLOCK_HEIGHT's
// reservation is; this isn't).
const PAGINATION_BUTTON_GAP = 20;

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
    hero: require('@/assets/images/onboarding-explore-feed.webp'),
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
  const colors = useThemeColors();
  const { width } = useWindowDimensions();

  const listRef = useRef<FlatList<Slide>>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const activeSlide = SLIDES[activeIndex];
  const isLastSlide = activeIndex === SLIDES.length - 1;
  const heroBandHeight = width * HERO_HEIGHT_RATIO;

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
  //
  // The cell is the height of the artwork band, not of the list. The list is
  // taller than the band now (it reaches down over the copy, so that area
  // swipes too) and a full-height cell would stretch the picture into it.
  const renderHero = ({ item }: ListRenderItemInfo<Slide>) => (
    <View
      style={{
        width,
        height: heroBandHeight,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: width - CARD_MARGIN * 2,
          aspectRatio: HERO_ASPECT,
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

      {/* The artwork and the copy share one box, and the carousel is stretched
          across the whole of it.

          Only the art moved before, because the list was only as tall as the
          art — so a swipe that started on the heading, which is where a thumb
          naturally lands, hit a plain View and did nothing. The picture being
          the only live target is not something a user can see; they just find
          that the gesture works in one place and not in another an inch below.

          So: the band and the copy sit in normal flow and size this box between
          them, and the list is laid over the top of both. Its cells draw the
          art in the band and leave the rest transparent, which is what lets the
          copy underneath show through. The copy is not inside the list — it
          still belongs to activeIndex and still stays put while you swipe. The
          list is only here to catch the gesture. */}
      <View style={{ marginTop: 18 }}>
        <View style={{ height: heroBandHeight }} />

        {/* This stays in place. Only the words change. */}
        <View
          style={{
            width: width - TEXT_MARGIN * 2,
            alignSelf: 'center',
            marginTop: 10,
          }}
        >
          <Text className="text-center font-roboto-bold text-[16px] text-lhlAccent">
            {activeSlide.eyebrow}
          </Text>

          <Text
            style={{
              marginTop: 18,
              fontSize: TITLE_SIZE,
              lineHeight: TITLE_LINE_HEIGHT,
              height: TITLE_BLOCK_HEIGHT,
            }}
            numberOfLines={2}
            className="text-center font-roboto-bold text-lhlInk"
          >
            {activeSlide.title}
          </Text>

          <Text
            style={{
              marginTop: 8,
            }}
            numberOfLines={3}
            className="text-center font-roboto text-[16px] leading-[22px] text-lhlInk"
          >
            {activeSlide.subtitle}
          </Text>
        </View>

        <FlatList
          ref={listRef}
          style={StyleSheet.absoluteFill}
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

      {/*
        FIXED 48pt gap, not a growing spacer.

        That was tried: a `flex: 1` spacer here pins the footer to the bottom
        of the screen, which keeps a consistent distance from the bottom edge
        but pushes Continue/Get Started well below where the Figma puts it —
        the buttons should sit close under the pagination dots, with slack
        left over at the bottom of the screen, not the other way around.
        Matches PAGINATION_BUTTON_GAP's own original intent above.
      */}
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

      {/*
        The [DEV] Skip to Home bypass lived here. Removed for the tester
        build, and not only because testers should not see it: it wrote a fake
        name and email into the session and navigated to the tabs WITHOUT a
        token, which is the exact signed-out-but-inside state AuthGate now
        exists to prevent. Keeping it would have meant a deliberate hole
        beside the guard closing the accidental one.
      */}
    </SafeAreaView>
  );
}
