// Auth routes for Cloudflare Worker + D1
import { Hono } from 'hono';
import type { Env } from '../worker';
import { UT_EMAIL_ERROR, isAllowedUTEmail, normalizeUTEmail } from '../../../shared/utEmail';

const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute
const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

export const authRoutes = new Hono<{ Bindings: Env }>();

// Hash code using Web Crypto API (available in Workers)
async function hashCode(code: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(code);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// `isValidUTEmail` used to live here as `endsWith('@utexas.edu')`, which
// rejected my.utexas.edu — one of the two domains students actually use — and
// accepted `evil-utexas.edu` besides. Replaced by isAllowedUTEmail in
// shared/utEmail.ts so the client and the Worker cannot disagree.

// Decide how to deliver the verification code. In dev mode we just log it
// so devs can test signup without a verified Resend domain. Otherwise we
// call Resend.
async function deliverVerificationCode(to: string, code: string, env: Env): Promise<void> {
  if (env.RESEND_DEV_MODE === 'true') {
    console.log(
      `\n[DEV] Verification code for ${to}: ${code}\n` +
        `      (RESEND_DEV_MODE=true — skipping Resend)\n`,
    );
    return;
  }
  await sendVerificationEmail(to, code, env.RESEND_API_KEY, env.EMAIL_FROM || DEFAULT_EMAIL_FROM);
}

/**
 * Who the code appears to come from.
 *
 * This was `onboarding@resend.dev` — Resend's shared sandbox sender, which
 * only delivers to the Resend account owner's own address and returns 403 for
 * everyone else. That is why codes reached Matthew's inbox during development
 * and would have reached exactly zero beta testers.
 *
 * `longhornloop.me` is now verified in Resend (SPF, DKIM and DMARC records
 * live at the registrar), so this can be any address at that domain.
 * Overridable via the EMAIL_FROM var so a staging Worker can point elsewhere
 * without a code change.
 */
const DEFAULT_EMAIL_FROM = 'Longhorn Loop <noreply@longhornloop.me>';

// Send verification email via Resend
async function sendVerificationEmail(
  to: string,
  code: string,
  apiKey: string,
  from: string,
): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Your Longhorn Loop Verification Code',
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
    console.error('Resend error:', error);
    throw new Error('Failed to send verification email');
  }
}

type CodeRow = {
  code_hash: string;
  expires_at: number;
  verified: number;
  used_at: number | null;
  attempts: number;
  last_sent_at: number;
};

/**
 * Store a fresh code and send it — and put the row back the way it was if the
 * send fails.
 *
 * Both /send-code and /resend-code used to do this inline, in the wrong order:
 *
 *     await c.env.DB.prepare('INSERT ... ON CONFLICT DO UPDATE ...').run();
 *     await deliverVerificationCode(...);   // throws -> unhandled 500
 *
 * A Resend outage therefore cost the user twice. The 500 was the small half.
 * The row had already been overwritten, so `last_sent_at` was now, which meant
 * the retry they immediately made came back RESEND_TOO_SOON for the next 60
 * seconds — a failure that locks you out of the fix for it. Worse, the
 * overwrite also destroyed whatever code was in the row before, so someone
 * holding a still-valid code from three minutes ago now had a dead one and a
 * cooldown, from an action that visibly failed.
 *
 * So: snapshot, write, send, and on failure restore the snapshot (or delete
 * the row if there wasn't one) before rethrowing. The caller turns the throw
 * into a 502 the client can retry immediately.
 *
 * D1 has no transaction we can hold across a fetch, so this is a manual
 * compensating write rather than a rollback. The window between the insert and
 * the restore is real but small, and the failure mode inside it — a valid code
 * briefly replaced — is the one we already had permanently.
 */
