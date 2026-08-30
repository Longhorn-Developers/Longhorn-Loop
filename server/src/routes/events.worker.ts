// Events routes for Cloudflare Worker
import { Hono } from 'hono';
import { parseStoredAvatarConfig } from '../../../shared/avatar';
import {
  MAX_BENEFIT_COUNT,
  MAX_BENEFIT_NAME_LENGTH,
  normalizeBenefitName,
} from '../../../shared/eventBenefits';
import { BUCKET_ID_SET, TAXONOMY_BUCKETS } from '../../../shared/taxonomy';
import { classifyAspectRatio, parseImageDimensions } from '../events/normalize';
import type { ImageAspectRatio } from '../events/types';
import { blockedAuthorFilter, blockedUserFilter, isBlockedBetween } from '../lib/blocks';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  extensionForMimeType,
  isFileLike,
  MAX_IMAGE_BYTES,
} from '../lib/images';
import { getAuthUser, getUserId } from '../lib/utils';
import { getManualScraper, SCRAPERS } from '../scrapers/registry';
import type { Env } from '../worker';

export const eventRoutes = new Hono<{ Bindings: Env }>();

// Once an event has this many reports it's filtered from feeds globally.
const REPORT_HIDE_THRESHOLD = 5;

const REPORT_REASONS = new Set(['violent_harmful', 'misinformation', 'troll_spam', 'other']);
const USER_CREATED_SOURCE = 'user_created';
const MAX_TITLE_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_LOCATION_LENGTH = 200;
const MAX_URL_LENGTH = 2048;
const MAX_CATEGORY_COUNT = 20;
const MAX_CATEGORY_NAME_LENGTH = 120;
const EXPIRES_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const ISO_8601_WITH_TIMEZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const VALID_IMAGE_ASPECT_RATIOS = new Set<ImageAspectRatio>([
  'vertical',
  'square',
  'horizontal',
  'none',
]);
const THEME_BY_DISCOVERY_BUCKET: Record<string, string> = {
  music: 'Music',
  arts: 'Arts',
  sports: 'Sports',
  food: 'Social',
  tech: 'Technology',
  education: 'Academic',
  learning: 'Academic',
  outdoors: 'Outdoors',
  gaming: 'Social',
  social: 'Social',
  health: 'Health',
  shopping: 'Social',
  business: 'Business',
  performing: 'Arts',
  travel: 'Social',
  pets: 'Social',
  home: 'Social',
  nightlife: 'Social',
  science: 'Academic',
  spirituality: 'Spirituality',
};

type ValidationErrors = Record<string, string>;
type CreateEventBody = Record<string, unknown>;

type AuthDbUser = {
  id: number;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
};

type NormalizedCategory = {
  id: string;
  name: string | null;
};

type ImageFields = {
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  imageAspectRatio: ImageAspectRatio;
  imageMimeType: string | null;
  imageAltText: string | null;
};

async function getUserByEmail(db: D1Database, email: string): Promise<AuthDbUser | null> {
  const row = await db
    .prepare('SELECT id, email, first_name, last_name FROM users WHERE email = ?')
    .bind(email)
    .first();
  if (!row) return null;
  return {
    id: row.id as number,
    email: row.email as string,
    first_name: (row.first_name as string | null | undefined) ?? null,
    last_name: (row.last_name as string | null | undefined) ?? null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readStringField(body: CreateEventBody, keys: string[]): string | null {
  for (const key of keys) {
    const value = cleanString(body[key]);
    if (value !== null) return value;
  }
  return null;
}

/**
 * Whether the caller actually mentioned a field.
 *
 * PATCH needs this and POST does not: readStringField answers "is there a
 * usable value here", which collapses "absent" and "present but empty" into
 * the same null. A partial update has to tell those apart — omitting
 * `description` must leave the column alone, while sending `description: ""`
 * is a deliberate clear.
 */
function hasField(body: CreateEventBody, keys: string[]): boolean {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(body, key));
}

function readIntegerField(body: CreateEventBody, keys: string[]): number | null {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
      const parsed = Number(value);
      if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
    }
  }
  return null;
}

function readNumberField(body: CreateEventBody, keys: string[]): number | null {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function parseRequiredString(
  body: CreateEventBody,
  keys: string[],
  field: string,
  maxLength: number,
  errors: ValidationErrors,
): string | null {
  const value = readStringField(body, keys);
  if (!value) {
    errors[field] = 'Required';
    return null;
  }
  if (value.length > maxLength) {
    errors[field] = `Must be ${maxLength} characters or fewer`;
    return null;
  }
  return value;
}

function parseOptionalString(
  body: CreateEventBody,
  keys: string[],
  field: string,
  maxLength: number,
  errors: ValidationErrors,
): string | null {
  const value = readStringField(body, keys);
  if (!value) return null;
  if (value.length > maxLength) {
    errors[field] = `Must be ${maxLength} characters or fewer`;
    return null;
  }
  return value;
}

function parseIsoDatetime(
  value: string | null,
  field: string,
  required: boolean,
  errors: ValidationErrors,
): string | null {
  if (!value) {
    if (required) errors[field] = 'Required';
    return null;
  }
  if (!ISO_8601_WITH_TIMEZONE.test(value)) {
    errors[field] = 'Must be an ISO 8601 datetime with timezone';
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    errors[field] = 'Must be a valid datetime';
    return null;
  }
  return parsed.toISOString();
}

function computeExpiresAt(endDatetime: string, startDatetime: string): string {
  const base = endDatetime || startDatetime;
  return new Date(new Date(base).getTime() + EXPIRES_AFTER_MS).toISOString();
}

function truncateLocation(location: string | null): string | null {
  if (!location) return null;
  if (location.length <= 40) return location;
  return `${location.slice(0, 37)}...`;
}

function validateUrl(value: string | null, field: string, errors: ValidationErrors): string | null {
  if (!value) return null;
  if (value.length > MAX_URL_LENGTH) {
    errors[field] = `Must be ${MAX_URL_LENGTH} characters or fewer`;
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      errors[field] = 'Must be an http or https URL';
      return null;
    }
    return url.toString();
  } catch {
    errors[field] = 'Must be a valid URL';
    return null;
  }
}

function slugifyCategoryId(name: string, index: number): string {
  const slug = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `category-${index + 1}`;
}

function normalizeCategories(
  body: CreateEventBody,
  errors: ValidationErrors,
): NormalizedCategory[] {
  const raw = body.categories ?? body.interestTags ?? body.interest_tags;
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.categories = 'Must be an array';
    return [];
  }
  if (raw.length > MAX_CATEGORY_COUNT) {
    errors.categories = `Must include ${MAX_CATEGORY_COUNT} categories or fewer`;
    return [];
  }

  const categories: NormalizedCategory[] = [];
  const seen = new Set<string>();
  raw.forEach((item, index) => {
    let id: string | null = null;
    let name: string | null = null;

    if (typeof item === 'string') {
      name = cleanString(item);
      id = name ? slugifyCategoryId(name, index) : null;
    } else if (isRecord(item)) {
      name =
        readStringField(item, ['name', 'category_name', 'categoryName', 'label']) ??
        readStringField(item, ['id', 'category_id', 'categoryId']);
      id = readStringField(item, ['id', 'category_id', 'categoryId']);
      if (!id && name) id = slugifyCategoryId(name, index);
    }

    if (!id) {
      errors.categories = 'Each category must be a string or include an id/name';
      return;
    }
    if (id.length > MAX_CATEGORY_NAME_LENGTH || (name && name.length > MAX_CATEGORY_NAME_LENGTH)) {
      errors.categories = `Category values must be ${MAX_CATEGORY_NAME_LENGTH} characters or fewer`;
      return;
    }

    const dedupeKey = id.toLowerCase();
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      categories.push({ id, name });
    }
  });

  return errors.categories ? [] : categories;
}

/**
 * Perks, for `event_benefits`.
 *
 * Deliberately looser than normalizeCategories: a benefit is a bare string
 * with no id to slugify, and the vocabulary is HornsLink's rather than ours
 * (see shared/eventBenefits.ts). Anything within the caps is accepted, so a
 * value the scraper already writes stays writable from the app.
 *
 * Deduplicated case-insensitively even though case is preserved on the way in
 * — "Free Food" and "free food" are one perk, and the UNIQUE(event_id,
 * benefit_name) index would not catch that pair.
 */
