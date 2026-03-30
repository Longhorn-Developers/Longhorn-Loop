import SearchIcon from '@/assets/images/search_icon_create_acc.svg';
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
  View
} from 'react-native';

const MAJORS = [
  'Accounting',
  'Acting',
  'Actuarial Science',
  'Advertising',
  'Aerospace Engineering',
  'African and African Diaspora Studies',
  'All-Level Special Education',
  'American Studies',
  'Anthropology',
  'Applied Movement Science',
  'Architectural Engineering',
  'Architectural Studies',
  'Architecture',
  'Architecture / Architectural Engineering Dual Degree Program',
  'Art Education (UTeach Art)',
  'Art History',
  'Arts and Entertainment Technologies',
  'Asian American Studies',
  'Asian Cultures and Languages',
  'Asian Studies',
  'Astronomy',
  'Athletic Training',
  'Behavioral and Social Data Sciences',
  'Biochemistry',
  'Biology',
  'Biomedical Engineering',
  'Business Analytics',
  'Chemical Engineering',
  'Chemistry',
  'Civics Honors',
  'Civil Engineering',
  'Classical Languages',
  'Classical Studies',
  'Climate System Science',
  'Communication and Leadership',
  'Communication Studies',
  'Computational Engineering',
  'Computer Science',
  'Dance',
  'Design',
  'Early Childhood to 6th Grade Bilingual Generalist Certification',
  'Early Childhood to 6th Grade ESL Generalist Certification',
  'Economics',
  'Electrical and Computer Engineering',
  'English',
  'Environmental Engineering',
  'Environmental Science',
  'European Studies',
  'Exercise Science',
  'Finance',
  'French',
  'Geography',
  'Geological Sciences',
  'Geosystems Engineering',
  'German',
  'Government',
  'Health & Society',
  'Health Promotion and Behavioral Science',
  'History',
  'Human Development and Family Sciences',
  'Human Dimensions of Organizations',
  'Human Ecology',
  'Humanities',
  'Informatics',
  'Interior Design',
  'International Business',
  'International Relations and Global Studies',
  'Italian',
  'Jewish Studies',
  'Journalism',
  'Latin American Studies',
  'Linguistics',
  'Management',
  'Management Information Systems',
  'Marketing',
  'Mathematics',
  'Mechanical Engineering',
  'Medical Laboratory Science',
  'Mexican American & Latina/o Studies',
  'Middle Eastern Studies',
  'Music',
  'Neuroscience',
  'Nursing',
  'Nutrition',
  'Petroleum Engineering',
  'Philosophy',
  'Physical Culture and Sports',
  'Physics',
  'Psychology',
  'Public Affairs',
  'Public Health',
  'Public Relations',
  'Race, Indigeneity, and Migration',
  'Radio-Television-Film',
  'Religious Studies',
  'Rhetoric and Writing',
  'Russian, East European and Eurasian Studies',
  'Social Work',
  'Sociology',
  'Spanish',
  'Speech, Language, and Hearing Sciences',
  'Sport Management',
  'Statistics and Data Science',
  'Studio Art',
  'Supply Chain Management',
  'Sustainability Studies',
  'Textiles and Apparel',
  'Theatre and Dance',
  'Urban Studies',
  'UTeach Dance (Dance Education)',
  'UTeach Music (Music Studies)',
  'UTeach Theatre (Theatre Studies)',
  "Women's and Gender Studies",
  'Youth and Community Studies',
];

const YEAR_OPTIONS = ['Freshmen', 'Sophomore', 'Junior', 'Senior', 'Graduate'];

const UNIQUE_CLASS_OPTIONS = [
  'First Generation',
  'International',
  'Transfer',
  'Non Applicable',
];

