// Turns the building codes UT students actually write into coordinates.
//
// THE PROBLEM. Ten of the twelve scrapers set `latitude: null` outright --
// only HornsLink and Pharmacy get coordinates from their feed. Everything
// else arrives with a location string and nothing else, so the Explore map
// had almost nothing to pin. And those strings are written for students:
// "GSB 2.126", "utc 2.102", "Welch 2.224". Nobody publishes a latitude next
// to a room number.
//
// data/ut-buildings.json is the single source of truth -- 204 buildings from
// UT's own Building Information pages, with coordinates taken from the marker
// on each building's official page. Coordinates appear nowhere else in this
// repo; when UT moves a building, that file is the only edit.

import buildingData from '../data/ut-buildings.json';

export interface UtBuilding {
  code: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
}

interface RawBuilding {
  code: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
}

/**
 * Campus bounds, as a last line of defence.
 *
 * Every entry in the file is inside these already. The check is here to catch
 * the failure that would otherwise reach the map silently: a latitude and
 * longitude swapped somewhere between here and the marker. Reversed UT
 * coordinates put a pin at 30°N 97°E, which is in western China, and a map
 * that flies to China is much harder to trace back than a building that
 * simply refuses to resolve.
 */
const CAMPUS_BOUNDS = { minLat: 29.5, maxLat: 31, minLng: -98.5, maxLng: -96.5 };

function isPlausible(b: RawBuilding): boolean {
  return (
    Number.isFinite(b.latitude) &&
    Number.isFinite(b.longitude) &&
    b.latitude >= CAMPUS_BOUNDS.minLat &&
    b.latitude <= CAMPUS_BOUNDS.maxLat &&
    b.longitude >= CAMPUS_BOUNDS.minLng &&
    b.longitude <= CAMPUS_BOUNDS.maxLng
  );
}

/**
 * Names students use that are not the official code.
 *
 * Kept OUT of the JSON on purpose: that file is regenerated from UT's own
 * data, and anything hand-added to it would be lost on the next regeneration.
 * This table is the place for local knowledge.
 *
 * SAC is the one that matters most. The building is officially WCP -- William
 * C. Powers, Jr. Student Activity Center -- and "SAC" appears nowhere in UT's
 * data, but it is what every student and half the event listings call it.
 */
export const LOCATION_ALIASES: Record<string, string> = {
  SAC: 'WCP',
  'STUDENT ACTIVITY CENTER': 'WCP',
  'UT TOWER': 'MAI',
  TOWER: 'MAI',
  'MAIN BUILDING': 'MAI',
  'THE TOWER': 'MAI',
  // Reliably written out rather than coded, and long enough to be unambiguous.
  'GREGORY GYM': 'GRE',
  'GREGORY GYMNASIUM': 'GRE',
  'PERRY CASTANEDA LIBRARY': 'PCL',
  'JESTER CENTER': 'JES',
};

/**
 * Codes that are also ordinary English words.
 *
 * AND is Andrews Residence Hall. Without this list, "Jester and Gregory Gym"
 * resolves to Andrews, and it does so confidently. ART, BIO, GAR, PAR, SEA
 * and WIN have the same problem in milder form.
 *
 * These still resolve -- they are real buildings and "ART 1.102" has to work
 * -- but only when the code LEADS the location string, which is how a room
 * reference is written and is not how a conjunction appears.
 */
const AMBIGUOUS_CODES = new Set(['AND', 'ART', 'BIO', 'GAR', 'PAR', 'SEA', 'WIN', 'TOWER']);

/**
 * Locations that are not places. These resolve to null and, unlike a building
 * we simply failed to recognise, are never logged -- an online event with no
 * pin is correct behaviour, not a gap in the data.
 */
const NON_PHYSICAL = [
  'ONLINE',
  'ZOOM',
  'TEAMS',
  'MICROSOFT TEAMS',
  'WEBEX',
  'GOOGLE MEET',
  'VIRTUAL',
  'TBA',
  'TBD',
  'OFF CAMPUS',
  'OFF-CAMPUS',
  'UNKNOWN',
  'N/A',
  'REMOTE',
  'LIVESTREAM',
  'LIVE STREAM',
];

const RAW: Record<string, RawBuilding> = buildingData.buildings as Record<string, RawBuilding>;

