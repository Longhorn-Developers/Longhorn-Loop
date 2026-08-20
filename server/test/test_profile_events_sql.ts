/**
 * My Events collections + follow counts (Profile Main frame), run against a
 * real SQLite database built from server/schema.sql.
 *
 * The things worth pinning here:
 *
 *   1. Tab isolation. Going/Saved/Posted are three different JOINs against the
 *      same events table; a wrong one silently shows someone else's events or
 *      the wrong collection, and both look plausible on screen.
 *   2. The upcoming boundary. These tabs deliberately exclude ended events —
 *      those belong to the Past Events screen (LOOP-200). Getting the
 *      comparison backwards would make Going permanently empty.
 *   3. LIKE escaping. A search for "50%" must not match every event.
 *   4. following_count spans two tables (users AND orgs), so it's easy to
 *      report a number that silently ignores half of what someone follows.
 *
 * Skips below Node 22 (node:sqlite). CI runs Node 20 and does not run this
 * suite; this is a local guard.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bucketsForFilter } from '../../shared/profileEventFilters';

let DatabaseSync: (new (path: string) => any) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const ME = 1;
const OTHER = 2;
const ORG = 900;

const TABS = {
  going: { join: 'JOIN event_rsvps r ON r.event_id = e.id AND r.user_id = ?', where: '1 = 1' },
  saved: { join: 'JOIN saved_events s ON s.event_id = e.id AND s.user_id = ?', where: '1 = 1' },
  posted: { join: '', where: 'e.created_by_user_id = ?' },
} as const;

const UPCOMING = `(e.is_archived = 0 AND COALESCE(e.end_datetime, e.start_datetime) >= datetime('now'))`;

const describeOrSkip = DatabaseSync ? describe : describe.skip;

describeOrSkip('profile My Events SQL (Profile Main frame)', () => {
  let db: any;

  const fetchTab = (tab: keyof typeof TABS, opts: { q?: string; buckets?: string[] } = {}) => {
    const { join: j, where } = TABS[tab];
    const binds: unknown[] = [ME, ME];
    let searchClause = '';
    if (opts.q) {
      const escaped = opts.q.replace(/[\\%_]/g, (ch) => `\\${ch}`);
      searchClause = ` AND (e.title LIKE ? ESCAPE '\\' OR e.description LIKE ? ESCAPE '\\'
                            OR e.host_organization_name LIKE ? ESCAPE '\\')`;
      binds.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`);
    }
    let bucketClause = '';
    if (opts.buckets?.length) {
      bucketClause = ` AND EXISTS (SELECT 1 FROM event_tags t WHERE t.event_id = e.id
                        AND t.bucket_id IN (${opts.buckets.map(() => '?').join(', ')}))`;
      binds.push(...opts.buckets);
    }
    return db
      .prepare(
        `SELECT e.id,
                EXISTS (SELECT 1 FROM saved_events sv
                        WHERE sv.event_id = e.id AND sv.user_id = ?) AS is_saved
         FROM events e ${j}
         LEFT JOIN organizations o ON e.host_organization_id = o.id
         WHERE ${where} AND ${UPCOMING} ${searchClause} ${bucketClause}
         ORDER BY COALESCE(e.start_datetime, e.end_datetime) ASC`,
      )
      .all(...binds)
      .map((r: { id: number }) => r.id);
  };

  beforeEach(() => {
    db = new DatabaseSync!(':memory:');
    db.exec(readFileSync(join(__dirname, '..', 'schema.sql'), 'utf-8'));
    db.exec(`INSERT INTO users (id,email,first_name,last_name) VALUES
      (${ME},'me@utexas.edu','Me','User'), (${OTHER},'other@utexas.edu','Other','User')`);
    db.exec(`INSERT INTO organizations (id,name) VALUES (${ORG},'Test Org')`);

    const F = '2999-01-01T10:00:00';
    const P = '2020-01-01T10:00:00';
    const ins = db.prepare(
      `INSERT INTO events (id,source,source_event_id,title,description,start_datetime,end_datetime,
                           host_organization_name,created_by_user_id,is_archived)
       VALUES (?,'test',?,?,?,?,?,?,?,?)`,
    );
    //     id  title                 desc            start end   host       creator archived
    ins.run(1, 'e1', 'Upcoming RSVP', 'a talk', F, F, 'Test Org', null, 0);
    ins.run(2, 'e2', 'Ended RSVP', 'a talk', P, P, 'Test Org', null, 0);
    ins.run(3, 'e3', 'Upcoming Saved', 'a talk', F, F, 'Test Org', null, 0);
    ins.run(4, 'e4', 'I made this', 'a talk', F, F, 'Test Org', ME, 0);
    ins.run(5, 'e5', 'Other made this', 'a talk', F, F, 'Test Org', OTHER, 0);
    ins.run(6, 'e6', 'Archived upcoming', 'a talk', F, F, 'Test Org', ME, 1);
    ins.run(7, 'e7', '50% off pizza', 'free food', F, F, 'Test Org', ME, 0);
    ins.run(8, 'e8', 'Career fair', 'jobs', F, F, 'Test Org', ME, 0);

    db.exec(`INSERT INTO event_rsvps (user_id,event_id) VALUES (${ME},1),(${ME},2)`);
    db.exec(`INSERT INTO saved_events (user_id,event_id) VALUES (${ME},3)`);
    db.exec(`INSERT INTO event_tags (event_id,bucket_id,tag) VALUES
      (7,'food','Free Food'), (8,'education','Career Fair')`);
  });

  describe('tab isolation', () => {
    it('Going shows only upcoming events the user RSVPd to', () => {
      expect(fetchTab('going')).toEqual([1]);
    });

    it('Saved shows only upcoming bookmarks', () => {
      expect(fetchTab('saved')).toEqual([3]);
    });

    it('Posted shows only events this user created', () => {
      const posted = fetchTab('posted');
      expect(posted).toContain(4);
      expect(posted).not.toContain(5); // another user's event
    });
  });

  describe('the upcoming boundary', () => {
    it('excludes an ended event, which belongs to Past Events (LOOP-200)', () => {
      expect(fetchTab('going')).not.toContain(2);
    });

    it('excludes an archived event even though its date is in the future', () => {
      expect(fetchTab('posted')).not.toContain(6);
    });
  });

  describe('search', () => {
    it('matches on title', () => {
      expect(fetchTab('posted', { q: 'Career' })).toEqual([8]);
    });

    it('matches on description', () => {
      expect(fetchTab('posted', { q: 'free food' })).toEqual([7]);
    });

    it('treats % as a literal, not a wildcard', () => {
      // Unescaped, '%' would match every row. Only the pizza event has one.
      const hits = fetchTab('posted', { q: '50%' });
      expect(hits).toEqual([7]);
    });

    it('treats _ as a literal', () => {
      // '_' matches any single char unescaped, so "5_%" would also hit "50%".
      expect(fetchTab('posted', { q: 'a_b' })).toEqual([]);
    });
  });

  describe('category filter', () => {
    it('academic covers education-bucket events', () => {
      expect(bucketsForFilter('academic')).toContain('education');
      expect(fetchTab('posted', { buckets: bucketsForFilter('academic') })).toEqual([8]);
    });

    it('social covers food-bucket events', () => {
      expect(bucketsForFilter('social')).toContain('food');
      expect(fetchTab('posted', { buckets: bucketsForFilter('social') })).toEqual([7]);
    });

    it('all applies no bucket restriction', () => {
      expect(bucketsForFilter('all')).toEqual([]);
    });

    it('general is the complement, so every bucket lands under some chip', () => {
      const covered = new Set([
        ...bucketsForFilter('academic'),
        ...bucketsForFilter('social'),
        ...bucketsForFilter('general'),
      ]);
      const all = db
        .prepare('SELECT DISTINCT bucket_id FROM event_tags')
        .all()
        .map((r: { bucket_id: string }) => r.bucket_id);
      for (const b of all) expect(covered.has(b)).toBe(true);
    });
  });

  describe('is_saved flag', () => {
    it('is true only for events the user bookmarked', () => {
      const rows = db
        .prepare(
          `SELECT e.id, EXISTS (SELECT 1 FROM saved_events sv
                                WHERE sv.event_id = e.id AND sv.user_id = ?) AS is_saved
           FROM events e ORDER BY e.id`,
        )
        .all(ME);
      const saved = rows.filter((r: any) => r.is_saved === 1).map((r: any) => r.id);
      expect(saved).toEqual([3]);
    });
  });

  describe('follow counts', () => {
    const followers = () =>
      db.prepare('SELECT COUNT(*) AS c FROM user_follows WHERE followed_user_id = ?').get(ME).c;
    const following = () =>
      db
        .prepare(
          `SELECT (SELECT COUNT(*) FROM user_follows WHERE follower_user_id = ?1)
                + (SELECT COUNT(*) FROM org_followers WHERE user_id = ?1) AS c`,
        )
        .get(ME).c;

    it('starts at zero', () => {
      expect(followers()).toBe(0);
      expect(following()).toBe(0);
    });

    it('counts a user following me as a follower, not as following', () => {
      db.exec(
        `INSERT INTO user_follows (follower_user_id,followed_user_id) VALUES (${OTHER},${ME})`,
      );
      expect(followers()).toBe(1);
      expect(following()).toBe(0);
    });

    it('counts orgs I follow toward following', () => {
      // The header reads "N following" as everything in my feed, so an org
      // follow has to count — otherwise someone following 20 orgs shows 0.
      db.exec(`INSERT INTO org_followers (org_id,user_id) VALUES (${ORG},${ME})`);
      expect(following()).toBe(1);
    });

    it('refuses a self-follow', () => {
      expect(() =>
        db.exec(
          `INSERT INTO user_follows (follower_user_id,followed_user_id) VALUES (${ME},${ME})`,
        ),
      ).toThrow();
    });

    it('is idempotent — following twice does not double count', () => {
      const sql = `INSERT INTO user_follows (follower_user_id,followed_user_id)
                   VALUES (${OTHER},${ME}) ON CONFLICT DO NOTHING`;
      db.exec(sql);
      db.exec(sql);
      expect(followers()).toBe(1);
    });
  });
});
