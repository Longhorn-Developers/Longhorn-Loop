// Central list of every scraper. worker.ts iterates this list on the
// scrape cron; adding a new scraper is one line here plus a new file.
//
// Each entry is:
//   name:    short id used for logs, metrics, AND the manual trigger route slug
//   run:     the (env) => Promise<void> cron entrypoint
//   manual:  (optional) scrape function exposed via POST /events/scrape/:name
//            Accepts the DB + a freeform options bag from the request body.
// NOTE: Manual is used for testing and shold not be called in production

import type { Env } from '../worker';
import { run as runFineArts, scrapeFineArts } from './finearts';
import { run as runCns } from './cns';
import { run as runHornsLink, scrapeHornsLink } from './hornslink';
import { run as runLawSchool, scrapeLawSchool } from './lawSchool';
import { run as runMccombs, scrapeMccombs } from './mccombs';
import { run as runTexasGlobal, scrapeTexasGlobal } from './texasGlobal';
import { run as runTexasToday } from './texasToday';

export interface ScraperEntry {
  name: string;
  run: (env: Env) => Promise<void>;
  /** If provided, the scraper is available via POST /events/scrape/:name */
  manual?: (db: D1Database, options: Record<string, unknown>) => Promise<unknown>;
}

export const SCRAPERS: ScraperEntry[] = [
  { name: 'hornslink', run: runHornsLink, manual: scrapeHornsLink },
  { name: 'texasToday', run: runTexasToday },
  { name: 'mccombs', run: runMccombs, manual: scrapeMccombs },
  { name: 'texasGlobal', run: runTexasGlobal, manual: scrapeTexasGlobal },
  { name: 'lawSchool', run: runLawSchool, manual: scrapeLawSchool },
  { name: 'cofa', run: runFineArts, manual: scrapeFineArts },
  { name: 'cns', run: runCns },
];

/** Lookup a scraper by route slug. */
export function getManualScraper(slug: string): ScraperEntry['manual'] | undefined {
  return SCRAPERS.find((s) => s.name === slug)?.manual;
}
