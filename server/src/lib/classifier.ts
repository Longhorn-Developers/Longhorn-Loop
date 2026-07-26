/**
 * LOOP-221 — keyword classifier
 *
 * Maps event text (title + description) → one or more { bucketId, tag } pairs
 * using the shared taxonomy from LOOP-219.
 *
 * Strategy:
 *  1. Auto-derive keyword signals from every tag name in the taxonomy (split on
 *     word boundaries, 4+ chars, deduplicated).
 *  2. Augment with a hand-tuned keyword list that covers common event-speak not
 *     present verbatim in tag names (e.g. "hackathon" → tech/Hackathons).
 *  3. Search the lowercased event text for each keyword; collect unique
 *     { bucketId, tag } matches.
 *  4. Guarantee ≥1 result by falling back to { bucketId: 'social', tag: 'Meetups & Mixers' }.
 */

import { TAXONOMY_BUCKETS } from '../../../shared/taxonomy';

export type ClassifierMatch = { bucketId: string; tag: string };

// ---------------------------------------------------------------------------
// Hand-tuned keyword supplements
// Each entry maps a keyword (lowercase) → the bucket + tag it should fire.
// These cover vocabulary that doesn't appear word-for-word inside tag labels.
//
// IMPORTANT: every (bucketId, tag) here MUST exist in taxonomy.ts. Entries
// that don't are dropped with a warning at module load (see buildKeywordIndex),
// so a bad pair can never write a phantom event_tags row — but keep this list
// in sync when the taxonomy changes.
// ---------------------------------------------------------------------------
const KEYWORD_SUPPLEMENTS: Array<{ keyword: string; bucketId: string; tag: string }> = [
  // music
  { keyword: 'concert', bucketId: 'music', tag: 'Pop' },
  { keyword: 'band', bucketId: 'music', tag: 'Rock & Alternative' },
  { keyword: 'live music', bucketId: 'music', tag: 'Pop' },
  { keyword: 'open mic', bucketId: 'music', tag: 'Indie & Underground' },
  { keyword: 'playlist', bucketId: 'music', tag: 'Pop' },

  // performing arts (Classical & Opera, Comedy, Poetry, Theater all live here)
  { keyword: 'orchestra', bucketId: 'performing', tag: 'Classical & Opera' },
  { keyword: 'choir', bucketId: 'performing', tag: 'Classical & Opera' },
  { keyword: 'ensemble', bucketId: 'performing', tag: 'Classical & Opera' },
  { keyword: 'recital', bucketId: 'performing', tag: 'Classical & Opera' },
  { keyword: 'opera', bucketId: 'performing', tag: 'Classical & Opera' },
  { keyword: 'play', bucketId: 'performing', tag: 'Theater & Musicals' },
  { keyword: 'theatre', bucketId: 'performing', tag: 'Theater & Musicals' },
  { keyword: 'theater', bucketId: 'performing', tag: 'Theater & Musicals' },
  { keyword: 'musical', bucketId: 'performing', tag: 'Theater & Musicals' },
  { keyword: 'poetry', bucketId: 'performing', tag: 'Poetry & Spoken Word' },
  { keyword: 'spoken word', bucketId: 'performing', tag: 'Poetry & Spoken Word' },
  { keyword: 'comedy', bucketId: 'performing', tag: 'Comedy' },
  { keyword: 'improv', bucketId: 'performing', tag: 'Comedy' },
  { keyword: 'stand-up', bucketId: 'performing', tag: 'Comedy' },
  { keyword: 'standup', bucketId: 'performing', tag: 'Comedy' },
  { keyword: 'magic show', bucketId: 'performing', tag: 'Circus & Magic' },
  { keyword: 'circus', bucketId: 'performing', tag: 'Circus & Magic' },
  { keyword: 'dance performance', bucketId: 'performing', tag: 'Dance Performances' },

  // arts
  { keyword: 'exhibit', bucketId: 'arts', tag: 'Visual Arts & Galleries' },
  { keyword: 'gallery', bucketId: 'arts', tag: 'Visual Arts & Galleries' },
  { keyword: 'mural', bucketId: 'arts', tag: 'Visual Arts & Galleries' },
  { keyword: 'museum', bucketId: 'arts', tag: 'Museum Tours' },
  { keyword: 'film', bucketId: 'arts', tag: 'Film & Cinema' },
  { keyword: 'movie', bucketId: 'arts', tag: 'Film & Cinema' },
  { keyword: 'screening', bucketId: 'arts', tag: 'Film & Cinema' },
  { keyword: 'anime', bucketId: 'arts', tag: 'Anime' },
  { keyword: 'festival', bucketId: 'arts', tag: 'Cultural Festivals' },

  // sports
  { keyword: 'game', bucketId: 'sports', tag: 'Team Sports' },
  { keyword: 'match', bucketId: 'sports', tag: 'Team Sports' },
  { keyword: 'tournament', bucketId: 'sports', tag: 'Team Sports' },
  { keyword: 'intramural', bucketId: 'sports', tag: 'Team Sports' },
  { keyword: 'race', bucketId: 'sports', tag: 'Running & Endurance' },
  { keyword: 'run', bucketId: 'sports', tag: 'Running & Endurance' },
  { keyword: 'marathon', bucketId: 'sports', tag: 'Running & Endurance' },
  { keyword: 'yoga', bucketId: 'sports', tag: 'Yoga & Fitness Classes' },
  { keyword: 'pilates', bucketId: 'sports', tag: 'Yoga & Fitness Classes' },
  { keyword: 'workout', bucketId: 'sports', tag: 'Yoga & Fitness Classes' },
  { keyword: 'fitness', bucketId: 'sports', tag: 'Yoga & Fitness Classes' },
  { keyword: 'swimming', bucketId: 'sports', tag: 'Cycling & Water Sports' },
  { keyword: 'cycling', bucketId: 'sports', tag: 'Cycling & Water Sports' },

  // food
  { keyword: 'tasting', bucketId: 'food', tag: 'Cocktails, Wine, & Breweries' },
  { keyword: 'wine', bucketId: 'food', tag: 'Cocktails, Wine, & Breweries' },
  { keyword: 'beer', bucketId: 'food', tag: 'Cocktails, Wine, & Breweries' },
  { keyword: 'brew', bucketId: 'food', tag: 'Cocktails, Wine, & Breweries' },
  { keyword: 'cocktail', bucketId: 'food', tag: 'Cocktails, Wine, & Breweries' },
  { keyword: 'dining', bucketId: 'food', tag: 'Fine Dining' },
  { keyword: 'dinner', bucketId: 'food', tag: 'Fine Dining' },
  { keyword: 'lunch', bucketId: 'food', tag: 'Fine Dining' },
  { keyword: 'brunch', bucketId: 'food', tag: 'Fine Dining' },
  { keyword: 'breakfast', bucketId: 'food', tag: 'Fine Dining' },
  { keyword: 'bake', bucketId: 'food', tag: 'Coffee, Tea & Baking' },
  { keyword: 'pastry', bucketId: 'food', tag: 'Coffee, Tea & Baking' },
  { keyword: 'coffee', bucketId: 'food', tag: 'Coffee, Tea & Baking' },
  { keyword: 'cafe', bucketId: 'food', tag: 'Coffee, Tea & Baking' },
  { keyword: 'vegan', bucketId: 'food', tag: 'Vegan & Vegetarian' },
  { keyword: 'vegetarian', bucketId: 'food', tag: 'Vegan & Vegetarian' },
  { keyword: 'food truck', bucketId: 'food', tag: 'Street Food & Food Trucks' },
  { keyword: 'cooking class', bucketId: 'food', tag: 'Cooking Classes' },
  { keyword: 'bbq', bucketId: 'food', tag: 'International Cuisine' },

  // tech
  { keyword: 'hackathon', bucketId: 'tech', tag: 'Hackathons & Tech Conferences' },
  { keyword: 'hack', bucketId: 'tech', tag: 'Hackathons & Tech Conferences' },
  { keyword: 'startup', bucketId: 'tech', tag: 'Startup & Entrepreneurship' },
  { keyword: 'pitch', bucketId: 'tech', tag: 'Startup & Entrepreneurship' },
  { keyword: 'entrepreneur', bucketId: 'tech', tag: 'Startup & Entrepreneurship' },
  { keyword: 'coding', bucketId: 'tech', tag: 'Web & App Development' },
  { keyword: 'programming', bucketId: 'tech', tag: 'Web & App Development' },
  { keyword: 'software', bucketId: 'tech', tag: 'Web & App Development' },
  { keyword: 'developer', bucketId: 'tech', tag: 'Web & App Development' },
  { keyword: 'ai', bucketId: 'tech', tag: 'AI & Machine Learning' },
  { keyword: 'machine learning', bucketId: 'tech', tag: 'AI & Machine Learning' },
  { keyword: 'data science', bucketId: 'tech', tag: 'AI & Machine Learning' },
  { keyword: 'cybersecurity', bucketId: 'tech', tag: 'Cybersecurity' },
  { keyword: 'robotics', bucketId: 'tech', tag: 'VR & AR, & Robotics' },

  // education (formerly "learning")
  { keyword: 'workshop', bucketId: 'education', tag: 'Workshops & Seminars' },
  { keyword: 'seminar', bucketId: 'education', tag: 'Workshops & Seminars' },
  { keyword: 'lecture', bucketId: 'education', tag: 'Lectures & Online Courses' },
  { keyword: 'talk', bucketId: 'education', tag: 'Lectures & Online Courses' },
  { keyword: 'panel', bucketId: 'education', tag: 'Lectures & Online Courses' },
  { keyword: 'study group', bucketId: 'education', tag: 'Book Clubs & Study Groups' },
  { keyword: 'tutoring', bucketId: 'education', tag: 'Book Clubs & Study Groups' },
  { keyword: 'book club', bucketId: 'education', tag: 'Book Clubs & Study Groups' },
  { keyword: 'history', bucketId: 'education', tag: 'History & Archaeology' },
  { keyword: 'training', bucketId: 'education', tag: 'Personal Development' },
  { keyword: 'career fair', bucketId: 'education', tag: 'Career Fairs' },

  // science / academia
  { keyword: 'symposium', bucketId: 'science', tag: 'Academic Research' },
  { keyword: 'research', bucketId: 'science', tag: 'Academic Research' },
  { keyword: 'lab', bucketId: 'science', tag: 'Academic Research' },
  { keyword: 'physics', bucketId: 'science', tag: 'Physics & Astronomy' },
  { keyword: 'astronomy', bucketId: 'science', tag: 'Physics & Astronomy' },
  { keyword: 'biology', bucketId: 'science', tag: 'Biology & Life Sciences' },
  { keyword: 'chemistry', bucketId: 'science', tag: 'Chemistry & Mathematics' },
  { keyword: 'math', bucketId: 'science', tag: 'Chemistry & Mathematics' },
  { keyword: 'psychology', bucketId: 'science', tag: 'Psychology & Social Sciences' },
  { keyword: 'philosophy', bucketId: 'science', tag: 'Philosophy' },

  // outdoors
  { keyword: 'hike', bucketId: 'outdoors', tag: 'Hiking & Backpacking' },
  { keyword: 'hiking', bucketId: 'outdoors', tag: 'Hiking & Backpacking' },
  { keyword: 'trail', bucketId: 'outdoors', tag: 'Hiking & Backpacking' },
  { keyword: 'backpack', bucketId: 'outdoors', tag: 'Hiking & Backpacking' },
  { keyword: 'camping', bucketId: 'outdoors', tag: 'Camping' },
  { keyword: 'climbing', bucketId: 'outdoors', tag: 'Rock Climbing' },
  { keyword: 'kayak', bucketId: 'outdoors', tag: 'Kayaking & Canoeing' },
  { keyword: 'canoe', bucketId: 'outdoors', tag: 'Kayaking & Canoeing' },
  { keyword: 'nature', bucketId: 'outdoors', tag: 'Wildlife & Bird Watching' },
  { keyword: 'garden', bucketId: 'outdoors', tag: 'Gardening & Fishing' },
  { keyword: 'fishing', bucketId: 'outdoors', tag: 'Gardening & Fishing' },

  // gaming
  { keyword: 'board game', bucketId: 'gaming', tag: 'Board Games' },
  { keyword: 'tabletop', bucketId: 'gaming', tag: 'Board Games' },
  { keyword: 'card game', bucketId: 'gaming', tag: 'Board Games' },
  { keyword: 'trivia', bucketId: 'gaming', tag: 'Trivia Nights' },
  { keyword: 'pub quiz', bucketId: 'gaming', tag: 'Trivia Nights' },
  { keyword: 'escape room', bucketId: 'gaming', tag: 'Escape Rooms' },
  { keyword: 'video game', bucketId: 'gaming', tag: 'Video Gaming' },
  { keyword: 'esport', bucketId: 'gaming', tag: 'Esports & Competitive Gaming' },
  { keyword: 'gaming', bucketId: 'gaming', tag: 'Video Gaming' },
  { keyword: 'rpg', bucketId: 'gaming', tag: 'Role-Playing Games (RPG)' },

  // social / networking
  { keyword: 'mixer', bucketId: 'social', tag: 'Meetups & Mixers' },
  { keyword: 'meetup', bucketId: 'social', tag: 'Meetups & Mixers' },
  { keyword: 'social', bucketId: 'social', tag: 'Meetups & Mixers' },
  { keyword: 'community', bucketId: 'social', tag: 'Community Service' },
  { keyword: 'volunteer', bucketId: 'social', tag: 'Community Service' },
  { keyword: 'service', bucketId: 'social', tag: 'Community Service' },
  { keyword: 'lgbtq', bucketId: 'social', tag: 'LGBTQ+ Events' },
  { keyword: 'pride', bucketId: 'social', tag: 'LGBTQ+ Events' },
  { keyword: 'club', bucketId: 'social', tag: 'Social Clubs' },

  // health / wellness
  { keyword: 'mental health', bucketId: 'health', tag: 'Mental Health & Therapy' },
  { keyword: 'therapy', bucketId: 'health', tag: 'Mental Health & Therapy' },
  { keyword: 'counseling', bucketId: 'health', tag: 'Mental Health & Therapy' },
  { keyword: 'gym', bucketId: 'health', tag: 'Gym' },
  { keyword: 'nutrition', bucketId: 'health', tag: 'Nutrition & Diet' },
  { keyword: 'meditation', bucketId: 'health', tag: 'Mindfulness Practice' },
  { keyword: 'mindfulness', bucketId: 'health', tag: 'Mindfulness Practice' },
  { keyword: 'wellness', bucketId: 'health', tag: 'Spa, Retreats & Relaxation' },
  { keyword: 'retreat', bucketId: 'health', tag: 'Spa, Retreats & Relaxation' },

  // business / professional
  { keyword: 'case competition', bucketId: 'business', tag: 'Case Competitions' },
  { keyword: 'networking', bucketId: 'business', tag: 'Networking & Conferences' },
  { keyword: 'conference', bucketId: 'business', tag: 'Networking & Conferences' },
  { keyword: 'summit', bucketId: 'business', tag: 'Networking & Conferences' },
  { keyword: 'leadership', bucketId: 'business', tag: 'Leadership Development' },
  { keyword: 'marketing', bucketId: 'business', tag: 'Sales & Marketing' },
  { keyword: 'finance', bucketId: 'business', tag: 'Finance & Investing' },
  { keyword: 'investing', bucketId: 'business', tag: 'Finance & Investing' },
  { keyword: 'real estate', bucketId: 'business', tag: 'Real Estate' },

  // travel
  { keyword: 'abroad', bucketId: 'travel', tag: 'Study Abroad' },
  { keyword: 'study abroad', bucketId: 'travel', tag: 'Study Abroad' },
  { keyword: 'road trip', bucketId: 'travel', tag: 'Road Trips' },

  // nightlife
  { keyword: 'party', bucketId: 'nightlife', tag: 'Themed Parties' },
  { keyword: 'club night', bucketId: 'nightlife', tag: 'Clubs & Live DJ Sets' },
  { keyword: 'dj set', bucketId: 'nightlife', tag: 'Clubs & Live DJ Sets' },
  { keyword: 'karaoke', bucketId: 'nightlife', tag: 'Karaoke' },
  { keyword: 'rave', bucketId: 'nightlife', tag: 'Raves & Electronic Music' },
  { keyword: 'happy hour', bucketId: 'nightlife', tag: 'Happy Hour Events' },
  { keyword: 'silent disco', bucketId: 'nightlife', tag: 'Silent Discos' },

  // spirituality
  { keyword: 'interfaith', bucketId: 'spirituality', tag: 'Interfaith Events' },
  { keyword: 'prayer', bucketId: 'spirituality', tag: 'Interfaith Events' },
  { keyword: 'worship', bucketId: 'spirituality', tag: 'Interfaith Events' },
  { keyword: 'spiritual', bucketId: 'spirituality', tag: 'Meditation & Mindfulness' },
  { keyword: 'church', bucketId: 'spirituality', tag: 'Christianity' },
  { keyword: 'buddhist', bucketId: 'spirituality', tag: 'Buddhism' },
  { keyword: 'hindu', bucketId: 'spirituality', tag: 'Hinduism' },
  { keyword: 'islamic', bucketId: 'spirituality', tag: 'Islam' },
  { keyword: 'muslim', bucketId: 'spirituality', tag: 'Islam' },
  { keyword: 'jewish', bucketId: 'spirituality', tag: 'Judaism' },
];

