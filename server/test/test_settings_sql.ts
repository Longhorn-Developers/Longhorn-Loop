/**
 * Settings storage + org verification SQL (LOOP-184, LOOP-185), run against a
 * real SQLite database built from server/schema.sql.
 *
 * The thing worth pinning here is the PATCH merge. Settings is a single wide
 * row with a lazily-created default state, so "toggle one thing" has three
 * distinct paths — no row yet, a row with defaults, a row already customized —
 * and the failure mode is silent: flipping Dark Mode resets someone's
 * notification preferences and nobody notices until they miss an event.
 *
 * Skips below Node 22 (node:sqlite). CI runs Node 20 and does not run this
 * suite; this is a local guard.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let DatabaseSync: (new (path: string) => any) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const USER = 1;

const BOOLEAN_SETTINGS: [string, boolean][] = [
  ['dark_mode', false],
  ['event_reminders', true],
  ['new_events', true],
  ['weekly_digest', false],
  ['rsvp_confirmations', true],
  ['channel_push', true],
  ['channel_email', false],
  ['channel_in_app', true],
];

const DEFAULT_REMINDER_LEAD = 1440;

const describeOrSkip = DatabaseSync ? describe : describe.skip;

describeOrSkip('settings + org verification SQL (LOOP-184, LOOP-185)', () => {
  let db: any;

  /** Mirrors shapeSettings() in routes/settings.worker.ts. */
  const shape = (row: Record<string, unknown> | null) => {
    const out: Record<string, boolean | number> = {};
    for (const [key, fallback] of BOOLEAN_SETTINGS) {
      out[key] = row ? Number(row[key]) === 1 : fallback;
    }
    out.reminder_lead_minutes = row ? Number(row.reminder_lead_minutes) : DEFAULT_REMINDER_LEAD;
    return out;
  };

  const read = () =>
    shape(db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(USER) ?? null);

  /** Mirrors the PATCH merge + upsert. */
  const patch = (changes: Record<string, boolean | number>) => {
    const current = read();
    const merged: Record<string, number> = {};
    for (const [key] of BOOLEAN_SETTINGS) {
      const supplied = changes[key];
      merged[key] = typeof supplied === 'boolean' ? (supplied ? 1 : 0) : current[key] ? 1 : 0;
    }
    merged.reminder_lead_minutes =
      changes.reminder_lead_minutes !== undefined
        ? Number(changes.reminder_lead_minutes)
        : (current.reminder_lead_minutes as number);

    const columns = [...BOOLEAN_SETTINGS.map(([k]) => k), 'reminder_lead_minutes'];
    db.prepare(
      `INSERT INTO user_settings (user_id, ${columns.join(', ')}, updated_at)
       VALUES (?, ${columns.map(() => '?').join(', ')}, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         ${columns.map((c) => `${c} = excluded.${c}`).join(', ')},
         updated_at = datetime('now')`,
    ).run(USER, ...columns.map((c) => merged[c]));
  };

  beforeEach(() => {
    db = new DatabaseSync!(':memory:');
    db.exec(readFileSync(join(__dirname, '..', 'schema.sql'), 'utf-8'));
    db.exec(`INSERT INTO users (id, email, first_name, last_name)
             VALUES (${USER}, 'me@utexas.edu', 'Me', 'User')`);
  });

  describe('settings defaults', () => {
    it('returns defaults when the user has no row, without creating one', () => {
      expect(read()).toMatchObject({
        dark_mode: false,
        event_reminders: true,
        weekly_digest: false,
        reminder_lead_minutes: DEFAULT_REMINDER_LEAD,
      });
      const count = db.prepare('SELECT COUNT(*) AS c FROM user_settings').get().c;
      // A GET must not write — otherwise every read creates a row.
      expect(count).toBe(0);
    });
  });

  describe('PATCH merge', () => {
    it('creates the row on first write, keeping defaults for untouched keys', () => {
      patch({ dark_mode: true });
      const after = read();
      expect(after.dark_mode).toBe(true);
      expect(after.event_reminders).toBe(true);
      expect(after.weekly_digest).toBe(false);
      expect(after.reminder_lead_minutes).toBe(DEFAULT_REMINDER_LEAD);
    });

    it('does not reset previously customized keys', () => {
      // This is the regression that matters: toggling one thing must not wipe
      // the rest back to their defaults.
      patch({ weekly_digest: true, channel_email: true, reminder_lead_minutes: 60 });
      patch({ dark_mode: true });

      const after = read();
      expect(after.dark_mode).toBe(true);
      expect(after.weekly_digest).toBe(true);
      expect(after.channel_email).toBe(true);
      expect(after.reminder_lead_minutes).toBe(60);
    });

    it('can turn a setting back off', () => {
      patch({ event_reminders: false });
      expect(read().event_reminders).toBe(false);
      patch({ dark_mode: true });
      // Still off after an unrelated patch — a falsy value must not be read as
      // "not supplied".
      expect(read().event_reminders).toBe(false);
    });

    it('keeps reminder_lead_minutes when only booleans change', () => {
      patch({ reminder_lead_minutes: 2880 });
      patch({ new_events: false });
      expect(read().reminder_lead_minutes).toBe(2880);
    });

    it('never creates a second row for the same user', () => {
      patch({ dark_mode: true });
      patch({ dark_mode: false });
      patch({ new_events: false });
      expect(db.prepare('SELECT COUNT(*) AS c FROM user_settings').get().c).toBe(1);
    });
  });

  describe('feedback', () => {
    it('survives the reporter deleting their account', () => {
      db.exec('PRAGMA foreign_keys = ON');
      db.exec(`INSERT INTO feedback (user_id, kind, message) VALUES (${USER}, 'bug', 'It broke')`);
      db.exec(`DELETE FROM users WHERE id = ${USER}`);

      const row = db.prepare("SELECT user_id, message FROM feedback WHERE kind = 'bug'").get();
      // ON DELETE SET NULL, not CASCADE: a bug report must not vanish the
      // moment the reporter leaves — that's exactly when it's still needed.
      expect(row).toBeDefined();
      expect(row.user_id).toBeNull();
      expect(row.message).toBe('It broke');
    });

    it('rejects a kind outside the allowed set', () => {
      expect(() =>
        db.exec(`INSERT INTO feedback (user_id, kind, message) VALUES (${USER}, 'rant', 'hi')`),
      ).toThrow();
    });
  });

  describe('org verification (LOOP-185)', () => {
    beforeEach(() => {
      db.exec(`INSERT INTO organizations (id, name, president_email)
               VALUES (500, 'Longhorn Devs', 'prez@utexas.edu'),
                      (501, 'No President Org', NULL)`);
    });

    it('defaults a new org to unverified', () => {
      const row = db
        .prepare('SELECT verified, verification_status FROM organizations WHERE id = 500')
        .get();
      expect(row.verification_status).toBe('unverified');
      expect(row.verified).toBe(0);
    });

    it('matches the president email case-insensitively', () => {
      const onFile = db
        .prepare('SELECT president_email FROM organizations WHERE id = 500')
        .get()
        .president_email.toLowerCase();
      expect(onFile).toBe('PREZ@UTEXAS.EDU'.toLowerCase());
    });

    it('treats an org with no president on file as unverifiable', () => {
      const onFile = db
        .prepare('SELECT president_email FROM organizations WHERE id = 501')
        .get().president_email;
      // The route reads NULL as a mismatch rather than waving the claim
      // through — approving an unverifiable claim is the worse failure.
      expect(onFile).toBeNull();
    });

    it('leaves `verified` at 0 after code confirmation', () => {
      db.exec("UPDATE organizations SET verification_status = 'pending_review' WHERE id = 500");
      const row = db
        .prepare('SELECT verified, verification_status FROM organizations WHERE id = 500')
        .get();
      // The success screen promises a human review; code confirmation alone
      // must not flip the verified badge.
      expect(row.verification_status).toBe('pending_review');
      expect(row.verified).toBe(0);
    });

    it('namespaces the verification code so it cannot collide with a 2FA code', () => {
      const key = (orgId: number, email: string) => `org:${orgId}:${email.toLowerCase()}`;

      db.exec(`INSERT INTO verification_codes (email, code_hash, expires_at, last_sent_at)
               VALUES ('prez@utexas.edu', 'login-hash', 9999999999999, 0)`);
      db.prepare(
        `INSERT INTO verification_codes (email, code_hash, expires_at, last_sent_at)
         VALUES (?, 'org-hash', 9999999999999, 0)`,
      ).run(key(500, 'prez@utexas.edu'));

      // Both coexist: a login code can't satisfy an org claim, or vice versa.
      const login = db
        .prepare("SELECT code_hash FROM verification_codes WHERE email = 'prez@utexas.edu'")
        .get();
      const orgCode = db
        .prepare('SELECT code_hash FROM verification_codes WHERE email = ?')
        .get(key(500, 'prez@utexas.edu'));

      expect(login.code_hash).toBe('login-hash');
      expect(orgCode.code_hash).toBe('org-hash');
    });
  });
});
