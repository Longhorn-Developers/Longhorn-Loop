/**
 * Outbound email, behind one interface (LOOP-255).
 *
 * WHY THIS EXISTS
 *
 * Every address this app will ever email ends in a utexas.edu domain, so 100%
 * of our mail hits one inbound gateway: UT's Proofpoint in front of Microsoft
 * 365. Most products spread across Gmail, Outlook and Yahoo, and a bad
 * reputation with one is survivable. We have a single point of failure, and it
 * already fired — the first real sends came back:
 *
 *     550 #5.7.1 Your access to submit messages to this e-mail system has
 *     been rejected.
 *
 * Identical for a mailbox that does not exist, which means UT rejected the
 * SENDER before it looked at the recipient. Not spam foldering, not a bad
 * address: a sender-level block. Resend's free tier sends over a shared Amazon
 * SES pool, and that pool is the most likely thing being refused.
 *
 * We do not yet know whether the block is on the sending IPs or on the
 * longhornloop.me domain itself, and the fix differs completely:
 *
 *   - IP reputation  -> a different provider clears it
 *   - domain/TLD     -> only a UT ITS allow-list or a different domain does
 *
 * The only way to find out is to send the same message from different
 * infrastructure and see what bounces. That is what this file is for: swapping
 * providers is now an env var, not a rewrite, so each experiment costs one
 * redeploy instead of an afternoon.
 *
 * WHAT TO TRY, AND WHY IT MIGHT WORK
 *
 *   cloudflare  Cloudflare Email Service. Free-ish under the sponsorship and
 *               native to the Worker, but the platform is months old — new
 *               infrastructure means new IPs with no history, and history is
 *               exactly what Proofpoint scores on. Could be cleaner than SES
 *               shared; could be worse. Unknown, and worth one test.
 *   postmark    Sells deliverability specifically and polices its pools hard
 *               enough to reject customers over it. Best odds of the three on
 *               reputation alone.
 *   resend      What we have. Known blocked from longhornloop.me.
 *   dev         Logs the code to the wrangler console. Local only.
 *
 * Prefer sending from longhorndevelopers.org over longhornloop.me whichever
 * provider wins. It is an older .org tied to a real student organization and
 * already sits in the Cloudflare account, where .me is a TLD with a bad
 * reputation that we registered the same morning.
 */

/** One message. Deliberately minimal — the shape every provider agrees on. */
export type EmailMessage = {
  to: string;
  from: string;
  subject: string;
  html: string;
  /** Plain-text alternative. Not optional in practice: a multipart message
   *  scores better than HTML-only at every filter, and we are fighting a
   *  filter. */
  text: string;
};

export type EmailProviderName = 'dev' | 'cloudflare' | 'postmark' | 'resend';

/**
 * The Cloudflare send_email binding, typed structurally rather than as
 * `SendEmail` from @cloudflare/workers-types.
 *
 * The binding only exists once wrangler.toml declares it AND the domain is
 * onboarded in the dashboard, so the field has to stay optional. Typing it
 * structurally also keeps this file compiling on workers-types versions that
 * predate Email Service, which matters while we are still deciding whether to
 * keep it.
 */
export type SendEmailBinding = {
  send(message: {
    to: string;
    from: string;
    subject: string;
    html?: string;
    text?: string;
  }): Promise<unknown>;
};

export type EmailEnv = {
  EMAIL_PROVIDER?: string;
  EMAIL_FROM?: string;
  EMAIL?: SendEmailBinding;
  RESEND_API_KEY?: string;
  POSTMARK_API_TOKEN?: string;
  RESEND_DEV_MODE?: string;
};

/**
 * Thrown when a provider refuses the message.
 *
 * Carries the provider name and the raw body because the useful part of a
 * delivery failure is always the vendor's own words — `550 #5.7.1 ...` told us
 * more than any status code could. The route logs this and answers 502; it is
 * never shown to a user.
 */
