/**
 * The building resolver, which is what put pins back on the Explore map.
 *
 * The cases below are the ones that break it, not the ones that flatter it:
 * codes that are also English words, codes with digits, aliases UT does not
 * publish, and locations that are not places at all.
 */

import { describe, expect, it } from 'vitest';
import {
  LOCATION_ALIASES,
  isNonPhysicalLocation,
  resolveBuilding,
} from '../src/lib/utBuildings';
import buildingData from '../src/data/ut-buildings.json';

describe('UT building resolver', () => {
  describe('codes', () => {
    it('resolves a bare code', () => {
      expect(resolveBuilding('GSB')?.code).toBe('GSB');
    });

    it('resolves a code with a room number', () => {
      expect(resolveBuilding('GSB 2.126')?.code).toBe('GSB');
      expect(resolveBuilding('GSB Room 2.126')?.code).toBe('GSB');
    });

    it('is case insensitive and tolerates surrounding whitespace', () => {
      expect(resolveBuilding('  utc 2.102  ')?.code).toBe('UTC');
    });

    it('finds a code in parentheses after a written-out name', () => {
      expect(resolveBuilding('Graduate School of Business (GSB)')?.code).toBe('GSB');
    });

    it('handles the codes that are not three letters of the alphabet', () => {
      // The ones a "three capital letters" regex would miss.
      expect(resolveBuilding('D21')?.code).toBe('D21');
      expect(resolveBuilding('N24 1.104')?.code).toBe('N24');
      expect(resolveBuilding('AF1')?.code).toBe('AF1');
      expect(resolveBuilding('E11')?.code).toBe('E11');
    });

    it('matches codes as words, never as substrings', () => {
      // BEN is a building. BENCH is not, and neither is a sentence about one.
      expect(resolveBuilding('Meet at the benches outside')).toBeNull();
      // ART is a building. PARTY contains it.
      expect(resolveBuilding('Welcome party')).toBeNull();
    });
  });

  describe('codes that are also English words', () => {
    it('resolves them when the code leads, which is how a room reads', () => {
      expect(resolveBuilding('AND 116')?.code).toBe('AND');
      expect(resolveBuilding('ART 1.102')?.code).toBe('ART');
    });

    it('does NOT resolve them mid-sentence', () => {
      // Without the guard this is Andrews Residence Hall, confidently.
      expect(resolveBuilding('Jester and Gregory Gym')?.code).not.toBe('AND');
      expect(resolveBuilding('An evening of art and music')).toBeNull();
    });
  });

  describe('aliases', () => {
    it('resolves SAC, which UT does not publish at all', () => {
      // The building is officially WCP. "SAC" appears nowhere in UT's data and
      // everywhere in student writing.
      expect(buildingData.buildings).not.toHaveProperty('SAC');
      expect(resolveBuilding('SAC')?.code).toBe('WCP');
      expect(resolveBuilding('Student Activity Center')?.code).toBe('WCP');
      expect(resolveBuilding('SAC 1.402')?.code).toBe('WCP');
    });

    it('resolves the Tower to the Main Building', () => {
      expect(resolveBuilding('UT Tower')?.code).toBe('MAI');
      expect(resolveBuilding('Main Building')?.code).toBe('MAI');
    });

    it('points every alias at a building that exists', () => {
      for (const code of Object.values(LOCATION_ALIASES)) {
        expect(resolveBuilding(code), `alias target ${code}`).not.toBeNull();
      }
    });
  });

  describe('real strings, taken from the scraper fixtures', () => {
    // These are the exact values the scraper tests already assert, so they are
    // what the resolver actually meets in production.
    it.each([
      ['Avaya Auditorium POB 2.302', 'POB'],
      ['GSB 2.122', 'GSB'],
      ['TNH 2.111 - Sheffield-Massey Room', 'TNH'],
      ['"HQ" Room, Floor 1 North Tower, EER Building', 'EER'],
    ])('resolves %j to %s', (location, code) => {
      expect(resolveBuilding(location)?.code).toBe(code);
    });

    it('does not read "North Tower" as the UT Tower', () => {
      // The bug this was written for: TOWER is an alias for MAI, and matching
      // it anywhere in the string sent an engineering lecture in EER to the
      // top of the Main Building.
      expect(resolveBuilding('"HQ" Room, Floor 1 North Tower, EER Building')?.code).not.toBe('MAI');
    });

    it('does not read "Museum of Art" as the Art Building', () => {
      expect(resolveBuilding('Blanton Museum of Art')?.code).not.toBe('ART');
    });
  });

  describe('full names', () => {
    it('resolves a written-out building name with no code present', () => {
      expect(resolveBuilding('Perry-Castaneda Library')?.code).toBe('PCL');
      expect(resolveBuilding('University Teaching Center')?.code).toBe('UTC');
    });
  });

  describe('locations that are not places', () => {
    it.each(['Online', 'Zoom', 'TBA', 'Off Campus', 'Unknown', '', '   '])(
      'treats %j as non-physical',
      (value) => {
        expect(isNonPhysicalLocation(value)).toBe(true);
      },
    );

    it('does not treat a real building as non-physical', () => {
      expect(isNonPhysicalLocation('GSB 2.126')).toBe(false);
    });

    it('returns null rather than throwing on junk', () => {
      expect(resolveBuilding('QQQ')).toBeNull();
      expect(resolveBuilding(null)).toBeNull();
      expect(resolveBuilding(undefined)).toBeNull();
      expect(resolveBuilding('!!!')).toBeNull();
    });
  });

  describe('the data itself', () => {
    const buildings = Object.values(
      buildingData.buildings as Record<string, { latitude: number; longitude: number; code: string }>,
    );

    it('has every building on the UT campus, right way round', () => {
      // A latitude/longitude swap is the failure this catches: reversed UT
      // coordinates are a valid point in western China, and a map that flies
      // there is far harder to trace than a building that will not resolve.
      for (const b of buildings) {
        expect(Number.isFinite(b.latitude), b.code).toBe(true);
        expect(Number.isFinite(b.longitude), b.code).toBe(true);
        expect(b.latitude, b.code).toBeGreaterThan(30);
        expect(b.latitude, b.code).toBeLessThan(30.6);
        expect(b.longitude, b.code).toBeLessThan(-97);
        expect(b.longitude, b.code).toBeGreaterThan(-98);
      }
    });

    it('never returns a coordinate the map cannot use', () => {
      for (const raw of ['GSB', 'D21', 'SAC', 'UT Tower', 'utc 2.102']) {
        const b = resolveBuilding(raw)!;
        expect(b).not.toBeNull();
        expect(Number.isNaN(b.latitude)).toBe(false);
        expect(Number.isNaN(b.longitude)).toBe(false);
        expect(b.latitude).toBeGreaterThan(0);
        expect(b.longitude).toBeLessThan(0);
      }
    });

    it('gives events at the same building identical coordinates', () => {
      // Which is what lets the map's existing jitter step fan them out.
      const a = resolveBuilding('GSB 2.126')!;
      const b = resolveBuilding('GSB 3.130')!;
      expect(a.latitude).toBe(b.latitude);
      expect(a.longitude).toBe(b.longitude);
    });
  });
});
