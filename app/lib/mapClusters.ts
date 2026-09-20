/**
 * What the Explore map draws at each coordinate.
 *
 * Design: "Events in View" — Explore map, treatment D, the threshold section.
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM THIS SOLVES, because the shape of the fix follows from it.
 *
 * Event coordinates are BUILDING centroids. `ingest.ts` resolves each event's
 * location string through `resolveBuilding()` and stamps whatever that returns,
 * so a room number never reaches the latitude. Forty law-school events are not
 * forty places; they are one place, forty times.
 *
 * The old behaviour scattered every co-located group around a fixed 9m ring.
 * That is right up to a point and unbounded past it: nine metres of
 * circumference is about 44pt on screen at campus zoom against a 24pt marker,
 * so somewhere around nine pins the ring starts overlapping itself and the
 * scatter stops achieving the thing it exists for. At forty it draws a donut.
 *
 * So the scatter is kept, and bounded. At or below MAX_SCATTERED the output is
 * exactly what it was before — same ring, same maths, same pins. Above it the
 * group collapses to one marker carrying its count.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT COLLAPSE EVERYTHING. A bubble reading "2" is strictly worse than two
 * pins: it hides information to save no space, and it makes a quiet building
 * look like a busy one. The scatter earns its place in the range it was written
 * for, which is why the threshold exists instead of a blanket rule.
 *
 * WHAT THIS IS NOT. It is not clustering. Nothing here merges events at
 * DIFFERENT coordinates, and the threshold does not move with zoom — six pins
 * that read fine at building zoom still touch at campus zoom. Zoom-aware
 * merging is supercluster, and it is a separate, larger piece of work; this
 * module deliberately does the simpler thing first and does it exactly.
 *
 * ---------------------------------------------------------------------------
 * Dependency-free on purpose: no React, no react-native, no `@/` alias. That is
 * what lets server/test reach it, which is the only vitest runner in the repo.
 */

/** The minimum an event needs to be placed. */
export interface MappableEvent {
  id: number;
  latitude: number;
  longitude: number;
}

export interface Coordinate {
  latitude: number;
  longitude: number;
}

/** One event drawn as its own pin, at the position it should be drawn AT. */
export interface ScatteredMarker<T> {
  event: T;
  coordinate: Coordinate;
  /** Filtered out — drawn grey and not tappable. */
  dimmed: boolean;
}

/** A co-located group drawn as one counted bubble. */
export interface ClusterMarker<T> {
  /** Stable across renders: the rounded coordinate the group shares. */
  key: string;
  coordinate: Coordinate;
  /** Events the current filters KEPT. The number on the bubble. */
  events: T[];
  /** Events the filters removed. Never counted — see the note below. */
  dimmedEvents: T[];
  /** events.length, hoisted because every caller wants it. */
  count: number;
}

export interface MapMarkers<T> {
  scattered: ScatteredMarker<T>[];
  clusters: ClusterMarker<T>[];
}

/**
 * Group size at which a coordinate stops scattering and starts counting.
 *
 * Six is reasoned rather than measured: below the ring's self-overlap point
 * (~9 at a usable zoom), above the sizes where a bubble hides more than it
 * saves. Worth re-setting against a real campus week — it is one constant and
 * nothing else depends on its value.
 */
export const MAX_SCATTERED = 6;

/**
 * ~9m at UT's latitude. Unchanged — this is the ring the scatter always drew.
 *
 * Both exported for the tests, which assert exact ring positions. Asserting
 * that the raw-degree distances are equal does NOT work and is the trap: a
 * degree of longitude is shorter than a degree of latitude, so the ring is a
 * circle on the ground and an ellipse in degrees.
 */
export const RING_RADIUS_DEGREES = 0.00008;

/** How much a degree of longitude is compressed at UT's latitude. */
export const LONGITUDE_SCALE_AT_UT = Math.cos((30.2849 * Math.PI) / 180);

/**
 * Six decimal places is ~11cm. Two events are "at the same place" when the
 * building resolver gave them the same row, which in practice means bit-identical
 * doubles; rounding is belt and braces for anything hand-entered.
 */
function coordinateKey(event: MappableEvent): string {
  return `${event.latitude.toFixed(6)},${event.longitude.toFixed(6)}`;
}

/** The ring position for index `i` of `total`. Lifted verbatim from the old
 *  jitterOverlappingCoordinates so the sub-threshold case is unchanged. */
function ringPosition(origin: MappableEvent, index: number, total: number): Coordinate {
  const angle = (2 * Math.PI * index) / total;
  return {
    latitude: origin.latitude + RING_RADIUS_DEGREES * Math.cos(angle),
    longitude: origin.longitude + (RING_RADIUS_DEGREES * Math.sin(angle)) / LONGITUDE_SCALE_AT_UT,
  };
}

