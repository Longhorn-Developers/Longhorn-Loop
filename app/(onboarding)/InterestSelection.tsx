import ArtsIcon from '@/assets/images/arts_culture.svg';
import BallIcon from '@/assets/images/ball.svg';
import BusinessIcon from '@/assets/images/business.svg';
import DropdownArrow from '@/assets/images/dropdown-arrow.svg';
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
import { useOnboarding } from '@/app/context/OnboardingContext';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  Keyboard,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SvgProps } from 'react-native-svg';

type Category = {
  id: string;
  label: string;
  icon: React.FC<SvgProps>;
  tags: string[];
};

const CATEGORIES: Category[] = [
  { id: 'music', label: 'Music', icon: MusicIcon, tags: ['Rock & Alternative', 'Hip Hop & Rap', 'Electronic & EDM', 'Country & Folk', 'Jazz & Blues', 'Classical & Opera', 'Pop & Top 40', 'R&B & Soul', 'Indie & Underground', 'Latin & Reggaeton', 'K-Pop & J-Pop'] },
  { id: 'arts', label: 'Arts & Culture', icon: ArtsIcon, tags: ['Art Exhibitions & Galleries', 'Theater & Broadway', 'Dance Performances', 'Film & Cinema', 'Photography', 'Sculpture & Installation Art', 'Poetry & Spoken Word', 'Street Art & Graffiti', 'Cultural Festivals', 'Museum Tours', 'Anime'] },
  { id: 'sports', label: 'Sports & Fitness', icon: BallIcon, tags: ['Football & Soccer', 'Basketball', 'Baseball & Softball', 'Tennis & Racquet Sports', 'Running & Marathon', 'Yoga & Meditation', 'Cycling & Biking', 'Swimming & Water Sports', 'Martial Arts & Boxing', 'Extreme Sports', 'Golf', 'CrossFit & HIIT'] },
  { id: 'food', label: 'Food & Drink', icon: FoodIcon, tags: ['Wine Tasting', 'Craft Beer & Breweries', 'Cocktails & Mixology', 'Fine Dining', 'Street Food & Food Trucks', 'Vegan & Vegetarian', 'Coffee & Tea', 'Baking & Pastries', 'International Cuisine', 'Cooking Classes', 'Food Festivals'] },
  { id: 'tech', label: 'Technology & Innovation', icon: TechIcon, tags: ['Startup & Entrepreneurship', 'AI & Machine Learning', 'Blockchain & Crypto', 'Web Development', 'Mobile Apps', 'Cybersecurity', 'Gaming & Esports', 'VR & AR', 'Robotics', 'Tech Conferences', 'Hackathons'] },
  { id: 'learning', label: 'Learning & Education', icon: LearningIcon, tags: ['Workshops & Seminars', 'Language Learning', 'Personal Development', 'Career & Professional Growth', 'Science & Research', 'History & Archaeology', 'Book Clubs', 'Study Groups', 'Online Courses', 'Academic Lectures', 'Undergraduate Research'] },
  { id: 'outdoors', label: 'Outdoors & Nature', icon: OutdoorsIcon, tags: ['Hiking & Trekking', 'Camping', 'Rock Climbing', 'Kayaking & Canoeing', 'Wildlife & Bird Watching', 'Gardening', 'Beach Activities', 'Fishing', 'Environmental Conservation'] },
  { id: 'gaming', label: 'Gaming & Entertainment', icon: VideoGameIcon, tags: ['Video Gaming', 'Board Games & Tabletop', 'Card Games', 'Esports Tournaments', 'Virtual Reality Gaming', 'Retro Gaming', 'Role-Playing Games (RPG)', 'Trivia Nights', 'Escape Rooms', 'Comedy Shows'] },
  { id: 'social', label: 'Social & Networking', icon: HandshakeIcon, tags: ['Meetups & Mixers', 'Speed Networking', 'Singles & Dating', 'LGBTQ+ Events', "Women's Networking", 'Young Professionals', 'Alumni Gatherings', 'Community Service', 'Cultural Exchange', 'Social Clubs'] },
  { id: 'health', label: 'Health & Wellness', icon: HealthIcon, tags: ['Mental Health & Therapy', 'Nutrition & Diet', 'Wellness Retreats', 'Spa & Relaxation', 'Alternative Medicine', 'Mindfulness & Meditation', 'Fitness Challenges', 'Weight Loss Support', 'Holistic Health', 'Sleep & Recovery'] },
  { id: 'shopping', label: 'Shopping & Fashion', icon: ShoppingIcon, tags: ['Fashion Shows', 'Vintage & Thrift', 'Luxury & Designer', 'Streetwear', 'Sustainable Fashion', 'Jewelry & Accessories', 'Pop-Up Shops', 'Sample Sales', 'Beauty & Makeup', 'Fashion Markets'] },
  { id: 'business', label: 'Business & Professional', icon: BusinessIcon, tags: ['Career Fairs', 'Case Competitions', 'Conferences & Summits', 'Trade Shows', 'Leadership Development', 'Sales & Marketing', 'Finance & Investing', 'Real Estate', 'Legal & Compliance', 'Human Resources', 'Project Management', 'B2B Networking'] },
  { id: 'performing', label: 'Performing Arts', icon: PerformingIcon, tags: ['Stand-Up Comedy', 'Improv & Sketch', 'Musical Theater', 'Opera & Classical Performance', 'Magic Shows', 'Circus & Acrobatics', 'Live Performance Art'] },
  { id: 'travel', label: 'Travel & Adventure', icon: TravelIcon, tags: ['Travel Meetups', 'Adventure Travel', 'Backpacking', 'Road Trips', 'Cultural Tours', 'Luxury Travel', 'Solo Travel', 'Budget Travel', 'Travel Photography', 'Study Abroad'] },
  { id: 'pets', label: 'Pets & Animals', icon: PetsIcon, tags: ['Dog Meetups & Walks', 'Cat Cafes & Events', 'Pet Adoption Events', 'Exotic Pets', 'Pet Training', 'Animal Rescue & Advocacy', 'Wildlife Conservation', 'Aquarium & Fish Keeping', 'Pet-Friendly Activities'] },
  { id: 'home', label: 'Home & Lifestyle', icon: HomeIcon, tags: ['Interior Design', 'DIY & Home Improvement', 'Real Estate & Housing', 'Sustainable Living', 'Minimalism', 'Organization & Decluttering', 'Home Decor', 'Smart Home Technology'] },
  { id: 'nightlife', label: 'Nightlife & Parties', icon: NightlifeIcon, tags: ['Clubs & Dancing', 'Bar Hopping', 'Live DJ Sets', 'Karaoke', 'Themed Parties', 'Raves & Electronic Music', 'Pub Quizzes', 'Rooftop Bars', 'Happy Hour Events', 'Silent Discos'] },
  { id: 'science', label: 'Science & Academia', icon: ScienceIcon, tags: ['Physics & Astronomy', 'Biology & Life Sciences', 'Chemistry', 'Mathematics', 'Psychology', 'Social Sciences', 'Philosophy', 'Research Symposiums', 'Science Cafes', 'Lab Tours & Demos'] },
  { id: 'spirituality', label: 'Spirituality & Religion', icon: SpiritualityIcon, tags: ['Meditation & Mindfulness', 'Yoga & Spiritual Practice', 'Religious Services', 'Interfaith Dialogue', 'Buddhist Teachings', 'Christian Fellowship', 'Jewish Community Events', 'Islamic Gatherings', 'New Age & Metaphysical', 'Prayer Groups'] },
];

