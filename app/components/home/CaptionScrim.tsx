// The dark fade behind the white title on every image-based Home card (Spotlight
// and the flyer carousels). One component so the cards can't drift apart again:
// each used to draw its own full-height gradient with its own stop.
//
// Bottom 60% only, so the top of the photo — and the date pill and save button
// sitting on it — is left as shot. Three stops (clear → 0.35 → 0.80) rather than
// two: a straight clear-to-0.80 ramp is still faint where the title's first line
// sits and then darkens hard at the edge, which reads as a box. The middle stop
// gets the title zone dark enough to read on a white flyer while the top of the
// scrim stays invisible.
//
// It sits inside the card's `overflow: 'hidden'` container, so it follows the
// rounded corners on both platforms without a radius of its own. pointerEvents
// "none" keeps taps going to the card and the save button.
//
// Tuning: the opacities are SCRIM_MID / SCRIM_DARK in ./overlay; the coverage is
// SCRIM_HEIGHT below.

import { SCRIM_CLEAR, SCRIM_DARK, SCRIM_MID } from '@/app/components/home/overlay';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';

/** How much of the card, from the bottom, the fade covers. */
const SCRIM_HEIGHT = '60%';

export default function CaptionScrim() {
  return (
    <LinearGradient
      colors={[SCRIM_CLEAR, SCRIM_MID, SCRIM_DARK]}
      // 0.45, not 0.5: the title's first line lands a little above the scrim's
      // midpoint on a two-line title, so the mid stop arrives just before it.
      locations={[0, 0.45, 1]}
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: SCRIM_HEIGHT }}
      pointerEvents="none"
    />
  );
}
