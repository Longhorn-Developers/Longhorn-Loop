// "Add to GCal" on the event detail screen.
//
// A Google Calendar template link rather than expo-calendar: that library needs
// a native module, a permission prompt and a calendar picker, and the design's
// button is Google-specific anyway. The link opens the user's own calendar
// pre-filled and lets them confirm, so nothing is written without a tap there.

const DEFAULT_DURATION_MS = 60 * 60 * 1000;

// Google caps what it will accept in a template URL and scraped descriptions
// can be whole press releases; an over-long link opens a blank error page.
const MAX_DETAILS_CHARS = 1000;

interface CalendarEvent {
  title: string;
  description: string | null;
  start_datetime: string;
  end_datetime: string | null;
  location_full: string | null;
  location_short: string | null;
  event_url: string | null;
}

/** Google wants UTC as YYYYMMDDTHHMMSSZ, with no separators or milliseconds. */
function toGoogleStamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/**
 * The prefilled-event URL, or null if the start time is unusable. With no end
 * time (or one at/before the start) the event is given an hour: Google needs
 * an end, and a zero-length block is nearly invisible on the calendar.
 */
export function googleCalendarUrl(event: CalendarEvent): string | null {
  const start = new Date(event.start_datetime);
  if (Number.isNaN(start.getTime())) return null;

  let end = event.end_datetime ? new Date(event.end_datetime) : null;
  if (!end || Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
    end = new Date(start.getTime() + DEFAULT_DURATION_MS);
  }

  const description = (event.description ?? '').trim().slice(0, MAX_DETAILS_CHARS);
  const details = [description, event.event_url ?? ''].filter(Boolean).join('\n\n');

  // Built by hand: URLSearchParams.toString is not reliably implemented in
  // React Native's polyfill.
  const params: Record<string, string> = {
    action: 'TEMPLATE',
    text: event.title,
    dates: `${toGoogleStamp(start)}/${toGoogleStamp(end)}`,
    details,
    location: event.location_full || event.location_short || '',
  };
  const query = Object.entries(params)
    .filter(([, value]) => value !== '')
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return `https://calendar.google.com/calendar/render?${query}`;
}
