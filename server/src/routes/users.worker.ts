// User routes for Cloudflare Worker + D1
import { Hono } from "hono";
import type { Env } from "../worker";

export const userRoutes = new Hono<{ Bindings: Env }>();

// Middleware to extract user from JWT
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

// POST /users/me/agreements
userRoutes.post("/me/agreements", async (c) => {
  const user = await getAuthUser(
    c.req.header("Authorization"),
    c.env.JWT_SECRET,
  );
  if (!user) return c.json({ error: "UNAUTHORIZED" }, 401);

  const {
    agreed_responsible_use,
    agreed_visibility_acknowledgment,
    agreed_community_guidelines,
    notifications_enabled,
  } = await c.req.json();

  if (
    agreed_responsible_use !== true ||
    agreed_visibility_acknowledgment !== true ||
    agreed_community_guidelines !== true
  ) {
    return c.json({ error: "TERMS_NOT_ACCEPTED" }, 400);
  }

  // Update user record in D1
  await c.env.DB.prepare(
    `UPDATE users SET
       agreed_responsible_use = 1,
       agreed_visibility_acknowledgment = 1,
       agreed_community_guidelines = 1,
       notifications_enabled = ?,
       terms_accepted_at = datetime('now'),
       onboarding_completed = 1
     WHERE email = ?`,
  )
    .bind(notifications_enabled === true ? 1 : 0, user.email)
    .run();

  const updatedUser = await c.env.DB.prepare(
    "SELECT * FROM users WHERE email = ?",
  )
    .bind(user.email)
    .first();

  return c.json({ message: "AGREEMENTS_SAVED", user: updatedUser });
});

// POST /users/me/profile -- save onboarding profile data (majors, tags, avatar, etc.)
userRoutes.post("/me/profile", async (c) => {
  const user = await getAuthUser(
    c.req.header("Authorization"),
    c.env.JWT_SECRET,
  );
  if (!user) return c.json({ error: "UNAUTHORIZED" }, 401);

  const {
    first_name,
    last_name,
    avatar,
    year_classification,
    unique_classification,
    majors,
    tags,
  } = await c.req.json();

  // Upsert user record
  await c.env.DB.prepare(
    `INSERT INTO users (email, first_name, last_name, avatar, year_classification, unique_classification)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       avatar = excluded.avatar,
       year_classification = excluded.year_classification,
       unique_classification = excluded.unique_classification`,
  )
    .bind(
      user.email,
      first_name,
      last_name,
      avatar,
      year_classification,
      unique_classification,
    )
    .run();

  // Get user ID
  const dbUser = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(user.email)
    .first();

  if (!dbUser) return c.json({ error: "USER_NOT_FOUND" }, 404);

  const userId = dbUser.id as number;

  // Replace majors
  await c.env.DB.prepare("DELETE FROM user_majors WHERE user_id = ?")
    .bind(userId)
    .run();
  if (majors && Array.isArray(majors)) {
    for (const major of majors) {
      await c.env.DB.prepare(
        "INSERT INTO user_majors (user_id, major) VALUES (?, ?)",
      )
        .bind(userId, major)
        .run();
    }
  }

  // Replace tags
  await c.env.DB.prepare("DELETE FROM user_tags WHERE user_id = ?")
    .bind(userId)
    .run();
  if (tags && Array.isArray(tags)) {
    for (const tag of tags) {
      await c.env.DB.prepare(
        "INSERT INTO user_tags (user_id, tag) VALUES (?, ?)",
      )
        .bind(userId, tag)
        .run();
    }
  }

  return c.json({ message: "PROFILE_SAVED" });
});

// GET /users/me -- get current user profile
userRoutes.get("/me", async (c) => {
  const user = await getAuthUser(
    c.req.header("Authorization"),
    c.env.JWT_SECRET,
  );
  if (!user) return c.json({ error: "UNAUTHORIZED" }, 401);

  const dbUser = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?")
    .bind(user.email)
    .first();

  if (!dbUser) return c.json({ error: "USER_NOT_FOUND" }, 404);

  const userId = dbUser.id as number;

  // Fetch majors and tags
  const majors = await c.env.DB.prepare(
    "SELECT major FROM user_majors WHERE user_id = ?",
  )
    .bind(userId)
    .all();

  const tags = await c.env.DB.prepare(
    "SELECT tag FROM user_tags WHERE user_id = ?",
  )
    .bind(userId)
    .all();

  return c.json({
    user: {
      ...dbUser,
      majors: majors.results.map((r) => r.major),
      tags: tags.results.map((r) => r.tag),
    },
  });
});
