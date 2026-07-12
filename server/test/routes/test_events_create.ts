import { describe, expect, it } from 'vitest';
import { eventRoutes } from '../../src/routes/events.worker';
import type { Env } from '../../src/worker';

const JWT_SECRET = 'test-secret';
const USER_EMAIL = 'student@utexas.edu';
const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

type UserRow = {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
};

type EventRow = Record<string, unknown> & {
  id: number;
  source: string;
  source_event_id: string;
  title: string;
  start_datetime: string;
  end_datetime: string;
  created_by_user_id: number;
};

class FakeD1Statement {
  private params: unknown[] = [];

  constructor(
    private readonly db: FakeD1Database,
    private readonly sql: string,
  ) {}

  bind(...params: unknown[]): FakeD1Statement {
    this.params = params;
    return this;
  }

  async first(): Promise<Record<string, unknown> | null> {
    return this.db.first(this.sql, this.params);
  }

  async all(): Promise<{ results: Record<string, unknown>[] }> {
    return { results: this.db.all(this.sql, this.params) };
  }

  async run(): Promise<{ meta: { last_row_id?: number } }> {
    return this.db.run(this.sql, this.params);
  }
}

class FakeD1Database {
  readonly events: EventRow[] = [];
  readonly eventCategories: {
    event_id: number;
    category_id: string;
    category_name: string | null;
  }[] = [];

  constructor(
    private readonly users: UserRow[] = [
      { id: 1, email: USER_EMAIL, first_name: 'Bevo', last_name: 'Student' },
    ],
  ) {}

  prepare(sql: string): FakeD1Statement {
    return new FakeD1Statement(this, sql);
  }

  first(sql: string, params: unknown[]): Record<string, unknown> | null {
    if (sql.includes('FROM users WHERE email = ?')) {
      return this.users.find((user) => user.email === params[0]) ?? null;
    }

    if (sql.includes('FROM events e') && sql.includes('WHERE e.id = ?')) {
      const event = this.events.find((row) => row.id === params[0]);
      return event ? { ...event, org_profile_picture: null } : null;
    }

    throw new Error(`Unexpected first() SQL: ${sql}`);
  }

  all(sql: string, params: unknown[]): Record<string, unknown>[] {
    if (sql.includes('FROM event_categories WHERE event_id = ?')) {
      return this.eventCategories
        .filter((category) => category.event_id === params[0])
        .map((category) => ({
          category_id: category.category_id,
          category_name: category.category_name,
        }));
    }

    if (sql.includes('FROM event_benefits WHERE event_id = ?')) {
      return [];
    }

    throw new Error(`Unexpected all() SQL: ${sql}`);
  }

  run(sql: string, params: unknown[]): { meta: { last_row_id?: number } } {
    if (sql.includes('INSERT INTO events')) {
      const id = this.events.length + 1;
      const event: EventRow = {
        id,
        source: params[0] as string,
        source_event_id: params[1] as string,
        title: params[2] as string,
        description: params[3] as string | null,
        start_datetime: params[4] as string,
        end_datetime: params[5] as string,
        location_short: params[6] as string | null,
        location_full: params[7] as string | null,
        latitude: params[8] as number | null,
        longitude: params[9] as number | null,
        host_organization_id: null,
        host_organization_name: params[10] as string,
        event_url: params[11] as string | null,
        rsvp_url: params[12] as string | null,
        image_url: params[13] as string | null,
        image_width: params[14] as number | null,
        image_height: params[15] as number | null,
        image_aspect_ratio: params[16] as string,
        image_mime_type: params[17] as string | null,
        image_alt_text: params[18] as string | null,
        theme: params[19] as string | null,
        visibility: 'Public',
        rsvp_total: 0,
        status: 'active',
        expires_at: params[20] as string,
        is_featured: 0,
        created_by_user_id: params[21] as number,
        is_archived: 0,
        archived_at: null,
      };
      this.events.push(event);
      return { meta: { last_row_id: id } };
    }

    if (sql.includes('INSERT OR IGNORE INTO event_categories')) {
      const row = {
        event_id: params[0] as number,
        category_id: params[1] as string,
        category_name: params[2] as string | null,
      };
      if (
        !this.eventCategories.some(
          (category) =>
            category.event_id === row.event_id && category.category_id === row.category_id,
        )
      ) {
        this.eventCategories.push(row);
      }
      return { meta: {} };
    }

    throw new Error(`Unexpected run() SQL: ${sql}`);
  }
}