// ---------------------------------------------------------------------------
// Build keyword index at module load time
// ---------------------------------------------------------------------------

type KeywordEntry = { keyword: string; bucketId: string; tag: string; pattern: RegExp };

/**
 * Build a word-boundary matcher for a keyword. Prevents short keywords from
 * matching inside unrelated words (e.g. "pop" in "popsicles", "ai" in "email"),
 * which was spraying tags across unrelated events. Escapes regex metachars and
 * allows internal whitespace runs to match any whitespace.
 */
function keywordPattern(keyword: string): RegExp {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  // \b works at alnum boundaries; keywords are lowercased alnum + spaces so
  // this reliably anchors to whole words / phrases.
  return new RegExp(`\\b${escaped}\\b`, 'i');
}

/**
 * Valid (bucketId, tag) pairs from the shared taxonomy. A supplement entry
 * whose pair isn't here is dropped at build time, so a taxonomy rename can
 * never let the classifier write a phantom event_tags row.
 */
const VALID_BUCKET_TAGS: ReadonlySet<string> = new Set(
  TAXONOMY_BUCKETS.flatMap((b) => b.tags.map((t) => `${b.id}|${t}`)),
);

/**
 * Valid (bucketId, tag) pairs from the shared taxonomy. A supplement entry
 * whose pair isn't here is dropped at build time, so a taxonomy rename can
 * never let the classifier write a phantom event_tags row.
 */
