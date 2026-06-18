// Saved-events (bookmark) routes for Cloudflare Worker
import { Hono } from "hono";
import type { Env } from "../worker";

export const savedRoutes = new Hono<{ Bindings: Env }>();

// JWT verification -- mirrors the pattern in notifications.worker.ts
async function getAuthUser(
  authHeader: string | undefined,
  secret: string,
): Promise<{ email: string } | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.split(" ")[1];
  try {
    const [headerB64, payloadB64, sigB64] = token.split(".");
    const encoder = new TextEncoder();
    const signingInput = `${headerB64}.${payloadB64}`;
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const sigBytes = Uint8Array.from(atob(sigB64), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes,
      encoder.encode(signingInput),
    );
    if (!valid) return null;
    const payload = JSON.parse(atob(payloadB64));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { email: payload.email };
  } catch {
    return null;
  }
}

async function getUserId(
  db: D1Database,
  email: string,
): Promise<number | null> {
  const row = await db
    .prepare("SELECT id FROM users WHERE email = ?")
    .bind(email)
    .first();
  return row ? (row.id as number) : null;
}

// GET /saved -- list the current user's saved/bookmarked events
savedRoutes.get("/", async (c) => {
  const authUser = await getAuthUser(
    c.req.header("Authorization"),
    c.env.JWT_SECRET,
  );
  if (!authUser) return c.json({ error: "UNAUTHORIZED" }, 401);

  const userId = await getUserId(c.env.DB, authUser.email);
  if (!userId) return c.json({ error: "USER_NOT_FOUND" }, 404);

  const { results } = await c.env.DB.prepare(
    `SELECT e.*, o.profile_picture as org_profile_picture
     FROM saved_events s
     JOIN events e ON e.id = s.event_id
     LEFT JOIN organizations o ON e.host_organization_id = o.id
     WHERE s.user_id = ?
     ORDER BY e.start_datetime ASC`,
  )
    .bind(userId)
    .all();

  return c.json({ events: results });
});

// POST /saved/:eventId -- bookmark an event
savedRoutes.post("/:eventId", async (c) => {
  const authUser = await getAuthUser(
    c.req.header("Authorization"),
    c.env.JWT_SECRET,
  );
  if (!authUser) return c.json({ error: "UNAUTHORIZED" }, 401);

  const userId = await getUserId(c.env.DB, authUser.email);
  if (!userId) return c.json({ error: "USER_NOT_FOUND" }, 404);

  const eventId = parseInt(c.req.param("eventId"), 10);
  if (isNaN(eventId)) return c.json({ error: "INVALID_EVENT_ID" }, 400);

  const event = await c.env.DB.prepare("SELECT id FROM events WHERE id = ?")
    .bind(eventId)
    .first();
  if (!event) return c.json({ error: "EVENT_NOT_FOUND" }, 404);

  await c.env.DB.prepare(
    `INSERT INTO saved_events (user_id, event_id)
     VALUES (?, ?)
     ON CONFLICT(user_id, event_id) DO NOTHING`,
  )
    .bind(userId, eventId)
    .run();

  return c.json({ saved: true });
});

// DELETE /saved/:eventId -- remove a bookmark
savedRoutes.delete("/:eventId", async (c) => {
  const authUser = await getAuthUser(
    c.req.header("Authorization"),
    c.env.JWT_SECRET,
  );
  if (!authUser) return c.json({ error: "UNAUTHORIZED" }, 401);

  const userId = await getUserId(c.env.DB, authUser.email);
  if (!userId) return c.json({ error: "USER_NOT_FOUND" }, 404);

  const eventId = parseInt(c.req.param("eventId"), 10);
  if (isNaN(eventId)) return c.json({ error: "INVALID_EVENT_ID" }, 400);

  await c.env.DB.prepare(
    "DELETE FROM saved_events WHERE user_id = ? AND event_id = ?",
  )
    .bind(userId, eventId)
    .run();

  return c.json({ saved: false });
});