function normalizeBenefits(body: CreateEventBody, errors: ValidationErrors): string[] {
  const raw = body.benefits ?? body.perks;
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.benefits = 'Must be an array';
    return [];
  }
  if (raw.length > MAX_BENEFIT_COUNT) {
    errors.benefits = `Must include ${MAX_BENEFIT_COUNT} perks or fewer`;
    return [];
  }

  const benefits: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const name = normalizeBenefitName(item);
    if (!name) {
      errors.benefits = 'Each perk must be a non-empty string';
      return [];
    }
    if (name.length > MAX_BENEFIT_NAME_LENGTH) {
      errors.benefits = `Perk values must be ${MAX_BENEFIT_NAME_LENGTH} characters or fewer`;
      return [];
    }
    const dedupeKey = name.toLowerCase();
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      benefits.push(name);
    }
  }

  return benefits;
}

/** Write the perk set for an event. Callers own the delete-first when editing. */
async function insertBenefits(db: D1Database, eventId: number, benefits: string[]): Promise<void> {
  for (const benefit of benefits) {
    await db
      .prepare(`INSERT OR IGNORE INTO event_benefits (event_id, benefit_name) VALUES (?, ?)`)
      .bind(eventId, benefit)
      .run();
  }
}

function normalizeAspectRatio(
  raw: string | null,
  width: number | null,
  height: number | null,
  hasImage: boolean,
  errors: ValidationErrors,
): ImageAspectRatio {
  if (raw) {
    if (VALID_IMAGE_ASPECT_RATIOS.has(raw as ImageAspectRatio)) return raw as ImageAspectRatio;
    errors.image_aspect_ratio = 'Must be vertical, square, horizontal, or none';
  }
  return classifyAspectRatio(width, height, hasImage);
}

function parseImageUrlFields(
  imageUrl: string | null,
  metadata: CreateEventBody,
  errors: ValidationErrors,
): ImageFields {
  const validatedUrl = validateUrl(imageUrl, 'image_url', errors);
  if (!validatedUrl) {
    return {
      imageUrl: null,
      imageWidth: null,
      imageHeight: null,
      imageAspectRatio: 'none',
      imageMimeType: null,
      imageAltText: null,
    };
  }

  const imageWidth = readIntegerField(metadata, ['image_width', 'imageWidth', 'width']);
  const imageHeight = readIntegerField(metadata, ['image_height', 'imageHeight', 'height']);
  const imageMimeType = parseOptionalString(
    metadata,
    ['image_mime_type', 'imageMimeType', 'mime_type', 'mimeType'],
    'image_mime_type',
    100,
    errors,
  );
  const imageAltText = parseOptionalString(
    metadata,
    ['image_alt_text', 'imageAltText', 'alt_text', 'altText'],
    'image_alt_text',
    250,
    errors,
  );
  const imageAspectRatio = normalizeAspectRatio(
    readStringField(metadata, [
      'image_aspect_ratio',
      'imageAspectRatio',
      'aspect_ratio',
      'aspectRatio',
    ]),
    imageWidth,
    imageHeight,
    true,
    errors,
  );

  return {
    imageUrl: validatedUrl,
    imageWidth,
    imageHeight,
    imageAspectRatio,
    imageMimeType,
    imageAltText,
  };
}

function parseDataImage(
  input: string,
  fallbackMimeType: string | null,
): {
  bytes: Uint8Array;
  mimeType: string;
} | null {
  const dataUriMatch = input.match(/^data:([^;,]+);base64,(.+)$/);
  const mimeType = dataUriMatch?.[1] ?? fallbackMimeType;
  const base64 = dataUriMatch?.[2] ?? input;
  if (!mimeType) return null;

  try {
    const binary = atob(base64.replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return { bytes, mimeType };
  } catch {
    return null;
  }
}

async function storeImageBytes(
  env: Env,
  userId: number,
  bytes: Uint8Array,
  mimeType: string,
  filename: string | null,
  altText: string | null,
  errors: ValidationErrors,
): Promise<ImageFields> {
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    errors.image = 'Must be a JPEG, PNG, GIF, or WebP image';
  } else if (bytes.byteLength > MAX_IMAGE_BYTES) {
    errors.image = 'Must be 5 MB or smaller';
  } else if (!env.EVENT_IMAGES) {
    errors.image = 'Image upload storage is not configured';
  } else if (!env.EVENT_IMAGE_PUBLIC_BASE_URL) {
    errors.image = 'Image public URL base is not configured';
  }

  if (errors.image) {
    return {
      imageUrl: null,
      imageWidth: null,
      imageHeight: null,
      imageAspectRatio: 'none',
      imageMimeType: null,
      imageAltText: null,
    };
  }

  const extension = extensionForMimeType(mimeType, filename);
  const key = `events/user-created/${userId}/${crypto.randomUUID()}.${extension}`;
  await env.EVENT_IMAGES!.put(key, bytes, {
    httpMetadata: { contentType: mimeType },
    customMetadata: { createdByUserId: String(userId) },
  });

  const dimensions = parseImageDimensions(bytes);
  const imageWidth = dimensions?.width ?? null;
  const imageHeight = dimensions?.height ?? null;
  const publicBaseUrl = env.EVENT_IMAGE_PUBLIC_BASE_URL!.replace(/\/+$/g, '');

  return {
    imageUrl: `${publicBaseUrl}/${key}`,
    imageWidth,
    imageHeight,
    imageAspectRatio: classifyAspectRatio(imageWidth, imageHeight, true, 0.05),
    imageMimeType: mimeType,
    imageAltText: altText,
  };
}

/** Body keys that arrive as a JSON array (or a comma list) inside multipart. */
const ARRAY_FORM_KEYS = new Set([
  'categories',
  'interestTags',
  'interest_tags',
  'benefits',
  'perks',
]);

function assignFormField(body: CreateEventBody, key: string, value: string): void {
  if (ARRAY_FORM_KEYS.has(key)) {
    try {
      body[key] = JSON.parse(value);
      return;
    } catch {
      body[key] = value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      return;
    }
  }
  body[key] = value;
}

async function readCreateEventBody(request: Request): Promise<{
  body: CreateEventBody | null;
  uploadedImage: File | null;
  malformed: boolean;
}> {
  const contentType = request.headers.get('Content-Type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData().catch(() => null);
    if (!form) return { body: null, uploadedImage: null, malformed: true };

    const body: CreateEventBody = {};
    let uploadedImage: File | null = null;
    for (const [key, value] of form.entries()) {
      if (isFileLike(value)) {
        if (key === 'image' && value.size > 0) uploadedImage = value;
      } else {
        assignFormField(body, key, value);
      }
    }
    return { body, uploadedImage, malformed: false };
  }

  const parsed = await request.json().catch(() => null);
  if (!isRecord(parsed)) return { body: null, uploadedImage: null, malformed: true };
  return { body: parsed, uploadedImage: null, malformed: false };
}