const VALID_BUCKET_TAGS: ReadonlySet<string> = new Set(
  TAXONOMY_BUCKETS.flatMap((b) => b.tags.map((t) => `${b.id}|${t}`)),
);

/** Deduplicated master list: supplements first, then auto-derived from tag names */
function buildKeywordIndex(): KeywordEntry[] {
  const entries: KeywordEntry[] = [];
  const seen = new Set<string>(); // key = `${keyword}|${bucketId}|${tag}`

  const add = (keyword: string, bucketId: string, tag: string) => {
    const k = `${keyword}|${bucketId}|${tag}`;
    if (!seen.has(k)) {
      seen.add(k);
      entries.push({ keyword, bucketId, tag, pattern: keywordPattern(keyword) });
    }
  };

  // 1. Hand-tuned supplements (highest priority — added first). Skip any pair
  //    that isn't in the taxonomy so stale entries can't leak into event_tags.
  for (const s of KEYWORD_SUPPLEMENTS) {
    if (!s.bucketId || !s.tag) continue;
    if (!VALID_BUCKET_TAGS.has(`${s.bucketId}|${s.tag}`)) {
      console.warn(
        `[classifier] skipping supplement for "${s.keyword}": ` +
          `(${s.bucketId}, ${s.tag}) is not in the taxonomy`,
      );
      continue;
    }
    add(s.keyword.toLowerCase(), s.bucketId, s.tag);
  }

  // 2. Auto-derive from tag names in the taxonomy
  for (const bucket of TAXONOMY_BUCKETS) {
    for (const tag of bucket.tags) {
      // Use the full tag name (lowercased) as a keyword
      add(tag.toLowerCase(), bucket.id, tag);

      // Also split on non-alpha chars and use meaningful words individually.
      // Skip generic words (STOPWORDS) that appear in tag names but don't
      // signal the tag's actual topic — e.g. "international" in "International
      // Cuisine" firing on "international students", "hour" in "Happy Hour"
      // firing on "Summer Soda Hour". The full tag name / phrase supplements
      // still match; we only drop the ambiguous single-word derivations.
      const words = tag
        .toLowerCase()
        .split(/[\s&,/()]+/)
        .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
      for (const word of words) {
        add(word, bucket.id, tag);
      }
    }
  }

  return entries;
}

