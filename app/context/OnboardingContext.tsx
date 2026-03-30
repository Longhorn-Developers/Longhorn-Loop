import React, { createContext, useContext, useState } from 'react';

interface OnboardingData {
  // Auth
  email: string;
  firstName: string;
  lastName: string;
  token: string;

  // Profile
  selectedMajors: string[];
  selectedYear: string;
  uniqueClassification: string;

  // Interests
  selectedTags: string[];

  // Avatar
  avatar: number | null;
}

interface OnboardingContextType {
  data: OnboardingData;
  update: (partial: Partial<OnboardingData>) => void;
  reset: () => void;
}

const DEFAULT_DATA: OnboardingData = {
  email: '',
  firstName: '',
  lastName: '',
  token: '',
  selectedMajors: [],
  selectedYear: '',
  uniqueClassification: '',
  selectedTags: [],
  avatar: null,
};

const OnboardingContext = createContext<OnboardingContextType>({
  data: DEFAULT_DATA,
  update: () => {},
  reset: () => {},
});

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<OnboardingData>(DEFAULT_DATA);

  const update = (partial: Partial<OnboardingData>) => {
    setData((prev) => ({ ...prev, ...partial }));
  };

  const reset = () => setData(DEFAULT_DATA);

  return (
    <OnboardingContext.Provider value={{ data, update, reset }}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  return useContext(OnboardingContext);
}
