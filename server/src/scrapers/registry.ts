// Central list of every scraper. worker.ts iterates this list on the
// scrape cron; adding a new scraper is one line here plus a new file.
//
// Each entry is:
//   name:    short id used for logs, metrics, AND the manual trigger route slug
//   run:     the (env) => Promise<void> cron entrypoint
//   manual:  (optional) scrape function exposed via POST /events/scrape/:name
//            Accepts env + a freeform options bag from the request body.
// NOTE: Manual is used for testing and shold not be called in production

import type { Env } from '../worker';
import { run as runCockrell, scrapeCockrell } from './cockrell';
import { run as runFineArts, scrapeFineArts } from './finearts';
import { run as runCns } from './cns';
// disabled to remove noisy events
// import { run as runHornsLink, scrapeHornsLink } from './hornslink';
// NOT the same thing as the line above: this one ingests ORGS only and never
// touches the events table. See scrapers/hornslinkOrgs.ts. It runs on its own
// daily cron, not the 6-hour event sweep, so it is absent from SCRAPERS.
import { run as runHornsLinkOrgs, manual as manualHornsLinkOrgs } from './hornslinkOrgs';
import { run as runLawSchool, scrapeLawSchool } from './lawSchool';
import { run as runLiberalArts, scrapeLiberalArts } from './liberalArts';
import { run as runMccombs, scrapeMccombs } from './mccombs';
import { run as runMoody, scrapeMoody } from './moody';
import { run as runPharmacy } from './pharmacy';
import { run as runTexasGlobal, scrapeTexasGlobal } from './texasGlobal';
import { run as runTexasToday } from './texasToday';

export interface ScraperEntry {
  name: string;
  run: (env: Env) => Promise<void>;
  /** If provided, the scraper is available via POST /events/scrape/:name */
  manual?: (env: Env, options: Record<string, unknown>) => Promise<unknown>;
}

export const SCRAPERS: ScraperEntry[] = [
  // disabled to remove noisy events
  // { name: 'hornslink', run: runHornsLink, manual: scrapeHornsLink },
  { name: 'texasToday', run: runTexasToday },
  { name: 'mccombs', run: runMccombs, manual: scrapeMccombs },
  { name: 'moody', run: runMoody, manual: scrapeMoody },
  { name: 'texasGlobal', run: runTexasGlobal, manual: scrapeTexasGlobal },
  { name: 'lawSchool', run: runLawSchool, manual: scrapeLawSchool },
  { name: 'cola', run: runLiberalArts, manual: scrapeLiberalArts },
  { name: 'cockrell', run: runCockrell, manual: scrapeCockrell },
  { name: 'cofa', run: runFineArts, manual: scrapeFineArts },
  { name: 'cns', run: runCns },
  { name: 'pharmacy', run: runPharmacy },
];

/**
 * The org directory scraper (LOOP-241).
 *
 * Kept OUT of SCRAPERS on purpose. Everything in that array runs on the
 * 6-hourly event cron and is expected to write events; this one writes only
 * `organizations` and runs daily, because org rosters barely move and the
 * detail-page pass is expensive. worker.ts dispatches it from its own cron.
 */
export const ORG_DIRECTORY_SCRAPER: ScraperEntry = {
  name: 'hornslinkOrgs',
  run: runHornsLinkOrgs,
  manual: manualHornsLinkOrgs,
};

/** Lookup a scraper by route slug. */
export function getManualScraper(slug: string): ScraperEntry['manual'] | undefined {
  if (slug === ORG_DIRECTORY_SCRAPER.name) return ORG_DIRECTORY_SCRAPER.manual;
  return SCRAPERS.find((s) => s.name === slug)?.manual;
}
