/**
 * Keeps the two halves of the theme in step, and holds them to WCAG AA.
 *
 * Colours live in two places by necessity: app/globals.css (CSS variables, for
 * everything styled with a Tailwind class) and app/lib/themeColors.ts (hex,
 * for React Native props like Switch thumbColor and SVG `color`, which cannot
 * read a CSS variable). If those drift, dark mode goes subtly wrong in exactly
 * the places hardest to eyeball — an icon that stays near-black on a dark card.
 *
 * The contrast half matters because the palette was chosen by measurement, not
 * by eye. Anyone tweaking a value should see it fail here rather than ship a
 * combination nobody can read.
 *
 * Lives in the server suite only because that's where vitest is configured;
 * it reads the app's files directly and touches nothing server-side.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const APP = join(__dirname, '..', '..', 'app');

/** Parse `--lhl-x: R G B;` out of a :root / .dark block. */
function cssVars(block: 'root' | 'dark'): Record<string, string> {
  const css = readFileSync(join(APP, 'globals.css'), 'utf-8');
  const re = block === 'root' ? /:root\s*\{([^}]*)\}/ : /\.dark\s*\{([^}]*)\}/;
  const body = re.exec(css)?.[1];
  if (!body) throw new Error(`no ${block} block in globals.css`);

  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--lhl-([\w-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) {
    const [, name, r, g, b] = m;
    out[name] =
      `#${[r, g, b].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  }
  return out;
}

/** Parse a LIGHT_COLORS / DARK_COLORS object out of themeColors.ts. */
function tsColors(which: 'LIGHT' | 'DARK'): Record<string, string> {
  const src = readFileSync(join(APP, 'lib', 'themeColors.ts'), 'utf-8');
  const body = new RegExp(`${which}_COLORS: ThemeColors = \\{([^}]*)\\}`).exec(src)?.[1];
  if (!body) throw new Error(`no ${which}_COLORS in themeColors.ts`);

  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(\w+):\s*'(#[0-9A-Fa-f]{6})'/g)) {
    out[m[1]] = m[2].toUpperCase();
  }
  return out;
}

/** CSS variable name -> themeColors.ts key. */
const PAIRS: [string, string][] = [
  ['background', 'background'],
  ['surface', 'surface'],
  ['surface-muted', 'surfaceMuted'],
  ['ink', 'ink'],
  ['ink-secondary', 'inkSecondary'],
  ['border', 'border'],
  ['placeholder', 'placeholder'],
  ['brand', 'brand'],
  ['accent', 'accent'],
  ['destructive', 'destructive'],
];

function srgb(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
}
function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe('theme tokens stay in sync', () => {
  for (const [block, which] of [
    ['root', 'LIGHT'],
    ['dark', 'DARK'],
  ] as const) {
    describe(`${which}`, () => {
      const css = cssVars(block);
      const ts = tsColors(which);

      for (const [cssName, tsName] of PAIRS) {
        it(`--lhl-${cssName} matches themeColors.${tsName}`, () => {
          expect(css[cssName]).toBeDefined();
          expect(ts[tsName]).toBeDefined();
          expect(ts[tsName]).toBe(css[cssName]);
        });
      }
    });
  }
});

describe('theme meets WCAG AA', () => {
  for (const which of ['LIGHT', 'DARK'] as const) {
    const c = tsColors(which);

    describe(which, () => {
      // Body text.
      it('primary text on the page clears 4.5:1', () => {
        expect(contrast(c.ink, c.background)).toBeGreaterThanOrEqual(4.5);
      });
      it('primary text on a card clears 4.5:1', () => {
        expect(contrast(c.ink, c.surface)).toBeGreaterThanOrEqual(4.5);
      });
      it('secondary text on the page clears 4.5:1', () => {
        expect(contrast(c.inkSecondary, c.background)).toBeGreaterThanOrEqual(4.5);
      });
      it('secondary text on a card clears 4.5:1', () => {
        expect(contrast(c.inkSecondary, c.surface)).toBeGreaterThanOrEqual(4.5);
      });

      // Accent is the link/"Edit" colour and is deliberately NOT the button
      // colour — it has to be readable as text on both the page and a card.
      it('accent text clears 4.5:1 on page and card', () => {
        expect(contrast(c.accent, c.background)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(c.accent, c.surface)).toBeGreaterThanOrEqual(4.5);
      });

      it('destructive text clears 4.5:1 on page and card', () => {
        expect(contrast(c.destructive, c.background)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(c.destructive, c.surface)).toBeGreaterThanOrEqual(4.5);
      });

      // White sits on filled brand buttons in both themes, which is why brand
      // can't lighten for dark the way accent does.
      it('white on a filled brand button clears 4.5:1', () => {
        expect(contrast('#FFFFFF', c.brand)).toBeGreaterThanOrEqual(4.5);
      });

      it('a brand button is distinguishable from the page', () => {
        expect(contrast(c.brand, c.background)).toBeGreaterThanOrEqual(3);
      });

      it('borders stay visible against a card', () => {
        // The light theme's existing border sits at 2.11:1; hold dark to the
        // same bar rather than quietly restyling light.
        expect(contrast(c.border, c.surface)).toBeGreaterThanOrEqual(2);
      });

      it('a card is distinguishable from the page', () => {
        expect(contrast(c.surface, c.background)).toBeGreaterThan(1.02);
      });
    });
  }
});
