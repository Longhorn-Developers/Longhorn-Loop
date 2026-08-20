/**
 * Every HTTP method a route handler uses must appear in the CORS allowMethods
 * list in worker.ts.
 *
 * This exists because it already broke once: four PATCH endpoints were added
 * (Edit Profile save, the avatar, Settings toggles, org role swap and org
 * notification settings) while allowMethods still read
 * ['GET','POST','PUT','DELETE','OPTIONS']. On web the browser's preflight
 * rejected all of them, and the app surfaced it as a bare "Failed to fetch"
 * with no status code and nothing in the Worker logs — the request never
 * reached the server.
 *
 * A pure static check: no database, no Node 22 features, so unlike the SQL
 * suites this one runs everywhere.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', 'src');

function allowedMethods(): string[] {
  const worker = readFileSync(join(SRC, 'worker.ts'), 'utf-8');
  const match = /allowMethods:\s*\[([^\]]*)\]/.exec(worker);
  if (!match) throw new Error('could not find allowMethods in worker.ts');
  return [...match[1].matchAll(/'([A-Z]+)'/g)].map((m) => m[1]);
}

/** Methods actually used across every *.worker.ts route file. */
function usedMethods(): Map<string, string[]> {
  const routesDir = join(SRC, 'routes');
  const used = new Map<string, string[]>();

  for (const file of readdirSync(routesDir).filter((f) => f.endsWith('.worker.ts'))) {
    const src = readFileSync(join(routesDir, file), 'utf-8');
    // e.g. userRoutes.patch('/me/profile', ...)
    for (const m of src.matchAll(/\w+Routes\.(get|post|put|patch|delete)\(/g)) {
      const method = m[1].toUpperCase();
      used.set(method, [...(used.get(method) ?? []), file]);
    }
  }
  return used;
}

describe('CORS allowMethods covers every routed method', () => {
  const allowed = allowedMethods();
  const used = usedMethods();

  it('finds routes to check', () => {
    expect(used.size).toBeGreaterThan(0);
  });

  it('always allows OPTIONS, or preflight itself fails', () => {
    expect(allowed).toContain('OPTIONS');
  });

  for (const [method, files] of usedMethods()) {
    it(`allows ${method} (used in ${[...new Set(files)].join(', ')})`, () => {
      expect(allowed).toContain(method);
    });
  }
});
