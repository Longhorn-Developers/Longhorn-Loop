// Auth routes for Cloudflare Worker + D1
import { Hono } from "hono";
import type { Env } from "../worker";

const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute
const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

export const authRoutes = new Hono<{ Bindings: Env }>();

// Hash code using Web Crypto API (available in Workers)
async function hashCode(code: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(code);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function isValidUTEmail(email: string): boolean {
  return email.toLowerCase().endsWith("@utexas.edu");
}

// Send verification email via Resend
async function sendVerificationEmail(
  to: string,
  code: string,
  apiKey: string,
): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Longhorn Loop <verify@longhornloop.com>",
      to: [to],
      subject: "Your Longhorn Loop Verification Code",
      html: `
        <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #BF5700;">Longhorn Loop</h2>
          <p>Your verification code is:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 20px; background: #f5f5f5; border-radius: 8px; margin: 16px 0;">
            ${code}
          </div>
          <p style="color: #666; font-size: 14px;">This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
        </div>
      `,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    console.error("Resend error:", error);
    throw new Error("Failed to send verification email");
  }
}

// POST /auth/send-code
authRoutes.post("/send-code", async (c) => {
  const { email } = await c.req.json();

  if (!email || typeof email !== "string") {
    return c.json({ error: "MISSING_EMAIL" }, 400);
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (!isValidUTEmail(normalizedEmail)) {
    return c.json({ error: "INVALID_UT_EMAIL" }, 400);
  }

  // Check resend cooldown
  const existing = await c.env.DB.prepare(
    "SELECT last_sent_at FROM verification_codes WHERE email = ?",
  )
    .bind(normalizedEmail)
    .first();

  if (
    existing &&
    Date.now() - (existing.last_sent_at as number) < RESEND_COOLDOWN_MS
  ) {
    return c.json({ error: "RESEND_TOO_SOON" }, 429);
  }

  const code = generateCode();
  const codeHash = await hashCode(code);

  // Upsert verification code into D1
  await c.env.DB.prepare(
    `INSERT INTO verification_codes (email, code_hash, expires_at, verified, used_at, attempts, last_sent_at)
     VALUES (?, ?, ?, 0, NULL, 0, ?)
     ON CONFLICT(email) DO UPDATE SET
       code_hash = excluded.code_hash,
       expires_at = excluded.expires_at,
       verified = 0,
       used_at = NULL,
       attempts = 0,
       last_sent_at = excluded.last_sent_at`,
  )
    .bind(normalizedEmail, codeHash, Date.now() + CODE_EXPIRY_MS, Date.now())
    .run();

  // Send verification email
  await sendVerificationEmail(normalizedEmail, code, c.env.RESEND_API_KEY);

  return c.json({ message: "VERIFICATION_CODE_SENT" });
});

// POST /auth/verify-code
authRoutes.post("/verify-code", async (c) => {
  const { email, code } = await c.req.json();

  if (!email || !code) {
    return c.json({ error: "MISSING_FIELDS" }, 400);
  }

  const normalizedEmail = email.trim().toLowerCase();

  const record = await c.env.DB.prepare(
    "SELECT * FROM verification_codes WHERE email = ?",
  )
    .bind(normalizedEmail)
    .first();

  if (!record) {
    return c.json({ error: "CODE_NOT_FOUND" }, 400);
  }

  if (Date.now() > (record.expires_at as number)) {
    await c.env.DB.prepare("DELETE FROM verification_codes WHERE email = ?")
      .bind(normalizedEmail)
      .run();
    return c.json({ error: "CODE_EXPIRED" }, 400);
  }

  if (record.used_at) {
    return c.json({ error: "CODE_ALREADY_USED" }, 400);
  }

  if ((record.attempts as number) >= MAX_ATTEMPTS) {
    await c.env.DB.prepare("DELETE FROM verification_codes WHERE email = ?")
      .bind(normalizedEmail)
      .run();
    return c.json({ error: "TOO_MANY_ATTEMPTS" }, 400);
  }

  const codeHash = await hashCode(code);

  if (record.code_hash !== codeHash) {
    // Increment attempts
    await c.env.DB.prepare(
      "UPDATE verification_codes SET attempts = attempts + 1 WHERE email = ?",
    )
      .bind(normalizedEmail)
      .run();
    return c.json({ error: "INVALID_CODE" }, 400);
  }

  // Mark as verified and used
  await c.env.DB.prepare(
    "UPDATE verification_codes SET verified = 1, used_at = ? WHERE email = ?",
  )
    .bind(Date.now(), normalizedEmail)
    .run();

  // Generate JWT using Web Crypto API
  const token = await generateJWT(normalizedEmail, c.env.JWT_SECRET);

  return c.json({
    message: "AUTHENTICATED",
    token,
    user: {
      email: normalizedEmail,
      isVerified: true,
    },
  });
});

// POST /auth/resend-code
authRoutes.post("/resend-code", async (c) => {
  const { email } = await c.req.json();

  if (!email || typeof email !== "string") {
    return c.json({ error: "MISSING_EMAIL" }, 400);
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (!isValidUTEmail(normalizedEmail)) {
    return c.json({ error: "INVALID_UT_EMAIL" }, 400);
  }

  const existing = await c.env.DB.prepare(
    "SELECT last_sent_at FROM verification_codes WHERE email = ?",
  )
    .bind(normalizedEmail)
    .first();

  if (
    existing &&
    Date.now() - (existing.last_sent_at as number) < RESEND_COOLDOWN_MS
  ) {
    return c.json({ error: "RESEND_TOO_SOON" }, 429);
  }

  const code = generateCode();
  const codeHash = await hashCode(code);

  await c.env.DB.prepare(
    `INSERT INTO verification_codes (email, code_hash, expires_at, verified, attempts, last_sent_at)
     VALUES (?, ?, ?, 0, 0, ?)
     ON CONFLICT(email) DO UPDATE SET
       code_hash = excluded.code_hash,
       expires_at = excluded.expires_at,
       verified = 0,
       attempts = 0,
       last_sent_at = excluded.last_sent_at`,
  )
    .bind(normalizedEmail, codeHash, Date.now() + CODE_EXPIRY_MS, Date.now())
    .run();

  // Send verification email
  await sendVerificationEmail(normalizedEmail, code, c.env.RESEND_API_KEY);

  return c.json({ message: "VERIFICATION_CODE_SENT" });
});

// GET /auth/me -- get current authenticated user
authRoutes.get("/me", async (c) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "UNAUTHORIZED" }, 401);
  }

  const token = authHeader.split(" ")[1];

  try {
    const payload = await verifyJWT(token, c.env.JWT_SECRET);
    return c.json({ user: payload });
  } catch {
    return c.json({ error: "INVALID_TOKEN" }, 401);
  }
});

// JWT helpers using Web Crypto API (no jsonwebtoken dependency needed in Workers)
async function generateJWT(email: string, secret: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    email,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days
  };

  const encoder = new TextEncoder();
  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, "");
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, "");
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(signingInput),
  );
  const sigB64 = btoa(
    String.fromCharCode(...new Uint8Array(signature)),
  ).replace(/=/g, "");

  return `${headerB64}.${payloadB64}.${sigB64}`;
}

async function verifyJWT(
  token: string,
  secret: string,
): Promise<{ email: string }> {
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

  if (!valid) throw new Error("Invalid signature");

  const payload = JSON.parse(atob(payloadB64));

  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Token expired");
  }

  return { email: payload.email };
}
