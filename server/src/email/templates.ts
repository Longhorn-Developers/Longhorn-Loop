/**
 * The org-facing emails (LOOP-245).
 *
 * Both of these were specified months ago and neither was ever sent. The org
 * verification code was written to the database and then dropped on the floor
 * unless RESEND_DEV_MODE was on — which it never is in production — so no
 * organization could complete a claim no matter what the scrapers found. The
 * editor invite created a membership row and returned `email_sent: false`,
 * leaving the invited person with no idea they had been invited.
 *
 * They live here rather than inline in orgs.worker.ts because a route handler
 * is a bad place to keep 30 lines of table-layout HTML, and because both need
 * the same visual treatment as the sign-in code — a person who has just
 * received one recognises the other.
 */

import type { EmailMessage } from './send';

/**
 * Shared shell. Inline styles only: every mail client strips <style> blocks,
 * and Outlook in particular ignores anything it cannot attribute to an element.
 */
function shell(heading: string, inner: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #BF5700; margin: 0 0 16px;">${heading}</h2>
      ${inner}
      <p style="color: #999; font-size: 12px; margin-top: 28px; border-top: 1px solid #eee; padding-top: 14px;">
        Longhorn Loop is built by Longhorn Developers, a student organization at UT Austin.
        Not affiliated with or endorsed by the University.
      </p>
    </div>
  `;
}

/** The big monospaced code block, matching the sign-in email. */
function codeBlock(code: string): string {
  return `
    <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 20px; background: #f5f5f5; border-radius: 8px; margin: 16px 0;">
      ${code}
    </div>
  `;
}

/**
 * Code proving the recipient is the contact on an org's HornsLink page.
 *
 * The org NAME is in the subject and the body on purpose. This address came
 * off a public directory page, so the recipient did not ask for this and may
 * not know what Longhorn Loop is. "Someone is claiming Chess Club" is a
 * message they can act on — either it was them, or they have just learned
 * somebody else tried. A bare code from an unknown sender is a phishing
 * report waiting to happen.
 */
export function orgVerificationEmail(
  to: string,
  orgName: string,
  code: string,
  from: string,
): EmailMessage {
  return {
    to,
    from,
    subject: `Your code to claim ${orgName} on Longhorn Loop`,
    html: shell(
      'Longhorn Loop',
      `<p>Someone is claiming <strong>${escapeHtml(orgName)}</strong> on Longhorn Loop using this
         email address, which is listed as the organization's contact on HornsLink.</p>
       <p>If that was you, here is your code:</p>
       ${codeBlock(code)}
       <p style="color: #666; font-size: 14px;">
         This code expires in 10 minutes. <strong>If it wasn't you, ignore this email</strong> — the
         claim cannot go through without it.
       </p>`,
    ),
    text:
      `Longhorn Loop\n\n` +
      `Someone is claiming ${orgName} on Longhorn Loop using this email address, which is listed ` +
      `as the organization's contact on HornsLink.\n\n` +
      `If that was you, your code is: ${code}\n\n` +
      `This code expires in 10 minutes. If it wasn't you, ignore this email — the claim cannot go ` +
      `through without it.\n`,
  };
}

/**
 * Invitation to help run an org's page.
 *
 * No link and no token, deliberately. The invite is keyed on (org_id, email)
 * in `org_invites`, and it is claimed when that person signs in with the
 * address it was sent to — an address we have already verified is UT. Adding
 * a click-through token would mean a second credential that grants org write
 * access and can be forwarded out of the inbox it was sent to.
 */
export function orgInviteEmail(
  to: string,
  orgName: string,
  inviterName: string,
  role: 'admin' | 'editor',
  from: string,
): EmailMessage {
  const roleWord = role === 'admin' ? 'an admin' : 'an editor';

  return {
    to,
    from,
    subject: `${inviterName} invited you to help run ${orgName} on Longhorn Loop`,
    html: shell(
      'Longhorn Loop',
      `<p><strong>${escapeHtml(inviterName)}</strong> invited you to join
         <strong>${escapeHtml(orgName)}</strong> as ${roleWord} on Longhorn Loop.</p>
       <p>Open the app and sign in with <strong>${escapeHtml(to)}</strong> — this invitation is
         attached to that address, so it will be waiting for you.</p>
       <p style="color: #666; font-size: 14px;">
         The invitation expires in 14 days. If you weren't expecting it, you can ignore this email.
       </p>`,
    ),
    text:
      `Longhorn Loop\n\n` +
      `${inviterName} invited you to join ${orgName} as ${roleWord} on Longhorn Loop.\n\n` +
      `Open the app and sign in with ${to} — this invitation is attached to that address, so it ` +
      `will be waiting for you.\n\n` +
      `The invitation expires in 14 days. If you weren't expecting it, you can ignore this email.\n`,
  };
}

/**
 * Org names come from a scraped directory, so they are attacker-adjacent
 * input: whoever edits a HornsLink page controls this string, and it lands in
 * an email we send. Inviter names come from user profiles, which is the same
 * problem with a shorter chain.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