async function resolveImageFields(
  env: Env,
  userId: number,
  body: CreateEventBody,
  uploadedImage: File | null,
  errors: ValidationErrors,
): Promise<ImageFields> {
  const empty: ImageFields = {
    imageUrl: null,
    imageWidth: null,
    imageHeight: null,
    imageAspectRatio: 'none',
    imageMimeType: null,
    imageAltText: null,
  };

  if (uploadedImage) {
    const bytes = new Uint8Array(await uploadedImage.arrayBuffer());
    const altText = parseOptionalString(
      body,
      ['image_alt_text', 'imageAltText', 'alt_text', 'altText'],
      'image_alt_text',
      250,
      errors,
    );
    if (Object.keys(errors).length > 0) return empty;
    return storeImageBytes(
      env,
      userId,
      bytes,
      uploadedImage.type || 'application/octet-stream',
      uploadedImage.name,
      altText,
      errors,
    );
  }

  const image = body.image;
  if (isRecord(image)) {
    const imageUrl = readStringField(image, ['url', 'image_url', 'imageUrl']);
    if (imageUrl) return parseImageUrlFields(imageUrl, image, errors);

    const imageData = readStringField(image, ['data', 'base64', 'base64_data', 'base64Data']);
    if (imageData) {
      const parsed = parseDataImage(
        imageData,
        readStringField(image, ['mime_type', 'mimeType', 'image_mime_type', 'imageMimeType']),
      );
      if (!parsed) {
        errors.image = 'Must include valid base64 image data and a MIME type';
        return empty;
      }
      return storeImageBytes(
        env,
        userId,
        parsed.bytes,
        parsed.mimeType,
        readStringField(image, ['filename', 'fileName', 'name']),
        readStringField(image, ['alt_text', 'altText', 'image_alt_text', 'imageAltText']),
        errors,
      );
    }
  }

  if (typeof image === 'string') {
    const imageString = image.trim();
    if (imageString.length > 0) {
      if (imageString.startsWith('data:')) {
        const parsed = parseDataImage(
          imageString,
          readStringField(body, ['image_mime_type', 'imageMimeType']),
        );
        if (!parsed) {
          errors.image = 'Must include valid base64 image data and a MIME type';
          return empty;
        }
        return storeImageBytes(env, userId, parsed.bytes, parsed.mimeType, null, null, errors);
      }
      return parseImageUrlFields(imageString, body, errors);
    }
  }

  const imageBase64 = readStringField(body, ['image_base64', 'imageBase64']);
  if (imageBase64) {
    const parsed = parseDataImage(
      imageBase64,
      readStringField(body, ['image_mime_type', 'imageMimeType']),
    );
    if (!parsed) {
      errors.image = 'Must include valid base64 image data and a MIME type';
      return empty;
    }
    return storeImageBytes(env, userId, parsed.bytes, parsed.mimeType, null, null, errors);
  }

  const imageUrl = readStringField(body, ['image_url', 'imageUrl']);
  if (imageUrl) return parseImageUrlFields(imageUrl, body, errors);

  return empty;
}

function getHostName(body: CreateEventBody, user: AuthDbUser): string {
  const poster = body.poster;
  if (isRecord(poster)) {
    const posterName = readStringField(poster, ['name']);
    if (posterName) return posterName;
  }

  const name = [user.first_name, user.last_name]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' ');
  return name || user.email;
}

async function getCreatedEvent(
  db: D1Database,
  eventId: number,
): Promise<Record<string, unknown> | null> {
  const event = await db
    .prepare(
      `SELECT e.*, o.profile_picture as org_profile_picture
       FROM events e
       LEFT JOIN organizations o ON e.host_organization_id = o.id
       WHERE e.id = ?`,
    )
    .bind(eventId)
    .first();

  if (!event) return null;

  const categories = await db
    .prepare('SELECT category_id, category_name FROM event_categories WHERE event_id = ?')
    .bind(eventId)
    .all();

  const benefits = await db
    .prepare('SELECT benefit_name FROM event_benefits WHERE event_id = ?')
    .bind(eventId)
    .all();

  return {
    ...event,
    categories: categories.results.map((category: any) => ({
      id: category.category_id,
      name: category.category_name,
    })),
    benefits: benefits.results.map((benefit: any) => benefit.benefit_name),
  };
}

// Returns a SQL fragment + params that hide events the caller already
// reported, any event over the global threshold, and (LOOP-180) any event
// posted by someone the caller has blocked or who has blocked the caller.
function buildVisibilityFilter(userId: number | null): {
  sql: string;
  params: any[];
} {
  const params: any[] = [REPORT_HIDE_THRESHOLD];
  let sql = `
    AND (
      SELECT COUNT(*) FROM event_reports er WHERE er.event_id = e.id
    ) < ?
  `;
  if (userId !== null) {
    sql += `
      AND NOT EXISTS (
        SELECT 1 FROM event_reports er2
        WHERE er2.event_id = e.id AND er2.user_id = ?
      )
    `;
    params.push(userId);
  }

  const blocked = blockedAuthorFilter(userId);
  sql += blocked.sql;
  params.push(...blocked.params);

  return { sql, params };
}

