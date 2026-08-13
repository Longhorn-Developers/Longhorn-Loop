/**
 * Asserts that server/migrations/ and server/schema.sql describe the same
 * database (LOOP-239).
 *
 * The two files are both canonical, for different audiences: schema.sql is
 * what `wrangler d1 execute --file=schema.sql` puts on a local machine, and
 * the migrations are what actually builds every other database -- preview,
 * a new contributor's local, a rebuilt prod. Nothing kept them in step, so
 * they drifted, and the drift was invisible: a Worker route referencing a
 * table that exists in schema.sql and in no migration looks perfectly fine in
 * review, passes every test that seeds from schema.sql, and then 500s in an
 * environment built the other way. LOOP-239 was two of those -- the
 * `notifications` table and `saved_events.reminder_sent_at` -- plus two
 * migrations (0006, 0007) that could not apply to an empty database at all
 * because the tables they alter were never created by any migration.
 *
 * This test builds one database each way and compares them, so that class of
 * bug is a red build instead of a Worker log nobody reads. Delete a migration
 * file and this goes red.
 *
 * Scope: structure only -- table names, columns (name, declared type,
 * nullability, default) and index names. Not compared:
 *   - column ORDER, because ALTER TABLE appends and CREATE TABLE does not, so
 *     the same schema legitimately reports different orderings;
 *   - CHECK/UNIQUE/foreign-key clauses, which sqlite_master only exposes as
 *     raw SQL text that differs by whitespace and comments between the two
 *     files. Behavioural constraints are pinned by the suites that exercise
 *     them (see test_org_console_sql.ts).
 *
 * Skips below Node 22 (node:sqlite). CI runs Node 20 and does not run this
 * suite; this is a local guard.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

let DatabaseSync: (new (path: string) => any) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const SERVER_DIR = join(__dirname, '..');
const MIGRATIONS_DIR = join(SERVER_DIR, 'migrations');

/** Numeric-prefix order, which is the order wrangler applies them in. */
const migrationFiles = (): string[] =>
  readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

type ColumnInfo = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
};

