// Vertical rhythm for Home, in one place so every section moves together.
//
// Tester feedback on the old Home was that it was crowded, and "the most
// important thing is adding space" — more so than the new card shapes. The gap
// between sections used to be 28 and was hardcoded separately in each section
// (the carousels, and again in the Spotlight and Orgs blocks); they all read it
// from here now, so tuning it is one number.
//
// The values are measured off the Figma frame (402pt wide, drawn ~1:1): the last
// card of a section to the next section's eyebrow is ~18–23pt, and a section's
// title to its first card is ~12pt. An earlier pass set 36 from the written
// "add space" instruction alone and came out visibly looser than the design.

/** Space below each section, i.e. between one section's content and the next one's header. */
export const SECTION_GAP = 20;

/** Space between a section's header and its content. */
export const HEADER_GAP = 12;