// POST /events/create -- authenticated users create their own events.
eventRoutes.post('/create', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const user = await getUserByEmail(c.env.DB, auth.email);
  if (!user) return c.json({ error: 'USER_NOT_FOUND' }, 401);

  const { body, uploadedImage, malformed } = await readCreateEventBody(c.req.raw);
  if (malformed || !body) return c.json({ error: 'INVALID_BODY' }, 400);

  const errors: ValidationErrors = {};
  const title = parseRequiredString(body, ['title'], 'title', MAX_TITLE_LENGTH, errors);
  const description = parseOptionalString(
    body,
    ['description'],
    'description',
    MAX_DESCRIPTION_LENGTH,
    errors,
  );
  const startDatetime = parseIsoDatetime(
    readStringField(body, ['start_datetime', 'startDatetime', 'datetime']),
    'start_datetime',
    true,
    errors,
  );
  const rawEndDatetime = parseIsoDatetime(
    readStringField(body, ['end_datetime', 'endDatetime']),
    'end_datetime',
    false,
    errors,
  );
  const endDatetime = rawEndDatetime ?? startDatetime;

  if (
    startDatetime &&
    endDatetime &&
    new Date(endDatetime).getTime() < new Date(startDatetime).getTime()
  ) {
    errors.end_datetime = 'Must be on or after start_datetime';
  }

  // venue_type arrived with LOOP-260 as a hard requirement, but the create
  // wizard has no in-person/online control and sends no such field — so every
  // post from the app was failing validation with a message about a control
  // the user cannot see. Absent now means in_person, which is what a free-text
  // location has always meant and what every row predating LOOP-260 is.
  //
  // A value that IS sent is still checked: this is a default for the client
  // that doesn't know about the field yet, not a relaxation of the field. Once
  // the wizard grows the toggle, the default stops being reachable from the
  // app and can be reconsidered.
  const rawVenueType = readStringField(body, ['venue_type', 'venueType']);
  const venueType = rawVenueType ?? 'in_person';

  if (venueType !== 'in_person' && venueType !== 'online') {
    errors.venue_type = 'Must be either in_person or online';
  }

  const locationObject = isRecord(body.location) ? body.location : null;
  const locationFull =
    parseOptionalString(
      body,
      ['location_full', 'locationFull'],
      'location_full',
      MAX_LOCATION_LENGTH,
      errors,
    ) ??
    parseOptionalString(
      locationObject ?? {},
      ['full', 'full_name', 'fullName', 'name'],
      'location_full',
      MAX_LOCATION_LENGTH,
      errors,
    ) ??
    parseOptionalString(body, ['location'], 'location', MAX_LOCATION_LENGTH, errors);
  const locationShort =
    parseOptionalString(body, ['location_short', 'locationShort'], 'location_short', 40, errors) ??
    parseOptionalString(
      locationObject ?? {},
      ['short', 'short_name', 'shortName'],
      'location_short',
      40,
      errors,
    ) ??
    truncateLocation(locationFull);
  const rsvpUrl = validateUrl(readStringField(body, ['rsvp_url', 'rsvpUrl']), 'rsvp_url', errors);
  const eventUrl = validateUrl(
    readStringField(body, ['event_url', 'eventUrl']),
    'event_url',
    errors,
  );
  const theme =
    parseOptionalString(body, ['theme'], 'theme', 80, errors) ??
    (() => {
      const discoveryBucket = readStringField(body, ['discovery_bucket', 'discoveryBucket']);
      return discoveryBucket ? (THEME_BY_DISCOVERY_BUCKET[discoveryBucket] ?? null) : null;
    })();
  const latitude = readNumberField(body, ['latitude', 'lat']);
  const longitude = readNumberField(body, ['longitude', 'lng', 'lon']);
  const categories = normalizeCategories(body, errors);
  const benefits = normalizeBenefits(body, errors);
  const imageFields =
    Object.keys(errors).length === 0
      ? await resolveImageFields(c.env, user.id, body, uploadedImage, errors)
      : {
          imageUrl: null,
          imageWidth: null,
          imageHeight: null,
          imageAspectRatio: 'none' as ImageAspectRatio,
          imageMimeType: null,
          imageAltText: null,
        };

  if (Object.keys(errors).length > 0 || !title || !startDatetime || !endDatetime) {
    return c.json({ error: 'VALIDATION_ERROR', fields: errors }, 400);
  }

  const sourceEventId = `user-${user.id}-${crypto.randomUUID()}`;
  const hostName = getHostName(body, user);
  const expiresAt = computeExpiresAt(endDatetime, startDatetime);

  const result = await c.env.DB.prepare(
    `INSERT INTO events (
       source, source_event_id, title, description,
       start_datetime, end_datetime, venue_type, location_short, location_full,
       latitude, longitude, host_organization_name,
       event_url, rsvp_url,
       image_url, image_width, image_height,
       image_aspect_ratio, image_mime_type, image_alt_text,
       theme, visibility, rsvp_total, expires_at,
       created_by_user_id
     ) VALUES (
       ?, ?, ?, ?,
       ?, ?, ?, ?, ?,
       ?, ?, ?,
       ?, ?,
       ?, ?, ?,
       ?, ?, ?,
       ?, 'Public', 0, ?,
       ?
     )`,
  )
    .bind(
      USER_CREATED_SOURCE,
      sourceEventId,
      title,
      description,
      startDatetime,
      endDatetime,
      venueType,
      locationShort,
      locationFull,
      latitude,
      longitude,
      hostName,
      eventUrl,
      rsvpUrl,
      imageFields.imageUrl,
      imageFields.imageWidth,
      imageFields.imageHeight,
      imageFields.imageAspectRatio,
      imageFields.imageMimeType,
      imageFields.imageAltText,
      theme,
      expiresAt,
      user.id,
    )
    .run();

  const eventId = Number((result.meta as { last_row_id?: number }).last_row_id);
  for (const category of categories) {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO event_categories (event_id, category_id, category_name)
       VALUES (?, ?, ?)`,
    )
      .bind(eventId, category.id, category.name)
      .run();
  }

  // Perks. The `?benefit=` filter and the ingest write have existed since the
  // first HornsLink scrape; this is the create path finally populating the
  // same table, so a user event can be found by the filter that already works
  // for scraped ones (LOOP-259).
  await insertBenefits(c.env.DB, eventId, benefits);

  // Feed ranking reads event_tags, not event_categories. Scraped events get
  // tagged by the classifier at ingest; user-created events are hand-tagged
  // here so they flow into the same ranking. The picked tags all belong to the
  // chosen discovery bucket (the create UI scopes them to it), so we write each
  // as a { bucket, tag } pair with source 'user'.
  const discoveryBucket = readStringField(body, ['discovery_bucket', 'discoveryBucket']);
  if (discoveryBucket && BUCKET_ID_SET.has(discoveryBucket)) {
    const bucketTags = new Set(TAXONOMY_BUCKETS.find((b) => b.id === discoveryBucket)?.tags ?? []);
    const matches = categories
      .filter((cat) => cat.name && bucketTags.has(cat.name))
      .map((cat) => ({
        bucketId: discoveryBucket,
        tag: cat.name as string,
        source: 'user' as const,
        // Full confidence: a creator hand-picking a tag is the strongest signal
        // we have, stronger than a semantic guess. Ranks these at full weight.
        score: 1,
      }));
    if (matches.length > 0) {
      const { writeEventTags } = await import('../lib/classifier');
      await writeEventTags(c.env.DB, eventId, matches);
    }
  }

  const event = await getCreatedEvent(c.env.DB, eventId);
  return c.json({ event }, 201);
});

// ---------------------------------------------------------------------------
// PATCH /events/:id -- edit an existing event (LOOP-136).
// ---------------------------------------------------------------------------
//
// Backs the pencil affordance on the Events tab of the Org Management console.
// Scope is the core fields the product owner signed off on: title, description,
// start/end datetime, location, and category/interest tags. Image replacement
// and recurrence are deliberately NOT here — see the header comment on
// app/components/org/EditEventOverlay.tsx for why.
//
// Partial by contract: a key the caller omits is never written. That is what
// makes this safe to call from an overlay that only knows about six fields —
// it cannot clobber image_url, rsvp_url, the denormalized counters, or any
// other column it has never heard of.
//
// Validation reuses the POST /events/create helpers rather than restating the
// rules. A second validator would drift, and the first thing to drift would be
// a length cap that the create form enforces and the edit form doesn't.
//
// Body (all optional; camelCase aliases accepted, same as create):
//   title            string, 1..80
//   description      string|null, <=500  (null / "" clears it)
//   start_datetime   ISO 8601 with timezone
//   end_datetime     ISO 8601 with timezone, or null to pin it to the start
//   location         string, <=200  (also location_full / location_short)
//   categories       string[] | {id,name}[], <=20   (also interestTags)
//   benefits         string[], <=10, each <=60      (also perks)
//   discovery_bucket taxonomy bucket id; rewrites event_tags when sent
//                    alongside categories
//
// Responses:
//   200 { event }                        the updated row, shaped like create's
//   400 { error: 'INVALID_EVENT_ID' }
//   400 { error: 'INVALID_BODY' }
//   400 { error: 'VALIDATION_ERROR', fields: {...} }
//   401 { error: 'UNAUTHORIZED' | 'USER_NOT_FOUND' }
//   403 { error: 'FORBIDDEN' }
//   404 { error: 'EVENT_NOT_FOUND' }

/** Every request key that means "the caller is changing where this happens". */
const LOCATION_KEYS = [
  'location',
  'location_full',
  'locationFull',
  'location_short',
  'locationShort',
];

const START_KEYS = ['start_datetime', 'startDatetime', 'datetime'];
const END_KEYS = ['end_datetime', 'endDatetime'];
const CATEGORY_KEYS = ['categories', 'interestTags', 'interest_tags'];
const BENEFIT_KEYS = ['benefits', 'perks'];

/**
 * May `userId` edit this event?
 *
 * Two independent grants, matching how events get into the system:
 *   - the creator of a user-created event owns it outright;
 *   - admins AND editors of the hosting org can manage that org's events —
 *     schema.sql is explicit that an editor "can post/manage events, cannot
 *     manage people", so this is deliberately looser than the admin-only gate
 *     on the Members tab.
 *
 * Membership is org-scoped: being an editor of one org grants nothing over
 * another org's events. That falls out of the org_id in the WHERE clause and
 * is the case the tests pin hardest.
 */
async function canEditEvent(
  db: D1Database,
  event: { host_organization_id: number | null; created_by_user_id: number | null },
  userId: number,
): Promise<boolean> {
  if (event.created_by_user_id !== null && event.created_by_user_id === userId) return true;
  if (event.host_organization_id === null) return false;

  const row = await db
    .prepare('SELECT role FROM org_members WHERE org_id = ? AND user_id = ?')
    .bind(event.host_organization_id, userId)
    .first();

  return row?.role === 'admin' || row?.role === 'editor';
}

eventRoutes.patch('/:id', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const user = await getUserByEmail(c.env.DB, auth.email);
  if (!user) return c.json({ error: 'USER_NOT_FOUND' }, 401);

  const eventId = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(eventId)) return c.json({ error: 'INVALID_EVENT_ID' }, 400);

  const existing = await c.env.DB.prepare(
    `SELECT id, start_datetime, end_datetime, host_organization_id, created_by_user_id
       FROM events WHERE id = ?`,
  )
    .bind(eventId)
    .first();
  if (!existing) return c.json({ error: 'EVENT_NOT_FOUND' }, 404);

  // Re-checked here on every call. The console hides the pencil for anyone who
  // can't edit, but that is presentation: this is the check that counts.
  const allowed = await canEditEvent(
    c.env.DB,
    {
      host_organization_id: (existing.host_organization_id as number | null) ?? null,
      created_by_user_id: (existing.created_by_user_id as number | null) ?? null,
    },
    user.id,
  );
  if (!allowed) return c.json({ error: 'FORBIDDEN' }, 403);

  const parsed = await c.req.json().catch(() => null);
  if (!isRecord(parsed)) return c.json({ error: 'INVALID_BODY' }, 400);
  const body = parsed as CreateEventBody;

  const errors: ValidationErrors = {};
  // Column name -> new value. Only what the caller actually sent lands here,
  // and the keys are literals from this file, never strings off the request.
  const updates: Record<string, unknown> = {};

  if (hasField(body, ['title'])) {
    const title = parseRequiredString(body, ['title'], 'title', MAX_TITLE_LENGTH, errors);
    // Required-if-present: an event with a blank title is unusable in every
    // list that renders it, so clearing the title is rejected rather than
    // treated as a clear.
    if (title) updates.title = title;
  }

  if (hasField(body, ['description'])) {
    updates.description = parseOptionalString(
      body,
      ['description'],
      'description',
      MAX_DESCRIPTION_LENGTH,
      errors,
    );
  }

  // Datetimes are validated against each other, not just individually, so the
  // effective pair is resolved first: whatever was sent, falling back to what
  // is already stored. An event whose end_datetime is NULL reads as
  // instantaneous, matching the COALESCE the feed queries use.
  const patchesStart = hasField(body, START_KEYS);
  const patchesEnd = hasField(body, END_KEYS);
  let effectiveStart = existing.start_datetime as string;
  let effectiveEnd = (existing.end_datetime as string | null) ?? effectiveStart;

  if (patchesStart) {
    const next = parseIsoDatetime(
      readStringField(body, START_KEYS),
      'start_datetime',
      true,
      errors,
    );
    if (next) {
      effectiveStart = next;
      updates.start_datetime = next;
    }
  }

  if (patchesEnd) {
    const raw = readStringField(body, END_KEYS);
    // An explicitly emptied end means "single instant", which the create path
    // spells as end = start. Storing that rather than NULL keeps the two paths
    // producing the same row for the same user intent.
    const next =
      raw === null ? effectiveStart : parseIsoDatetime(raw, 'end_datetime', false, errors);
    if (next) {
      effectiveEnd = next;
      updates.end_datetime = next;
    }
  }

  if (new Date(effectiveEnd).getTime() < new Date(effectiveStart).getTime()) {
    errors.end_datetime = 'Must be on or after start_datetime';
  }

  // expires_at is derived, so moving either endpoint has to move it too or the
  // cleanup job (LOOP-150) purges a rescheduled event on its old schedule.
  if (patchesStart || patchesEnd) {
    updates.expires_at = computeExpiresAt(effectiveEnd, effectiveStart);
  }

  if (hasField(body, LOCATION_KEYS)) {
    const locationObject = isRecord(body.location) ? body.location : null;
    const locationFull =
      parseOptionalString(
        body,
        ['location_full', 'locationFull'],
        'location_full',
        MAX_LOCATION_LENGTH,
        errors,
      ) ??
      parseOptionalString(
        locationObject ?? {},
        ['full', 'full_name', 'fullName', 'name'],
        'location_full',
        MAX_LOCATION_LENGTH,
        errors,
      ) ??
      parseOptionalString(body, ['location'], 'location', MAX_LOCATION_LENGTH, errors);
    // Both columns move together. location_short is a display truncation of
    // location_full, so leaving the old one behind would show the previous
    // room next to the new address.
    updates.location_full = locationFull;
    updates.location_short =
      parseOptionalString(
        body,
        ['location_short', 'locationShort'],
        'location_short',
        40,
        errors,
      ) ??
      parseOptionalString(
        locationObject ?? {},
        ['short', 'short_name', 'shortName'],
        'location_short',
        40,
        errors,
      ) ??
      truncateLocation(locationFull);
  }

  const patchesCategories = hasField(body, CATEGORY_KEYS);
  const categories = patchesCategories ? normalizeCategories(body, errors) : [];

  const patchesBenefits = hasField(body, BENEFIT_KEYS);
  const benefits = patchesBenefits ? normalizeBenefits(body, errors) : [];

  const discoveryBucket = readStringField(body, ['discovery_bucket', 'discoveryBucket']);
  if (discoveryBucket) {
    // theme is a pure function of the bucket on the create path; recomputing it
    // here keeps a re-bucketed event from keeping its old theme forever.
    const theme = THEME_BY_DISCOVERY_BUCKET[discoveryBucket];
    if (theme) updates.theme = theme;
  }

  if (Object.keys(errors).length > 0) {
    return c.json({ error: 'VALIDATION_ERROR', fields: errors }, 400);
  }

  const columns = Object.keys(updates);
  if (columns.length > 0) {
    await c.env.DB.prepare(
      `UPDATE events
          SET ${columns.map((column) => `${column} = ?`).join(', ')},
              updated_at = datetime('now')
        WHERE id = ?`,
    )
      .bind(...columns.map((column) => updates[column]), eventId)
      .run();
  }

  // Categories are a set, not a column, so "edit" is replace-all. Skipped
  // entirely when the caller didn't mention them, which is the whole point of
  // a partial patch.
  if (patchesCategories) {
    await c.env.DB.prepare('DELETE FROM event_categories WHERE event_id = ?').bind(eventId).run();
    for (const category of categories) {
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO event_categories (event_id, category_id, category_name)
         VALUES (?, ?, ?)`,
      )
        .bind(eventId, category.id, category.name)
        .run();
    }
  }

  // Perks are a set too, and replace-all for the same reason as categories:
  // there is no per-row identity to diff against, and an edit that removes a
  // perk has to be expressible. Sending `benefits: []` clears them; omitting
  // the key leaves them alone.
  if (patchesBenefits) {
    await c.env.DB.prepare('DELETE FROM event_benefits WHERE event_id = ?').bind(eventId).run();
    await insertBenefits(c.env.DB, eventId, benefits);
  }

  // event_tags drives feed ranking and is rewritten only when the caller sent
  // BOTH a bucket and a tag list — i.e. actually edited the tag picker. Sending
  // one alone would otherwise wipe the classifier's semantic tags on a scraped
  // event as a side effect of, say, fixing a typo in the title.
  if (patchesCategories && discoveryBucket && BUCKET_ID_SET.has(discoveryBucket)) {
    const bucketTags = new Set(TAXONOMY_BUCKETS.find((b) => b.id === discoveryBucket)?.tags ?? []);
    const { writeEventTags } = await import('../lib/classifier');
    await writeEventTags(
      c.env.DB,
      eventId,
      categories
        .filter((cat) => cat.name && bucketTags.has(cat.name))
        .map((cat) => ({
          bucketId: discoveryBucket,
          tag: cat.name as string,
          source: 'user' as const,
          score: 1,
        })),
    );
  }

  const event = await getCreatedEvent(c.env.DB, eventId);
  return c.json({ event });
});