class FakeR2Bucket {
  readonly puts: { key: string; value: unknown; options: unknown }[] = [];

  async put(key: string, value: unknown, options: unknown): Promise<null> {
    this.puts.push({ key, value, options });
    return null;
  }
}

function makeEnv(
  db: FakeD1Database,
  imageBucket?: FakeR2Bucket,
  overrides: Partial<Env> = {},
): Env {
  return {
    DB: db as unknown as D1Database,
    EVENT_IMAGES: imageBucket as unknown as R2Bucket,
    EVENT_IMAGE_PUBLIC_BASE_URL: imageBucket ? 'https://cdn.example.test' : undefined,
    JWT_SECRET,
    RESEND_API_KEY: '',
    ...overrides,
  };
}

async function signJwt(email: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    email,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60,
  };

  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '');
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, '');
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '');
  return `${signingInput}.${sigB64}`;
}

async function postCreate(
  env: Env,
  body: Record<string, unknown>,
  token?: string,
): Promise<Response> {
  return eventRoutes.request(
    'http://longhorn-loop.test/create',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    },
    env,
  );
}

describe('POST /events/create', () => {
  it('creates a user-created event for an authenticated user', async () => {
    const db = new FakeD1Database();
    const token = await signJwt(USER_EMAIL);

    const res = await postCreate(
      makeEnv(db),
      {
        title: 'Board Game Night',
        description: 'Bring a friend and a favorite game.',
        start_datetime: '2026-07-07T19:00:00-05:00',
        location: 'GDC 2.216',
        rsvp_url: 'https://example.test/rsvp',
        discoveryBucket: 'gaming',
        categories: [{ id: 'gaming', name: 'Gaming' }, 'Board Games & Tabletop'],
      },
      token,
    );

    expect(res.status).toBe(201);
    const json = (await res.json()) as { event: EventRow & { categories: unknown[] } };
    expect(json.event).toMatchObject({
      source: 'user_created',
      title: 'Board Game Night',
      start_datetime: '2026-07-08T00:00:00.000Z',
      end_datetime: '2026-07-08T00:00:00.000Z',
      location_short: 'GDC 2.216',
      location_full: 'GDC 2.216',
      host_organization_name: 'Bevo Student',
      rsvp_url: 'https://example.test/rsvp',
      theme: 'Social',
      created_by_user_id: 1,
      image_url: null,
      image_aspect_ratio: 'none',
    });
    expect(json.event.source_event_id).toMatch(/^user-1-/);
    expect(json.event.categories).toEqual([
      { id: 'gaming', name: 'Gaming' },
      { id: 'board-games-and-tabletop', name: 'Board Games & Tabletop' },
    ]);
    expect(db.events).toHaveLength(1);
  });

  it('returns validation errors when a required field is missing', async () => {
    const db = new FakeD1Database();
    const token = await signJwt(USER_EMAIL);

    const res = await postCreate(
      makeEnv(db),
      { start_datetime: '2026-07-07T19:00:00-05:00' },
      token,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'VALIDATION_ERROR',
      fields: { title: 'Required' },
    });
    expect(db.events).toHaveLength(0);
  });

  it('rejects unauthenticated requests', async () => {
    const db = new FakeD1Database();

    const res = await postCreate(makeEnv(db), {
      title: 'Unauthorized Event',
      start_datetime: '2026-07-07T19:00:00-05:00',
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'UNAUTHORIZED' });
    expect(db.events).toHaveLength(0);
  });

  it('stores an uploaded base64 image when R2 is configured', async () => {
    const db = new FakeD1Database();
    const bucket = new FakeR2Bucket();
    const token = await signJwt(USER_EMAIL);

    const res = await postCreate(
      makeEnv(db, bucket),
      {
        title: 'Flyer Event',
        startDatetime: '2026-07-07T19:00:00-05:00',
        image: {
          data: `data:image/png;base64,${PNG_1X1_BASE64}`,
          filename: 'flyer.png',
          altText: 'Flyer',
        },
      },
      token,
    );

    expect(res.status).toBe(201);
    expect(bucket.puts).toHaveLength(1);
    expect(bucket.puts[0].key).toMatch(/^events\/user-created\/1\/.+\.png$/);

    const json = (await res.json()) as { event: EventRow };
    expect(json.event).toMatchObject({
      image_url: `https://cdn.example.test/${bucket.puts[0].key}`,
      image_width: 1,
      image_height: 1,
      image_aspect_ratio: 'square',
      image_mime_type: 'image/png',
      image_alt_text: 'Flyer',
    });
  });
});