/** name -> declared type, for the "columns and types" comparison. */
const columnTypes = (db: any, table: string): Record<string, string> =>
  Object.fromEntries(
    (db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[])
      .map((c) => [c.name, c.type] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  );

/** name -> "TYPE [NOT NULL] [DEFAULT x]", for the stricter comparison. */
const columnSignatures = (db: any, table: string): Record<string, string> =>
  Object.fromEntries(
    (db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[])
      .map(
        (c) =>
          [
            c.name,
            [c.type, c.notnull ? 'NOT NULL' : '', c.dflt_value ? `DEFAULT ${c.dflt_value}` : '']
              .filter(Boolean)
              .join(' '),
          ] as const,
      )
      .sort(([a], [b]) => a.localeCompare(b)),
  );

const tableNames = (db: any): string[] =>
  db
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name`,
    )
    .all()
    .map((r: any) => r.name);

const indexNames = (db: any): string[] =>
  db
    .prepare(
      // Indexes SQLite creates itself for UNIQUE/PRIMARY KEY are named
      // sqlite_autoindex_* and are a consequence of the constraints, not
      // something either file declares. Only explicit CREATE INDEX counts.
      `SELECT name FROM sqlite_master
        WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
        ORDER BY name`,
    )
    .all()
    .map((r: any) => r.name);

const describeOrSkip = DatabaseSync ? describe : describe.skip;

describeOrSkip('schema.sql / migrations parity (LOOP-239)', () => {
  let fromMigrations: any;
  let fromSchema: any;

  beforeAll(() => {
    fromMigrations = new DatabaseSync!(':memory:');
    for (const file of migrationFiles()) {
      fromMigrations.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf-8'));
    }

    fromSchema = new DatabaseSync!(':memory:');
    fromSchema.exec(readFileSync(join(SERVER_DIR, 'schema.sql'), 'utf-8'));
  });

  describe('the migration sequence applies to an empty database', () => {
    it('has at least one migration to apply', () => {
      // Guards the comparison below: two empty databases agree trivially.
      expect(migrationFiles().length).toBeGreaterThan(0);
    });

    it('applies every migration in order without error', () => {
      // 0006 and 0007 used to fail here ("no such table: saved_events" /
      // "no such table: users"). A migration that throws is never recorded as
      // applied, so the environment silently loses everything in that file --
      // which is how the org console ended up 500ing on events.view_count.
      const db = new DatabaseSync!(':memory:');
      for (const file of migrationFiles()) {
        expect(
          () => db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf-8')),
          file,
        ).not.toThrow();
      }
    });
  });

  describe('structure', () => {
    it('creates the same set of tables', () => {
      // A table in schema.sql and no migration is the LOOP-239 bug. A table in
      // the migrations and not schema.sql is the same drift pointed the other
      // way -- it breaks every test that seeds from schema.sql.
      expect(tableNames(fromMigrations)).toEqual(tableNames(fromSchema));
    });

    it('creates the same columns, with the same types, on every table', () => {
      for (const table of tableNames(fromSchema)) {
        expect(columnTypes(fromMigrations, table), table).toEqual(columnTypes(fromSchema, table));
      }
    });

    it('agrees on nullability and defaults for every column', () => {
      // A column that is NOT NULL in one file and nullable in the other lets
      // an INSERT that passes locally fail in the environment built the other
      // way -- the same silent split, one level down.
      for (const table of tableNames(fromSchema)) {
        expect(columnSignatures(fromMigrations, table), table).toEqual(
          columnSignatures(fromSchema, table),
        );
      }
    });

    it('creates the same set of indexes', () => {
      expect(indexNames(fromMigrations)).toEqual(indexNames(fromSchema));
    });
  });

  // What the ticket actually promised: a database built purely from migrations
  // can serve the two features that were broken. The parity check above would
  // pass if both files were wrong in the same way, so these run the real
  // statements rather than trusting the comparison.
  describe('the migrated database serves the routes that were 500ing', () => {
    const USER = 1;
    const EVENT = 10;

    beforeAll(() => {
      const db = fromMigrations;
      db.exec(
        `INSERT INTO users (id, email, first_name, last_name)
         VALUES (${USER}, 'saver@utexas.edu', 'Sam', 'Saver')`,
      );
      db.exec(
        `INSERT INTO organizations (id, name, profile_picture)
         VALUES (5, 'Longhorn Devs', 'https://example.test/org.png')`,
      );
      db.exec(
        `INSERT INTO events
           (id, source, source_event_id, title, start_datetime, end_datetime,
            host_organization_id, image_url, status)
         VALUES (${EVENT}, 'test', 'e10', 'Hack Night',
                 datetime('now', '+2 hours'), datetime('now', '+4 hours'),
                 5, 'https://example.test/event.png', 'active')`,
      );
      db.exec(`INSERT INTO saved_events (user_id, event_id) VALUES (${USER}, ${EVENT})`);
    });

    it('runs the reminder cron query in sendEventReminders()', () => {
      // Duplicated from src/worker.ts for the same reason test_org_console_sql
      // duplicates the route SQL: the real one runs against a D1Database
      // binding that only exists in the Worker runtime.
      const due = fromMigrations
        .prepare(
          `SELECT
             s.id as saved_id,
             s.user_id,
             e.id as event_id,
             e.title,
             e.start_datetime,
             e.image_url,
             o.profile_picture as org_profile_picture
           FROM saved_events s
           JOIN events e ON e.id = s.event_id
           LEFT JOIN organizations o ON e.host_organization_id = o.id
           WHERE s.reminder_sent_at IS NULL
             AND e.start_datetime > ?
             AND e.start_datetime <= ?
             AND e.status = 'active'`,
        )
        .all(new Date(0).toISOString(), '9999-12-31T00:00:00.000Z');

      expect(due).toHaveLength(1);
      expect(due[0].event_id).toBe(EVENT);
      expect(due[0].org_profile_picture).toBe('https://example.test/org.png');
    });

    it('inserts the reminder notification and marks the save as reminded', () => {
      const row = fromMigrations
        .prepare('SELECT id FROM saved_events WHERE user_id = ? AND event_id = ?')
        .get(USER, EVENT);

      fromMigrations
        .prepare(
          `INSERT INTO notifications
             (user_id, type, title, subtitle, avatar_url, thumbnail_url, event_id)
           VALUES (?, 'event_reminder', ?, ?, ?, ?, ?)`,
        )
        .run(
          USER,
          'Hack Night',
          'is happening in 2 hours!',
          'https://example.test/org.png',
          'https://example.test/event.png',
          EVENT,
        );

      const sentAt = new Date().toISOString();
      fromMigrations
        .prepare('UPDATE saved_events SET reminder_sent_at = ? WHERE id = ?')
        .run(sentAt, row.id);

      // Second tick: the same save must no longer be due, or every cron run
      // re-notifies everyone.
      const stillDue = fromMigrations
        .prepare('SELECT COUNT(*) AS c FROM saved_events WHERE reminder_sent_at IS NULL')
        .get().c;
      expect(stillDue).toBe(0);
    });

    it('runs the three /notifications route statements', () => {
      const list = fromMigrations
        .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC')
        .all(USER);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ type: 'event_reminder', title: 'Hack Night' });
      // Columns the activity center reads off the row, which only exist if the
      // migration copied the schema.sql definition field for field.
      expect(list[0].read_at).toBeNull();
      expect(list[0].subtitle).toBe('is happening in 2 hours!');

      // DELETE /notifications/:id -- scoped to the owner, so another user's id
      // deletes nothing.
      const del = fromMigrations.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?');
      del.run(list[0].id, 999);
      expect(fromMigrations.prepare('SELECT COUNT(*) AS c FROM notifications').get().c).toBe(1);
      del.run(list[0].id, USER);

      // DELETE /notifications -- clear all for the user.
      fromMigrations.prepare('DELETE FROM notifications WHERE user_id = ?').run(USER);
      expect(fromMigrations.prepare('SELECT COUNT(*) AS c FROM notifications').get().c).toBe(0);
    });
  });
});