/**
 * Everyone attached to an event: RSVP'd or saved, deduped.
 *
 * Both delete and announcements speak to the same audience — the people who
 * arranged their week around this event and would otherwise turn up to a
 * locked door. Saves count, not just RSVPs: saving is the weaker signal but
 * it is still someone planning to go.
 */
async function getEventAudience(db: D1Database, eventId: number): Promise<number[]> {
  const rows = await db
    .prepare(
      `SELECT user_id FROM event_rsvps WHERE event_id = ?
       UNION
       SELECT user_id FROM saved_events WHERE event_id = ?`,
    )
    .bind(eventId, eventId)
    .all<{ user_id: number }>();
  return rows.results.map((r) => r.user_id);
}

/** Fan a notification out to a set of users. Best-effort, one row each. */
async function notifyUsers(
  db: D1Database,
  userIds: number[],
  notification: {
    type: string;
    title: string;
    subtitle: string | null;
    eventId: number | null;
    thumbnailUrl: string | null;
  },
): Promise<void> {
  for (const userId of userIds) {
    await db
      .prepare(
        `INSERT INTO notifications
           (user_id, type, title, subtitle, thumbnail_url, event_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        userId,
        notification.type,
        notification.title,
        notification.subtitle,
        notification.thumbnailUrl,
        notification.eventId,
      )
      .run();
  }
}

// DELETE /events/:id -- the host removes their own event.
//
// CANCEL, NOT A ROW DELETE, AND NOT AN ARCHIVE. `events.status` already exists
// (DEFAULT 'active') and the read paths that matter already filter on it — the
// feed, the event detail, the org console, and the worker's reminder query — so
// flipping it to 'cancelled' takes the event out of discovery everywhere in one
// write.
//
// `is_archived` was the other candidate and is the wrong one: it cannot tell an
// attendee that an event was CANCELLED apart from one that merely EXPIRED.
// Someone who RSVP'd and would otherwise turn up to a locked door deserves that
// distinction, and the column that carries it is status. (LOOP-277.)
//
// A hard DELETE is the third option and the worst: it cascades through
// event_rsvps, saved_events, event_tags and notifications, so an accidental
// delete is unrecoverable and the notice telling people it was cancelled
// deletes itself on the way out.
//
// The modal promises "anyone who saved or RSVP'd will no longer see it, and
// users will be notified" — the status change does the first half, the fan-out
// below does the second. The event stays visible to its creator, and RSVP
// history stays intact.
eventRoutes.delete('/:id', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const user = await getUserByEmail(c.env.DB, auth.email);
  if (!user) return c.json({ error: 'USER_NOT_FOUND' }, 401);

  const eventId = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(eventId)) return c.json({ error: 'INVALID_EVENT_ID' }, 400);

  const existing = await c.env.DB.prepare(
    `SELECT id, title, image_url, status, host_organization_id, created_by_user_id
       FROM events WHERE id = ?`,
  )
    .bind(eventId)
    .first();
  if (!existing) return c.json({ error: 'EVENT_NOT_FOUND' }, 404);

  // Same grant as editing: the creator owns their event, org admins and
  // editors manage their org's. Nothing here is looser than the pencil.
  const allowed = await canEditEvent(
    c.env.DB,
    {
      host_organization_id: (existing.host_organization_id as number | null) ?? null,
      created_by_user_id: (existing.created_by_user_id as number | null) ?? null,
    },
    user.id,
  );
  if (!allowed) return c.json({ error: 'FORBIDDEN' }, 403);

  // Already cancelled: succeed quietly rather than 404. Double-tapping Delete
  // on a slow connection should not read as an error, and re-notifying the
  // audience about a second cancellation would be worse than doing nothing.
  if (existing.status === 'cancelled') {
    return c.json({ ok: true, alreadyCancelled: true });
  }

  const audience = await getEventAudience(c.env.DB, eventId);

  await c.env.DB.prepare(`UPDATE events SET status = 'cancelled' WHERE id = ?`).bind(eventId).run();

  // After the write, not before: if the UPDATE fails nobody should have been
  // told their event was cancelled.
  await notifyUsers(c.env.DB, audience, {
    type: 'event_cancelled',
    title: existing.title as string,
    subtitle: 'was cancelled by the host',
    // Deliberately still linked. The event page 404s for a cancelled event,
    // but the id is what lets a later fix restore the link rather than leaving
    // an orphan notification.
    eventId,
    thumbnailUrl: (existing.image_url as string | null) ?? null,
  });

  return c.json({ ok: true, notified: audience.length });
});

/** A short update, not a second description. Matches the Figma counter. */
const MAX_ANNOUNCEMENT_LENGTH = 200;

// POST /events/:id/announcements -- the host posts an update.
// Body: { body: string, notify?: boolean }
eventRoutes.post('/:id/announcements', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const user = await getUserByEmail(c.env.DB, auth.email);
  if (!user) return c.json({ error: 'USER_NOT_FOUND' }, 401);

  const eventId = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(eventId)) return c.json({ error: 'INVALID_EVENT_ID' }, 400);

  const existing = await c.env.DB.prepare(
    `SELECT id, title, image_url, status, host_organization_id, created_by_user_id
       FROM events WHERE id = ?`,
  )
    .bind(eventId)
    .first();
  if (!existing) return c.json({ error: 'EVENT_NOT_FOUND' }, 404);
  if (existing.status === 'cancelled') {
    return c.json({ error: 'EVENT_CANCELLED' }, 409);
  }

  const allowed = await canEditEvent(
    c.env.DB,
    {
      host_organization_id: (existing.host_organization_id as number | null) ?? null,
      created_by_user_id: (existing.created_by_user_id as number | null) ?? null,
    },
    user.id,
  );
  if (!allowed) return c.json({ error: 'FORBIDDEN' }, 403);

  const parsed = await c.req.json().catch(() => null);
  if (!isRecord(parsed)) return c.json({ error: 'INVALID_BODY' }, 400);

  const raw = parsed.body;
  const body = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (!body) return c.json({ error: 'EMPTY_ANNOUNCEMENT' }, 400);
  if (body.length > MAX_ANNOUNCEMENT_LENGTH) {
    return c.json({ error: 'ANNOUNCEMENT_TOO_LONG', max: MAX_ANNOUNCEMENT_LENGTH }, 400);
  }

  // Defaults to true: the toggle ships on, and a caller that omits the field
  // is asking for the normal case.
  const notify = parsed.notify === undefined ? true : parsed.notify === true;

  const inserted = await c.env.DB.prepare(
    `INSERT INTO event_announcements (event_id, author_user_id, body, notify)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(eventId, user.id, body, notify ? 1 : 0)
    .run();

  // The toggle is real, and this is what it controls: off, the announcement
  // still exists on the event; on, everyone attached to the event gets a
  // notification. Push delivery does not exist server-side yet — when it does
  // it reads this same flag, so the switch does not change meaning.
  let notified = 0;
  if (notify) {
    const audience = await getEventAudience(c.env.DB, eventId);
    await notifyUsers(c.env.DB, audience, {
      type: 'event_announcement',
      title: existing.title as string,
      subtitle: body,
      eventId,
      thumbnailUrl: (existing.image_url as string | null) ?? null,
    });
    notified = audience.length;
  }

  return c.json({
    announcement: {
      id: inserted.meta.last_row_id,
      event_id: eventId,
      body,
      notify,
    },
    notified,
  });
});

// GET /events/:id/announcements -- newest first. Public: an announcement is
// part of the event, and someone deciding whether to go should see that the
// room moved before they RSVP.
eventRoutes.get('/:id/announcements', async (c) => {
  const eventId = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(eventId)) return c.json({ error: 'INVALID_EVENT_ID' }, 400);

  const rows = await c.env.DB.prepare(
    `SELECT a.id, a.body, a.created_at, u.first_name, u.last_name
       FROM event_announcements a
       JOIN users u ON u.id = a.author_user_id
      WHERE a.event_id = ?
      ORDER BY a.created_at DESC`,
  )
    .bind(eventId)
    .all();

  return c.json({ announcements: rows.results });
});

