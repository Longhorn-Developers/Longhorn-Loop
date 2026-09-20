/**
 * app/lib/mapClusters.ts — the scatter/collapse threshold.
 *
 * Lives here because server/ holds the repo's only vitest runner, and the
 * module under test is deliberately dependency-free (no React, no `@/` alias)
 * so it can be imported by relative path from outside the app. If the client
 * ever grows its own runner, this moves.
 *
 * The cases worth having are the boundary — off by one at the threshold is the
 * whole bug surface — and the promise that sub-threshold output is byte-for-byte
 * what the map drew before, because "unchanged below the threshold" is the
 * claim the design makes.
 */

import { describe, expect, it } from 'vitest';
import {
  LONGITUDE_SCALE_AT_UT,
  MAX_SCATTERED,
  RING_RADIUS_DEGREES,
  buildMapMarkers,
  clusterDiameter,
  type MappableEvent,
} from '../../app/lib/mapClusters';

const LAW = { latitude: 30.28787, longitude: -97.7299 };
const WELCH = { latitude: 30.28654, longitude: -97.73688 };

/** n events all at the same coordinate, with distinguishable ids. */
function atVenue(venue: { latitude: number; longitude: number }, n: number, idBase = 0) {
  return Array.from({ length: n }, (_, i) => ({
    id: idBase + i + 1,
    latitude: venue.latitude,
    longitude: venue.longitude,
  }));
}

const build = (visible: MappableEvent[], dimmed: MappableEvent[] = []) =>
  buildMapMarkers({ visible, dimmed });

describe('the threshold boundary', () => {
  it('draws a lone event at its exact coordinate, unjittered', () => {
    const { scattered, clusters } = build(atVenue(LAW, 1));
    expect(clusters).toHaveLength(0);
    expect(scattered).toHaveLength(1);
    expect(scattered[0].coordinate).toEqual(LAW);
  });

  it('scatters a group at the threshold', () => {
    const { scattered, clusters } = build(atVenue(LAW, MAX_SCATTERED));
    expect(clusters).toHaveLength(0);
    expect(scattered).toHaveLength(MAX_SCATTERED);
  });

  it('collapses one past the threshold', () => {
    // The whole feature in one assertion.
    const { scattered, clusters } = build(atVenue(LAW, MAX_SCATTERED + 1));
    expect(scattered).toHaveLength(0);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(MAX_SCATTERED + 1);
  });

  it('collapses the law school to a single marker', () => {
    const { scattered, clusters } = build(atVenue(LAW, 40));
    expect(scattered).toHaveLength(0);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(40);
    // At the building's real coordinate — the point of collapsing is that we
    // stop inventing positions.
    expect(clusters[0].coordinate).toEqual(LAW);
  });
});

describe('sub-threshold scatter is unchanged', () => {
  it('places a group evenly on a ring around its origin', () => {
    // THE TRAP, and why this asserts positions rather than distances: a degree
    // of longitude is shorter than a degree of latitude, so the ring is a
    // circle on the GROUND and an ellipse in degrees. An earlier version of
    // this test compared raw-degree hypots and expected them equal — at n=4
    // that is 8.0e-5 north versus 9.26e-5 east, which is not equal to nine
    // decimal places or to any other number of them.
    const { scattered } = build(atVenue(LAW, 4));
    const lng = RING_RADIUS_DEGREES / LONGITUDE_SCALE_AT_UT;

    // n=4 puts one member at each compass point, starting north and going
    // clockwise — index 0 is angle 0.
    const expected = [
      { latitude: LAW.latitude + RING_RADIUS_DEGREES, longitude: LAW.longitude },
      { latitude: LAW.latitude, longitude: LAW.longitude + lng },
      { latitude: LAW.latitude - RING_RADIUS_DEGREES, longitude: LAW.longitude },
      { latitude: LAW.latitude, longitude: LAW.longitude - lng },
    ];

    expect(scattered).toHaveLength(4);
    scattered.forEach((marker, i) => {
      expect(marker.coordinate.latitude).toBeCloseTo(expected[i].latitude, 12);
      expect(marker.coordinate.longitude).toBeCloseTo(expected[i].longitude, 12);
    });
  });

  it('keeps the ring circular on the ground, not in degrees', () => {
    // The property the positions above encode: once longitude is scaled back,
    // every member sits the same real distance from the building.
    const { scattered } = build(atVenue(LAW, 8));
    const ground = scattered.map((m) =>
      Math.hypot(
        m.coordinate.latitude - LAW.latitude,
        (m.coordinate.longitude - LAW.longitude) * LONGITUDE_SCALE_AT_UT,
      ),
    );
    for (const d of ground) expect(d).toBeCloseTo(RING_RADIUS_DEGREES, 12);
  });

  it('moves every member off the shared point', () => {
    const { scattered } = build(atVenue(LAW, 3));
    for (const marker of scattered) {
      expect(marker.coordinate).not.toEqual(LAW);
    }
  });
});

