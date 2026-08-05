import DiscoveryBucket from '@/app/components/create-event/DiscoveryBucket';
import EventDetails from '@/app/components/create-event/EventDetails';
import InterestTags from '@/app/components/create-event/InterestTags';
import OptionalExtras from '@/app/components/create-event/OptionalExtras';
import WhenIsIt from '@/app/components/create-event/WhenIsIt';
import WhosPosting from '@/app/components/create-event/WhosPosting';
import { useCreateEvent, type CreateEventStep } from '@/app/context/CreateEventContext';
import React from 'react';

const STEP_SCREENS: Record<CreateEventStep, React.ComponentType> = {
  whosPosting: WhosPosting,
  discoveryBucket: DiscoveryBucket,
  interestTags: InterestTags,
  eventDetails: EventDetails,
  whenIsIt: WhenIsIt,
  optionalExtras: OptionalExtras,
};

// The create tab shows one step at a time. Because it lives under (tabs), the
// tab bar stays mounted, and the step index lives in CreateEventContext, so
// switching tabs and coming back lands on the same step with data intact.
export default function CreateEventTab() {
  const { step } = useCreateEvent();
  const StepScreen = STEP_SCREENS[step];
  return <StepScreen />;
}
