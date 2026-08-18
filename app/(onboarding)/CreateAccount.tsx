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
import { MAJORS } from '@/app/lib/majors';
import FlowLayout from '../components/layouts/FlowLayout';

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
      step={1}
      totalSteps={4}
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