export default function InterestSelection() {
  const router = useRouter();
  const { update } = useOnboarding();
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<string[]>([]);

  const allTags = CATEGORIES.flatMap((c) => c.tags);

  const filteredTags = allTags.filter(
    (t) =>
      t.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !selectedTags.includes(t)
  );

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const toggleCategory = (id: string) => {
    setExpandedCategories((prev) =>
      prev.includes(id) ? [] : [id]
    );
    setShowSearchResults(false);
    Keyboard.dismiss();
  };

  const getSelectedCountForCategory = (tags: string[]) =>
    tags.filter((t) => selectedTags.includes(t)).length;

  const handleSearchTag = (tag: string) => {
    toggleTag(tag);
    setSearchQuery('');
    setShowSearchResults(false);
    Keyboard.dismiss();
  };

  const closeSearch = () => {
    setShowSearchResults(false);
    Keyboard.dismiss();
  };

  const allFilled = selectedTags.length > 0;

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView className="flex-1 px-8 pt-6" keyboardShouldPersistTaps="handled">

        {/* Back Arrow */}
        <TouchableOpacity onPress={() => router.back()} className="mb-8 self-start">
          <Text className="text-2xl text-gray-800">←</Text>
        </TouchableOpacity>

        {/* Progress Bar */}
        <View className="h-1.5 bg-gray-200 rounded-full mb-12 overflow-hidden">
          <View className="h-full w-2/3 bg-orange-700 rounded-full" />
        </View>

        {/* Title */}
        <TouchableWithoutFeedback onPress={closeSearch}>
          <View>
            <Text className="text-2xl font-bold text-gray-900 mb-2">Tell Us About You</Text>
            <Text className="text-sm text-gray-500 mb-8">
              Pick tags from any category — we'll use them to customize your experience
            </Text>
          </View>
        </TouchableWithoutFeedback>

        {/* Search Bar */}
        <View className="border border-gray-300 rounded-lg mb-3 px-4 flex-row items-center">
          <SearchIcon width={16} height={16} style={{ marginRight: 10 }} />
          <TextInput
            className="flex-1 py-4 text-sm text-gray-800"
            placeholder="Search for interests, events, activities..."
            placeholderTextColor="#9CA3AF"
            value={searchQuery}
            onChangeText={(text) => {
              setSearchQuery(text);
              setShowSearchResults(text.length > 0);
            }}
            onFocus={() => setShowSearchResults(searchQuery.length > 0)}
          />
        </View>

        {/* Search Results */}
        {showSearchResults && (
          <View className="border border-gray-200 rounded-lg mb-6 bg-white shadow-sm">
            {filteredTags.length > 0 ? (
              <>
                <Text className="text-xs text-gray-400 px-4 pt-3 pb-1">
                  {filteredTags.length} results - tap to select tag(s)
                </Text>
                <View className="flex-row flex-wrap px-4 pb-4 gap-2">
                  {filteredTags.slice(0, 6).map((tag) => (
                    <TouchableOpacity
                      key={tag}
                      onPress={() => handleSearchTag(tag)}
                      className="flex-row items-center border border-gray-300 rounded-full px-3 py-1.5"
                    >
                      <Text className="text-xs text-gray-700">+ {tag}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            ) : (
              <View className="px-4 py-4">
                <Text className="text-sm text-gray-500">
                  No results for "{searchQuery}"
                </Text>
                <TouchableOpacity className="mt-1">
                  <Text className="text-sm text-orange-700 font-semibold">
                    Tag not listed? Send it in
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* Categories */}
        <View className="gap-3 mb-8">
          {CATEGORIES.map((category) => {
            const isExpanded = expandedCategories.includes(category.id);
            const selectedCount = getSelectedCountForCategory(category.tags);
            const IconComponent = category.icon;

            return (
              <View key={category.id} className="border border-gray-200 rounded-lg overflow-hidden">
                <TouchableOpacity
                  className="px-4 py-4 flex-row items-center justify-between bg-white"
                  onPress={() => toggleCategory(category.id)}
                >
                  <View className="flex-row items-center gap-3">
                    <IconComponent width={24} height={24} />
                    <Text className="text-sm font-semibold text-gray-800">{category.label}</Text>
                    {selectedCount > 0 && (
                      <View className="bg-orange-700 rounded-full w-5 h-5 items-center justify-center">
                        <Text className="text-white text-xs font-bold">{selectedCount}</Text>
                      </View>
                    )}
                  </View>
                  <DropdownArrow
                    width={16}
                    height={16}
                    style={{ transform: [{ rotate: isExpanded ? '180deg' : '0deg' }] }}
                  />
                </TouchableOpacity>

                {isExpanded && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 16, borderTopWidth: 1, borderTopColor: '#F3F4F6' }}>
                    {category.tags.map((tag) => {
                      const isSelected = selectedTags.includes(tag);
                      return (
                        <TouchableOpacity
                          key={tag}
                          onPress={() => toggleTag(tag)}
                          className={`flex-row items-center rounded-full px-3 py-1.5 mt-2 ${
                            isSelected
                              ? 'bg-orange-700 border border-orange-700'
                              : 'border border-gray-300'
                          }`}
                        >
                          <Text className={`text-xs ${isSelected ? 'text-white' : 'text-gray-700'}`}>
                            {isSelected ? '× ' : '+ '}{tag}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })}
        </View>

        {/* Next Button */}
        <TouchableOpacity
          className={`rounded-lg py-4 items-center justify-center mt-2 mb-16 ${
            allFilled ? 'bg-orange-700' : 'bg-transparent border border-gray-300'
          }`}
          onPress={allFilled ? () => {
            update({ selectedTags });
            router.push('/Avatar');
          } : undefined}
          activeOpacity={allFilled ? 0.8 : 1}
        >
          <Text className={`text-base font-semibold ${allFilled ? 'text-white' : 'text-gray-400'}`}>
            Next
          </Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}
