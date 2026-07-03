import CheckIcon from '@/assets/images/check-selected.svg';
import ArtsIcon from '@/assets/images/arts_culture.svg';
import BallIcon from '@/assets/images/ball.svg';
import BusinessIcon from '@/assets/images/business.svg';
import FoodIcon from '@/assets/images/food&drink.svg';
import HealthIcon from '@/assets/images/health_wellness.svg';
import HomeIcon from '@/assets/images/home_lifestyle.svg';
import HandshakeIcon from '@/assets/images/ix_handshake.svg';
import LearningIcon from '@/assets/images/learning&ed.svg';
import MusicIcon from '@/assets/images/music.svg';
import NightlifeIcon from '@/assets/images/nightlife.svg';
import OutdoorsIcon from '@/assets/images/outdoors.svg';
import PerformingIcon from '@/assets/images/performing_arts.svg';
import PetsIcon from '@/assets/images/pets.svg';
import ScienceIcon from '@/assets/images/science.svg';
import ShoppingIcon from '@/assets/images/shopping_fashion.svg';
import SpiritualityIcon from '@/assets/images/spirituality.svg';
import TechIcon from '@/assets/images/technology.svg';
import TravelIcon from '@/assets/images/travel.svg';
import VideoGameIcon from '@/assets/images/Video_Game.svg';
import { useCreateEvent } from '@/app/context/CreateEventContext';
import type { DiscoveryBucketId } from '@/app/context/CreateEventContext';
import { useRouter } from 'expo-router';
import React from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SvgProps } from 'react-native-svg';

type Bucket = {
  id: DiscoveryBucketId;
  title: string;
  description: string;
  Icon: React.FC<SvgProps>;
  iconSize: { width: number; height: number };
};

const DEFAULT_ICON_SIZE = { width: 22, height: 22 };

const BUCKETS: Bucket[] = [
  {
    id: 'music',
    title: 'Music',
    description: 'Concerts, DJ sets, & live performances',
    Icon: MusicIcon,
    iconSize: DEFAULT_ICON_SIZE,
  },
  {
    id: 'arts',
    title: 'Arts & Culture',
    description: 'Galleries, theater, film, & cultural festivals',
    Icon: ArtsIcon,
    iconSize: DEFAULT_ICON_SIZE,
  },
  {
    id: 'sports',
    title: 'Sports & Fitness',
    description: 'Workout classes, sports, & outdoor activities',
    Icon: BallIcon,
    iconSize: DEFAULT_ICON_SIZE,
  },
  {
    id: 'food',
    title: 'Food & Drink',
    description: 'Restaurant outings, coffee chats, & happy hours',
    Icon: FoodIcon,
    iconSize: DEFAULT_ICON_SIZE,
  },
  {
    id: 'tech',
    title: 'Technology & Innovation',
    description: 'Startups, hackathons, & tech talks',
    Icon: TechIcon,
    iconSize: DEFAULT_ICON_SIZE,
  },
  {
    id: 'learning',
    title: 'Learning & Education',
    description: 'Workshops, study sessions, & career events',
    Icon: LearningIcon,
    iconSize: DEFAULT_ICON_SIZE,
  },
  {
    id: 'outdoors',
    title: 'Outdoors & Nature',
    description: 'Hiking, camping, & outdoor adventures',
    Icon: OutdoorsIcon,
    iconSize: DEFAULT_ICON_SIZE,
  },
  {
    id: 'gaming',
    title: 'Gaming & Entertainment',
    description: 'Esports, game nights, & live entertainment',
    Icon: VideoGameIcon,
    iconSize: DEFAULT_ICON_SIZE,
  },
  {
    id: 'social',
    title: 'Social & Networking',
    description: 'Mixers, parties, & hangouts',
    Icon: HandshakeIcon,
    iconSize: DEFAULT_ICON_SIZE,
  },
  {
    id: 'health',
    title: 'Health & Wellness',
    description: 'Mindfulness, wellness, & mental health',
    Icon: HealthIcon,
    iconSize: DEFAULT_ICON_SIZE,
  },
  {
    id: 'shopping',
    title: 'Shopping & Fashion',
    description: 'Pop-ups, markets, & fashion shows',
    Icon: ShoppingIcon,
    iconSize: DEFAULT_ICON_SIZE,
  },
  {
    id: 'business',
    title: 'Business & Professional',
    description: 'Career fairs, conferences, & networking',
    Icon: BusinessIcon,
    iconSize: DEFAULT_ICON_SIZE,
  },
  {
    id: 'performing',
    title: 'Performing Arts',
    description: 'Comedy, improv, theater, & live shows',
    Icon: PerformingIcon,
    iconSize: DEFAULT_ICON_SIZE,
  },
  {
    id: 'travel',
    title: 'Travel & Adventure',
    description: 'Trips, meetups, & travel talks',
    Icon: TravelIcon,
    iconSize: DEFAULT_ICON_SIZE,
  },
  {
    id: 'pets',
    title: 'Pets & Animals',
    description: 'Pet meetups, adoptions, & animal events',
    Icon: PetsIcon,
    iconSize: DEFAULT_ICON_SIZE,
  },
  {
    id: 'home',
    title: 'Home & Lifestyle',
    description: 'DIY, decor, & sustainable living',
    Icon: HomeIcon,
    iconSize: DEFAULT_ICON_SIZE,
  },
  {
    id: 'nightlife',
    title: 'Nightlife & Parties',
    description: 'Bars, parties, clubs, & late-night events',
    Icon: NightlifeIcon,
    iconSize: DEFAULT_ICON_SIZE,
  },
  {
    id: 'science',
    title: 'Science & Academia',
    description: 'Lectures, research talks, & symposiums',
    Icon: ScienceIcon,
    iconSize: DEFAULT_ICON_SIZE,
  },
  {
    id: 'spirituality',
    title: 'Spirituality & Religion',
    description: 'Services, fellowship, & meditation groups',
    Icon: SpiritualityIcon,
    iconSize: DEFAULT_ICON_SIZE,
  },
];

