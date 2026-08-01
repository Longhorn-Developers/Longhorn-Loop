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

/**
 * Most interests a user may select.
 *
 * The taxonomy has 100 tags; without a cap the profile's interest row becomes
 * an unreadable wall and the feed signal degrades into "everything". Enforced
 * at every write point — onboarding, Edit Profile, and the Worker — so the
 * three can't disagree.
 *
 * Rows written before this cap existed may hold more; reads never reject, only
 * writes do, so an existing user is asked to trim rather than locked out of
 * their profile.
 */
export const MAX_INTERESTS = 5;

export const TAXONOMY_BUCKETS: TaxonomyBucket[] = [
  {
    id: 'music',
    label: 'Music',
    description: 'Concerts, DJ sets, & live performances',
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
    description: 'Comedy, theater, dance, & live shows',
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
  {
    id: 'arts',
    label: 'Arts & Culture',
    description: 'Film, galleries, festivals, & pop culture',
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
    description: 'Team sports, fitness classes, & outdoor activities',
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
    id: 'science',
    label: 'Science & Academia',
    description: 'Physics, biology, research, & academic talks',
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
    description: 'Career fairs, workshops, & study groups',
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
    description: 'Hiking, camping, & outdoor adventures',
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
    description: 'Esports, game nights, & tabletop',
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
    description: 'Mixers, meetups, & social clubs',
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
    description: 'Wellness, therapy, gym, & mindfulness',
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
    description: 'Case comps, networking, & conferences',
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
    description: 'Study abroad, road trips, & travel meetups',
    tags: ['Road Trips', 'Budget Travel', 'Travel Photography', 'Study Abroad'],
  },
  {
    id: 'nightlife',
    label: 'Nightlife & Parties',
    description: 'Bars, clubs, karaoke, & late-night events',
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

/** Flat list of every tag in taxonomy order. Handy for search/classifier lookups. */
export const ALL_TAXONOMY_TAGS: string[] = TAXONOMY_BUCKETS.flatMap((b) => b.tags);

/** Set of all valid bucket IDs — useful for fast membership checks. */
export const BUCKET_ID_SET: ReadonlySet<string> = new Set(TAXONOMY_BUCKETS.map((b) => b.id));
