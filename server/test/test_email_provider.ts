/**
 * Provider selection and dispatch for outbound email (LOOP-255).
 *
 * UT's Proofpoint gateway rejects our current sender outright, so which
 * provider sends a verification code is now an experiment we run by flipping
 * EMAIL_PROVIDER. That makes this switch load-bearing: pick the wrong branch
 * and the test result we are trying to read is meaningless, because we do not
 * know which infrastructure produced the bounce.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EmailSendError,
  type EmailEnv,
  type EmailMessage,
  resolveProvider,
  sendEmail,
} from '../src/email/send';

const MESSAGE: EmailMessage = {
  to: 'mew4343@my.utexas.edu',
  from: 'Longhorn Loop <noreply@longhorndevelopers.org>',
  subject: 'Your Longhorn Loop Verification Code',
  html: '<p>123456</p>',
  text: '123456',
};

const realFetch = globalThis.fetch;

function stubFetch(status = 200, body = '{}') {
  const fn = vi.fn(async () => new Response(body, { status }));
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('resolveProvider', () => {
  it('honours an explicit EMAIL_PROVIDER', () => {
    expect(resolveProvider({ EMAIL_PROVIDER: 'cloudflare' })).toBe('cloudflare');
    expect(resolveProvider({ EMAIL_PROVIDER: 'postmark' })).toBe('postmark');
    expect(resolveProvider({ EMAIL_PROVIDER: 'resend' })).toBe('resend');
  });

  it('is case- and whitespace-insensitive, because it comes from a TOML file', () => {
    expect(resolveProvider({ EMAIL_PROVIDER: '  Postmark ' })).toBe('postmark');
  });

  it('lets RESEND_DEV_MODE win over everything', () => {
    // This is set in local .dev.vars and predates provider switching. Having
    // it silently stop working because someone also set EMAIL_PROVIDER would
    // be a genuinely confusing afternoon.
    expect(
      resolveProvider({
        RESEND_DEV_MODE: 'true',
        EMAIL_PROVIDER: 'postmark',
        POSTMARK_API_TOKEN: 'tok',
      }),
    ).toBe('dev');
  });

  it('ignores an unknown provider name rather than sending through it', () => {
    // A typo in wrangler.toml must not fall through to whatever was configured
    // before. It picks up the credential-based default instead.
    expect(resolveProvider({ EMAIL_PROVIDER: 'sendgrd', RESEND_API_KEY: 'k' })).toBe('resend');
  });

  it('infers from whichever credential is present', () => {
    expect(resolveProvider({ EMAIL: { send: async () => ({}) } })).toBe('cloudflare');
    expect(resolveProvider({ POSTMARK_API_TOKEN: 'tok' })).toBe('postmark');
    expect(resolveProvider({ RESEND_API_KEY: 'key' })).toBe('resend');
  });

  it('falls back to dev when nothing is configured', () => {
    // Better to log the code than to throw on a Worker with no mail set up.
    expect(resolveProvider({})).toBe('dev');
  });
});

describe('sendEmail dispatch', () => {
  it('uses the Cloudflare binding, not fetch', async () => {
    const send = vi.fn(async () => ({ messageId: 'abc' }));
    const fetchSpy = stubFetch();

    const provider = await sendEmail({ EMAIL_PROVIDER: 'cloudflare', EMAIL: { send } }, MESSAGE);

    expect(provider).toBe('cloudflare');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: MESSAGE.to, from: MESSAGE.from, text: MESSAGE.text }),
    );
  });

  it('explains itself when the binding is missing', async () => {
    // The failure mode without this is a Worker that looks configured for
    // Cloudflare and silently is not.
    const env: EmailEnv = { EMAIL_PROVIDER: 'cloudflare' };
    await expect(sendEmail(env, MESSAGE)).rejects.toThrow(/send_email/);
  });

  it('posts to Postmark on the transactional stream', async () => {
    const fetchSpy = stubFetch();
    await sendEmail({ EMAIL_PROVIDER: 'postmark', POSTMARK_API_TOKEN: 'tok' }, MESSAGE);

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.postmarkapp.com/email');
    expect((init.headers as Record<string, string>)['X-Postmark-Server-Token']).toBe('tok');

    const body = JSON.parse(init.body as string);
    // Postmark scores transactional and broadcast streams separately. Login
    // codes on the broadcast stream would inherit a marketing reputation.
    expect(body.MessageStream).toBe('outbound');
    expect(body.TextBody).toBe(MESSAGE.text);
  });

  it('sends both parts through Resend', async () => {
    const fetchSpy = stubFetch();
    await sendEmail({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'key' }, MESSAGE);

    const body = JSON.parse((fetchSpy.mock.calls[0] as any)[1].body);
    expect(body.to).toEqual([MESSAGE.to]);
    // HTML-only mail scores worse at every filter, and we are losing to one.
    expect(body.text).toBe(MESSAGE.text);
    expect(body.html).toBe(MESSAGE.html);
  });

  it('keeps the provider and the raw rejection on the error', async () => {
    // `550 #5.7.1 ...` told us more than any status code did. Losing the
    // vendor's own words is losing the diagnosis.
    stubFetch(422, 'Domain not verified for this account');

    const err = await sendEmail(
      { EMAIL_PROVIDER: 'postmark', POSTMARK_API_TOKEN: 'tok' },
      MESSAGE,
    ).catch((e) => e);

    expect(err).toBeInstanceOf(EmailSendError);
    expect(err.provider).toBe('postmark');
    expect(err.status).toBe(422);
    expect(err.detail).toContain('Domain not verified');
  });

  it('does NOT fall back to another provider when one fails', async () => {
    // Tempting and wrong. A quiet success through a backup would destroy the
    // signal these experiments exist to produce.
    const fetchSpy = stubFetch(403, 'blocked');
    const send = vi.fn(async () => ({}));

    await expect(
      sendEmail(
        {
          EMAIL_PROVIDER: 'resend',
          RESEND_API_KEY: 'key',
          POSTMARK_API_TOKEN: 'tok',
          EMAIL: { send },
        },
        MESSAGE,
      ),
    ).rejects.toBeInstanceOf(EmailSendError);

    expect(fetchSpy).toHaveBeenCalledTimes(1); // no retry either
    expect(send).not.toHaveBeenCalled();
  });

  it('logs instead of sending in dev mode', async () => {
    const fetchSpy = stubFetch();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(await sendEmail({ RESEND_DEV_MODE: 'true' }, MESSAGE)).toBe('dev');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(log.mock.calls[0][0]).toContain(MESSAGE.text);
  });
});
