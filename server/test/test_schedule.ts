// jobsDue (LOOP-295): one */15 trigger standing in for the four the Worker
// used to declare. The contract is "the same jobs fire at the same UTC minutes
// as before", so each case below is a tick the old four-trigger config would
// have fired, with the jobs it would have run.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CRON_TICK, jobsDue } from '../src/lib/schedule';

const at = (iso: string) => new Date(iso).getTime();

describe('jobsDue', () => {
  it('00:00 UTC runs reminders and the scrape, and nothing daily', () => {
    // The tick most likely to double-fire: it satisfies the 6-hour condition
    // AND is a day boundary.
    expect(jobsDue(at('2026-11-10T00:00:00Z'))).toEqual(['reminders', 'scrape']);
  });

  it('runs the scrape on every 6-hour mark', () => {
    for (const hh of ['06', '12', '18']) {
      expect(jobsDue(at(`2026-11-10T${hh}:00:00Z`))).toEqual(['reminders', 'scrape']);
    }
  });

  it('08:00 UTC runs reminders and the org directory only', () => {
    expect(jobsDue(at('2026-11-10T08:00:00Z'))).toEqual(['reminders', 'orgDirectory']);
  });

  it('09:00 UTC runs reminders and event cleanup only', () => {
    expect(jobsDue(at('2026-11-10T09:00:00Z'))).toEqual(['reminders', 'eventCleanup']);
  });

  it('quarter-hour ticks run reminders only, including just after a daily hour', () => {
    for (const t of ['06:15', '08:15', '09:45', '23:45', '00:15']) {
      expect(jobsDue(at(`2026-11-10T${t}:00Z`))).toEqual(['reminders']);
    }
  });

  it('a non-scrape hour on the hour runs reminders only', () => {
    expect(jobsDue(at('2026-11-10T07:00:00Z'))).toEqual(['reminders']);
    expect(jobsDue(at('2026-11-10T13:00:00Z'))).toEqual(['reminders']);
  });

  it('fires each daily job exactly once across a whole day of ticks', () => {
    const counts: Record<string, number> = {};
    const start = at('2026-11-10T00:00:00Z');
    for (let i = 0; i < 96; i++) {
      for (const job of jobsDue(start + i * 15 * 60 * 1000)) counts[job] = (counts[job] ?? 0) + 1;
    }
    expect(counts).toEqual({ reminders: 96, scrape: 4, orgDirectory: 1, eventCleanup: 1 });
  });

  it('is UTC, so a DST change in Austin moves nothing', () => {
    // US DST ended 2026-11-01. 08:00Z is 03:00 CDT the day before and 02:00
    // CST the day after; the org sweep must run at 08:00Z on both.
    expect(jobsDue(at('2026-10-31T08:00:00Z'))).toContain('orgDirectory');
    expect(jobsDue(at('2026-11-02T08:00:00Z'))).toContain('orgDirectory');
  });
});

describe('wrangler.toml', () => {
  it('declares exactly the one trigger jobsDue is written against', () => {
    const toml = readFileSync(join(__dirname, '..', 'wrangler.toml'), 'utf-8');
    const crons = /^crons\s*=\s*\[(.*)\]/m.exec(toml)?.[1];
    expect(crons?.split(',').map((s) => s.trim().replace(/"/g, ''))).toEqual([CRON_TICK]);
  });
});