function toBuilding(raw: RawBuilding): UtBuilding {
  return {
    code: raw.code,
    name: raw.name,
    address: raw.address,
    latitude: raw.latitude,
    longitude: raw.longitude,
  };
}

const BY_CODE = new Map<string, UtBuilding>();
for (const raw of Object.values(RAW)) {
  if (isPlausible(raw)) BY_CODE.set(raw.code.toUpperCase(), toBuilding(raw));
}

/** Uppercase, punctuation to spaces, whitespace collapsed. */
function normalize(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Official names, longest first.
 *
 * Longest-first matters: "ART BUILDING AND MUSEUM" and "ART" would both match
 * a location containing the former, and the longer name is the more specific
 * claim. Sorting once here beats deciding per lookup.
 */
const BY_NAME: { key: string; building: UtBuilding }[] = [];
for (const building of BY_CODE.values()) {
  const key = normalize(building.name).replace(/\s+(BLDG|BUILDING)$/, '');
  // Short names are too loose to match inside a sentence. "2400 NUECES"
  // normalises to seven characters and would fire on any address containing
  // that number.
  if (key.length >= 9) BY_NAME.push({ key, building });
}
BY_NAME.sort((a, b) => b.key.length - a.key.length);

/**
 * Aliases split by shape, because one word and several behave differently.
 *
 * A multi-word alias is safe to look for anywhere in a string -- "Student
 * Activity Center" means one thing. A single word is not: TOWER matched inside
 * '"HQ" Room, Floor 1 North Tower, EER Building' and sent an engineering
 * lecture to the top of the UT Tower. Single words therefore go through the
 * same token path as codes, where the ambiguity rule applies to them.
 */
const ALIAS_EXACT = new Map<string, UtBuilding>();
const ALIAS_TOKENS = new Map<string, UtBuilding>();
const ALIAS_PHRASES: { key: string; building: UtBuilding }[] = [];
for (const [alias, code] of Object.entries(LOCATION_ALIASES)) {
  const building = BY_CODE.get(code.toUpperCase());
  if (!building) continue;
  const key = normalize(alias);
  ALIAS_EXACT.set(key, building);
  if (key.includes(' ')) ALIAS_PHRASES.push({ key, building });
  else ALIAS_TOKENS.set(key, building);
}
// Longest first, so "STUDENT ACTIVITY CENTER" wins over a shorter overlap.
ALIAS_PHRASES.sort((a, b) => b.key.length - a.key.length);

/** True for "Online", "Zoom", "TBA" and friends -- absent, not unrecognised. */
export function isNonPhysicalLocation(location: string | null | undefined): boolean {
  if (!location || !location.trim()) return true;
  const normalized = normalize(location);
  return NON_PHYSICAL.some(
    (term) => normalized === term || normalized.startsWith(`${term} `) || normalized.includes(` ${term} `),
  );
}

/**
 * Resolve a scraped location string to a UT building, or null.
 *
 * Order, most confident first:
 *   1. the whole string is an alias  ("Student Activity Center")
 *   2. the whole string is a code    ("GSB", "utc")
 *   3. an alias appears in the string
 *   4. a code appears as its own word ("GSB 2.126", "Welch Hall (WEL)")
 *   5. an official building name appears in the string
 *
 * Codes are matched as WORDS, never as substrings. Substring matching finds
 * "ART" inside "PARTY" and "BEN" inside "BENCH", and there are 204 codes to
 * collide with.
 */
export function resolveBuilding(location: string | null | undefined): UtBuilding | null {
  if (!location) return null;
  const normalized = normalize(location);
  if (!normalized) return null;

  const exactAlias = ALIAS_EXACT.get(normalized);
  if (exactAlias) return exactAlias;

  const exactCode = BY_CODE.get(normalized);
  if (exactCode) return exactCode;

  for (const { key, building } of ALIAS_PHRASES) {
    if (normalized.includes(key)) return building;
  }

  const tokens = normalized.split(' ');
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const building = BY_CODE.get(token) ?? ALIAS_TOKENS.get(token);
    if (!building) continue;
    // An ambiguous code only counts when it leads, which is how a room
    // reference reads. Anywhere else it is probably just the English word.
    if (AMBIGUOUS_CODES.has(token) && i !== 0) continue;
    return building;
  }

  for (const { key, building } of BY_NAME) {
    if (normalized.includes(key)) return building;
  }

  return null;
}