export default function CreateAccount() {
  const router = useRouter();
  const { update } = useOnboarding();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMajors, setSelectedMajors] = useState<string[]>([]);
  const [showMajorDropdown, setShowMajorDropdown] = useState(false);

  const [yearOpen, setYearOpen] = useState(false);
  const [selectedYear, setSelectedYear] = useState('');

  const [uniqueOpen, setUniqueOpen] = useState(false);
  const [selectedUnique, setSelectedUnique] = useState('');

  const filteredMajors = MAJORS.filter(
    (m) =>
      m.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !selectedMajors.includes(m)
  );

  const handleSelectMajor = (major: string) => {
    setSelectedMajors((prev) => [...prev, major]);
    setSearchQuery('');
    setShowMajorDropdown(false);
    Keyboard.dismiss();
  };

  const handleRemoveMajor = (major: string) => {
    setSelectedMajors((prev) => prev.filter((m) => m !== major));
  };

  const closeAll = () => {
    setShowMajorDropdown(false);
    setYearOpen(false);
    setUniqueOpen(false);
    Keyboard.dismiss();
  };

  const allFilled =
    selectedMajors.length > 0 && selectedYear !== '' && selectedUnique !== '';

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView className="flex-1 px-8 pt-6" keyboardShouldPersistTaps="handled">

        {/* Back Arrow */}
        <TouchableOpacity onPress={() => router.back()} className="mb-8 self-start">
          <Text className="text-2xl text-gray-800">←</Text>
        </TouchableOpacity>

        {/* Progress Bar */}
        <View className="h-1.5 bg-gray-200 rounded-full mb-12 overflow-hidden">
          <View className="h-full w-1/3 bg-orange-700 rounded-full" />
        </View>

        {/* Title - tap to close all dropdowns */}
        <TouchableWithoutFeedback onPress={closeAll}>
          <View>
            <Text className="text-2xl font-bold text-gray-900 mb-2">Begin Your Journey</Text>
            <Text className="text-sm text-gray-500 mb-10">Lets create your account!</Text>
          </View>
        </TouchableWithoutFeedback>

        {/* Major Search */}
        <Text className="text-sm font-semibold text-gray-800 mb-3">Whats your major(s)?</Text>
        <View className="border border-gray-300 rounded-lg mb-3 px-4 flex-row items-center">
          <SearchIcon width={16} height={16} style={{ marginRight: 10 }} />
          <TextInput
            className="flex-1 py-4 text-sm text-gray-800"
            placeholder="Search for your major..."
            placeholderTextColor="#9CA3AF"
            value={searchQuery}
            onChangeText={(text) => {
              setSearchQuery(text);
              setShowMajorDropdown(true);
              setYearOpen(false);
              setUniqueOpen(false);
            }}
            onFocus={() => {
              setShowMajorDropdown(true);
              setYearOpen(false);
              setUniqueOpen(false);
            }}
          />
        </View>

        {/* Selected Major Tags */}
        {selectedMajors.length > 0 && (
          <View className="flex-row flex-wrap gap-2 mb-4">
            {selectedMajors.map((major) => (
              <View key={major} className="flex-row items-center bg-orange-700 rounded-full px-3 py-1.5">
                <Text className="text-white text-xs mr-1">{major}</Text>
                <TouchableOpacity onPress={() => handleRemoveMajor(major)}>
                  <Text className="text-white text-xs font-bold">×</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Major Dropdown */}
        {showMajorDropdown && filteredMajors.length > 0 && (
          <View className="border border-gray-200 rounded-lg mb-8 bg-white shadow-sm">
            <Text className="text-xs text-gray-400 px-4 pt-3 pb-1">
              {filteredMajors.length} results - tap to select tag(s)
            </Text>
            <View className="flex-row flex-wrap px-4 pb-4 gap-2">
              {filteredMajors.slice(0, 6).map((major) => (
                <TouchableOpacity
                  key={major}
                  onPress={() => handleSelectMajor(major)}
                  className="flex-row items-center border border-gray-300 rounded-full px-3 py-1.5"
                >
                  <Text className="text-xs text-gray-700">+ {major}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Year Classification */}
        <Text className="text-sm font-semibold text-gray-800 mb-3 mt-4">Year Classification</Text>
        <TouchableOpacity
          className="border border-gray-300 rounded-lg px-4 py-4 flex-row justify-between items-center mb-3"
          onPress={() => {
            setYearOpen(!yearOpen);
            setUniqueOpen(false);
            setShowMajorDropdown(false);
          }}
        >
          <Text className={selectedYear ? 'text-gray-800 text-sm' : 'text-gray-400 text-sm'}>
            {selectedYear || 'Select year'}
          </Text>
          <Text className="text-gray-400">{yearOpen ? '∧' : '∨'}</Text>
        </TouchableOpacity>
        {yearOpen && (
          <View className="border border-gray-200 rounded-lg mb-8 bg-white shadow-sm overflow-hidden">
            {YEAR_OPTIONS.map((year) => (
              <TouchableOpacity
                key={year}
                className="px-4 py-4 border-b border-gray-100"
                onPress={() => {
                  setSelectedYear(year);
                  setYearOpen(false);
                }}
              >
                <Text className="text-sm text-gray-800">{year}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Unique Classification */}
        <Text className="text-sm font-semibold text-gray-800 mb-3 mt-4">Unique Classification</Text>
        <TouchableOpacity
          className="border border-gray-300 rounded-lg px-4 py-4 flex-row justify-between items-center mb-3"
          onPress={() => {
            setUniqueOpen(!uniqueOpen);
            setYearOpen(false);
            setShowMajorDropdown(false);
          }}
        >
          <Text className={selectedUnique ? 'text-gray-800 text-sm' : 'text-gray-400 text-sm'}>
            {selectedUnique || 'Select classification'}
          </Text>
          <Text className="text-gray-400">{uniqueOpen ? '∧' : '∨'}</Text>
        </TouchableOpacity>
        {uniqueOpen && (
          <View className="border border-gray-200 rounded-lg mb-8 bg-white shadow-sm overflow-hidden">
            {UNIQUE_CLASS_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option}
                className="px-4 py-4 border-b border-gray-100"
                onPress={() => {
                  setSelectedUnique(option);
                  setUniqueOpen(false);
                }}
              >
                <Text className="text-sm text-gray-800">{option}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Next Button */}
        <TouchableOpacity
          className={`rounded-lg py-4 items-center justify-center mt-8 mb-16 ${
            allFilled ? 'bg-orange-700' : 'bg-transparent border border-gray-300'
          }`}
          onPress={allFilled ? () => {
            update({
              selectedMajors,
              selectedYear,
              uniqueClassification: selectedUnique,
            });
            router.push('/InterestSelection');
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