// GET /events -- list upcoming events with optional filters
eventRoutes.get('/', async (c) => {
  const limit = parseInt(c.req.query('limit') || '20');
  const offset = parseInt(c.req.query('offset') || '0');
  const category = c.req.query('category');
  const benefit = c.req.query('benefit');
  const theme = c.req.query('theme');
  const orgId = c.req.query('orgId');
  const source = c.req.query('source');

  // If the caller is signed in, also hide events they've already reported.
  // Anonymous callers only get the global threshold filter.
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  const userId = auth ? await getUserId(c.env.DB, auth.email) : null;
  const visibility = buildVisibilityFilter(userId);

  let query = `
    SELECT e.*, o.profile_picture as org_profile_picture
    FROM events e
    LEFT JOIN organizations o ON e.host_organization_id = o.id
    WHERE e.status = 'active'
      AND e.is_archived = 0
      -- Nullable end_datetime: see the same filter in feed.worker.ts.
      AND COALESCE(e.end_datetime, e.start_datetime) > datetime('now')
      ${visibility.sql}
  `;
  const params: any[] = [...visibility.params];

  if (theme) {
    query += ` AND e.theme = ?`;
    params.push(theme);
  }

  if (orgId) {
    query += ` AND e.host_organization_id = ?`;
    params.push(parseInt(orgId));
  }

  if (source) {
    query += ` AND e.source = ?`;
    params.push(source);
  }

  if (category) {
    query += ` AND e.id IN (SELECT event_id FROM event_categories WHERE category_name = ?)`;
    params.push(category);
  }

  if (benefit) {
    query += ` AND e.id IN (SELECT event_id FROM event_benefits WHERE benefit_name = ?)`;
    params.push(benefit);
  }

  query += ` ORDER BY e.start_datetime ASC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const events = await c.env.DB.prepare(query)
    .bind(...params)
    .all();

  // Attach categories and benefits to each event
  const enrichedEvents = [];
  for (const event of events.results) {
    const categories = await c.env.DB.prepare(
      'SELECT category_id, category_name FROM event_categories WHERE event_id = ?',
    )
      .bind(event.id)
      .all();

    const benefits = await c.env.DB.prepare(
      'SELECT benefit_name FROM event_benefits WHERE event_id = ?',
    )
      .bind(event.id)
      .all();

    enrichedEvents.push({
      ...event,
      categories: categories.results.map((c: any) => ({
        id: c.category_id,
        name: c.category_name,
      })),
      benefits: benefits.results.map((b: any) => b.benefit_name),
    });
  }

  return c.json({
    events: enrichedEvents,
    total: events.results.length,
    limit,
    offset,
  });
});

// GET /events/:id -- single event detail
eventRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');

  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  const userId = auth ? await getUserId(c.env.DB, auth.email) : null;

  const event = await c.env.DB.prepare(
    `SELECT e.*, o.profile_picture as org_profile_picture
     FROM events e
     LEFT JOIN organizations o ON e.host_organization_id = o.id
     WHERE e.id = ?`,
  )
    .bind(id)
    .first();

  if (!event) {
    return c.json({ error: 'EVENT_NOT_FOUND' }, 404);
  }

  // Hide events the caller already reported, or that crossed the global
  // report threshold. Treat as not-found so the UI handles it cleanly.
  const reportCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as c FROM event_reports WHERE event_id = ?',
  )
    .bind(id)
    .first();
  if (reportCount && (reportCount.c as number) >= REPORT_HIDE_THRESHOLD) {
    return c.json({ error: 'EVENT_NOT_FOUND' }, 404);
  }
  if (userId !== null) {
    const reportedByMe = await c.env.DB.prepare(
      'SELECT 1 FROM event_reports WHERE event_id = ? AND user_id = ?',
    )
      .bind(id, userId)
      .first();
    if (reportedByMe) {
      return c.json({ error: 'EVENT_NOT_FOUND' }, 404);
    }

    // Blocking (LOOP-180). The list endpoints filter this in SQL; a single
    // event is fetched by id with no WHERE to hang the filter off, so it is
    // checked here instead. Without it a blocked author's event is one deep
    // link away — from a notification, a share sheet, or the report screen —
    // and the feed filter would be decoration.
    const author = event.created_by_user_id as number | null;
    if (author !== null) {
      const block = await isBlockedBetween(c.env.DB, userId, author);
      if (block.blocked) return c.json({ error: 'EVENT_NOT_FOUND' }, 404);
    }
  }

  const categories = await c.env.DB.prepare(
    'SELECT category_id, category_name FROM event_categories WHERE event_id = ?',
  )
    .bind(id)
    .all();

  const benefits = await c.env.DB.prepare(
    'SELECT benefit_name FROM event_benefits WHERE event_id = ?',
  )
    .bind(id)
    .all();

  // Classifier-assigned tags (Phase 2). Distinct tag names, shown as chips in
  // the app in place of the raw scraped categories.
  const tagRows = await c.env.DB.prepare(
    'SELECT DISTINCT tag FROM event_tags WHERE event_id = ? ORDER BY tag',
  )
    .bind(id)
    .all();

  const isRsvped = userId
    ? !!(await c.env.DB.prepare('SELECT 1 FROM event_rsvps WHERE user_id = ? AND event_id = ?')
        .bind(userId, id)
        .first())
    : false;

  return c.json({
    ...event,
    categories: categories.results.map((c: any) => ({
      id: c.category_id,
      name: c.category_name,
    })),
    benefits: benefits.results.map((b: any) => b.benefit_name),
    tags: tagRows.results.map((t: any) => t.tag as string),
    is_rsvped: isRsvped,
  });
});

// POST /events/:id/rsvp -- auth-gated, idempotent RSVP for an event.
eventRoutes.post('/:id/rsvp', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const userId = await getUserId(c.env.DB, auth.email);
  if (!userId) return c.json({ error: 'USER_NOT_FOUND' }, 401);

  const eventId = parseInt(c.req.param('id'));
  if (!Number.isFinite(eventId)) {
    return c.json({ error: 'INVALID_EVENT_ID' }, 400);
  }

  const eventExists = await c.env.DB.prepare('SELECT 1 FROM events WHERE id = ?')
    .bind(eventId)
    .first();
  if (!eventExists) return c.json({ error: 'EVENT_NOT_FOUND' }, 404);

  const inserted = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO event_rsvps (user_id, event_id) VALUES (?, ?)`,
  )
    .bind(userId, eventId)
    .run();

  // Bump the denormalized counter only when this RSVP is new (deduped per
  // user), so re-POSTing the same RSVP doesn't inflate rsvp_count.
  if (inserted.meta.changes > 0) {
    await c.env.DB.prepare(`UPDATE events SET rsvp_count = rsvp_count + 1 WHERE id = ?`)
      .bind(eventId)
      .run();
  }

  return c.json({ ok: true });
});

