/**
 * Server-side taxonomy data: bucket IDs, labels, and tags.
 *
 * This is a data-only mirror of app/lib/interestCategories.ts (minus the
 * icons/descriptions/React deps), kept inside server/src/ so the server
 * can import it easily
 *
 * SOURCE OF TRUTH: app/lib/interestCategories.ts. If you add or rename a
 * bucket/tag there, update this file to match. The vitest test
 * server/test/test_taxonomy.ts guards structural invariants.
 *
 * Server imports: import { TAXONOMY_BUCKETS } from './lib/taxonomy'
 */

export type TaxonomyBucket = {
  // id used as a foreign key in event_tags.bucket_id
  id: string;
  // Human-readable label
  label: string;
  // Child tags belonging to this bucket
  tags: string[];
};

export const TAXONOMY_BUCKETS: TaxonomyBucket[] = [
  {
    id: 'music',
    label: 'Music',
    tags: [
      'Rock & Alternative',
      'Hip Hop & Rap',
      'Country & Folk',
      'Jazz & Blues',
      'Pop',
      'R&B & Soul',
      'Indie & Underground',
      'Latin & Reggaeton',
      'K-Pop & J-Pop',
    ],
  },
  {
    id: 'performing',
    label: 'Performing Arts',
    tags: [
      'Comedy',
      'Theater & Musicals',
      'Classical & Opera',
      'Dance Performances',
      'Circus & Magic',
      'Poetry & Spoken Word',
    ],
  },
  {
    id: 'spirituality',
    label: 'Spirituality & Religion',
    tags: [
      'Meditation & Mindfulness',
      'Interfaith Events',
      'Buddhism',
      'Hinduism',
      'Christianity',
      'Judaism',
      'Islam',
    ],
  },
  {
    id: 'arts',
    label: 'Arts & Culture',
    tags: [
      'Film & Cinema',
      'Anime',
      'Pop Culture',
      'Visual Arts & Galleries',
      'Cultural Festivals',
      'Museum Tours',
    ],
  },
  {
    id: 'sports',
    label: 'Sports & Fitness',
    tags: [
      'Team Sports',
      'Racquet Sports',
      'Running & Endurance',
      'Cycling & Water Sports',
      'Yoga & Fitness Classes',
      'Combat Sports',
      'Golf',
      'Extreme & Adventure Sports',
    ],
  },
  {
    id: 'food',
    label: 'Food & Drink',
    tags: [
      'Cocktails, Wine, & Breweries',
      'Fine Dining',
      'Street Food & Food Trucks',
      'Vegan & Vegetarian',
      'Coffee, Tea & Baking',
      'International Cuisine',
      'Cooking Classes',
      'Food Festivals',
    ],
  },
  {
    id: 'tech',
    label: 'Technology & Innovation',
    tags: [
      'Startup & Entrepreneurship',
      'AI & Machine Learning',
      'Hardware',
      'Web & App Development',
      'Cybersecurity',
      'VR & AR, & Robotics',
      'Hackathons & Tech Conferences',
    ],
  },
  {
    id: 'science',
    label: 'Science & Academia',
    tags: [
      'Physics & Astronomy',
      'Biology & Life Sciences',
      'Chemistry & Mathematics',
      'Psychology & Social Sciences',
      'Philosophy',
      'Academic Research',
    ],
  },
  {
    id: 'education',
    label: 'Education & Career',
    tags: [
      'Career Fairs',
      'Workshops & Seminars',
      'Personal Development',
      'History & Archaeology',
      'Book Clubs & Study Groups',
      'Lectures & Online Courses',
    ],
  },
  {
    id: 'outdoors',
    label: 'Outdoors & Nature',
    tags: [
      'Hiking & Backpacking',
      'Camping',
      'Rock Climbing',
      'Kayaking & Canoeing',
      'Wildlife & Bird Watching',
      'Gardening & Fishing',
    ],
  },
  {
    id: 'gaming',
    label: 'Gaming & Entertainment',
    tags: [
      'Video Gaming',
      'Board Games',
      'Esports & Competitive Gaming',
      'VR & Immersive Gaming',
      'Role-Playing Games (RPG)',
      'Trivia Nights',
      'Escape Rooms',
    ],
  },
  {
    id: 'social',
    label: 'Social & Networking',
    tags: [
      'Meetups & Mixers',
      'Singles & Dating',
      'LGBTQ+ Events',
      'Community Service',
      'Cultural Exchange',
      'Social Clubs',
    ],
  },
  {
    id: 'health',
    label: 'Health & Wellness',
    tags: [
      'Mental Health & Therapy',
      'Gym',
      'Nutrition & Diet',
      'Mindfulness Practice',
      'Spa, Retreats & Relaxation',
    ],
  },
  {
    id: 'business',
    label: 'Business & Professional',
    tags: [
      'Case Competitions',
      'Networking & Conferences',
      'Leadership Development',
      'Sales & Marketing',
      'Finance & Investing',
      'Real Estate',
      'Project Management',
    ],
  },
  {
    id: 'travel',
    label: 'Travel & Adventure',
    tags: ['Road Trips', 'Budget Travel', 'Travel Photography', 'Study Abroad'],
  },
  {
    id: 'nightlife',
    label: 'Nightlife & Parties',
    tags: [
      'Clubs & Live DJ Sets',
      'Karaoke',
      'Themed Parties',
      'Raves & Electronic Music',
      'Happy Hour Events',
      'Silent Discos',
    ],
  },
];

/** Flat list of every tag in taxonomy order. Handy for classifier keyword lookups. */
export const ALL_TAXONOMY_TAGS: string[] = TAXONOMY_BUCKETS.flatMap((b) => b.tags);

/** Set of all valid bucket IDs- useful for fast membership checks. */
export const BUCKET_ID_SET: ReadonlySet<string> = new Set(TAXONOMY_BUCKETS.map((b) => b.id));
