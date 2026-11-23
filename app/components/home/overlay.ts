// Colours for text and controls drawn over an event's flyer on Home.
//
// Fixed in both themes on purpose: the flyer underneath is not themed, so a
// themed text colour could land dark-on-dark on a dark photo. Shared by every
// Home card that puts text over an image so they darken and tag the same way.

export const OVERLAY_TEXT = '#FFFFFF'; // theme-exempt: text over a darkened flyer
export const SCRIM_CLEAR = 'rgba(0,0,0,0)'; // theme-exempt
// The caption scrim's three stops (see CaptionScrim.tsx). These are the knobs
// for readability: raise SCRIM_DARK for titles on very bright flyers, lower it
// if the bottom of the photo goes too murky. SCRIM_MID shapes the fade; keep it
// well under SCRIM_DARK or the scrim reads as a dark box with a soft top edge.
export const SCRIM_DARK = 'rgba(0,0,0,0.80)'; // theme-exempt: bottom of the caption scrim
export const SCRIM_MID = 'rgba(0,0,0,0.35)'; // theme-exempt: midpoint of the caption scrim
export const DIM = 'rgba(0,0,0,0.12)'; // theme-exempt: evens out very bright flyers
export const PILL_FILL = 'rgba(70,70,70,0.6)'; // theme-exempt: translucent grey tag
