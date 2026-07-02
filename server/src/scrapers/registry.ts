// Central list of every scraper. worker.ts iterates this list on the
// scrape cron; adding a new scraper is one line here plus a new file.
//
// Each entry is:
//   name: short id for logs / metrics
//   run:  the (env) => Promise<void> cron entrypoint

import { run as runHornsLink } from './hornslink';
import { run as runMccombs } from './mccombs';
import { run as runTexasToday } from './texasToday';
import type { Env } from '../worker';

export interface ScraperEntry {
  name: string;
  run: (env: Env) => Promise<void>;
}

export const SCRAPERS: ScraperEntry[] = [
  { name: 'hornslink', run: runHornsLink },
  { name: 'texasToday', run: runTexasToday },
  { name: 'mccombs', run: runMccombs },
];
