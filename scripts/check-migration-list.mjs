// Fails when server/migrations/ and EXPECTED_MIGRATIONS disagree (LOOP-308).
//
// The Worker can only tell prod is behind if its list of expected migrations
// includes every migration file. A file added without a matching list entry
// would make /health/schema report "ok" while prod is missing it -- the same
// silent gap that left 0020 and 0021 unapplied for weeks. CI runs this in the
// Build job because it does not run the server's vitest suite.
//
// Plain Node with no dependencies, so it runs before or without `npm ci` in
// server/. Reads the TS file as text rather than importing it.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(root, 'server', 'migrations');
const listFile = join(root, 'server', 'src', 'lib', 'migrationStatus.ts');

const onDisk = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const source = readFileSync(listFile, 'utf8');
const block = source.match(/EXPECTED_MIGRATIONS[^=]*=\s*\[([\s\S]*?)\]/);
if (!block) {
  console.error(`check-migration-list: EXPECTED_MIGRATIONS not found in ${listFile}`);
  process.exit(1);
}
const listed = [...block[1].matchAll(/'([^']+\.sql)'/g)].map((m) => m[1]);

const missing = onDisk.filter((f) => !listed.includes(f));
const extra = listed.filter((f) => !onDisk.includes(f));
const outOfOrder = missing.length === 0 && extra.length === 0 && listed.join() !== onDisk.join();

if (missing.length || extra.length || outOfOrder) {
  console.error('check-migration-list: server/src/lib/migrationStatus.ts is out of date.');
  for (const f of missing) console.error(`  missing from EXPECTED_MIGRATIONS: ${f}`);
  for (const f of extra) console.error(`  listed but no such file:          ${f}`);
  if (outOfOrder) console.error('  entries are not in filename order');
  console.error('Add every server/migrations/*.sql file to EXPECTED_MIGRATIONS, in order.');
  process.exit(1);
}

console.log(`check-migration-list: ${onDisk.length} migrations, list matches.`);