const BURNT_ORANGE = '#9D4A06';
const BLACK = '#020B12';
const BORDER = '#D9D9D9';
const CARD_BG = '#FFFFFF';
const CARD_BG_SELECTED = '#FFF5E5';
const AVATAR_BG = '#E9E6E2';
const AVATAR_BG_SELECTED = '#EEA26480';
const BG = '#F9F8F5';
const TEXT_SECONDARY = '#485656';

export default function DiscoveryBucket() {
  const router = useRouter();
  const { data, update } = useCreateEvent();
  const selectedId = data.discoveryBucket;
  const canContinue = selectedId !== null;

  const onContinue = () => {
    if (!canContinue) return;
    router.push('/(create-event)/InterestTags');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Create an Event</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.stepBlock}>
          <Text style={styles.stepLabel}>STEP 2 OF 6</Text>
          <Text style={styles.stepTitle}>Choose a Discovery Bucket</Text>
        </View>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: '33.33%' }]} />
        </View>

        <Text style={styles.instruction}>Buckets help your event reach the right audience.</Text>

        <View style={styles.bucketList}>
          {BUCKETS.map((bucket) => {
            const isSelected = bucket.id === selectedId;
            const { Icon, iconSize } = bucket;
            return (
              <TouchableOpacity
                key={bucket.id}
                activeOpacity={0.85}
                onPress={() => {
                  // Clear interest tags when the bucket changes — the tag
                  // list on step 3 is derived from the bucket's category,
                  // so previous picks wouldn't be visible anyway.
                  const changing = bucket.id !== data.discoveryBucket;
                  update({
                    discoveryBucket: bucket.id,
                    ...(changing ? { interestTags: [] } : {}),
                  });
                }}
                style={[styles.bucketCard, isSelected && styles.bucketCardSelected]}
              >
                <View style={[styles.avatar, isSelected && styles.avatarSelected]}>
                  <Icon
                    width={iconSize.width}
                    height={iconSize.height}
                    color={isSelected ? BURNT_ORANGE : BLACK}
                  />
                </View>
                <View style={styles.bucketText}>
                  <Text style={styles.bucketTitle}>{bucket.title}</Text>
                  <Text style={styles.bucketDescription}>{bucket.description}</Text>
                </View>
                {isSelected && <CheckIcon width={19} height={14} color={BURNT_ORANGE} />}
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          onPress={onContinue}
          activeOpacity={canContinue ? 0.85 : 1}
          disabled={!canContinue}
          style={[styles.continueButton, canContinue && styles.continueButtonEnabled]}
        >
          <Text style={[styles.continueText, canContinue && styles.continueTextEnabled]}>
            Continue
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  backArrow: {
    fontSize: 22,
    color: '#000000',
  },
  headerTitle: {
    fontSize: 19,
    fontWeight: '600',
    color: '#000000',
    letterSpacing: -0.5,
  },
  headerSpacer: {
    width: 22,
  },
  stepBlock: {
    marginBottom: 18,
  },
  stepLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: TEXT_SECONDARY,
    letterSpacing: 1,
    marginBottom: 6,
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: '500',
    color: '#000000',
  },
  progressTrack: {
    height: 10,
    backgroundColor: '#E5E1DA',
    borderRadius: 999,
    overflow: 'hidden',
    marginBottom: 20,
  },
  progressFill: {
    height: '100%',
    backgroundColor: BURNT_ORANGE,
    borderRadius: 999,
  },
  instruction: {
    fontSize: 14,
    color: '#000000',
    lineHeight: 20,
    marginBottom: 24,
  },
  bucketList: {
    gap: 12,
    marginBottom: 24,
  },
  bucketCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD_BG,
  },
  bucketCardSelected: {
    borderColor: BURNT_ORANGE,
    backgroundColor: CARD_BG_SELECTED,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: AVATAR_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarSelected: {
    backgroundColor: AVATAR_BG_SELECTED,
  },
  bucketText: {
    flex: 1,
    gap: 2,
  },
  bucketTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
  },
  bucketDescription: {
    fontSize: 12,
    color: '#000000',
  },
  continueButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#00000033',
    backgroundColor: CARD_BG,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueButtonEnabled: {
    backgroundColor: BURNT_ORANGE,
    borderColor: BURNT_ORANGE,
  },
  continueText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#020B12',
  },
  continueTextEnabled: {
    color: '#FFFFFF',
  },
});
