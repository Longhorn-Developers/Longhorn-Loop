// Interest categories for the UI (Onboarding InterestSelection, Create Event
// steps). The bucket/tag DATA lives in the framework-neutral shared module
// (shared/taxonomy.ts) so the server can reuse it without React/SVG deps;
// this file just decorates each bucket with its icon.
//
// To add or rename a bucket/tag, edit shared/taxonomy.ts. To change an icon,
// edit BUCKET_ICONS below.

import { TAXONOMY_BUCKETS } from '@/shared/taxonomy';
import ArtsIcon from '@/assets/images/arts_culture.svg';
import BallIcon from '@/assets/images/ball.svg';
import BusinessIcon from '@/assets/images/business.svg';
import FoodIcon from '@/assets/images/food&drink.svg';
import HealthIcon from '@/assets/images/health_wellness.svg';
import HandshakeIcon from '@/assets/images/ix_handshake.svg';
import LearningIcon from '@/assets/images/learning&ed.svg';
import MusicIcon from '@/assets/images/music.svg';
import NightlifeIcon from '@/assets/images/nightlife.svg';
import OutdoorsIcon from '@/assets/images/outdoors.svg';
import PerformingIcon from '@/assets/images/performing_arts.svg';
import ScienceIcon from '@/assets/images/science.svg';
import SpiritualityIcon from '@/assets/images/spirituality.svg';
import TechIcon from '@/assets/images/technology.svg';
import TravelIcon from '@/assets/images/travel.svg';
import VideoGameIcon from '@/assets/images/Video_Game.svg';
import React from 'react';
import { SvgProps } from 'react-native-svg';

export type InterestCategory = {
  id: string;
  label: string;
  // one liner used in Create Event Step 2 bucket cards.
  description: string;
  icon: React.FC<SvgProps>;
  tags: string[];
};

// Bucket id -> icon. Keyed by the shared taxonomy ids.
const BUCKET_ICONS: Record<string, React.FC<SvgProps>> = {
  music: MusicIcon,
  performing: PerformingIcon,
  spirituality: SpiritualityIcon,
  arts: ArtsIcon,
  sports: BallIcon,
  food: FoodIcon,
  tech: TechIcon,
  science: ScienceIcon,
  education: LearningIcon,
  outdoors: OutdoorsIcon,
  gaming: VideoGameIcon,
  social: HandshakeIcon,
  health: HealthIcon,
  business: BusinessIcon,
  travel: TravelIcon,
  nightlife: NightlifeIcon,
};

export const INTEREST_CATEGORIES: InterestCategory[] = TAXONOMY_BUCKETS.map((bucket) => ({
  id: bucket.id,
  label: bucket.label,
  description: bucket.description,
  icon: BUCKET_ICONS[bucket.id],
  tags: bucket.tags,
}));

// Flat list of every tag, in taxonomy order. Handy for search/autocomplete.
export const ALL_INTEREST_TAGS: string[] = INTEREST_CATEGORIES.flatMap((c) => c.tags);