describe('venues are independent', () => {
  it('collapses a busy venue while leaving a quiet one scattered', () => {
    const { scattered, clusters } = build([...atVenue(LAW, 40), ...atVenue(WELCH, 3, 100)]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(40);
    expect(scattered).toHaveLength(3);
    expect(scattered.every((m) => m.event.id > 100)).toBe(true);
  });
});

describe('filtered-out events', () => {
  it('counts only what survived the filters', () => {
    // 2 visible + 38 hidden. The bubble must promise 2, because 2 is what
    // opening it delivers.
    const { clusters } = build(atVenue(LAW, 2), atVenue(LAW, 38, 500));
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(2);
    expect(clusters[0].dimmedEvents).toHaveLength(38);
  });

  it('decides scatter vs collapse on the combined size', () => {
    // Crowding is crowding: two live pins among thirty-eight dead ones is still
    // forty markers fighting over one point.
    const { scattered, clusters } = build(atVenue(LAW, 2), atVenue(LAW, 38, 500));
    expect(scattered).toHaveLength(0);
    expect(clusters).toHaveLength(1);
  });

  it('keeps a group whose events were all filtered out', () => {
    // It stays on the map, greyed, so a filter reads as a filter rather than as
    // an empty campus.
    const { clusters } = build([], atVenue(LAW, 12, 900));
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(0);
    expect(clusters[0].dimmedEvents).toHaveLength(12);
  });

  it('marks a lone filtered-out event as dimmed', () => {
    const { scattered } = build([], atVenue(WELCH, 1, 900));
    expect(scattered).toHaveLength(1);
    expect(scattered[0].dimmed).toBe(true);
  });

  it('gives visible events the low ring indices', () => {
    // So a live pin does not jump around the ring when a filter removes one of
    // its neighbours.
    const { scattered } = build(atVenue(WELCH, 2), atVenue(WELCH, 2, 700));
    const live = scattered.filter((m) => !m.dimmed);
    const dead = scattered.filter((m) => m.dimmed);
    expect(live).toHaveLength(2);
    expect(dead).toHaveLength(2);
    expect(live.every((m) => m.event.id <= 2)).toBe(true);
  });
});

describe('bubble sizing', () => {
  it('steps rather than ramping', () => {
    expect(clusterDiameter(7)).toBe(38);
    expect(clusterDiameter(11)).toBe(38);
    expect(clusterDiameter(12)).toBe(46);
    expect(clusterDiameter(40)).toBe(56);
  });

  it('never returns a size smaller than a pin', () => {
    expect(clusterDiameter(0)).toBeGreaterThanOrEqual(30);
  });
});

describe('degenerate input', () => {
  it('returns nothing for nothing', () => {
    expect(build([])).toEqual({ scattered: [], clusters: [] });
  });

  it('treats coordinates equal to six decimals as one venue', () => {
    const a = { id: 1, latitude: 30.2878700001, longitude: -97.7299 };
    const b = { id: 2, latitude: 30.28787, longitude: -97.7299 };
    const { scattered } = build([a, b]);
    // Grouped, therefore scattered apart rather than stacked.
    expect(scattered).toHaveLength(2);
    expect(scattered[0].coordinate).not.toEqual(scattered[1].coordinate);
  });
});