// DELETE /events/:id/rsvp -- auth-gated, removes the caller's RSVP.
eventRoutes.delete('/:id/rsvp', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const userId = await getUserId(c.env.DB, auth.email);
  if (!userId) return c.json({ error: 'USER_NOT_FOUND' }, 401);

  const eventId = parseInt(c.req.param('id'));
  if (!Number.isFinite(eventId)) {
    return c.json({ error: 'INVALID_EVENT_ID' }, 400);
  }

  const deleted = await c.env.DB.prepare(
    `DELETE FROM event_rsvps WHERE user_id = ? AND event_id = ?`,
  )
    .bind(userId, eventId)
    .run();

  // Only decrement when a row was actually removed, so a repeat DELETE can't
  // drive rsvp_count negative.
  if (deleted.meta.changes > 0) {
    await c.env.DB.prepare(`UPDATE events SET rsvp_count = rsvp_count - 1 WHERE id = ?`)
      .bind(eventId)
      .run();
  }

  return c.json({ ok: true });
});

// Faces shown in the attendee stack on the event detail screen. The row only
// has space for a few; `count` carries the real total so the label stays
// accurate without shipping every attendee to the client.
const ATTENDEE_PREVIEW_LIMIT = 5;

// GET /events/:id/attendees -- auth-gated preview of who has RSVP'd, plus the
// total. Auth-gated because it names people: an attendee list is exactly the
// kind of thing that shouldn't be readable by anyone with an event URL.
//
// Counts from event_rsvps rather than events.rsvp_count so a drifted
// denormalized counter can't disagree with the faces beside it.
eventRoutes.get('/:id/attendees', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const eventId = parseInt(c.req.param('id'));
  if (!Number.isFinite(eventId)) {
    return c.json({ error: 'INVALID_EVENT_ID' }, 400);
  }

  const viewerId = await getUserId(c.env.DB, auth.email);

  const eventExists = await c.env.DB.prepare('SELECT 1 FROM events WHERE id = ?')
    .bind(eventId)
    .first();
  if (!eventExists) return c.json({ error: 'EVENT_NOT_FOUND' }, 404);

  // `count` is deliberately NOT block-filtered (LOOP-180). It is an aggregate
  // about the event — "23 going" — not a disclosure about any particular
  // person, and subtracting blocked attendees from it would tell the blocker
  // exactly when a blocked person RSVP'd by making the number move. The FACES
  // below are filtered, because those are the part that names someone.
  const totalRow = await c.env.DB.prepare(
    'SELECT COUNT(*) AS count FROM event_rsvps WHERE event_id = ?',
  )
    .bind(eventId)
    .first<{ count: number }>();

  const notBlocked = blockedUserFilter(viewerId, 'r.user_id');

  // Newest RSVPs first, so the faces change as an event fills up rather than
  // freezing on whoever happened to RSVP first.
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.first_name, u.last_name, u.avatar, u.avatar_config, u.profile_photo_url
       FROM event_rsvps r
       JOIN users u ON u.id = r.user_id
      WHERE r.event_id = ?
        ${notBlocked.sql}
      ORDER BY r.created_at DESC, u.id DESC
      LIMIT ?`,
  )
    .bind(eventId, ...notBlocked.params, ATTENDEE_PREVIEW_LIMIT)
    .all();

  return c.json({
    attendees: results.map((u: any) => ({
      id: u.id as number,
      first_name: (u.first_name as string) ?? '',
      last_name: (u.last_name as string) ?? '',
      avatar: (u.avatar as number | null) ?? null,
      avatar_config: parseStoredAvatarConfig(u.avatar_config),
      profile_photo_url: (u.profile_photo_url as string | null) ?? null,
    })),
    count: totalRow?.count ?? 0,
  });
});

// POST /events/:id/view -- auth-gated, idempotent view signal. Deduped per
// user (one row per user/event), so view_count tracks distinct viewers.
eventRoutes.post('/:id/view', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const userId = await getUserId(c.env.DB, auth.email);
  if (!userId) return c.json({ error: 'USER_NOT_FOUND' }, 401);

  const eventId = parseInt(c.req.param('id'));
  if (!Number.isFinite(eventId)) {
    return c.json({ error: 'INVALID_EVENT_ID' }, 400);
  }

  const eventExists = await c.env.DB.prepare('SELECT 1 FROM events WHERE id = ?')
    .bind(eventId)
    .first();
  if (!eventExists) return c.json({ error: 'EVENT_NOT_FOUND' }, 404);

  const inserted = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO event_views (user_id, event_id) VALUES (?, ?)`,
  )
    .bind(userId, eventId)
    .run();

  if (inserted.meta.changes > 0) {
    await c.env.DB.prepare(`UPDATE events SET view_count = view_count + 1 WHERE id = ?`)
      .bind(eventId)
      .run();
  }

  return c.json({ ok: true });
});