export interface BuildMarkersInput<T extends MappableEvent> {
  /** Events matching the current filters. */
  visible: T[];
  /** Events the filters excluded, drawn grey for context. */
  dimmed?: T[];
  /** Override for tests; defaults to MAX_SCATTERED. */
  maxScattered?: number;
}

/**
 * Decide, per coordinate, between scattering and counting.
 *
 * BOTH SETS ARE GROUPED TOGETHER, and that is deliberate on two counts.
 *
 * Crowding is crowding: two visible events at a building with thirty-eight
 * filtered-out ones is still forty markers competing for the same point, so the
 * scatter/collapse decision is made on the COMBINED size. Grouping them
 * separately would also let a visible bubble and a dimmed bubble land on the
 * same pixel, with the live one covering the dead one — the exact overlap the
 * old ring existed to prevent.
 *
 * The count on the bubble is the VISIBLE count only. A filtered-out event is
 * not a result; promising forty and delivering two is the failure the live
 * counts in the filter sheet were built to avoid, and the map must not
 * reintroduce it. A group with nothing visible left keeps its bubble, greyed,
 * carrying the dimmed events so the caller can still show what was excluded.
 */
export function buildMapMarkers<T extends MappableEvent>({
  visible,
  dimmed = [],
  maxScattered = MAX_SCATTERED,
}: BuildMarkersInput<T>): MapMarkers<T> {
  const groups = new Map<string, { visible: T[]; dimmed: T[] }>();

  const bucket = (key: string) => {
    let group = groups.get(key);
    if (!group) {
      group = { visible: [], dimmed: [] };
      groups.set(key, group);
    }
    return group;
  };

  /**
   * COERCE AND VALIDATE BEFORE GROUPING (LOOP-279).
   *
   * The type says `number` and the caller filters on `!= null`, but the value
   * came off the wire. A string "30.28" passes that filter and then throws on
   * `.toFixed()` in coordinateKey. A non-finite value is worse than a throw: it
   * reaches MapKit as a NaN coordinate and takes the app down NATIVELY, where
   * there is no JS frame left to catch it.
   *
   * An event that fails this gets no marker rather than killing the whole map.
   *
   * This guard arrived on main as part of the function this module replaced.
   * Keeping it is the point of the merge — the extraction moved the code, it
   * did not make the wire data trustworthy.
   */
  const place = (event: T, into: 'visible' | 'dimmed') => {
    const latitude = Number(event.latitude);
    const longitude = Number(event.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    // Keyed and positioned off the COERCED numbers, so a numeric string groups
    // with the equivalent number instead of forming a venue of its own.
    bucket(coordinateKey({ ...event, latitude, longitude }))[into].push({
      ...event,
      latitude,
      longitude,
    });
  };

  for (const event of visible) place(event, 'visible');
  for (const event of dimmed) place(event, 'dimmed');

  const scattered: ScatteredMarker<T>[] = [];
  const clusters: ClusterMarker<T>[] = [];

  for (const [key, group] of groups) {
    const members = [...group.visible, ...group.dimmed];
    const total = members.length;
    if (total === 0) continue;

    const origin = members[0];

    if (total > maxScattered) {
      clusters.push({
        key,
        // The true centroid, not a ring position: one marker at the building's
        // own coordinate is the honest placement, and the whole point of
        // collapsing is that we stop inventing positions.
        coordinate: { latitude: origin.latitude, longitude: origin.longitude },
        events: group.visible,
        dimmedEvents: group.dimmed,
        count: group.visible.length,
      });
      continue;
    }

    if (total === 1) {
      scattered.push({
        event: members[0],
        coordinate: { latitude: origin.latitude, longitude: origin.longitude },
        dimmed: group.visible.length === 0,
      });
      continue;
    }

    // Sub-threshold: today's ring, unchanged. Visible events take the first
    // indices so a group's live pins keep stable positions when a filter only
    // removes some of its neighbours.
    members.forEach((event, index) => {
      scattered.push({
        event,
        coordinate: ringPosition(origin, index, total),
        dimmed: index >= group.visible.length,
      });
    });
  }

  return { scattered, clusters };
}

// A viewport-scoping helper (eventsInRegion) and a venue-sectioning one
// (groupByVenue) lived here while the list panel followed the camera. The panel
// is scoped to a tapped cluster now — it shows one building, so it needs
// neither — and they were removed rather than left as tested, exported,
// uncalled code. Git has them if the viewport-synced variant comes back.

/**
 * Bubble diameter for a count, in points.
 *
 * Stepped rather than continuous: a smooth size ramp makes 11 and 13 look
 * different without meaning anything, while four steps read as four
 * magnitudes. Matches the design's 30 / 38 / 46 / 56.
 */
export function clusterDiameter(count: number): number {
  if (count >= 25) return 56;
  if (count >= 12) return 46;
  if (count >= 7) return 38;
  return 30;
}
