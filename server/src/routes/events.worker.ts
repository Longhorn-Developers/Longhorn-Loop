// Events routes for Cloudflare Worker
import { Hono } from 'hono';
import { classifyAspectRatio, parseImageDimensions } from '../events/normalize';
import type { ImageAspectRatio } from '../events/types';
import { scrapeHornsLink } from '../scrapers/hornslink';
import { scrapeMccombs } from '../scrapers/mccombs';
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
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const EXPIRES_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const ISO_8601_WITH_TIMEZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const VALID_IMAGE_ASPECT_RATIOS = new Set<ImageAspectRatio>([
  'vertical',
  'square',
  'horizontal',
  'none',
]);
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
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

// JWT verification (mirrors the pattern used in saved.worker.ts).
async function getAuthUser(
  authHeader: string | undefined,
  secret: string,
): Promise<{ email: string } | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  try {
    const [headerB64, payloadB64, sigB64] = token.split('.');
    const encoder = new TextEncoder();
    const signingInput = `${headerB64}.${payloadB64}`;
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const sigBytes = Uint8Array.from(atob(sigB64), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(signingInput));
    if (!valid) return null;
    const payload = JSON.parse(atob(payloadB64));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { email: payload.email };
  } catch {
    return null;
  }
}

async function getUserId(db: D1Database, email: string): Promise<number | null> {
  const row = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  return row ? (row.id as number) : null;
}

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

function extensionForMimeType(mimeType: string, filename: string | null): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/gif') return 'gif';
  if (mimeType === 'image/webp') return 'webp';
  const filenameMatch = filename?.match(/\.([a-z0-9]+)$/i);
  return filenameMatch?.[1].toLowerCase() ?? 'bin';
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

function isFileLike(value: FormDataEntryValue): value is File {
  return typeof File !== 'undefined' && value instanceof File;
}

function assignFormField(body: CreateEventBody, key: string, value: string): void {
  if (key === 'categories' || key === 'interestTags' || key === 'interest_tags') {
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
// reported and any event over the global threshold.
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
       start_datetime, end_datetime, location_short, location_full,
       latitude, longitude, host_organization_name,
       event_url, rsvp_url,
       image_url, image_width, image_height,
       image_aspect_ratio, image_mime_type, image_alt_text,
       theme, visibility, rsvp_total, expires_at,
       created_by_user_id
     ) VALUES (
       ?, ?, ?, ?,
       ?, ?, ?, ?,
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

  const event = await getCreatedEvent(c.env.DB, eventId);
  return c.json({ event }, 201);
});

// GET /events -- list upcoming events with optional filters
eventRoutes.get('/', async (c) => {
  const limit = parseInt(c.req.query('limit') || '20');
  const offset = parseInt(c.req.query('offset') || '0');
  const category = c.req.query('category');
  const benefit = c.req.query('benefit');
  const theme = c.req.query('theme');
  const orgId = c.req.query('orgId');

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
      AND e.end_datetime > datetime('now')
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

  return c.json({
    ...event,
    categories: categories.results.map((c: any) => ({
      id: c.category_id,
      name: c.category_name,
    })),
    benefits: benefits.results.map((b: any) => b.benefit_name),
  });
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

// POST /events/scrape -- manually trigger a scrape (for testing)
eventRoutes.post('/scrape', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const maxPages = (body as any).maxPages ?? 3;
  const dryRun = (body as any).dryRun ?? false;

  const result = await scrapeHornsLink(c.env.DB, { maxPages, dryRun });

  return c.json(result);
});

// POST /events/scrape/mccombs -- manually trigger the McCombs scrape (for testing)
eventRoutes.post('/scrape/mccombs', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const maxEvents = (body as any).maxEvents ?? 500;
  const dryRun = (body as any).dryRun ?? false;

  const result = await scrapeMccombs(c.env.DB, { maxEvents, dryRun });

  return c.json(result);
});
