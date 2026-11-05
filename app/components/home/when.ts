// Date/time fragments for Home's event cards, in the device's local time. Each
// card composes its own line from these (the Figma uses a different separator
// and precision on each), so they are pieces rather than one formatter.

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Sat" — '' for an unparseable date, so callers can drop the whole line. */
export function formatDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : DAYS[date.getDay()];
}

/** "8/21" */
export function formatMonthDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : `${date.getMonth() + 1}/${date.getDate()}`;
}

/** "4:00 PM" */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const hours = date.getHours() % 12 || 12;
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes} ${date.getHours() >= 12 ? 'PM' : 'AM'}`;
}

/** "1 PM" on the hour, "1:30 PM" otherwise. */
export function formatTimeCompact(iso: string): string {
  const time = formatTime(iso);
  return time.replace(':00 ', ' ');
}