// Generic words that occur inside tag names but carry no topical signal on
// their own. Excluded from single-word auto-derivation (multi-word supplement
// phrases that contain them, e.g. "happy hour", are unaffected).
const STOPWORDS: ReadonlySet<string> = new Set([
  'events', // in ~a dozen tag names ("Interfaith Events", "LGBTQ+ Events") vs "Special Events Office"
  'event', // same, singular
  'international', // "International Cuisine" vs "international students"
  'hour', // "Happy Hour" vs "Soda Hour", "office hours"
  'play', // "Role-Playing" vs "play while you hang out"
  'board', // "Board Games" vs "advisory board", "board meeting"
  'global', // fires on org names like "Texas Global"
  'general', // "general meeting", "general body"
  'meet', // "meet some friends" — too broad
  'live', // "live" as verb/adverb vs music
  'social', // over-broad; the 'social' supplement handles the real signal
  'personal', // "Personal Development" vs "personal items"
  'development', // "Personal Development" vs "software development", "career development"
  'group', // "Study Groups" vs any "group"
  'club', // "Book Clubs" vs any student "club"
  'academic', // fires on any university event
]);

const KEYWORD_INDEX: KeywordEntry[] = buildKeywordIndex();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify an event by searching its title + description for known keywords.
 * Returns one or more { bucketId, tag } matches.
 * Always returns at least one result (fallback: social / Meetups & Mixers).
 */
