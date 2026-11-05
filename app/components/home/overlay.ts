// Colours for text and controls drawn over an event's flyer on Home.
//
// Fixed in both themes on purpose: the flyer underneath is not themed, so a
// themed text colour could land dark-on-dark on a dark photo. Shared by every
// Home card that puts text over an image so they darken and tag the same way.

export const OVERLAY_TEXT = '#FFFFFF'; // theme-exempt: text over a darkened flyer
export const SCRIM_CLEAR = 'rgba(0,0,0,0)'; // theme-exempt
export const SCRIM_DARK = 'rgba(0,0,0,0.78)'; // theme-exempt: bottom of the caption scrim
export const DIM = 'rgba(0,0,0,0.12)'; // theme-exempt: evens out very bright flyers
export const PILL_FILL = 'rgba(70,70,70,0.6)'; // theme-exempt: translucent grey tag
