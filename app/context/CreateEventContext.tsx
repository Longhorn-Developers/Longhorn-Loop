import { DEFAULT_VENUE_TYPE, type VenueType } from '@/shared/venueType';
import React, { createContext, useContext, useState } from 'react';

export type PosterKind = 'personal' | 'org';

export interface CreateEventPoster {
  kind: PosterKind;
  id: string;
  name: string;
  role: string;
}

// IDs mirror InterestCategory ids from app/lib/interestCategories.ts.
// Keep the two lists in sync as step 3 of the flow picks tags from the
// category whose id equals the selected DiscoveryBucketId.
export type DiscoveryBucketId =
  | 'music'
  | 'performing'
  | 'arts'
  | 'sports'
  | 'food'
  | 'tech'
  | 'science'
  | 'education'
  | 'outdoors'
  | 'gaming'
  | 'social'
  | 'health'
  | 'business'
  | 'travel'
  | 'nightlife'
  | 'spirituality';

export const MAX_INTEREST_TAGS = 5;

export type EventTypeId =
  | 'general_meeting'
  | 'social'
  | 'career'
  | 'workshop'
  | 'performance'
  | 'fundraiser'
  | 'sports'
  | 'other';

export type DateMode = 'single' | 'range';

export interface CreateEventData {
  poster: CreateEventPoster | null;
  discoveryBucket: DiscoveryBucketId | null;
  interestTags: string[];
  title: string;
  description: string;
  eventType: EventTypeId | null;
  dateMode: DateMode;
  startDatetime: string | null;
  endDatetime: string | null;
  locationFull: string;
  /** In-person vs online. Required by the server since LOOP-260. */
  venueType: VenueType;
  rsvpUrl: string;
  /** Perks offered at the event -- writes event_benefits (LOOP-259). */
  benefits: string[];
  imageUrl: string | null;
  imageName: string | null;
  imageMimeType: string | null;
}

// The six steps of the flow, in order. The create tab renders the component
// for the current step; advancing/going back moves through this list rather
// than pushing routes, so the tab bar stays mounted the whole time.
export const CREATE_EVENT_STEPS = [
  'whosPosting',
  'discoveryBucket',
  'interestTags',
  'eventDetails',
  'whenIsIt',
  'optionalExtras',
] as const;

export type CreateEventStep = (typeof CREATE_EVENT_STEPS)[number];

export const CREATE_EVENT_STEP_COUNT = CREATE_EVENT_STEPS.length;

interface CreateEventContextType {
  data: CreateEventData;
  update: (partial: Partial<CreateEventData>) => void;
  reset: () => void;
  /** Index into CREATE_EVENT_STEPS of the step currently shown. */
  stepIndex: number;
  step: CreateEventStep;
  goNext: () => void;
  goBack: () => void;
}

const DEFAULT_DATA: CreateEventData = {
  poster: null,
  discoveryBucket: null,
  interestTags: [],
  title: '',
  description: '',
  eventType: null,
  dateMode: 'single',
  startDatetime: null,
  endDatetime: null,
  locationFull: '',
  venueType: DEFAULT_VENUE_TYPE,
  rsvpUrl: '',
  benefits: [],
  imageUrl: null,
  imageName: null,
  imageMimeType: null,
};

const CreateEventContext = createContext<CreateEventContextType>({
  data: DEFAULT_DATA,
  update: () => {},
  reset: () => {},
  stepIndex: 0,
  step: CREATE_EVENT_STEPS[0],
  goNext: () => {},
  goBack: () => {},
});

export function CreateEventProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<CreateEventData>(DEFAULT_DATA);
  const [stepIndex, setStepIndex] = useState(0);

  const update = (partial: Partial<CreateEventData>) => {
    setData((prev) => ({ ...prev, ...partial }));
  };

  // Reset clears both the draft and the step, so the next visit starts fresh.
  const reset = () => {
    setData(DEFAULT_DATA);
    setStepIndex(0);
  };

  const goNext = () => setStepIndex((i) => Math.min(i + 1, CREATE_EVENT_STEPS.length - 1));
  const goBack = () => setStepIndex((i) => Math.max(i - 1, 0));

  return (
    <CreateEventContext.Provider
      value={{
        data,
        update,
        reset,
        stepIndex,
        step: CREATE_EVENT_STEPS[stepIndex],
        goNext,
        goBack,
      }}
    >
      {children}
    </CreateEventContext.Provider>
  );
}

export function useCreateEvent() {
  return useContext(CreateEventContext);
}
