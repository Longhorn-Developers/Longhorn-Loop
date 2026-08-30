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
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const APP = join(__dirname, '..', '..', 'app');

/** Parse `--lhl-x: R G B;` out of a :root / .dark:root block. */
function cssVars(block: 'root' | 'dark'): Record<string, string> {
  const css = readFileSync(join(APP, 'globals.css'), 'utf-8');
  const re = block === 'root' ? /(?<!\.dark):root\s*\{([^}]*)\}/ : /\.dark:root\s*\{([^}]*)\}/;
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

describe('theme selector works on native', () => {
  it("defines dark variables on NativeWind's virtual root", () => {
    const css = readFileSync(join(APP, 'globals.css'), 'utf-8');
    expect(css).toMatch(/\.dark:root\s*\{/);
  });
});

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
  ['ink-muted', 'inkMuted'],
  ['border', 'border'],
  ['divider', 'divider'],
  ['placeholder', 'placeholder'],
  ['brand', 'brand'],
  ['accent', 'accent'],
  ['brand-soft', 'brandSoft'],
  ['destructive', 'destructive'],
  ['destructive-fill', 'destructiveFill'],
  ['destructive-soft', 'destructiveSoft'],
  ['info', 'info'],
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

      // The reason destructiveFill exists as its own token. `destructive`
      // lightens for dark so it reads as TEXT; white on that lightened red is
      // 2.79:1. This is the button fill, so it stays dark enough for a white
      // label — on "Yes, Delete" and "Yes, cancel RSVP".
      it('white on a filled destructive button clears 4.5:1', () => {
        expect(contrast('#FFFFFF', c.destructiveFill)).toBeGreaterThanOrEqual(4.5);
      });

      it('a destructive button is distinguishable from the page', () => {
        expect(contrast(c.destructiveFill, c.background)).toBeGreaterThanOrEqual(3);
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

      it('an inset fill is distinguishable from a card', () => {
        expect(contrast(c.surfaceMuted, c.surface)).toBeGreaterThan(1.02);
      });

      // brandSoft is the selected-card / saved fill. Primary text sits on it,
      // and it has to read as a tint rather than as another plain card.
      it('primary text on a selected card clears 4.5:1', () => {
        expect(contrast(c.ink, c.brandSoft)).toBeGreaterThanOrEqual(4.5);
      });
      it('a selected card is distinguishable from a plain one', () => {
        expect(contrast(c.brandSoft, c.surface)).toBeGreaterThan(1.02);
      });

      it('a divider is visible against the page', () => {
        expect(contrast(c.divider, c.background)).toBeGreaterThan(1.2);
      });

      it('destructive text on its own tint clears 4.5:1', () => {
        expect(contrast(c.destructive, c.destructiveSoft)).toBeGreaterThanOrEqual(4.5);
      });
      it('an error tint is distinguishable from a card', () => {
        expect(contrast(c.destructiveSoft, c.surface)).toBeGreaterThan(1.02);
      });
    });
  }
});

// Tertiary text is held to a lower bar than body text on purpose. It was
// already at 2.8:1 in the light theme before any of this existed, so pinning
// it to 4.5 would mean restyling the light app under cover of adding dark
// mode. What the dark theme must not do is come out WORSE than light — that
// would be the regression the screenshots were about.
describe('tertiary text', () => {
  const light = tsColors('LIGHT');
  const dark = tsColors('DARK');

  it('dark is at least as legible as light on the page', () => {
    expect(contrast(dark.inkMuted, dark.background)).toBeGreaterThanOrEqual(
      contrast(light.inkMuted, light.background),
    );
  });

  it('dark clears 4.5:1 on page and card', () => {
    expect(contrast(dark.inkMuted, dark.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark.inkMuted, dark.surface)).toBeGreaterThanOrEqual(4.5);
  });
});

// Same reasoning for the "Going" badge blue, which was already only 3.25:1 on
// the light page. Dark must not be worse.
describe('the info blue', () => {
  const light = tsColors('LIGHT');
  const dark = tsColors('DARK');

  it('dark is at least as legible as light', () => {
    expect(contrast(dark.info, dark.background)).toBeGreaterThanOrEqual(
      contrast(light.info, light.background),
    );
    expect(contrast(dark.info, dark.surface)).toBeGreaterThanOrEqual(
      contrast(light.info, light.surface),
    );
  });
});

