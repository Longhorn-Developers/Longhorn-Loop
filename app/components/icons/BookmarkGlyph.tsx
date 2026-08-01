// The save glyph, in both of its states.
//
// Outline when the event isn't saved, solid accent when it is. The pair
// matters more than the colour does: at 13px a hollow orange bookmark and a
// hollow grey one are the same shape, and on a dark card the difference is
// easy to miss entirely. Filling it changes the silhouette, which reads at a
// glance and still works for anyone who can't separate the two hues.
//
// bookmark-filled.svg is the same path as bookmark.svg with the inner counter
// removed, so the two are guaranteed to sit on the same outline.

import BookmarkFilledIcon from '@/assets/images/bookmark-filled.svg';
import BookmarkIcon from '@/assets/images/bookmark.svg';
import { useThemeColors } from '@/app/lib/themeColors';
import React from 'react';

interface BookmarkGlyphProps {
  saved: boolean;
  width: number;
  height: number;
  /** Colour for the unsaved state. Defaults to secondary text. */
  idleColor?: string;
}

export default function BookmarkGlyph({ saved, width, height, idleColor }: BookmarkGlyphProps) {
  const colors = useThemeColors();
  const Icon = saved ? BookmarkFilledIcon : BookmarkIcon;

  return (
    <Icon
      width={width}
      height={height}
      color={saved ? colors.accent : (idleColor ?? colors.inkSecondary)}
    />
  );
}
