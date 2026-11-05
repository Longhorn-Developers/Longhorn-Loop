// Inline feedback under an RSVP link input (LOOP-282).
//
// A tester only learned their RSVP link was wrong after the event was live --
// the field took anything, and a scheme-less paste was either refused on Post
// or stored and then never opened. This says what will happen while they type:
// either the exact address the button will open (so a silent "https://" being
// added is visible, not magic), or why it isn't a link.
//
// Shared by the Create Event wizard and the Edit Event overlay so both read
// the same rule -- shared/externalUrl.ts, which the server's validator and the
// event page's open guard also use.

import { checkExternalUrlInput } from '@/shared/externalUrl';
import React from 'react';
import { Text } from 'react-native';

export default function UrlInputHint({ value }: { value: string }) {
  const result = checkExternalUrlInput(value);

  // Nothing typed is a valid answer (the field is optional), so say nothing.
  if (result.kind === 'empty') return null;

  if (result.kind === 'invalid') {
    return (
      <Text
        accessibilityLiveRegion="polite"
        className="mt-[6px] font-roboto text-[12px] text-lhlDestructiveRed"
      >
        {result.reason}
      </Text>
    );
  }

  // Only worth a line when normalisation changed something; echoing back
  // exactly what they typed is noise.
  if (result.url === value.trim()) return null;

  return (
    <Text numberOfLines={1} className="mt-[6px] font-roboto text-[12px] text-lhlSecondaryTextGrey">
      Will open {result.url}
    </Text>
  );
}
