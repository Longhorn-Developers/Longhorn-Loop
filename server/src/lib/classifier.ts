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

import { TAXONOMY_BUCKETS, type TaxonomyBucket } from './taxonomy';

export type ClassifierMatch = { bucketId: string; tag: string };

// ---------------------------------------------------------------------------
// Hand-tuned keyword supplements
// Each entry maps a keyword (lowercase) → the bucket + tag it should fire.
// These cover vocabulary that doesn't appear word-for-word inside tag labels.
// ---------------------------------------------------------------------------
const KEYWORD_SUPPLEMENTS: Array<{ keyword: string; bucketId: string; tag: string }> = [
  // music
  { keyword: 'concert', bucketId: 'music', tag: 'Pop & Top 40' },
  { keyword: 'band', bucketId: 'music', tag: 'Rock & Alternative' },
  { keyword: 'live music', bucketId: 'music', tag: 'Pop & Top 40' },
  { keyword: 'open mic', bucketId: 'music', tag: 'Indie & Underground' },
  { keyword: 'dj set', bucketId: 'music', tag: 'Electronic & EDM' },
  { keyword: 'orchestra', bucketId: 'music', tag: 'Classical & Opera' },
  { keyword: 'choir', bucketId: 'music', tag: 'Classical & Opera' },
  { keyword: 'ensemble', bucketId: 'music', tag: 'Classical & Opera' },
  { keyword: 'recital', bucketId: 'music', tag: 'Classical & Opera' },
  { keyword: 'playlist', bucketId: 'music', tag: 'Pop & Top 40' },

  // arts
  { keyword: 'exhibit', bucketId: 'arts', tag: 'Art Exhibitions & Galleries' },
  { keyword: 'gallery', bucketId: 'arts', tag: 'Art Exhibitions & Galleries' },
  { keyword: 'museum', bucketId: 'arts', tag: 'Museum Tours' },
  { keyword: 'play', bucketId: 'arts', tag: 'Theater & Broadway' },
  { keyword: 'theatre', bucketId: 'arts', tag: 'Theater & Broadway' },
  { keyword: 'theater', bucketId: 'arts', tag: 'Theater & Broadway' },
  { keyword: 'film', bucketId: 'arts', tag: 'Film & Cinema' },
  { keyword: 'movie', bucketId: 'arts', tag: 'Film & Cinema' },
  { keyword: 'screening', bucketId: 'arts', tag: 'Film & Cinema' },
  { keyword: 'anime', bucketId: 'arts', tag: 'Anime' },
  { keyword: 'mural', bucketId: 'arts', tag: 'Street Art & Graffiti' },
  { keyword: 'poetry', bucketId: 'arts', tag: 'Poetry & Spoken Word' },
  { keyword: 'spoken word', bucketId: 'arts', tag: 'Poetry & Spoken Word' },

  // sports
  { keyword: 'game', bucketId: 'sports', tag: 'Football & Soccer' },
  { keyword: 'tournament', bucketId: 'sports', tag: 'Tennis & Racquet Sports' },
  { keyword: 'match', bucketId: 'sports', tag: 'Football & Soccer' },
  { keyword: 'race', bucketId: 'sports', tag: 'Running & Marathon' },
  { keyword: 'run', bucketId: 'sports', tag: 'Running & Marathon' },
  { keyword: 'marathon', bucketId: 'sports', tag: 'Running & Marathon' },
  { keyword: 'workout', bucketId: 'sports', tag: 'CrossFit & HIIT' },
  { keyword: 'gym', bucketId: 'sports', tag: 'CrossFit & HIIT' },
  { keyword: 'yoga', bucketId: 'sports', tag: 'Yoga & Meditation' },
  { keyword: 'pilates', bucketId: 'sports', tag: 'Yoga & Meditation' },
  { keyword: 'swimming', bucketId: 'sports', tag: 'Swimming & Water Sports' },
  { keyword: 'intramural', bucketId: 'sports', tag: 'Football & Soccer' },

  // food
  { keyword: 'tasting', bucketId: 'food', tag: 'Wine Tasting' },
  { keyword: 'wine', bucketId: 'food', tag: 'Wine Tasting' },
  { keyword: 'beer', bucketId: 'food', tag: 'Craft Beer & Breweries' },
  { keyword: 'brew', bucketId: 'food', tag: 'Craft Beer & Breweries' },
  { keyword: 'cocktail', bucketId: 'food', tag: 'Cocktails & Mixology' },
  { keyword: 'dining', bucketId: 'food', tag: 'Fine Dining' },
  { keyword: 'dinner', bucketId: 'food', tag: 'Fine Dining' },
  { keyword: 'lunch', bucketId: 'food', tag: 'Fine Dining' },
  { keyword: 'brunch', bucketId: 'food', tag: 'Fine Dining' },
  { keyword: 'breakfast', bucketId: 'food', tag: 'Fine Dining' },
  { keyword: 'bake', bucketId: 'food', tag: 'Baking & Pastries' },
  { keyword: 'pastry', bucketId: 'food', tag: 'Baking & Pastries' },
  { keyword: 'coffee', bucketId: 'food', tag: 'Coffee & Tea' },
  { keyword: 'cafe', bucketId: 'food', tag: 'Coffee & Tea' },
  { keyword: 'vegan', bucketId: 'food', tag: 'Vegan & Vegetarian' },
  { keyword: 'vegetarian', bucketId: 'food', tag: 'Vegan & Vegetarian' },
  { keyword: 'food truck', bucketId: 'food', tag: 'Street Food & Food Trucks' },
  { keyword: 'bbq', bucketId: 'food', tag: 'International Cuisine' },

  // tech
  { keyword: 'hackathon', bucketId: 'tech', tag: 'Hackathons' },
  { keyword: 'hack', bucketId: 'tech', tag: 'Hackathons' },
  { keyword: 'startup', bucketId: 'tech', tag: 'Startup & Entrepreneurship' },
  { keyword: 'pitch', bucketId: 'tech', tag: 'Startup & Entrepreneurship' },
  { keyword: 'coding', bucketId: 'tech', tag: 'Web Development' },
  { keyword: 'programming', bucketId: 'tech', tag: 'Web Development' },
  { keyword: 'software', bucketId: 'tech', tag: 'Web Development' },
  { keyword: 'developer', bucketId: 'tech', tag: 'Web Development' },
  { keyword: 'ai', bucketId: 'tech', tag: 'AI & Machine Learning' },
  { keyword: 'machine learning', bucketId: 'tech', tag: 'AI & Machine Learning' },
  { keyword: 'data science', bucketId: 'tech', tag: 'AI & Machine Learning' },
  { keyword: 'crypto', bucketId: 'tech', tag: 'Blockchain & Crypto' },
  { keyword: 'blockchain', bucketId: 'tech', tag: 'Blockchain & Crypto' },
  { keyword: 'cybersecurity', bucketId: 'tech', tag: 'Cybersecurity' },
  { keyword: 'esport', bucketId: 'tech', tag: 'Gaming & Esports' },
  { keyword: 'gaming', bucketId: 'tech', tag: 'Gaming & Esports' },

  // learning
  { keyword: 'workshop', bucketId: 'learning', tag: 'Workshops & Seminars' },
  { keyword: 'seminar', bucketId: 'learning', tag: 'Workshops & Seminars' },
  { keyword: 'lecture', bucketId: 'learning', tag: 'Academic Lectures' },
  { keyword: 'talk', bucketId: 'learning', tag: 'Academic Lectures' },
  { keyword: 'panel', bucketId: 'learning', tag: 'Academic Lectures' },
  { keyword: 'symposium', bucketId: 'learning', tag: 'Research Symposiums' },
  { keyword: 'research', bucketId: 'learning', tag: 'Undergraduate Research' },
  { keyword: 'study', bucketId: 'learning', tag: 'Study Groups' },
  { keyword: 'tutoring', bucketId: 'learning', tag: 'Study Groups' },
  { keyword: 'book club', bucketId: 'learning', tag: 'Book Clubs' },
  { keyword: 'language', bucketId: 'learning', tag: 'Language Learning' },
  { keyword: 'training', bucketId: 'learning', tag: 'Personal Development' },

  // outdoors
  { keyword: 'hike', bucketId: 'outdoors', tag: 'Hiking & Trekking' },
  { keyword: 'hiking', bucketId: 'outdoors', tag: 'Hiking & Trekking' },
  { keyword: 'camping', bucketId: 'outdoors', tag: 'Camping' },
  { keyword: 'nature', bucketId: 'outdoors', tag: 'Wildlife & Bird Watching' },
  { keyword: 'garden', bucketId: 'outdoors', tag: 'Gardening' },
  { keyword: 'trail', bucketId: 'outdoors', tag: 'Hiking & Trekking' },
  { keyword: 'kayak', bucketId: 'outdoors', tag: 'Kayaking & Canoeing' },
  { keyword: 'canoe', bucketId: 'outdoors', tag: 'Kayaking & Canoeing' },
  { keyword: 'fishing', bucketId: 'outdoors', tag: 'Fishing' },
  { keyword: 'environment', bucketId: 'outdoors', tag: 'Environmental Conservation' },

  // gaming (board/tabletop/video)
  { keyword: 'board game', bucketId: 'gaming', tag: 'Board Games & Tabletop' },
  { keyword: 'tabletop', bucketId: 'gaming', tag: 'Board Games & Tabletop' },
  { keyword: 'card game', bucketId: 'gaming', tag: 'Card Games' },
  { keyword: 'trivia', bucketId: 'gaming', tag: 'Trivia Nights' },
  { keyword: 'escape room', bucketId: 'gaming', tag: 'Escape Rooms' },
  { keyword: 'video game', bucketId: 'gaming', tag: 'Video Gaming' },
  { keyword: 'rpg', bucketId: 'gaming', tag: 'Role-Playing Games (RPG)' },
  { keyword: 'comedy', bucketId: 'gaming', tag: 'Comedy Shows' },

  // social / networking
  { keyword: 'mixer', bucketId: 'social', tag: 'Meetups & Mixers' },
  { keyword: 'meetup', bucketId: 'social', tag: 'Meetups & Mixers' },
  { keyword: 'networking', bucketId: 'social', tag: 'Speed Networking' },
  { keyword: 'social', bucketId: 'social', tag: 'Meetups & Mixers' },
  { keyword: 'community', bucketId: 'social', tag: 'Community Service' },
  { keyword: 'volunteer', bucketId: 'social', tag: 'Community Service' },
  { keyword: 'service', bucketId: 'social', tag: 'Community Service' },
  { keyword: 'lgbtq', bucketId: 'social', tag: 'LGBTQ+ Events' },
  { keyword: 'pride', bucketId: 'social', tag: 'LGBTQ+ Events' },
  { keyword: 'alumni', bucketId: 'social', tag: 'Alumni Gatherings' },
  { keyword: 'club', bucketId: 'social', tag: 'Social Clubs' },

  // health / wellness
  { keyword: 'mental health', bucketId: 'health', tag: 'Mental Health & Therapy' },
  { keyword: 'wellness', bucketId: 'health', tag: 'Holistic Health' },
  { keyword: 'meditation', bucketId: 'health', tag: 'Mindfulness & Meditation' },
  { keyword: 'mindfulness', bucketId: 'health', tag: 'Mindfulness & Meditation' },
  { keyword: 'nutrition', bucketId: 'health', tag: 'Nutrition & Diet' },
  { keyword: 'health', bucketId: 'health', tag: 'Holistic Health' },
  { keyword: 'therapy', bucketId: 'health', tag: 'Mental Health & Therapy' },
  { keyword: 'counseling', bucketId: 'health', tag: 'Mental Health & Therapy' },
  { keyword: 'fitness', bucketId: 'health', tag: 'Fitness Challenges' },

  // business / professional
  { keyword: 'career fair', bucketId: 'business', tag: 'Career Fairs' },
  { keyword: 'career', bucketId: 'business', tag: 'Career & Professional Growth' },
  { keyword: 'internship', bucketId: 'business', tag: 'Career & Professional Growth' },
  { keyword: 'resume', bucketId: 'business', tag: 'Career & Professional Growth' },
  { keyword: 'interview', bucketId: 'business', tag: 'Career & Professional Growth' },
  { keyword: 'case competition', bucketId: 'business', tag: 'Case Competitions' },
  { keyword: 'conference', bucketId: 'business', tag: 'Conferences & Summits' },
  { keyword: 'summit', bucketId: 'business', tag: 'Conferences & Summits' },
  { keyword: 'leadership', bucketId: 'business', tag: 'Leadership Development' },
  { keyword: 'finance', bucketId: 'business', tag: 'Finance & Investing' },
  { keyword: 'investing', bucketId: 'business', tag: 'Finance & Investing' },
  { keyword: 'marketing', bucketId: 'business', tag: 'Sales & Marketing' },
  { keyword: 'entrepreneur', bucketId: 'tech', tag: 'Startup & Entrepreneurship' },

  // performing arts
  { keyword: 'improv', bucketId: 'performing', tag: 'Improv & Sketch' },
  { keyword: 'stand-up', bucketId: 'performing', tag: 'Stand-Up Comedy' },
  { keyword: 'standup', bucketId: 'performing', tag: 'Stand-Up Comedy' },
  { keyword: 'magic show', bucketId: 'performing', tag: 'Magic Shows' },
  { keyword: 'circus', bucketId: 'performing', tag: 'Circus & Acrobatics' },
  { keyword: 'musical', bucketId: 'performing', tag: 'Musical Theater' },
  { keyword: 'opera', bucketId: 'performing', tag: 'Opera & Classical Performance' },

  // nightlife
  { keyword: 'party', bucketId: 'nightlife', tag: 'Themed Parties' },
  { keyword: 'club night', bucketId: 'nightlife', tag: 'Clubs & Dancing' },
  { keyword: 'bar hop', bucketId: 'nightlife', tag: 'Bar Hopping' },
  { keyword: 'karaoke', bucketId: 'nightlife', tag: 'Karaoke' },
  { keyword: 'rave', bucketId: 'nightlife', tag: 'Raves & Electronic Music' },
  { keyword: 'happy hour', bucketId: 'nightlife', tag: 'Happy Hour Events' },
  { keyword: 'pub quiz', bucketId: 'nightlife', tag: 'Pub Quizzes' },
  { keyword: 'rooftop', bucketId: 'nightlife', tag: 'Rooftop Bars' },

  // science / academia
  { keyword: 'physics', bucketId: 'science', tag: 'Physics & Astronomy' },
  { keyword: 'astronomy', bucketId: 'science', tag: 'Physics & Astronomy' },
  { keyword: 'biology', bucketId: 'science', tag: 'Biology & Life Sciences' },
  { keyword: 'chemistry', bucketId: 'science', tag: 'Chemistry' },
  { keyword: 'math', bucketId: 'science', tag: 'Mathematics' },
  { keyword: 'psychology', bucketId: 'science', tag: 'Psychology' },
  { keyword: 'philosophy', bucketId: 'science', tag: 'Philosophy' },
  { keyword: 'lab', bucketId: 'science', tag: 'Lab Tours & Demos' },
  { keyword: 'demo', bucketId: 'science', tag: 'Lab Tours & Demos' },

  // travel
  { keyword: 'travel', bucketId: 'travel', tag: 'Travel Meetups' },
  { keyword: 'abroad', bucketId: 'travel', tag: 'Study Abroad' },
  { keyword: 'study abroad', bucketId: 'travel', tag: 'Study Abroad' },
  { keyword: 'road trip', bucketId: 'travel', tag: 'Road Trips' },
  { keyword: 'backpack', bucketId: 'travel', tag: 'Backpacking' },

  // pets
  { keyword: 'dog', bucketId: 'pets', tag: 'Dog Meetups & Walks' },
  { keyword: 'puppy', bucketId: 'pets', tag: 'Dog Meetups & Walks' },
  { keyword: 'cat', bucketId: 'pets', tag: 'Cat Cafes & Events' },
  { keyword: 'pet', bucketId: 'pets', tag: 'Pet-Friendly Activities' },
  { keyword: 'animal', bucketId: 'pets', tag: 'Animal Rescue & Advocacy' },
  { keyword: 'adoption', bucketId: 'pets', tag: 'Pet Adoption Events' },

  // home / lifestyle
  { keyword: 'interior design', bucketId: 'home', tag: 'Interior Design' },
  { keyword: 'diy', bucketId: 'home', tag: 'DIY & Home Improvement' },
  { keyword: 'sustainable', bucketId: 'home', tag: 'Sustainable Living' },
  { keyword: 'decor', bucketId: 'home', tag: 'Home Decor' },

  // shopping / fashion
  { keyword: 'fashion', bucketId: 'shopping', tag: 'Fashion Shows' },
  { keyword: 'thrift', bucketId: 'shopping', tag: 'Vintage & Thrift' },
  { keyword: 'vintage', bucketId: 'shopping', tag: 'Vintage & Thrift' },
  { keyword: 'pop-up shop', bucketId: 'shopping', tag: 'Pop-Up Shops' },
  { keyword: 'pop up shop', bucketId: 'shopping', tag: 'Pop-Up Shops' },
  { keyword: 'beauty', bucketId: 'shopping', tag: 'Beauty & Makeup' },

  // spirituality
  { keyword: 'prayer', bucketId: 'spirituality', tag: 'Prayer Groups' },
  { keyword: 'worship', bucketId: 'spirituality', tag: 'Religious Services' },
  { keyword: 'church', bucketId: 'spirituality', tag: 'Christian Fellowship' },
  { keyword: 'interfaith', bucketId: 'spirituality', tag: 'Interfaith Dialogue' },
  { keyword: 'spiritual', bucketId: 'spirituality', tag: 'New Age & Metaphysical' },
  { keyword: 'buddhist', bucketId: 'spirituality', tag: 'Buddhist Teachings' },
  { keyword: 'islamic', bucketId: 'spirituality', tag: 'Islamic Gatherings' },
  { keyword: 'jewish', bucketId: 'spirituality', tag: 'Jewish Community Events' },
];