export class EmailSendError extends Error {
  constructor(
    readonly provider: EmailProviderName,
    readonly status: number | null,
    readonly detail: string,
  ) {
    super(`[${provider}] send failed (${status ?? 'no status'}): ${detail}`);
    this.name = 'EmailSendError';
  }
}

/**
 * Which provider to use.
 *
 * RESEND_DEV_MODE=true still wins outright. It predates this file and is set
 * in local .dev.vars; having it silently stop working because someone also set
 * EMAIL_PROVIDER would be a nasty surprise mid-debugging.
 *
 * Otherwise: explicit EMAIL_PROVIDER, else whichever credential is present,
 * else dev. The fallback order is deliberate — Cloudflare first because it
 * needs no secret, so an env holding only the binding does the obvious thing.
 */
export function resolveProvider(env: EmailEnv): EmailProviderName {
  if (env.RESEND_DEV_MODE === 'true') return 'dev';

  const explicit = env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (explicit === 'cloudflare' || explicit === 'postmark' || explicit === 'resend') {
    return explicit;
  }
  if (explicit === 'dev') return 'dev';

  if (env.EMAIL) return 'cloudflare';
  if (env.POSTMARK_API_TOKEN) return 'postmark';
  if (env.RESEND_API_KEY) return 'resend';
  return 'dev';
}

async function sendViaCloudflare(env: EmailEnv, msg: EmailMessage): Promise<void> {
  if (!env.EMAIL) {
    // Misconfiguration, not a delivery failure: the binding is declared in
    // wrangler.toml or it isn't. Worth being loud about, because the symptom
    // otherwise is silent fallthrough to a provider we were trying to leave.
    throw new EmailSendError(
      'cloudflare',
      null,
      'EMAIL binding missing — add [[send_email]] name = "EMAIL" to wrangler.toml and onboard the domain under Compute > Email Service.',
    );
  }

  try {
    await env.EMAIL.send({
      to: msg.to,
      from: msg.from,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
  } catch (err) {
    throw new EmailSendError('cloudflare', null, err instanceof Error ? err.message : String(err));
  }
}

async function sendViaPostmark(env: EmailEnv, msg: EmailMessage): Promise<void> {
  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      'X-Postmark-Server-Token': env.POSTMARK_API_TOKEN ?? '',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      From: msg.from,
      To: msg.to,
      Subject: msg.subject,
      HtmlBody: msg.html,
      TextBody: msg.text,
      // Postmark separates transactional from bulk at the stream level, and
      // scores them separately. Login codes are transactional; putting them on
      // the wrong stream is how you inherit a marketing reputation.
      MessageStream: 'outbound',
    }),
  });

  if (!res.ok) {
    throw new EmailSendError('postmark', res.status, await res.text());
  }
}

async function sendViaResend(env: EmailEnv, msg: EmailMessage): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY ?? ''}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: msg.from,
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    }),
  });

  if (!res.ok) {
    throw new EmailSendError('resend', res.status, await res.text());
  }
}

/**
 * Send one message, or throw.
 *
 * Note what this does NOT do: retry, or fall back to another provider. Both
 * are tempting and both are wrong here. A 550 from UT is a policy decision,
 * not a blip — retrying just adds rejections to our record, and quietly
 * succeeding through a backup provider would hide the exact signal we are
 * currently trying to read.
 */
export async function sendEmail(env: EmailEnv, msg: EmailMessage): Promise<EmailProviderName> {
  const provider = resolveProvider(env);

  switch (provider) {
    case 'dev':
      console.log(`\n[DEV] Email to ${msg.to} — ${msg.subject}\n${msg.text}\n`);
      break;
    case 'cloudflare':
      await sendViaCloudflare(env, msg);
      break;
    case 'postmark':
      await sendViaPostmark(env, msg);
      break;
    case 'resend':
      await sendViaResend(env, msg);
      break;
  }

  return provider;
}
