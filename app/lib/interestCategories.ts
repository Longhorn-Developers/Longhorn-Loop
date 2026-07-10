// Shared interest categories and their tags. Used by:
//   - Onboarding InterestSelection screen
//   - Create Event Step 3
//
// NOTE: A category's `id` should match the DiscoveryBucketId when they overlap
// (music, arts, sports, etc.).

import ArtsIcon from '@/assets/images/arts_culture.svg';
import BallIcon from '@/assets/images/ball.svg';
import BusinessIcon from '@/assets/images/business.svg';
import FoodIcon from '@/assets/images/food&drink.svg';
import HealthIcon from '@/assets/images/health_wellness.svg';
import HandshakeIcon from '@/assets/images/ix_handshake.svg';
import LearningIcon from '@/assets/images/learning&ed.svg';
import MusicIcon from '@/assets/images/music.svg';
import NightlifeIcon from '@/assets/images/nightlife.svg';
import OutdoorsIcon from '@/assets/images/outdoors.svg';
import PerformingIcon from '@/assets/images/performing_arts.svg';
import ScienceIcon from '@/assets/images/science.svg';
import SpiritualityIcon from '@/assets/images/spirituality.svg';
import TechIcon from '@/assets/images/technology.svg';
import TravelIcon from '@/assets/images/travel.svg';
import VideoGameIcon from '@/assets/images/Video_Game.svg';
import React from 'react';
import { SvgProps } from 'react-native-svg';

export type InterestCategory = {
  id: string;
  label: string;
  // one liner used in Create Event Step 2 bucket cards.
  description: string;
  icon: React.FC<SvgProps>;
  tags: string[];
};

