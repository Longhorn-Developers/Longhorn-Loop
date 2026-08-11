/**
 * Shared interest taxonomy: single source of truth for buckets + tags.
 *
 * Dependency-free by design (no React, no SVGs, no server-only APIs) so BOTH
 * sides can import it directly:
 *   - app/lib/interestCategories.ts decorates these with icons for the UI
 *   - server/src/lib/taxonomy.ts re-exports them for the classifier + feeds
 *
 * `bucket.id` is used as event_tags.bucket_id; `tags` are the child tags the
 * classifier assigns. Keep additions/renames here — everything else derives
 * from this file, so there is nothing to keep in sync.
 */

export type TaxonomyBucket = {
  // id used as a foreign key in event_tags.bucket_id
  id: string;
  // Human-readable label
  label: string;
  // One-liner used in Create Event Step 2 bucket cards.
  description: string;
  // Child tags belonging to this bucket
  tags: string[];
};

export const TAXONOMY_BUCKETS: TaxonomyBucket[] = [
  {
    id: 'performing',
    label: 'Performing Arts',
    description: 'Comedy, music, theater, & live shows',
    tags: [
      'Comedy',
      'Music',
      'Theater',
      'Classical & Opera',
      'Dance Performances',
      'Poetry & Spoken Word',
    ],
  },
  {
    id: 'arts',
    label: 'Arts & Culture',
    description: 'Film, galleries, museums, & pop culture',
    tags: ['Film & Cinema', 'Anime', 'Pop Culture', 'Visual Arts & Galleries', 'Museum Tours'],
  },
  {
    id: 'sports',
    label: 'Sports & Fitness',
    description: 'Team sports, fitness, & outdoor activities',
    tags: [
      'Team Sports',
      'Watch Parties & Game Day',
      'Gym & Fitness Classes',
      'Nutrition & Diet',
      'Cycling & Water Sports',
      'Combat Sports',
      'Extreme & Adventure Sports',
    ],
  },
  {
    id: 'food',
    label: 'Food & Drink',
    description: 'Restaurant outings, coffee chats, & happy hours',
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
    description: 'Startups, hackathons, AI, & tech talks',
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
    id: 'education',
    label: 'Education & Career',
    description: 'Career fairs, workshops, research, & networking',
    tags: [
      'Career Fairs',
      'Workshops & Seminars',
      'Talks & Speaker Series',
      'Academic Research',
      'Personal/Leadership Development',
      'Study Groups',
      'Networking & Conferences',
      'Finance & Investing',
    ],
  },
  {
    id: 'outdoors',
    label: 'Outdoors & Nature',
    description: 'Hiking, camping, & outdoor adventures',
    tags: [
      'Hiking & Backpacking',
      'Camping',
      'Rock Climbing',
      'Kayaking & Canoeing',
      'Gardening & Fishing',
    ],
  },
  {
    id: 'gaming',
    label: 'Gaming & Entertainment',
    description: 'Esports, game nights, & trivia',
    tags: ['Video Gaming', 'Board Games', 'Trivia Nights'],
  },
  {
    id: 'social',
    label: 'Social & Networking',
    description: 'Mixers, meetups, & community events',
    tags: [
      'Meetups & Mixers',
      'Singles & Dating',
      'LGBTQ+ Events',
      'Community Service',
      'Cultural Exchange',
    ],
  },
  {
    id: 'travel',
    label: 'Travel & Adventure',
    description: 'Study abroad, road trips, & budget travel',
    tags: ['Road Trips', 'Budget Travel', 'Study Abroad'],
  },
  {
    id: 'nightlife',
    label: 'Nightlife & Parties',
    description: 'Bars, clubs, karaoke, & late-night events',
    tags: ['Clubs & Live DJ Sets', 'Karaoke', 'Themed Parties', 'Raves', 'Happy Hour Events'],
  },
  {
    id: 'spirituality',
    label: 'Spirituality & Religion',
    description: 'Services, fellowship, & meditation groups',
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
];

/** Flat list of every tag in taxonomy order. Handy for search/classifier lookups. */
export const ALL_TAXONOMY_TAGS: string[] = TAXONOMY_BUCKETS.flatMap((b) => b.tags);

/** Set of all valid bucket IDs — useful for fast membership checks. */
export const BUCKET_ID_SET: ReadonlySet<string> = new Set(TAXONOMY_BUCKETS.map((b) => b.id));