// The five screenshots that prompted this were all the same failure: a colour
// written as a literal instead of a token, so it stayed light when everything
// around it went dark. Grep is the only thing that actually prevents that
// recurring — a type checker sees a valid string, and a test that renders one
// screen won't visit the other forty.
describe('no hardcoded colours outside the palette', () => {
  const SRC = join(__dirname, '..', '..', 'app');

  /** Files allowed to name a colour directly, and why. */
  const ALLOWED = new Set([
    // The palette itself.
    'lib/themeColors.ts',
    // Splash renders before the provider tree exists, so it cannot read a theme.
    'components/SplashScreen.tsx',
    // Web-only map fallback; styled by the browser, not by NativeWind.
    'components/MapViewWrapper.web.tsx',
  ]);

  /**
   * Literals that are colour-shaped but theme-neutral:
   *   #FFFFFF / #FFF — white text ON a filled brand button, which is white in
   *     both themes. Backgrounds were the bug; foregrounds on brand were not.
   *   #000 — shadowColor, which iOS composites against the backdrop rather
   *     than painting; a shadow is dark in both themes.
   *   transparent — self-evidently fine.
   */
  const NEUTRAL = /^(#fff{1,3}|#ffffff|#000|#000000|transparent)$/i;

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(p));
      else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
    return out;
  }

  it('every screen and component uses tokens', () => {
    const offenders: string[] = [];

    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).split(sep).join('/');
      if (ALLOWED.has(rel)) continue;

      const src = readFileSync(file, 'utf-8');
      src.split('\n').forEach((line, i) => {
        // Skip comments — several explain which token replaced which hex.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        // A deliberate exception, annotated at the point of use so the reason
        // travels with the line rather than living in a list over here.
        if (/theme-exempt:/.test(line)) return;
        for (const m of line.matchAll(/#[0-9A-Fa-f]{3,8}\b/g)) {
          if (NEUTRAL.test(m[0])) continue;
          offenders.push(`${rel}:${i + 1}  ${m[0]}  ${line.trim().slice(0, 70)}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});

// `lhlGrey` shipped in EventCard for months: NativeWind silently emits nothing
// for a class it can't resolve, so the flagship feed card drew React Native's
// default black hairline instead of a border — and nothing failed. A typo in a
// class name has no compiler and no runtime error, only this.
describe('every lhl* class exists in the Tailwind config', () => {
  const SRC = join(__dirname, '..', '..', 'app');

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(p));
      else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
    return out;
  }

  const defined = new Set(
    [
      ...readFileSync(join(__dirname, '..', '..', 'tailwind.config.js'), 'utf-8').matchAll(
        /^\s*(lhl\w+):/gm,
      ),
    ].map((m) => m[1]),
  );

  const UTILITY = String.raw`bg|text|border|fill|stroke|shadow|from|to|via|placeholder|decoration|ring|divide|caret|accent|outline`;

  it('resolves', () => {
    const unknown: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).split(sep).join('/');
      readFileSync(file, 'utf-8')
        .split('\n')
        .forEach((line, i) => {
          for (const m of line.matchAll(new RegExp(String.raw`\b(?:${UTILITY})-(lhl\w+)`, 'g'))) {
            if (!defined.has(m[1])) unknown.push(`${rel}:${i + 1}  ${m[1]}`);
          }
        });
    }
    expect(unknown).toEqual([]);
  });

  // brand is #BD5500 in BOTH themes because white button labels sit on it.
  // As text on a dark card that is 3.4:1 — below AA. accent exists for this.
  it('never uses the button colour as text', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).split(sep).join('/');
      readFileSync(file, 'utf-8')
        .split('\n')
        .forEach((line, i) => {
          if (/text-lhlBurntOrange/.test(line)) offenders.push(`${rel}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});

// An SVG that hardcodes its own fill ignores the `color` prop entirely, so a
// call site can look correct and still paint a near-black icon on a dark card.
// calendar.svg was the reverse — a white glyph invisible in LIGHT mode — and
// nobody noticed, because the prop next to it looked like it was working.
describe('monochrome icons take their colour from the caller', () => {
  const ASSETS = join(__dirname, '..', '..', 'assets', 'images');

  /** Colours an icon may hardcode without breaking either theme. */
  const OK = /^(none|currentColor|white|#fff|#ffffff)$/i;

  it('no icon hardcodes a near-black fill', () => {
    const offenders: string[] = [];

    for (const name of readdirSync(ASSETS)) {
      if (!name.endsWith('.svg')) continue;
      // <mask> uses fill="white"/"black" as a stencil, not as paint.
      const src = readFileSync(join(ASSETS, name), 'utf-8').replace(/<mask[\s\S]*?<\/mask>/g, '');

      for (const m of src.matchAll(/(?:fill|stroke)="([^"]+)"/g)) {
        const v = m[1];
        if (OK.test(v)) continue;
        if (/^black$/i.test(v)) {
          offenders.push(`${name}  ${v}`);
          continue;
        }
        // Only near-neutral darks. A saturated brand orange or a warning red
        // is legible on either theme and is meant to be that colour; a dark
        // GREY is a monochrome glyph that was supposed to invert.
        if (!v.startsWith('#')) continue;
        const hex = v.length === 4 ? expand(v) : v.slice(0, 7);
        if (chroma(hex) < 40 && luminance(hex) < 0.2) offenders.push(`${name}  ${v}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  /** Distance from grey. Near-zero means the colour carries no hue. */
  function chroma(hex: string): number {
    const h = hex.replace('#', '');
    const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return Math.max(...v) - Math.min(...v);
  }

  function expand(short: string): string {
    const h = short.replace('#', '');
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  }
});
