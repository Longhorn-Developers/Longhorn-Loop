/**
 * Org meeting times (LOOP-319): the shape, the validation and the display
 * format, shared so the client form and the Worker agree on what a valid
 * meeting is.
 *
 * WEEKLY RECURRING ONLY. A student org's "meeting" is overwhelmingly a weekly
 * slot -- 91% of HornsLink events are recurring series (LOOP-310) -- and a
 * one-off gathering is already an event, with RSVPs, a map pin and a feed
 * presence. Modelling one-offs here too would give the same thing two homes.
 *
 * Times are wall-clock "HH:MM" (24h) in Austin time, not instants: "Tuesdays
 * at 7pm" stays 7pm across the DST change, which a stored UTC time would not.
 *
 * Dependency-free so both app/ and server/ can import it.
 */

export interface OrgMeeting {
  id: number;
  label: string;
  /** 0 = Sunday ... 6 = Saturday. */
  day_of_week: number;
  /** "HH:MM", 24-hour, Austin wall clock. */
  start_time: string;
  end_time: string | null;
  location: string;
  notes: string | null;
}

export type OrgMeetingInput = Omit<OrgMeeting, 'id'>;

export const MAX_MEETINGS_PER_ORG = 10;
export const MAX_MEETING_LABEL = 60;
export const MAX_MEETING_LOCATION = 120;
export const MAX_MEETING_NOTES = 300;

export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Read a time the way people type one -- "7pm", "7:30 PM", "19:30", "7.30pm"
 * -- into "HH:MM". Null when it isn't a time. A bare "7" is read as 7:00 in
 * the 24h sense; the form shows the parsed result, so an evening meeting typed
 * as "7" is visible as "7:00 AM" before saving.
 */
export function parseTimeInput(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, '').replace('.', ':');
  const m = /^(\d{1,2})(?::(\d{2}))?(am|pm|a|p)?$/.exec(s);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const meridiem = m[3]?.[0];
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'a' && hour === 12) hour = 0;
    if (meridiem === 'p' && hour !== 12) hour += 12;
  } else if (hour > 23) {
    return null;
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** "19:30" -> "7:30 PM". */
export function formatTime(hhmm: string): string {
  const m = HHMM.exec(hhmm);
  if (!m) return hhmm;
  const hour = Number(m[1]);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${m[2]} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** "Tuesdays · 7:00 PM – 8:30 PM". */
export function formatMeetingWhen(
  m: Pick<OrgMeeting, 'day_of_week' | 'start_time' | 'end_time'>,
): string {
  const day = `${DAY_NAMES[m.day_of_week] ?? 'Weekly'}s`;
  const time = m.end_time
    ? `${formatTime(m.start_time)} – ${formatTime(m.end_time)}`
    : formatTime(m.start_time);
  return `${day} · ${time}`;
}

export type MeetingValidation =
  | { ok: true; value: OrgMeetingInput }
  | { ok: false; errors: Partial<Record<keyof OrgMeetingInput, string>> };

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * Validate and normalise a meeting from a request body or the form. Unknown
 * keys are ignored; strings are trimmed; empty optional strings become null.
 */
export function validateMeeting(body: Record<string, unknown>): MeetingValidation {
  const errors: Partial<Record<keyof OrgMeetingInput, string>> = {};

  const label = text(body.label);
  if (!label) errors.label = 'Give the meeting a name.';
  else if (label.length > MAX_MEETING_LABEL)
    errors.label = `Keep it under ${MAX_MEETING_LABEL} characters.`;

  const day = Number(body.day_of_week);
  if (!Number.isInteger(day) || day < 0 || day > 6) errors.day_of_week = 'Pick a day.';

  const start = text(body.start_time);
  if (!HHMM.test(start)) errors.start_time = 'Enter a start time.';

  const endRaw = text(body.end_time);
  const end = endRaw || null;
  if (end && !HHMM.test(end)) errors.end_time = 'Enter a valid end time.';
  else if (end && HHMM.test(start) && end <= start)
    errors.end_time = 'The end time has to be after the start.';

  const location = text(body.location);
  if (!location) errors.location = 'Say where it meets.';
  else if (location.length > MAX_MEETING_LOCATION)
    errors.location = `Keep it under ${MAX_MEETING_LOCATION} characters.`;

  const notesRaw = text(body.notes);
  const notes = notesRaw || null;
  if (notes && notes.length > MAX_MEETING_NOTES)
    errors.notes = `Keep it under ${MAX_MEETING_NOTES} characters.`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { label, day_of_week: day, start_time: start, end_time: end, location, notes },
  };
}