// POST /events/:id/coordinates -- backfill an event's coordinates.
// Body: { latitude: number, longitude: number }
//
// Scraped events store a location label but no coordinates; the first iOS
// client that resolves the label via MKLocalSearch posts the result back here
// so it's persisted for every later viewer and for feed ranking. Only fills
// when both columns are currently NULL, so a real coordinate is never
// overwritten and concurrent resolvers converge on the first write.
eventRoutes.post('/:id/coordinates', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const userId = await getUserId(c.env.DB, auth.email);
  if (!userId) return c.json({ error: 'USER_NOT_FOUND' }, 401);

  const eventId = parseInt(c.req.param('id'));
  if (!Number.isFinite(eventId)) {
    return c.json({ error: 'INVALID_EVENT_ID' }, 400);
  }

  const body = await c.req.json().catch(() => null);
  const latitude = readNumberField(isRecord(body) ? body : {}, ['latitude', 'lat']);
  const longitude = readNumberField(isRecord(body) ? body : {}, ['longitude', 'lng', 'lon']);
  if (
    latitude == null ||
    longitude == null ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    return c.json({ error: 'INVALID_COORDINATES' }, 400);
  }

  const updated = await c.env.DB.prepare(
    `UPDATE events SET latitude = ?, longitude = ?
     WHERE id = ? AND latitude IS NULL AND longitude IS NULL`,
  )
    .bind(latitude, longitude, eventId)
    .run();

  return c.json({ ok: true, updated: updated.meta.changes > 0 });
});

// POST /events/:id/report -- user reports an event for moderation.
// Body: { reasons: string[], description: string }
// At REPORT_HIDE_THRESHOLD reports, the event is hidden from every feed.
eventRoutes.post('/:id/report', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const userId = await getUserId(c.env.DB, auth.email);
  if (!userId) return c.json({ error: 'USER_NOT_FOUND' }, 401);

  const eventId = parseInt(c.req.param('id'));
  if (!Number.isFinite(eventId)) {
    return c.json({ error: 'INVALID_EVENT_ID' }, 400);
  }

  const body = await c.req.json().catch(() => ({}));
  const reasons: unknown = (body as any).reasons;
  const description: unknown = (body as any).description;

  if (!Array.isArray(reasons) || reasons.length === 0) {
    return c.json({ error: 'MISSING_REASONS' }, 400);
  }
  if (typeof description !== 'string' || description.trim().length === 0) {
    return c.json({ error: 'MISSING_DESCRIPTION' }, 400);
  }
  const cleanReasons = reasons.filter(
    (r): r is string => typeof r === 'string' && REPORT_REASONS.has(r),
  );
  if (cleanReasons.length === 0) {
    return c.json({ error: 'INVALID_REASONS' }, 400);
  }

  // Confirm the event exists before recording the report.
  const eventExists = await c.env.DB.prepare('SELECT 1 FROM events WHERE id = ?')
    .bind(eventId)
    .first();
  if (!eventExists) return c.json({ error: 'EVENT_NOT_FOUND' }, 404);

  try {
    await c.env.DB.prepare(
      `INSERT INTO event_reports (user_id, event_id, reasons, description)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(userId, eventId, JSON.stringify(cleanReasons), description.trim())
      .run();
  } catch (err) {
    // unique(user_id, event_id) -- ignore duplicate reports
    if (String(err).includes('UNIQUE')) {
      return c.json({ ok: true, alreadyReported: true });
    }
    throw err;
  }

  return c.json({ ok: true });
});

// POST /events/scrape/:name -- manually trigger any registered scraper (for testing)
eventRoutes.post('/scrape/:name', async (c) => {
  const scraperName = c.req.param('name');
  const auth = c.req.header('Authorization');

  if (auth === `Bearer ${c.env.CRON_SECRET}`) {
    const scraper = SCRAPERS.find((s) => s.name === scraperName);
    if (!scraper) {
      return c.json({ error: 'SCRAPER_NOT_FOUND' }, 404);
    }
    try {
      await scraper.run(c.env);
      return c.json({ ok: true, name: scraperName });
    } catch (err) {
      console.error(`[scrape/${scraperName}] fatal:`, err);
      return c.json({ ok: false, name: scraperName, error: String(err) }, 500);
    }
  }

  const scraper = getManualScraper(scraperName);
  if (!scraper) {
    const available = SCRAPERS.filter((s) => s.manual).map((s) => s.name);
    return c.json({ error: 'UNKNOWN_SCRAPER', available }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const result = await scraper(c.env, body as Record<string, unknown>);

  return c.json(result);
});

// POST /events/reclassify -- backfill event_tags for all existing events (LOOP-221)
eventRoutes.post('/reclassify', async (c) => {
  const { writeEventTags } = await import('../lib/classifier');
  const { classifyEventsBatch } = await import('../lib/semanticTags');

  const rows = await c.env.DB.prepare(
    'SELECT id, title, description FROM events WHERE is_archived = 0',
  ).all<{ id: number; title: string; description: string | null }>();

  // Batch-classify to stay under the Workers AI per-invocation embed cap; the
  // same reason ingestEvents batches. tagsByIndex[i] <-> rows.results[i].
  const tagsByIndex = await classifyEventsBatch(
    c.env,
    rows.results.map((r) => ({ title: r.title, description: r.description })),
  );

  let processed = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.results.length; i++) {
    const event = rows.results[i];
    try {
      await writeEventTags(c.env.DB, event.id, tagsByIndex[i]);
      processed++;
    } catch (err) {
      errors.push(`event ${event.id}: ${err}`);
    }
  }

  return c.json({ ok: true, processed, errors });
});

// POST /events/seed-tag-vectors that embeds every taxonomy tag into Vectorize.
// Run once after deploy and whenever the taxonomy changes. Safe to re-run
// (upsert overwrites existing tag vectors).
eventRoutes.post('/seed-tag-vectors', async (c) => {
  const { seedTagVectors } = await import('../lib/semanticTags');
  const result = await seedTagVectors(c.env);
  return c.json({ ok: true, ...result });
});

// POST /events/delete-tag-vectors -- remove stale tag vectors by id.
// Body: { ids: string[] } where each id is `tag:<bucketId>:<tagName>`.
// Use after renaming/removing a taxonomy tag: seeding adds the new vector but
// leaves the old id orphaned, and the binding has no list method to find it.
eventRoutes.post('/delete-tag-vectors', async (c) => {
  const { deleteTagVectors } = await import('../lib/semanticTags');
  const body = (await c.req.json().catch(() => ({}))) as { ids?: string[] };
  const ids = Array.isArray(body.ids) ? body.ids : [];
  const result = await deleteTagVectors(c.env, ids);
  return c.json({ ok: true, ...result });
});