export function classifyEvent(title: string, description: string | null): ClassifierMatch[] {
  const haystack = `${title} ${description ?? ''}`.toLowerCase();
  const results = new Map<string, ClassifierMatch>(); // key = `${bucketId}|${tag}`

  for (const entry of KEYWORD_INDEX) {
    if (entry.pattern.test(haystack)) {
      const key = `${entry.bucketId}|${entry.tag}`;
      if (!results.has(key)) {
        results.set(key, { bucketId: entry.bucketId, tag: entry.tag });
      }
    }
  }

  if (results.size === 0) {
    return [{ bucketId: 'social', tag: 'Meetups & Mixers' }];
  }

  return Array.from(results.values());
}

/**
 * Write classifier results for a single event to D1.
 * Clears existing tags first (idempotent / safe to re-run).
 */
export async function writeEventTags(
  db: D1Database,
  eventId: number,
  matches: ClassifierMatch[],
): Promise<void> {
  await db.prepare('DELETE FROM event_tags WHERE event_id = ?').bind(eventId).run();
  for (const { bucketId, tag } of matches) {
    await db
      .prepare(`INSERT OR IGNORE INTO event_tags (event_id, bucket_id, tag) VALUES (?, ?, ?)`)
      .bind(eventId, bucketId, tag)
      .run();
  }
}
