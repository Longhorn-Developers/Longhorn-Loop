// Is the deployed database behind the code? (LOOP-308)
//
// WHY THIS EXISTS. Migrations 0020 and 0021 were merged, the Worker that reads
// their tables was deployed, and neither migration was ever applied to prod.
// GET /events/:id/announcements returned 500 for every event for weeks, and
// the org meeting cards had no table behind them. Nothing in the repo could
// see it: schema.sql has both tables, so every local database and every test
// had them too, and test_schema_migration_parity.ts only compares those two
// files with each other. The only place the gap existed was prod, and nothing
// looked there.
//
// HOW IT CHECKS. `wrangler d1 migrations apply` records each file it runs in
// the `d1_migrations` table, and prod has been migrated that way since 0000.
// The Worker compares that table against EXPECTED_MIGRATIONS below, the list
// of files this build was written against. Anything in the list and not in
// the table is pending: the code may read a table or column that is not there.
//
// WHY A HAND-WRITTEN LIST. A Worker bundle can't read server/migrations/ at
// runtime, and wrangler's bundler has no glob import. The list is kept honest
// by scripts/check-migration-list.mjs, which CI runs: add a migration file
// without adding it here and the build goes red. Without that check, a new
// migration missing from this list would read as "up to date" -- the exact
// silence this file is meant to end.
//
// Where it surfaces: GET /health/schema (503 while behind) and a
// console.error on every cron tick while behind. See worker.ts.

/** Every file in server/migrations/, in the order wrangler applies them. */
export const EXPECTED_MIGRATIONS: readonly string[] = [
  '0000_add_core_user_tables.sql',
  '0001_add_events.sql',
  '0002_add_event_lifecycle_columns.sql',
  '0003_add_event_reports.sql',
  '0004_add_event_rsvps.sql',
  '0005_add_event_tags.sql',
  '0006_add_event_views_and_signal_counters.sql',
  '0007_add_user_socials_and_bio.sql',
  '0008_add_org_membership_and_follows.sql',
  '0009_add_user_settings_and_feedback.sql',
  '0010_add_org_verification_columns.sql',
  '0011_add_user_follows.sql',
  '0012_add_event_tag_source_score.sql',
  '0013_add_org_category.sql',
  '0014_add_notifications.sql',
  '0015_add_saved_events_reminder_sent_at.sql',
  '0016_add_user_blocks_and_org_bio.sql',
  '0017_add_followed_org_notification_settings.sql',
  '0018_add_avatar_config_and_photo.sql',
  '0019_add_event_venue_type.sql',
  '0020_add_event_announcements.sql',
  '0021_add_org_meetings.sql',
];

export type MigrationStatus =
  // Every expected migration is recorded as applied.
  | { status: 'ok'; applied: number; expected: number; unknownApplied: string[] }
  // At least one expected migration has not been applied.
  | {
      status: 'behind';
      applied: number;
      expected: number;
      pending: string[];
      unknownApplied: string[];
    }
  // There is no d1_migrations table to read. That is normal for a local
  // database built with `wrangler d1 execute --file=schema.sql`, which never
  // records anything, so it is reported rather than treated as an outage.
  | { status: 'unknown'; reason: string };

/**
 * Compares applied migration names against the expected list.
 *
 * `unknownApplied` is the other direction: migrations the database has that
 * this build doesn't know about. That happens when an older Worker is deployed
 * over a newer schema, or a migration was renamed. Reported, never a failure:
 * an extra table doesn't break code that doesn't read it.
 */
export function compareMigrations(
  applied: readonly string[],
  expected: readonly string[] = EXPECTED_MIGRATIONS,
): MigrationStatus {
  const appliedSet = new Set(applied);
  const expectedSet = new Set(expected);
  const pending = expected.filter((name) => !appliedSet.has(name));
  const unknownApplied = applied.filter((name) => !expectedSet.has(name));
  const counts = { applied: applied.length, expected: expected.length, unknownApplied };
  return pending.length > 0
    ? { status: 'behind', pending, ...counts }
    : { status: 'ok', ...counts };
}

/** Reads d1_migrations and compares it against EXPECTED_MIGRATIONS. */
export async function getMigrationStatus(db: D1Database): Promise<MigrationStatus> {
  let rows: { name: string }[];
  try {
    const result = await db.prepare('SELECT name FROM d1_migrations').all<{ name: string }>();
    rows = result.results ?? [];
  } catch (err) {
    // "no such table: d1_migrations" -- see the 'unknown' case above. Any
    // other error lands here too and is surfaced in `reason`, not thrown, so
    // a health check never 500s about itself.
    return { status: 'unknown', reason: String(err) };
  }
  return compareMigrations(rows.map((r) => r.name));
}