async function issueVerificationCode(email: string, env: Env): Promise<void> {
  const code = generateCode();
  const codeHash = await hashCode(code);
  const now = Date.now();

  const previous = await env.DB.prepare(
    `SELECT code_hash, expires_at, verified, used_at, attempts, last_sent_at
     FROM verification_codes WHERE email = ?`,
  )
    .bind(email)
    .first<CodeRow>();

  await env.DB.prepare(
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
    .bind(email, codeHash, now + CODE_EXPIRY_MS, now)
    .run();

  try {
    await deliverVerificationCode(email, code, env);
  } catch (sendError) {
    try {
      if (previous) {
        await env.DB.prepare(
          `UPDATE verification_codes
           SET code_hash = ?, expires_at = ?, verified = ?, used_at = ?, attempts = ?, last_sent_at = ?
           WHERE email = ?`,
        )
          .bind(
            previous.code_hash,
            previous.expires_at,
            previous.verified,
            previous.used_at,
            previous.attempts,
            previous.last_sent_at,
            email,
          )
          .run();
      } else {
        await env.DB.prepare('DELETE FROM verification_codes WHERE email = ?').bind(email).run();
      }
    } catch (rollbackError) {
      // The send failed AND we couldn't undo the write. The user is now in the
      // 60-second cooldown for a code that was never delivered. Nothing left to
      // do in-request, but this needs to be findable in the logs.
      console.error('Failed to roll back verification code for', email, rollbackError);
    }
    throw sendError;
  }
}

// POST /auth/send-code
authRoutes.post('/send-code', async (c) => {
  const { email, mode } = await c.req.json();

  if (!email || typeof email !== 'string') {
    return c.json({ error: 'MISSING_EMAIL' }, 400);
  }

  const normalizedEmail = normalizeUTEmail(email);

  // The gate, re-enabled (LOOP-255). This runs BEFORE the cooldown lookup and
  // before any Resend call, so a non-UT address costs one D1-free rejection
  // and never receives a code — which is the whole requirement: no code, no
  // way in.
  if (!isAllowedUTEmail(normalizedEmail)) {
    return c.json({ error: 'INVALID_UT_EMAIL', message: UT_EMAIL_ERROR }, 400);
  }

  // `mode: 'login'` means the caller came from "Already Have an Account", and
  // wants to be told when there is no account rather than being quietly walked
  // into creating one.
  //
  // Until now Log In and Sign Up were the same request, so an unknown address
  // typed under "Welcome Back!" received a code and fell through into
  // onboarding. Nobody was ever told they had no account, and a typo in your
  // own email silently produced a second one.
  //
  // The tradeoff is account enumeration: this confirms whether an address is
  // registered. Accepted deliberately. The signal already leaks — signing up
  // with an existing address lands you straight on the feed — and the app is
  // UT-gated, so the cost is low next to a sign-in screen that cannot say
  // "no account with that email".
  if (mode === 'login') {
    const existingUser = await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ?')
      .bind(normalizedEmail)
      .first();

    if (!existingUser) {
      // 404, and NO code is sent — sending one would defeat the point and
      // burn a Resend send on an address that cannot sign in.
      return c.json({ error: 'ACCOUNT_NOT_FOUND' }, 404);
    }
  }

  // Check resend cooldown
  const existing = await c.env.DB.prepare(
    'SELECT last_sent_at FROM verification_codes WHERE email = ?',
  )
    .bind(normalizedEmail)
    .first();

  if (existing && Date.now() - (existing.last_sent_at as number) < RESEND_COOLDOWN_MS) {
    return c.json({ error: 'RESEND_TOO_SOON' }, 429);
  }

  try {
    await issueVerificationCode(normalizedEmail, c.env);
  } catch (error) {
    console.error('Could not send verification code to', normalizedEmail, error);
    return c.json(
      {
        error: 'SEND_FAILED',
        message: "We couldn't send your code right now. Please try again.",
      },
      502,
    );
  }

  return c.json({ message: 'VERIFICATION_CODE_SENT' });
});

// POST /auth/verify-code
authRoutes.post('/verify-code', async (c) => {
  const { email, code } = await c.req.json();

  if (!email || !code) {
    return c.json({ error: 'MISSING_FIELDS' }, 400);
  }

  const normalizedEmail = normalizeUTEmail(email);

  // Gate the redemption side too, not just issuance. Codes live for 10
  // minutes, so without this a code issued to a non-UT address just before
  // this shipped would still be redeemable — and any row already sitting in
  // `verification_codes` from before the gate existed stays usable forever
  // otherwise.
  if (!isAllowedUTEmail(normalizedEmail)) {
    return c.json({ error: 'INVALID_UT_EMAIL', message: UT_EMAIL_ERROR }, 400);
  }

  const record = await c.env.DB.prepare('SELECT * FROM verification_codes WHERE email = ?')
    .bind(normalizedEmail)
    .first();

  if (!record) {
    return c.json({ error: 'CODE_NOT_FOUND' }, 400);
  }

  if (Date.now() > (record.expires_at as number)) {
    await c.env.DB.prepare('DELETE FROM verification_codes WHERE email = ?')
      .bind(normalizedEmail)
      .run();
    return c.json({ error: 'CODE_EXPIRED' }, 400);
  }

  if (record.used_at) {
    return c.json({ error: 'CODE_ALREADY_USED' }, 400);
  }

  if ((record.attempts as number) >= MAX_ATTEMPTS) {
    await c.env.DB.prepare('DELETE FROM verification_codes WHERE email = ?')
      .bind(normalizedEmail)
      .run();
    return c.json({ error: 'TOO_MANY_ATTEMPTS' }, 400);
  }

  const codeHash = await hashCode(code);

  if (record.code_hash !== codeHash) {
    // Increment attempts
    await c.env.DB.prepare('UPDATE verification_codes SET attempts = attempts + 1 WHERE email = ?')
      .bind(normalizedEmail)
      .run();
    return c.json({ error: 'INVALID_CODE' }, 400);
  }

  // Mark as verified and used
  await c.env.DB.prepare('UPDATE verification_codes SET verified = 1, used_at = ? WHERE email = ?')
    .bind(Date.now(), normalizedEmail)
    .run();

  // Generate JWT using Web Crypto API
  const token = await generateJWT(normalizedEmail, c.env.JWT_SECRET);

  return c.json({
    message: 'AUTHENTICATED',
    token,
    user: {
      email: normalizedEmail,
      isVerified: true,
    },
  });
});

// POST /auth/resend-code
authRoutes.post('/resend-code', async (c) => {
  const { email } = await c.req.json();

  if (!email || typeof email !== 'string') {
    return c.json({ error: 'MISSING_EMAIL' }, 400);
  }

  const normalizedEmail = normalizeUTEmail(email);

  // Same gate as /send-code. Resend is a second door to the same room — a
  // non-UT address must not be able to reach a code through it either.
  if (!isAllowedUTEmail(normalizedEmail)) {
    return c.json({ error: 'INVALID_UT_EMAIL', message: UT_EMAIL_ERROR }, 400);
  }

  const existing = await c.env.DB.prepare(
    'SELECT last_sent_at FROM verification_codes WHERE email = ?',
  )
    .bind(normalizedEmail)
    .first();

  if (existing && Date.now() - (existing.last_sent_at as number) < RESEND_COOLDOWN_MS) {
    return c.json({ error: 'RESEND_TOO_SOON' }, 429);
  }

  try {
    await issueVerificationCode(normalizedEmail, c.env);
  } catch (error) {
    console.error('Could not resend verification code to', normalizedEmail, error);
    return c.json(
      {
        error: 'SEND_FAILED',
        message: "We couldn't send your code right now. Please try again.",
      },
      502,
    );
  }

  return c.json({ message: 'VERIFICATION_CODE_SENT' });
});

// GET /auth/me -- get current authenticated user
authRoutes.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'UNAUTHORIZED' }, 401);
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = await verifyJWT(token, c.env.JWT_SECRET);
    return c.json({ user: payload });
  } catch {
    return c.json({ error: 'INVALID_TOKEN' }, 401);
  }
});

// JWT helpers using Web Crypto API (no jsonwebtoken dependency needed in Workers)
async function generateJWT(email: string, secret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    email,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days
  };

  const encoder = new TextEncoder();
  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '');
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, '');
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '');

  return `${headerB64}.${payloadB64}.${sigB64}`;
}

async function verifyJWT(token: string, secret: string): Promise<{ email: string }> {
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

  if (!valid) throw new Error('Invalid signature');

  const payload = JSON.parse(atob(payloadB64));

  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }

  return { email: payload.email };
}
