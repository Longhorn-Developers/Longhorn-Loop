import React, { createContext, useContext, useState } from 'react';

export type PosterKind = 'personal' | 'org';

export interface CreateEventPoster {
  kind: PosterKind;
  id: string;
  name: string;
  role: string;
}

export type DiscoveryBucketId =
  | 'campus_wide'
  | 'music'
  | 'arts'
  | 'sports'
  | 'food'
  | 'tech'
  | 'learning'
  | 'outdoors'
  | 'gaming'
  | 'social'
  | 'health'
  | 'shopping'
  | 'business'
  | 'performing'
  | 'travel'
  | 'pets'
  | 'home'
  | 'nightlife'
  | 'science'
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
  rsvpUrl: string;
  imageUrl: string | null;
}

interface CreateEventContextType {
  data: CreateEventData;
  update: (partial: Partial<CreateEventData>) => void;
  reset: () => void;
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
  rsvpUrl: '',
  imageUrl: null,
};

const CreateEventContext = createContext<CreateEventContextType>({
  data: DEFAULT_DATA,
  update: () => {},
  reset: () => {},
});

export function CreateEventProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<CreateEventData>(DEFAULT_DATA);

  const update = (partial: Partial<CreateEventData>) => {
    setData((prev) => ({ ...prev, ...partial }));
  };

  const reset = () => setData(DEFAULT_DATA);

  return (
    <CreateEventContext.Provider value={{ data, update, reset }}>
      {children}
    </CreateEventContext.Provider>
  );
}

export function useCreateEvent() {
  return useContext(CreateEventContext);
}