export const INTEREST_CATEGORIES: InterestCategory[] = [
  {
    id: 'music',
    label: 'Music',
    description: 'Concerts, DJ sets, & live performances',
    icon: MusicIcon,
    tags: [
      'Rock & Alternative',
      'Hip Hop & Rap',
      'Country & Folk',
      'Jazz & Blues',
      'Pop',
      'R&B & Soul',
      'Indie & Underground',
      'Latin & Reggaeton',
      'K-Pop & J-Pop',
    ],
  },
  {
    id: 'performing',
    label: 'Performing Arts',
    description: 'Comedy, theater, dance, & live shows',
    icon: PerformingIcon,
    tags: [
      'Comedy',
      'Theater & Musicals',
      'Classical & Opera',
      'Dance Performances',
      'Circus & Magic',
      'Poetry & Spoken Word',
    ],
  },
  {
    id: 'spirituality',
    label: 'Spirituality & Religion',
    description: 'Services, fellowship, & meditation groups',
    icon: SpiritualityIcon,
    tags: [
      'Meditation & Mindfulness',
      'Interfaith Events',
      'Buddhism',
      'Hinduism',
      'Christianity',
      'Judaism',
      'Islam',
    ],
  },
  {
    id: 'arts',
    label: 'Arts & Culture',
    description: 'Film, galleries, festivals, & pop culture',
    icon: ArtsIcon,
    tags: [
      'Film & Cinema',
      'Anime',
      'Pop Culture',
      'Visual Arts & Galleries',
      'Cultural Festivals',
      'Museum Tours',
    ],
  },
  {
    id: 'sports',
    label: 'Sports & Fitness',
    description: 'Team sports, fitness classes, & outdoor activities',
    icon: BallIcon,
    tags: [
      'Team Sports',
      'Racquet Sports',
      'Running & Endurance',
      'Cycling & Water Sports',
      'Yoga & Fitness Classes',
      'Combat Sports',
      'Golf',
      'Extreme & Adventure Sports',
    ],
  },
  {
    id: 'food',
    label: 'Food & Drink',
    description: 'Restaurant outings, coffee chats, & happy hours',
    icon: FoodIcon,
    tags: [
      'Cocktails, Wine, & Breweries',
      'Fine Dining',
      'Street Food & Food Trucks',
      'Vegan & Vegetarian',
      'Coffee, Tea & Baking',
      'International Cuisine',
      'Cooking Classes',
      'Food Festivals',
    ],
  },
  {
    id: 'tech',
    label: 'Technology & Innovation',
    description: 'Startups, hackathons, AI, & tech talks',
    icon: TechIcon,
    tags: [
      'Startup & Entrepreneurship',
      'AI & Machine Learning',
      'Hardware',
      'Web & App Development',
      'Cybersecurity',
      'VR & AR, & Robotics',
      'Hackathons & Tech Conferences',
    ],
  },
  {
    id: 'science',
    label: 'Science & Academia',
    description: 'Physics, biology, research, & academic talks',
    icon: ScienceIcon,
    tags: [
      'Physics & Astronomy',
      'Biology & Life Sciences',
      'Chemistry & Mathematics',
      'Psychology & Social Sciences',
      'Philosophy',
      'Academic Research',
    ],
  },
  {
    id: 'education',
    label: 'Education & Career',
    description: 'Career fairs, workshops, & study groups',
    icon: LearningIcon,
    tags: [
      'Career Fairs',
      'Workshops & Seminars',
      'Personal Development',
      'History & Archaeology',
      'Book Clubs & Study Groups',
      'Lectures & Online Courses',
    ],
  },
  {
    id: 'outdoors',
    label: 'Outdoors & Nature',
    description: 'Hiking, camping, & outdoor adventures',
    icon: OutdoorsIcon,
    tags: [
      'Hiking & Backpacking',
      'Camping',
      'Rock Climbing',
      'Kayaking & Canoeing',
      'Wildlife & Bird Watching',
      'Gardening & Fishing',
    ],
  },
  {
    id: 'gaming',
    label: 'Gaming & Entertainment',
    description: 'Esports, game nights, & tabletop',
    icon: VideoGameIcon,
    tags: [
      'Video Gaming',
      'Board Games',
      'Esports & Competitive Gaming',
      'VR & Immersive Gaming',
      'Role-Playing Games (RPG)',
      'Trivia Nights',
      'Escape Rooms',
    ],
  },
  {
    id: 'social',
    label: 'Social & Networking',
    description: 'Mixers, meetups, & social clubs',
    icon: HandshakeIcon,
    tags: [
      'Meetups & Mixers',
      'Singles & Dating',
      'LGBTQ+ Events',
      'Community Service',
      'Cultural Exchange',
      'Social Clubs',
    ],
  },
  {
    id: 'health',
    label: 'Health & Wellness',
    description: 'Wellness, therapy, gym, & mindfulness',
    icon: HealthIcon,
    tags: [
      'Mental Health & Therapy',
      'Gym',
      'Nutrition & Diet',
      'Mindfulness Practice',
      'Spa, Retreats & Relaxation',
    ],
  },
  {
    id: 'business',
    label: 'Business & Professional',
    description: 'Case comps, networking, & conferences',
    icon: BusinessIcon,
    tags: [
      'Case Competitions',
      'Networking & Conferences',
      'Leadership Development',
      'Sales & Marketing',
      'Finance & Investing',
      'Real Estate',
      'Project Management',
    ],
  },
  {
    id: 'travel',
    label: 'Travel & Adventure',
    description: 'Study abroad, road trips, & travel meetups',
    icon: TravelIcon,
    tags: ['Road Trips', 'Budget Travel', 'Travel Photography', 'Study Abroad'],
  },
  {
    id: 'nightlife',
    label: 'Nightlife & Parties',
    description: 'Bars, clubs, karaoke, & late-night events',
    icon: NightlifeIcon,
    tags: [
      'Clubs & Live DJ Sets',
      'Karaoke',
      'Themed Parties',
      'Raves & Electronic Music',
      'Happy Hour Events',
      'Silent Discos',
    ],
  },
];

// Flat list of every tag, in taxonomy order. Handy for search/autocomplete.
export const ALL_INTEREST_TAGS: string[] = INTEREST_CATEGORIES.flatMap((c) => c.tags);