// ---------------------------------------------------------------------------
// Build keyword index at module load time
// ---------------------------------------------------------------------------

type KeywordEntry = { keyword: string; bucketId: string; tag: string };

/** Deduplicated master list: supplements first, then auto-derived from tag names */
function buildKeywordIndex(): KeywordEntry[] {
  const entries: KeywordEntry[] = [];
  const seen = new Set<string>(); // key = `${keyword}|${bucketId}|${tag}`

  const add = (keyword: string, bucketId: string, tag: string) => {
    const k = `${keyword}|${bucketId}|${tag}`;
    if (!seen.has(k)) {
      seen.add(k);
      entries.push({ keyword, bucketId, tag });
    }
  };

  // 1. Hand-tuned supplements (highest priority — added first)
  for (const s of KEYWORD_SUPPLEMENTS) {
    if (s.bucketId && s.tag) add(s.keyword.toLowerCase(), s.bucketId, s.tag);
  }

  // 2. Auto-derive from tag names in the taxonomy
  for (const bucket of TAXONOMY_BUCKETS) {
    for (const tag of bucket.tags) {
      // Use the full tag name (lowercased) as a keyword
      add(tag.toLowerCase(), bucket.id, tag);

      // Also split on non-alpha chars and use meaningful words individually
      const words = tag
        .toLowerCase()
        .split(/[\s&,/()]+/)
        .filter((w) => w.length >= 4);
      for (const word of words) {
        add(word, bucket.id, tag);
      }
    }
  }

  return entries;
}

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
    if (haystack.includes(entry.keyword)) {
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
