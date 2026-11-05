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
  venue_type: string;
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
  readonly eventTags: {
    event_id: number;
    bucket_id: string;
    tag: string;
    source: string;
    score: number | null;
  }[] = [];

  constructor(
    private readonly users: UserRow[] = [
      { id: 1, email: USER_EMAIL, first_name: 'Bevo', last_name: 'Student' },
    ],
    /**
     * Orgs the caller belongs to, for the host_organization_id path (LOOP-281).
     * Empty by default so every test predating it behaves as before.
     */
    private readonly memberships: { orgId: number; userId: number; orgName: string }[] = [],
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

    // resolveHostOrganization: the caller's membership in the org they claim
    // to be posting as, plus that org's canonical name (LOOP-281).
    if (sql.includes('FROM org_members m') && sql.includes('JOIN organizations o')) {
      const row = this.memberships.find(
        (member) => member.orgId === params[0] && member.userId === params[1],
      );
      return row ? { id: row.orgId, name: row.orgName } : null;
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
        venue_type: params[6] as string,
        location_short: params[7] as string | null,
        location_full: params[8] as string | null,
        latitude: params[9] as number | null,
        longitude: params[10] as number | null,
        // params[11] was a hardcoded null until LOOP-281 — the INSERT did not
        // name host_organization_id at all, which is precisely why an event an
        // admin posted as their org never reached the org console.
        host_organization_id: params[11] as number | null,
        host_organization_name: params[12] as string,
        event_url: params[13] as string | null,
        rsvp_url: params[14] as string | null,
        image_url: params[15] as string | null,
        image_width: params[16] as number | null,
        image_height: params[17] as number | null,
        image_aspect_ratio: params[18] as string,
        image_mime_type: params[19] as string | null,
        image_alt_text: params[20] as string | null,
        theme: params[21] as string | null,
        visibility: 'Public',
        rsvp_total: 0,
        status: 'active',
        expires_at: params[22] as string,
        is_featured: 0,
        created_by_user_id: params[23] as number,
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

    if (sql.includes('DELETE FROM event_tags WHERE event_id = ?')) {
      const eventId = params[0] as number;
      for (let i = this.eventTags.length - 1; i >= 0; i--) {
        if (this.eventTags[i].event_id === eventId) this.eventTags.splice(i, 1);
      }
      return { meta: {} };
    }

    if (sql.includes('INSERT OR IGNORE INTO event_tags')) {
      this.eventTags.push({
        event_id: params[0] as number,
        bucket_id: params[1] as string,
        tag: params[2] as string,
        source: params[3] as string,
        score: params[4] as number | null,
      });
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
        venue_type: 'in_person',
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
      venue_type: 'in_person',
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

  // LOOP-282: the tester's link only "registered" once they typed https://.
  it('adds https:// to a scheme-less RSVP link instead of rejecting it', async () => {
    const db = new FakeD1Database();
    const token = await signJwt(USER_EMAIL);

    const res = await postCreate(
      makeEnv(db),
      {
        title: 'MHA in Concert',
        start_datetime: '2026-07-07T19:00:00-05:00',
        rsvp_url: 'texasperformingarts.evenue.net',
      },
      token,
    );

    expect(res.status).toBe(201);
    const json = (await res.json()) as { event: EventRow };
    expect(json.event.rsvp_url).toBe('https://texasperformingarts.evenue.net/');
  });

  it('rejects an RSVP link that is not a web address', async () => {
    const db = new FakeD1Database();
    const token = await signJwt(USER_EMAIL);

    const res = await postCreate(
      makeEnv(db),
      {
        title: 'MHA in Concert',
        start_datetime: '2026-07-07T19:00:00-05:00',
        rsvp_url: 'mailto:tickets@utexas.edu',
      },
      token,
    );

    expect(res.status).toBe(400);
    const json = (await res.json()) as { fields: Record<string, string> };
    expect(json.fields.rsvp_url).toBe('Use a web link (https://…)');
    expect(db.events).toHaveLength(0);
  });

  it('writes hand-picked taxonomy tags to event_tags with source user', async () => {
    const db = new FakeD1Database();
    const token = await signJwt(USER_EMAIL);

    const res = await postCreate(
      makeEnv(db),
      {
        title: 'Board Game Night',
        start_datetime: '2026-07-07T19:00:00-05:00',
        venue_type: 'in_person',
        discoveryBucket: 'gaming',
        // 'Board Games' is a real gaming tag; 'Not A Tag' is not and is skipped.
        categories: ['Board Games', 'Not A Tag'],
      },
      token,
    );

    expect(res.status).toBe(201);
    expect(db.eventTags).toEqual([
      { event_id: 1, bucket_id: 'gaming', tag: 'Board Games', source: 'user', score: 1 },
    ]);
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
        venue_type: 'in_person',
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

  // LOOP-281. The wizard's first step lets an admin or editor post as one of
  // their orgs, but the request carried no poster and the INSERT never named
  // host_organization_id — so the row went in with a NULL org and
  // GET /orgs/:orgId/events, which filters on exactly that column, could not
  // see it. The event showed under Posted on the poster's own profile, which
  // is what made it look like a read bug rather than a write one.
  describe('posting as an organization (LOOP-281)', () => {
    const ORG = 42;

    const withOrg = () =>
      new FakeD1Database(
        [{ id: 1, email: USER_EMAIL, first_name: 'Bevo', last_name: 'Student' }],
        [{ orgId: ORG, userId: 1, orgName: 'Longhorn Devs' }],
      );

    const baseBody = {
      title: 'Gong Cha Coffee Chat',
      start_datetime: '2026-09-20T18:00:00-05:00',
      venue_type: 'in_person',
      location: 'GDC 2.216',
    };

    it('writes host_organization_id so the org console can find the event', async () => {
      const db = withOrg();
      const res = await postCreate(
        makeEnv(db),
        { ...baseBody, host_organization_id: ORG },
        await signJwt(USER_EMAIL),
      );

      expect(res.status).toBe(201);
      const json = (await res.json()) as { event: EventRow };
      expect(json.event.host_organization_id).toBe(ORG);
      // Still attributed to the person who posted it: the org association is
      // added, it does not move the event off their profile.
      expect(json.event.created_by_user_id).toBe(1);
    });

    it('takes the host name from the organizations row, not the request', async () => {
      // The client's copy of the name comes from a cached /orgs/mine response
      // and would go stale on a rename; trusting it would also let a caller
      // label an event with any org name they liked.
      const db = withOrg();
      const res = await postCreate(
        makeEnv(db),
        { ...baseBody, host_organization_id: ORG, poster: { name: 'Not This Org' } },
        await signJwt(USER_EMAIL),
      );

      expect(res.status).toBe(201);
      const json = (await res.json()) as { event: EventRow };
      expect(json.event.host_organization_name).toBe('Longhorn Devs');
    });

    it('accepts the id as a string, which is what multipart sends', async () => {
      // The create wizard posts FormData, so every field arrives as text.
      const db = withOrg();
      const res = await postCreate(
        makeEnv(db),
        { ...baseBody, host_organization_id: String(ORG) },
        await signJwt(USER_EMAIL),
      );

      expect(res.status).toBe(201);
      const json = (await res.json()) as { event: EventRow };
      expect(json.event.host_organization_id).toBe(ORG);
    });

    it('refuses an org the caller does not belong to', async () => {
      // Otherwise any authenticated user could put a post on any org's public
      // profile just by naming its id.
      const db = withOrg();
      const res = await postCreate(
        makeEnv(db),
        { ...baseBody, host_organization_id: 999 },
        await signJwt(USER_EMAIL),
      );

      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string; fields: Record<string, string> };
      expect(json.error).toBe('VALIDATION_ERROR');
      expect(json.fields.host_organization_id).toBeTruthy();
      expect(db.events).toHaveLength(0);
    });

    it('refuses an id that is not a positive integer', async () => {
      const db = withOrg();
      for (const bad of ['abc', '0', '-4', '1.5']) {
        const res = await postCreate(
          makeEnv(db),
          { ...baseBody, host_organization_id: bad },
          await signJwt(USER_EMAIL),
        );
        expect(res.status).toBe(400);
      }
      expect(db.events).toHaveLength(0);
    });

    it('leaves the org null and keeps the personal host name when posting as a person', async () => {
      const db = withOrg();
      const res = await postCreate(makeEnv(db), baseBody, await signJwt(USER_EMAIL));

      expect(res.status).toBe(201);
      const json = (await res.json()) as { event: EventRow };
      expect(json.event.host_organization_id).toBeNull();
      expect(json.event.host_organization_name).toBe('Bevo Student');
    });
  });
});
