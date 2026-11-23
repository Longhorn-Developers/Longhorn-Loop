// The bottom-nav "Orgs" item (LOOP-330).
//
// The other four tab icons are single SVG assets with their word baked in as
// outlined paths (tab-explore.svg and friends). This one composes a glyph with
// real text instead: the word has no outlined export in the repo, and
// hand-tracing "Orgs" into a path would be the one icon nobody can edit. The
// glyph is drawn in the same y 0..18 band and the word is placed where the
// others' words sit (~y 24..37 of the 42x38 artboard), so the five line up.

import { OrgsTabGlyph } from '@/assets/icons/LhlOrgsIcons';
import React from 'react';
import { Text, View } from 'react-native';

const ART_WIDTH = 42;
const ART_HEIGHT = 38;

export default function OrgsTabIcon({ focused, color }: { focused: boolean; color: string }) {
  return (
    <View style={{ width: ART_WIDTH, height: ART_HEIGHT, alignItems: 'center' }}>
      <OrgsTabGlyph filled={focused} color={color} />
      <Text
        allowFontScaling={false}
        // allowFontScaling off: the baked-in words on the other four icons
        // don't scale with Dynamic Type either, and one word growing while its
        // neighbours stay put would read as a layout bug.
        className="font-roboto"
        style={{ position: 'absolute', top: 23, fontSize: 12, lineHeight: 14, color }}
      >
        Orgs
      </Text>
    </View>
  );
}
