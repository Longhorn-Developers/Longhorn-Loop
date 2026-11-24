// The app's type scale, taken from Home. Home was tuned first (tester rounds,
// iOS's text styles), and Explore and Orgs each drifted into their own sizes: a
// 24pt Medium page title on one, 32pt Bold on another; section names at 14, 16 or
// 22; "See all" at 12, 13 or 15. These roles are Home's values, named, so every
// tab reads as one app and a change to one role moves all of them.
//
// Sizes and families only. Colour is still a theme token at the call site
// (`colors.*` or an `lhl*` class), because a style object here can't follow the
// light/dark switch. The colour each role pairs with is noted beside it.
//
// Orange TEXT is `accent`, never `brand`. brand is the button fill and stays
// #BD5500 in dark so white labels on it pass; as text on a dark card that is
// ~3.4:1, below AA (server/test/test_theme_tokens.ts enforces this for the
// lhlBurntOrange class). In light the two are a shade apart (#A84B00 vs
// #9D4B06), so this costs nothing visually. Orange ICONS beside that text
// (the "See all" caret) use brand, as Home does.
//
// Every role names a Roboto Flex family. A bare `fontWeight: '700'` with no
// `fontFamily` renders in the SYSTEM font (SF Pro / Roboto-on-Android), not ours,
// and RN can't pick a weight off a variable font anyway (see CLAUDE.md, Fonts).
// That was the main reason Explore looked "off" next to Home.

import type { TextStyle } from 'react-native';

export const FONT = {
  regular: 'Roboto-Flex',
  medium: 'Roboto-Flex-Medium',
  semibold: 'Roboto-Flex-SemiBold',
  bold: 'Roboto-Flex-Bold',
} as const;

export const TYPE = {
  /** Small caps line above a tab's title ("GOOD MORNING,"). colors.accent, uppercased. */
  pageEyebrow: { fontFamily: FONT.semibold, fontSize: 14, letterSpacing: 0.4 },
  /** A tab's own title (the user's name on Home). colors.ink. */
  pageTitle: { fontFamily: FONT.bold, fontSize: 32, lineHeight: 38 },
  /**
   * The "why this row is here" line above a section ("Because You Picked").
   * colors.accent. 15 is iOS's subheadline; 11 and 13 both read as fine print.
   */
  sectionEyebrow: { fontFamily: FONT.medium, fontSize: 15 },
  /** A section's name, uppercased. colors.ink. 22 is iOS's title-2. */
  sectionTitle: { fontFamily: FONT.bold, fontSize: 22, letterSpacing: 0.3 },
  /** "See all", and other text links in a header row. colors.accent. */
  sectionLink: { fontFamily: FONT.medium, fontSize: 15 },
  /** Name of an event, org or row in a list or card. colors.ink. */
  cardTitle: { fontFamily: FONT.semibold, fontSize: 16 },
  /** Supporting line under a title (date, place, description). colors.inkSecondary. */
  body: { fontFamily: FONT.regular, fontSize: 13 },
  /** Tertiary detail (counts, timestamps). colors.inkMuted. */
  caption: { fontFamily: FONT.regular, fontSize: 12 },
  /** Label on a pill or button ("Follow"). Colour follows the button's fill. */
  button: { fontFamily: FONT.semibold, fontSize: 14 },
} satisfies Record<string, TextStyle>;
