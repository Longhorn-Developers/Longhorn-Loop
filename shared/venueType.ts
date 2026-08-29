// Whether an event happens somewhere physical or on a link.
//
// The column arrived with LOOP-260 and the server made it a hard requirement,
// but the create wizard had no control for it and sent no such field — so every
// post from the app failed with a 400 naming a field the user could not see.
// The server now defaults a missing value to 'in_person'; this module is the
// other half, so the user actually chooses.
//
// Lives in shared/ rather than the app, for the same reason eventBenefits.ts
// does: the server validates against these exact strings, and a vocabulary
// defined twice drifts.

export const VENUE_TYPES = ['in_person', 'online'] as const;

export type VenueType = (typeof VENUE_TYPES)[number];

/**
 * Most campus events are somewhere you walk to, and it is the answer that makes
 * the location field mean what it looks like it means. Matches the server's
 * fallback, so a client that forgets to send the field and one that sends the
 * default produce the same row.
 */
export const DEFAULT_VENUE_TYPE: VenueType = 'in_person';

/** What each option is called in the UI. The stored values are never shown. */
export const VENUE_TYPE_LABELS: Record<VenueType, string> = {
  in_person: 'In Person',
  online: 'Virtual',
};

/**
 * Placeholder for the location field, which means something different for each
 * venue type — a room number or a meeting link. Asking "Location" and hinting
 * "GDC 2.216" to someone hosting a Zoom is how you get a room number typed into
 * a field that needed a URL.
 */
export const LOCATION_PLACEHOLDER: Record<VenueType, string> = {
  in_person: 'GDC 2.216, Gregory Gym, etc...',
  online: 'Zoom or Teams link...',
};

export function isVenueType(value: unknown): value is VenueType {
  return typeof value === 'string' && (VENUE_TYPES as readonly string[]).includes(value);
}
