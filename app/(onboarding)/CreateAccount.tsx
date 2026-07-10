import { useOnboarding } from '@/app/context/OnboardingContext';
import LhlSearchIcon from '@/assets/icons/LhlSearchIcon';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import InlineAlert from '../components/alerts/InlineAlert';
import PrimaryButton from '../components/buttons/PrimaryButton';
import DropdownMultiSelectField from '../components/inputs/DropdownMultiSelectField';
import DropdownSelectField from '../components/inputs/DropdownSelectField';
import SearchablePillDropdownField from '../components/inputs/SearchablePillDropdownField';
import FlowLayout from '../components/layouts/FlowLayout';

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

const UNIQUE_CLASS_OPTIONS = ['First Generation', 'International', 'Transfer', 'Not Applicable'];

export default function CreateAccount() {
  const router = useRouter();
  const { update } = useOnboarding();

  const [inlineError, setInlineError] = useState('');

  const [selectedMajors, setSelectedMajors] = useState<string[]>([]);

  const [yearOpen, setYearOpen] = useState(false);
  const [selectedYear, setSelectedYear] = useState('');

  const [uniqueOpen, setUniqueOpen] = useState(false);
  const [selectedUnique, setSelectedUnique] = useState<string[]>([]);

  const handleSubmit = () => {
    if (selectedMajors.length === 0) {
      setInlineError('Please select at least one major.');
      return;
    }

    if (selectedYear === '') {
      setInlineError('Please select your year classification.');
      return;
    }

    if (selectedUnique.length === 0) {
      setInlineError('Please select at least one unique classification.');
      return;
    }

    setInlineError('');

    update({
      selectedMajors,
      selectedYear,
      uniqueClassification: selectedUnique,
    });

    router.push('/InterestSelection');
  };

  const allFilled = selectedMajors.length > 0 && selectedYear !== '' && selectedUnique.length > 0;

  return (
    <FlowLayout
      title="Get In The Loop!"
      subTitle="Let's create your account!"
      onBackPress={() => router.back()}
      showProgressBar={true}
      startingPercentage={0}
      progressBarPercentage={25}
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

      <View className="mt-[42px]">
        <SearchablePillDropdownField
          label="Major(s)"
          leftIcon={<LhlSearchIcon />}
          placeholder="Search for your major..."
          options={MAJORS}
          selectedValues={selectedMajors}
          onSelect={setSelectedMajors}
        />
      </View>

      <View className="mt-[16px]">
        <DropdownSelectField
          label="Year Classification"
          placeholder="Select year"
          options={YEAR_OPTIONS}
          selectedValue={selectedYear}
          onSelect={setSelectedYear}
          isOpen={yearOpen}
          onToggle={() => {
            setYearOpen(!yearOpen);
          }}
        />
      </View>

      <View className="mt-[16px]">
        <DropdownMultiSelectField
          label="Unique Classification"
          placeholder="Select all that apply"
          options={UNIQUE_CLASS_OPTIONS}
          selectedValues={selectedUnique}
          onSelect={setSelectedUnique}
          isOpen={uniqueOpen}
          onToggle={() => {
            setUniqueOpen(!uniqueOpen);
          }}
        />
      </View>
    </FlowLayout>
  );
}
