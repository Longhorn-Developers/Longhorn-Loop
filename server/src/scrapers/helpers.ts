export function inferVenueType(
  location: string | null | undefined,
  address: string | null | undefined,
): 'in_person' | 'online' {
  const text = `${location ?? ''} ${address ?? ''}`.toLowerCase();

  const onlineIndicators = ['online', 'virtual', 'zoom', 'zoom webinar'];

  return onlineIndicators.some((indicator) => text.includes(indicator)) ? 'online' : 'in_person';
}

// Named entities seen in scraped UT content. Anything not listed is left
// alone (see decodeHtmlEntities) rather than guessed at. Names are
// case-sensitive, as in HTML: "&Eacute;" is a different character from
// "&eacute;", so only the core entities below are matched case-insensitively.
const HTML_ENTITIES: Record<string, string> = {
  aacute: 'á',
  amp: '&',
  apos: "'",
  auml: 'ä',
  bull: '•',
  copy: '©',
  eacute: 'é',
  gt: '>',
  hellip: '…',
  iacute: 'í',
  ldquo: '“',
  lsquo: '‘',
  lt: '<',
  mdash: '—',
  middot: '·',
  nbsp: ' ',
  ndash: '–',
  ntilde: 'ñ',
  oacute: 'ó',
  ouml: 'ö',
  quot: '"',
  rdquo: '”',
  reg: '®',
  rsquo: '’',
  trade: '™',
  uacute: 'ú',
  uuml: 'ü',
};

// The five entities every HTML source spells in capitals now and then
// ("&AMP;"), which browsers accept.
const CORE_ENTITY = /^(?:amp|lt|gt|quot|apos)$/i;

// Scraped HTML mixes named entities (&amp;) with decimal and hex ones
// (&#8217;, &#xFC;), and WP ".rendered" fields keep all of them un-decoded.
//
// One pass, not a chain of .replace() calls: chaining would decode
// "&amp;lt;" twice, first to "&lt;" and then to "<", turning text that was
// literally "&lt;" into markup. Unknown named entities are preserved instead
// of silently dropping content. A numeric entity is also preserved when it is
// not a usable character: String.fromCodePoint() throws above U+10FFFF, and
// "&#0;" would otherwise put a NUL byte into a title.
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith('#')) {
      const point =
        code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    }
    return HTML_ENTITIES[CORE_ENTITY.test(code) ? code.toLowerCase() : code] ?? entity;
  });
}

// Plain text from an HTML fragment (a WP ".rendered" field, a table cell).
//
// Order matters: drop the tags first, so escaped markup ("&lt;b&gt;") survives
// as text, then decode exactly once, so a literal "&amp;amp;" ends as "&amp;"
// and not "&". (Decoding first, or handing the result to stripHtml(), which
// decodes again, gets both wrong.) Tags become spaces rather than nothing so
// neighbouring blocks ("<p>a</p><p>b</p>", "line<br>line") don't glue together.
export function htmlToText(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

// Scraped dates carry no UTC offset, so look up the real America/Chicago
// offset for the event's own date (DST-aware) instead of assuming CST or CDT:
// one scrape can span a DST boundary, and sites that label every time "CST"
// do so even in summer.
export function chicagoOffset(dateStr: string): string {
  const date = new Date(`${dateStr}T12:00:00Z`); // noon UTC stays the same calendar day in Chicago
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    timeZoneName: 'shortOffset',
  }).formatToParts(date);
  const tzName = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-6';
  const match = tzName.match(/GMT([+-]\d+)/);
  const hours = match ? parseInt(match[1], 10) : -6;
  const sign = hours >= 0 ? '+' : '-';
  return `${sign}${String(Math.abs(hours)).padStart(2, '0')}:00`;
}

// "9:00 am" / "5:00 pm" / "12:00 am" -> {hours: 0-23, minutes}
// A shape-correct but impossible time ("13:00 pm", "9:99 am") is rejected, not
// passed on: it would otherwise reach buildDatetime() and come out as an
// invalid ISO string that silently fails every later date comparison.
export function parseTime12h(time: string): { hours: number; minutes: number } | null {
  const match = time.trim().match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i);
  if (!match) return null;
  const hour12 = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hour12 < 1 || hour12 > 12 || minutes > 59) return null;
  let hours = hour12 % 12;
  if (match[3].toLowerCase() === 'pm') hours += 12;
  return { hours, minutes };
}

// Combines a plain date with an optional 12h time string into an ISO
// datetime. No time -> date-only string (all-day), matching the
// convention used by other scrapers for all-day/multi-day events.
export function buildDatetime(dateStr: string, timeStr: string): string {
  const time = timeStr ? parseTime12h(timeStr) : null;
  if (!time) return dateStr;
  const hh = String(time.hours).padStart(2, '0');
  const mm = String(time.minutes).padStart(2, '0');
  return `${dateStr}T${hh}:${mm}:00${chicagoOffset(dateStr)}`;
}
