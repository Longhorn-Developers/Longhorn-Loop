// Date / time labels for the event detail screen's info card.
//
// Hand-rolled instead of Intl.DateTimeFormat on purpose: the card has to read
// "Wednesday, Dec 3rd", with an ordinal, and no Intl option produces that, so
// the pieces are assembled here anyway. Everything is in the device's local
// time, matching the rest of the app (EventCard, EventPreview).

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function ordinalSuffix(n: number): string {
  // 11th, 12th, 13th are the exceptions to the last-digit rule.
  if (n >= 11 && n <= 13) return 'th';
  switch (n % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

/** "Dec 3rd" */
export function formatShortDate(isoString: string): string {
  const date = new Date(isoString);
  const day = date.getDate();
  return `${MONTHS[date.getMonth()]} ${day}${ordinalSuffix(day)}`;
}

/** "Wednesday, Dec 3rd" */
export function formatWeekdayDate(isoString: string): string {
  const date = new Date(isoString);
  return `${WEEKDAYS[date.getDay()]}, ${formatShortDate(isoString)}`;
}

/** "12:30 PM", or "12:00 PM" on the hour. */
export function formatShortTime(isoString: string): string {
  const date = new Date(isoString);
  const hours = date.getHours() % 12 || 12;
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes} ${date.getHours() >= 12 ? 'PM' : 'AM'}`;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * "12:30 PM - 2:00 PM". Falls back to just the start time when there is no end
 * (scraped rows often have none) or the end is unusable, rather than showing a
 * range that ends at "Invalid Date". An end on a different day carries its date
 * so an overnight event doesn't read as ending before it starts.
 */
export function formatTimeRange(startIso: string, endIso: string | null | undefined): string {
  const start = formatShortTime(startIso);
  if (!endIso) return start;
  const startDate = new Date(startIso);
  const endDate = new Date(endIso);
  if (Number.isNaN(endDate.getTime()) || endDate.getTime() <= startDate.getTime()) return start;
  const end = formatShortTime(endIso);
  return isSameLocalDay(startDate, endDate)
    ? `${start} - ${end}`
    : `${start} - ${formatShortDate(endIso)}, ${end}`;
}
