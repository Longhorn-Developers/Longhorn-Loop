import { useOnboarding } from '@/app/context/OnboardingContext';
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
import SearchIcon from '@/assets/images/search_icon_create_acc.svg';
import ShoppingIcon from '@/assets/images/shopping_fashion.svg';
import SpiritualityIcon from '@/assets/images/spirituality.svg';
import TechIcon from '@/assets/images/technology.svg';
import TravelIcon from '@/assets/images/travel.svg';
import VideoGameIcon from '@/assets/images/Video_Game.svg';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import InlineAlert from '../components/alerts/InlineAlert';
import PrimaryButton from '../components/buttons/PrimaryButton';
import PillDropdownField from '../components/inputs/PillDropdownField';
import SearchablePillDropdownField from '../components/inputs/SearchablePillDropdownField';
import FlowLayout from '../components/layouts/FlowLayout';

interface Category {
  id: string;
  label: string;
  icon: React.ComponentType<any>;
  tags: string[];
}

const CATEGORIES: Category[] = [
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

export default function CategorySelectorScreen() {
  const router = useRouter();
  const { update } = useOnboarding();

  const [inlineError, setInlineError] = useState('');

  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  const allGlobalTags = useMemo(() => {
    const tagSet = new Set<string>();
    CATEGORIES.forEach((category) => {
      category.tags.forEach((tag) => tagSet.add(tag));
    });
    return Array.from(tagSet);
  }, []);

  const handleToggleDropdown = (id: string) => {
    setOpenDropdownId((prev) => (prev === id ? null : id));
  };

  const handleSubmit = () => {
    if (selectedTags.length === 0) {
      setInlineError('Please select at least one tag.');
      return;
    }

    setInlineError('');

    update({
      selectedTags,
    });

    router.push('/Avatar');
  };

  const allFilled = selectedTags.length > 0;

  return (
    <FlowLayout
      title="Tell Us About You!"
      subTitle="Pick tags from any category and we'll use them to customize your experience."
      onBackPress={() => router.back()}
      showProgressBar={true}
      startingPercentage={25}
      progressBarPercentage={50}
      footer={
        <View className="mt-[16px] mb-[42px]">
          <PrimaryButton label="Next" isFilled={allFilled} onPress={handleSubmit} />
        </View>
      }
    >
      {inlineError && (
        <View className="mt-4">
          <InlineAlert message={inlineError} />
        </View>
      )}

      <View className="mt-[16px]">
        <SearchablePillDropdownField
          leftIcon={<SearchIcon width={15} height={15} fill="#a3a3a3" />}
          placeholder="Search for interests, events, activities..."
          options={allGlobalTags}
          selectedValues={selectedTags}
          onSelect={setSelectedTags}
        />
      </View>

      <View className="mt-[16px] gap-[16px]">
        {CATEGORIES.map((category) => {
          const IconComponent = category.icon;

          const currentCategorySelectedTags = selectedTags.filter((tag) =>
            category.tags.includes(tag),
          );

          const handleCategorySelect = (updatedCategoryTags: string[]) => {
            const cleanGlobalTags = selectedTags.filter((tag) => !category.tags.includes(tag));
            setSelectedTags([...cleanGlobalTags, ...updatedCategoryTags]);
          };

          return (
            <View key={category.id}>
              <PillDropdownField
                titleText={category.label}
                leftIcon={<IconComponent width={16} height={16} />}
                options={category.tags}
                selectedValues={currentCategorySelectedTags}
                onSelect={handleCategorySelect}
                isOpen={openDropdownId === category.id}
                onToggle={() => handleToggleDropdown(category.id)}
              />
            </View>
          );
        })}
      </View>
    </FlowLayout>
  );
}
