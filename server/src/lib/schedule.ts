// Which scheduled jobs run on a given cron tick (LOOP-295).
//
// ONE CRON TRIGGER, FOUR JOBS. wrangler.toml used to declare four triggers
// ("0 */6 * * *", "*/15 * * * *", "0 8 * * *", "0 9 * * *") and scheduled()
// matched event.cron against each string. Cron Triggers are a per-account
// budget on Workers Free, shared by every Longhorn Developers project, and
// Loop was holding four of the five. Now there is a single "*/15 * * * *"
// trigger -- already the tightest cadence any job needs -- and this function
// decides from the tick's time which jobs are due.
//
// BEHAVIOUR IS IDENTICAL TO THE FOUR-TRIGGER SETUP. Under the old config a
// 00:00 tick fired two separate invocations, "0 */6" and "*/15", so reminders
// ran alongside the scrape; 08:00 ran reminders AND the org sweep. A single
// tick therefore returns every job due at that minute, not just the "most
// specific" one -- returning only the scrape at 00:00 would silently drop four
// reminder passes a day.
//
// THE TIME IS event.scheduledTime, NOT Date.now(). scheduledTime is when the
// trigger was MEANT to fire. A tick that starts late reads a wall clock of
// 06:00:40 or 06:16, which would skip a :00 job or, with a fuzzier match,
// run it twice; the scheduled time is always exactly on the quarter hour.
//
// UTC ACCESSORS. Cron Triggers fire in UTC, so "0 8 * * *" was 08:00 UTC.
// Local-hour getters would move every daily job, and move it again at each
// DST boundary.
//
// The two daily jobs stay an hour apart (08:00 org sweep, 09:00 cleanup). The
// old comment said that was so they didn't share a cron string; that reason is
// gone, but keeping them apart avoids two heavy D1 jobs in the same tick.

export type ScheduledJob = 'reminders' | 'scrape' | 'orgDirectory' | 'eventCleanup';

/** The one cron expression in wrangler.toml [triggers]. */
export const CRON_TICK = '*/15 * * * *';

export function jobsDue(scheduledTime: number): ScheduledJob[] {
  const t = new Date(scheduledTime);
  const hour = t.getUTCHours();
  const minute = t.getUTCMinutes();

  const jobs: ScheduledJob[] = ['reminders'];
  if (minute === 0 && hour % 6 === 0) jobs.push('scrape');
  if (minute === 0 && hour === 8) jobs.push('orgDirectory');
  if (minute === 0 && hour === 9) jobs.push('eventCleanup');
  return jobs;
}
