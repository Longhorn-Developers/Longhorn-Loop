// Shared interest categories and their tags. Used by:
//   - Onboarding InterestSelection screen
//   - Create Event Step 3
//
// A category's `id` should match the DiscoveryBucketId when they overlap
// (music, arts, sports, etc.). Campus-Wide has no matching category here
// since it's not an interest.

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
import React from 'react';
import { SvgProps } from 'react-native-svg';

export type InterestCategory = {
  id: string;
  label: string;
  icon: React.FC<SvgProps>;
  tags: string[];
};

export const INTEREST_CATEGORIES: InterestCategory[] = [
  {
    id: 'music',
    label: 'Music',
    icon: MusicIcon,
    tags: [
      'Rock & Alternative',
      'Hip Hop & Rap',
      'Electronic & EDM',
      'Country & Folk',
      'Jazz & Blues',
      'Classical & Opera',
      'Pop & Top 40',
      'R&B & Soul',
      'Indie & Underground',
      'Latin & Reggaeton',
      'K-Pop & J-Pop',
    ],
  },
  {
    id: 'arts',
    label: 'Arts & Culture',
    icon: ArtsIcon,
    tags: [
      'Art Exhibitions & Galleries',
      'Theater & Broadway',
      'Dance Performances',
      'Film & Cinema',
      'Photography',
      'Sculpture & Installation Art',
      'Poetry & Spoken Word',
      'Street Art & Graffiti',
      'Cultural Festivals',
      'Museum Tours',
      'Anime',
    ],
  },
  {
    id: 'sports',
    label: 'Sports & Fitness',
    icon: BallIcon,
    tags: [
      'Football & Soccer',
      'Basketball',
      'Baseball & Softball',
      'Tennis & Racquet Sports',
      'Running & Marathon',
      'Yoga & Meditation',
      'Cycling & Biking',
      'Swimming & Water Sports',
      'Martial Arts & Boxing',
      'Extreme Sports',
      'Golf',
      'CrossFit & HIIT',
    ],
  },
  {
    id: 'food',
    label: 'Food & Drink',
    icon: FoodIcon,
    tags: [
      'Wine Tasting',
      'Craft Beer & Breweries',
      'Cocktails & Mixology',
      'Fine Dining',
      'Street Food & Food Trucks',
      'Vegan & Vegetarian',
      'Coffee & Tea',
      'Baking & Pastries',
      'International Cuisine',
      'Cooking Classes',
      'Food Festivals',
    ],
  },
  {
    id: 'tech',
    label: 'Technology & Innovation',
    icon: TechIcon,
    tags: [
      'Startup & Entrepreneurship',
      'AI & Machine Learning',
      'Blockchain & Crypto',
      'Web Development',
      'Mobile Apps',
      'Cybersecurity',
      'Gaming & Esports',
      'VR & AR',
      'Robotics',
      'Tech Conferences',
      'Hackathons',
    ],
  },
  {
    id: 'learning',
    label: 'Learning & Education',
    icon: LearningIcon,
    tags: [
      'Workshops & Seminars',
      'Language Learning',
      'Personal Development',
      'Career & Professional Growth',
      'Science & Research',
      'History & Archaeology',
      'Book Clubs',
      'Study Groups',
      'Online Courses',
      'Academic Lectures',
      'Undergraduate Research',
    ],
  },
  {
    id: 'outdoors',
    label: 'Outdoors & Nature',
    icon: OutdoorsIcon,
    tags: [
      'Hiking & Trekking',
      'Camping',
      'Rock Climbing',
      'Kayaking & Canoeing',
      'Wildlife & Bird Watching',
      'Gardening',
      'Beach Activities',
      'Fishing',
      'Environmental Conservation',
    ],
  },
  {
    id: 'gaming',
    label: 'Gaming & Entertainment',
    icon: VideoGameIcon,
    tags: [
      'Video Gaming',
      'Board Games & Tabletop',
      'Card Games',
      'Esports Tournaments',
      'Virtual Reality Gaming',
      'Retro Gaming',
      'Role-Playing Games (RPG)',
      'Trivia Nights',
      'Escape Rooms',
      'Comedy Shows',
    ],
  },
  {
    id: 'social',
    label: 'Social & Networking',
    icon: HandshakeIcon,
    tags: [
      'Meetups & Mixers',
      'Speed Networking',
      'Singles & Dating',
      'LGBTQ+ Events',
      "Women's Networking",
      'Young Professionals',
      'Alumni Gatherings',
      'Community Service',
      'Cultural Exchange',
      'Social Clubs',
    ],
  },
  {
    id: 'health',
    label: 'Health & Wellness',
    icon: HealthIcon,
    tags: [
      'Mental Health & Therapy',
      'Nutrition & Diet',
      'Wellness Retreats',
      'Spa & Relaxation',
      'Alternative Medicine',
      'Mindfulness & Meditation',
      'Fitness Challenges',
      'Weight Loss Support',
      'Holistic Health',
      'Sleep & Recovery',
    ],
  },
  {
    id: 'shopping',
    label: 'Shopping & Fashion',
    icon: ShoppingIcon,
    tags: [
      'Fashion Shows',
      'Vintage & Thrift',
      'Luxury & Designer',
      'Streetwear',
      'Sustainable Fashion',
      'Jewelry & Accessories',
      'Pop-Up Shops',
      'Sample Sales',
      'Beauty & Makeup',
      'Fashion Markets',
    ],
  },
  {
    id: 'business',
    label: 'Business & Professional',
    icon: BusinessIcon,
    tags: [
      'Career Fairs',
      'Case Competitions',
      'Conferences & Summits',
      'Trade Shows',
      'Leadership Development',
      'Sales & Marketing',
      'Finance & Investing',
      'Real Estate',
      'Legal & Compliance',
      'Human Resources',
      'Project Management',
      'B2B Networking',
    ],
  },
  {
    id: 'performing',
    label: 'Performing Arts',
    icon: PerformingIcon,
    tags: [
      'Stand-Up Comedy',
      'Improv & Sketch',
      'Musical Theater',
      'Opera & Classical Performance',
      'Magic Shows',
      'Circus & Acrobatics',
      'Live Performance Art',
    ],
  },
  {
    id: 'travel',
    label: 'Travel & Adventure',
    icon: TravelIcon,
    tags: [
      'Travel Meetups',
      'Adventure Travel',
      'Backpacking',
      'Road Trips',
      'Cultural Tours',
      'Luxury Travel',
      'Solo Travel',
      'Budget Travel',
      'Travel Photography',
      'Study Abroad',
    ],
  },
  {
    id: 'pets',
    label: 'Pets & Animals',
    icon: PetsIcon,
    tags: [
      'Dog Meetups & Walks',
      'Cat Cafes & Events',
      'Pet Adoption Events',
      'Exotic Pets',
      'Pet Training',
      'Animal Rescue & Advocacy',
      'Wildlife Conservation',
      'Aquarium & Fish Keeping',
      'Pet-Friendly Activities',
    ],
  },
  {
    id: 'home',
    label: 'Home & Lifestyle',
    icon: HomeIcon,
    tags: [
      'Interior Design',
      'DIY & Home Improvement',
      'Real Estate & Housing',
      'Sustainable Living',
      'Minimalism',
      'Organization & Decluttering',
      'Home Decor',
      'Smart Home Technology',
    ],
  },
  {
    id: 'nightlife',
    label: 'Nightlife & Parties',
    icon: NightlifeIcon,
    tags: [
      'Clubs & Dancing',
      'Bar Hopping',
      'Live DJ Sets',
      'Karaoke',
      'Themed Parties',
      'Raves & Electronic Music',
      'Pub Quizzes',
      'Rooftop Bars',
      'Happy Hour Events',
      'Silent Discos',
    ],
  },
  {
    id: 'science',
    label: 'Science & Academia',
    icon: ScienceIcon,
    tags: [
      'Physics & Astronomy',
      'Biology & Life Sciences',
      'Chemistry',
      'Mathematics',
      'Psychology',
      'Social Sciences',
      'Philosophy',
      'Research Symposiums',
      'Science Cafes',
      'Lab Tours & Demos',
    ],
  },
  {
    id: 'spirituality',
    label: 'Spirituality & Religion',
    icon: SpiritualityIcon,
    tags: [
      'Meditation & Mindfulness',
      'Yoga & Spiritual Practice',
      'Religious Services',
      'Interfaith Dialogue',
      'Buddhist Teachings',
      'Christian Fellowship',
      'Jewish Community Events',
      'Islamic Gatherings',
      'New Age & Metaphysical',
      'Prayer Groups',
    ],
  },
];

// Flat list of every tag, in taxonomy order. Handy for search/autocomplete.
export const ALL_INTEREST_TAGS: string[] = INTEREST_CATEGORIES.flatMap((c) => c.tags);
