import { useOnboarding } from '@/app/context/OnboardingContext';
import LhlSearchIcon from '@/assets/icons/LhlSearchIcon';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import InlineAlert from '../components/alerts/InlineAlert';
import PrimaryButton from '../components/buttons/PrimaryButton';
import DropdownMultiSelectField from '../components/inputs/DropdownMultiSelectField';
import DropdownSelectField from '../components/inputs/DropdownSelectField';
import SearchablePillDropdownField from '../components/inputs/SearchablePillDropdownField';
import { MAJORS } from '@/app/lib/majors';
import { YEAR_OPTIONS } from '@/app/lib/yearOptions';
import FlowLayout from '../components/layouts/FlowLayout';

const UNIQUE_CLASS_OPTIONS = ['First Generation', 'International', 'Transfer', 'Not Applicable'];

// Which field the inline alert is complaining about, rather than the message
// itself. Tracking the field is what lets the alert clear the moment that field
// is satisfied — see the effect below.
type ErrorField = 'majors' | 'year' | 'unique';

const ERROR_MESSAGES: Record<ErrorField, string> = {
  majors: 'Please select at least one major.',
  year: 'Please select your year classification.',
  unique: 'Please select at least one unique classification.',
};

export default function CreateAccount() {
  const router = useRouter();
  const { update } = useOnboarding();

  const [errorField, setErrorField] = useState<ErrorField | null>(null);

  const [selectedMajors, setSelectedMajors] = useState<string[]>([]);

  const [yearOpen, setYearOpen] = useState(false);
  const [selectedYear, setSelectedYear] = useState('');

  const [uniqueOpen, setUniqueOpen] = useState(false);
  const [selectedUnique, setSelectedUnique] = useState<string[]>([]);

  // The alert names one specific field, so it has to go the moment that field is
  // filled in — not on the next Next press. Bug bash: "after selecting a major,
  // 'Please select at least one major' error should disappear but stays
  // persistent." Leaving a satisfied requirement on screen reads as the app
  // having failed to register the choice.
  useEffect(() => {
    if (!errorField) return;
    const satisfied =
      errorField === 'majors'
        ? selectedMajors.length > 0
        : errorField === 'year'
          ? selectedYear !== ''
          : selectedUnique.length > 0;
    if (satisfied) setErrorField(null);
  }, [errorField, selectedMajors, selectedYear, selectedUnique]);

  const handleSubmit = () => {
    if (selectedMajors.length === 0) {
      setErrorField('majors');
      return;
    }

    if (selectedYear === '') {
      setErrorField('year');
      return;
    }

    if (selectedUnique.length === 0) {
      setErrorField('unique');
      return;
    }

    setErrorField(null);

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
      title="Begin Your Journey"
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
      {errorField ? (
        <View className="mt-4">
          <InlineAlert message={ERROR_MESSAGES[errorField]} />
        </View>
      ) : null}

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
