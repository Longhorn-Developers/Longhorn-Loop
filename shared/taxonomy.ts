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
 *
 * TAG_DESCRIPTIONS gives the LLM a clearer definition of what each tag means.
 * Tags stay as string[] so existing UI/server code does not need a data-shape
 * change.
 */

export type TaxonomyBucket = {
  id: string;
  label: string;
  description: string;
  tags: string[];
};

export const TAXONOMY_BUCKETS: TaxonomyBucket[] = [
  {
    id: 'performing',
    label: 'Performing Arts',
    description: 'Comedy, music, theater, dance, poetry, & live performances',
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
    description: 'Film, galleries, museums, anime, & pop culture',
    tags: ['Film & Cinema', 'Anime', 'Pop Culture', 'Visual Arts & Galleries', 'Museum Tours'],
  },
  {
    id: 'sports',
    label: 'Sports & Fitness',
    description: 'Team sports, fitness, game-day events, & physical activities',
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
    description: 'Dining, cooking, coffee, food festivals, & drink-focused events',
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
    description: 'Startups, hackathons, AI, software, hardware, & robotics',
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
    description: 'Career fairs, workshops, talks, research, study groups, & professional growth',
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
    description: 'Hiking, camping, climbing, paddling, gardening, & fishing',
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
    description: 'Video games, board games, & trivia',
    tags: ['Video Gaming', 'Board Games', 'Trivia Nights'],
  },
  {
    id: 'social',
    label: 'Social & Networking',
    description: 'Mixers, community gatherings, identity events, service, & cultural exchange',
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
    description: 'Bars, clubs, karaoke, themed parties, raves, & happy hours',
    tags: ['Clubs & Live DJ Sets', 'Karaoke', 'Themed Parties', 'Raves', 'Happy Hour Events'],
  },
  {
    id: 'spirituality',
    label: 'Spirituality & Religion',
    description: 'Religious services, faith communities, interfaith events, & meditation',
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

export const TAG_DESCRIPTIONS: Readonly<Record<string, string>> = {
  Comedy:
    'Live comedy events such as stand-up, improv, sketch comedy, or comedy performances. Do not use just because an event is humorous.',
  Music:
    'Events where listening to or performing music is a central activity, such as concerts, live bands, recitals, or musical showcases.',
  Theater: 'Stage plays, theatrical productions, dramatic performances, or theater-focused events.',
  'Classical & Opera':
    'Classical music, opera, orchestra, choir, chamber music, or formal classical recitals and performances.',
  'Dance Performances':
    'Events centered on watching or presenting dance performances. Do not use for general parties where people may dance.',
  'Poetry & Spoken Word':
    'Poetry readings, spoken-word performances, literary open mics, or events centered on performed poetry.',

  'Film & Cinema':
    'Movie screenings, film festivals, cinema discussions, filmmaking showcases, or events where film is the main subject.',
  Anime:
    'Events specifically centered on anime, manga-related anime culture, anime screenings, or anime fandom.',
  'Pop Culture':
    'Events centered on mainstream entertainment, fandom, celebrities, media franchises, or contemporary popular culture.',
  'Visual Arts & Galleries':
    'Art exhibitions, gallery events, painting, sculpture, photography, or events where viewing or creating visual art is central.',
  'Museum Tours':
    'Events whose main activity is visiting, touring, or exploring museum exhibits. Do not use merely because an event happens at a museum.',

  'Team Sports':
    'Events where attendees play, compete in, practice, or directly participate in a team sport.',
  'Watch Parties & Game Day':
    'Events organized around watching a sports game, tailgating, or participating in game-day fan activities.',
  'Gym & Fitness Classes':
    'Structured exercise, workout, yoga, fitness, or gym classes where attendees actively participate in physical fitness.',
  'Nutrition & Diet':
    'Events primarily focused on nutrition, healthy eating, dietary education, or food choices for health and fitness.',
  'Cycling & Water Sports':
    'Events where cycling, swimming, surfing, paddling, or another water-based sport is a main activity.',
  'Combat Sports':
    'Martial arts, boxing, wrestling, fencing, or other combat-sport practices, competitions, or demonstrations.',
  'Extreme & Adventure Sports':
    'High-adrenaline physical activities such as skydiving, motocross, obstacle racing, or similar adventure sports.',

  'Cocktails, Wine, & Breweries':
    'Events primarily centered on alcoholic drink tasting, cocktails, wine, beer, breweries, or beverage education.',
  'Fine Dining':
    'Formal meals, restaurant dining experiences, hosted dinners, brunches, or food-centered sit-down gatherings.',
  'Street Food & Food Trucks':
    'Events centered on food trucks, street-food vendors, outdoor food markets, or casual vendor-based eating.',
  'Vegan & Vegetarian':
    'Events specifically focused on vegan or vegetarian food, cooking, dining, or plant-based lifestyles.',
  'Coffee, Tea & Baking':
    'Events centered on coffee, tea, cafes, baking, pastries, or related food and drink activities.',
  'International Cuisine':
    'Events where cuisine from a specific country, region, or cultural tradition is a central part of the experience.',
  'Cooking Classes':
    'Hands-on events where attendees learn to cook, bake, prepare food, or practice culinary techniques.',
  'Food Festivals':
    'Large or themed events where trying food from multiple vendors, cuisines, or food activities is a central attraction.',

  'Startup & Entrepreneurship':
    'Events centered on starting companies, entrepreneurship, pitching ideas, founders, venture building, or startup strategy.',
  'AI & Machine Learning':
    'Events primarily about artificial intelligence, machine learning, data-driven AI systems, or AI research and applications.',
  Hardware:
    'Events focused on electronics, devices, circuits, computer hardware, embedded systems, or building physical technology.',
  'Web & App Development':
    'Events centered on programming, software engineering, websites, mobile apps, developer tools, or application development.',
  Cybersecurity:
    'Events focused on computer security, privacy, hacking defense, secure systems, digital threats, or cybersecurity careers.',
  'VR & AR, & Robotics':
    'Events primarily about virtual reality, augmented reality, robotics, autonomous systems, or related interactive technologies.',
  'Hackathons & Tech Conferences':
    'Hackathons, coding competitions, or conferences where technology and technical collaboration are the main purpose.',

  'Career Fairs':
    'Recruiting fairs or employer events where attendees meet recruiters, explore job or internship opportunities, or participate in structured hiring activities. Do not use for speaker bios or general career mentions.',
  'Workshops & Seminars':
    'Structured educational sessions where attendees learn a skill, method, process, or topic through guided instruction or discussion.',
  'Talks & Speaker Series':
    'Lectures, guest talks, panels, presentations, or speaker events where attendees primarily listen to or discuss a presented topic.',
  'Academic Research':
    'Events centered on scholarly research, research findings, academic inquiry, research presentations, or research opportunities.',
  'Personal/Leadership Development':
    'Events focused on leadership, communication, confidence, mentoring, personal growth, or developing non-technical professional skills.',
  'Study Groups':
    'Events where attendees meet specifically to study, review course material, prepare for exams, or learn collaboratively.',
  'Networking & Conferences':
    'Professional or academic networking events, conferences, summits, or gatherings where building professional connections is a central purpose.',
  'Finance & Investing':
    'Events centered on investing, personal finance, financial markets, banking, financial literacy, or finance careers.',

  'Hiking & Backpacking':
    'Outdoor events where attendees will actually hike, backpack, walk trails, or participate in a trail-based excursion. Do not use for general outdoor events or nature-related topics.',
  Camping:
    'Events where camping, staying overnight outdoors, camp setup, or camping skills are a central activity.',
  'Rock Climbing':
    'Events where attendees climb, boulder, learn climbing skills, or participate in climbing-related activities.',
  'Kayaking & Canoeing':
    'Events where attendees kayak, canoe, paddle, or participate in similar small-watercraft activities.',
  'Gardening & Fishing':
    'Events centered on gardening, planting, horticulture, fishing, or hands-on activities involving those practices.',

  'Video Gaming':
    'Events centered on playing, watching, discussing, or competing in video games or esports.',
  'Board Games': 'Events where playing tabletop, card, or board games is the main activity.',
  'Trivia Nights':
    'Trivia competitions, quiz nights, pub quizzes, or events primarily built around answering trivia questions.',

  'Meetups & Mixers':
    'Casual gatherings whose main purpose is meeting people, socializing, or making informal connections without a more specific activity dominating.',
  'Singles & Dating':
    'Events explicitly designed for singles, dating, matchmaking, romantic introductions, or speed dating.',
  'LGBTQ+ Events':
    'Events specifically centered on LGBTQ+ identity, community, pride, advocacy, support, or queer social connection.',
  'Community Service':
    'Volunteer, charity, service, donation, cleanup, outreach, or other events where attendees actively contribute to a community cause.',
  'Cultural Exchange':
    'Events centered on learning about, celebrating, sharing, or experiencing a culture, heritage, identity, or community tradition. Appropriate for heritage celebrations and cross-cultural learning.',

  'Road Trips':
    'Events organized around traveling by car to one or more destinations as a shared road-trip experience.',
  'Budget Travel':
    'Events focused on affordable travel planning, low-cost travel strategies, backpacker travel, or budget-conscious trips.',
  'Study Abroad':
    'Events focused on studying, interning, researching, or participating in academic programs in another country.',

  'Clubs & Live DJ Sets':
    'Nightlife events centered on clubbing, dancing to DJs, or live DJ performances in a club or party setting.',
  Karaoke: 'Events where attendees sing karaoke or participate in karaoke-focused entertainment.',
  'Themed Parties':
    'Social parties organized around a specific theme, costume, motif, or party concept. Do not use just because the word party appears in another context.',
  Raves:
    'Electronic-music dance events, raves, or high-energy nightlife events centered on electronic music and dancing.',
  'Happy Hour Events':
    'Social events specifically centered on happy-hour drinks, bar specials, cocktails, or after-work-style drink gatherings.',

  'Meditation & Mindfulness':
    'Events where attendees actively practice or learn meditation, mindfulness, contemplative techniques, or closely related wellness practices. Do not use for general religion, spirituality, or historical discussion.',
  'Interfaith Events':
    'Events intentionally involving multiple faith traditions, interfaith dialogue, shared religious understanding, or multi-faith community activities.',
  Buddhism:
    'Events specifically centered on Buddhist belief, practice, community, teaching, worship, or Buddhist religious life.',
  Hinduism:
    'Events specifically centered on Hindu belief, practice, community, teaching, worship, festivals, or Hindu religious life.',
  Christianity:
    'Events specifically centered on Christian belief, practice, worship, Bible study, church community, or Christian religious life.',
  Judaism:
    'Events specifically centered on Jewish belief, practice, worship, Jewish community, holidays, or Jewish religious life.',
  Islam:
    'Events specifically centered on Islam, Muslim religious practice, Islamic teaching, worship, Muslim community, or Islamic religious life. Historical or academic discussion of Islam may also fit when Islam is a central subject, but incidental mentions should not trigger it.',
};

export const ALL_TAXONOMY_TAGS: string[] = TAXONOMY_BUCKETS.flatMap((b) => b.tags);

export const BUCKET_ID_SET: ReadonlySet<string> = new Set(TAXONOMY_BUCKETS.map((b) => b.id));

export function getTagDescription(tag: string): string {
  return TAG_DESCRIPTIONS[tag] ?? '';
}
