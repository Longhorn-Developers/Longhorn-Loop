// Renders whatever a user actually has set for their avatar, in precedence
// order: an uploaded photo, a customized Bevo, or nothing. Used everywhere an
// avatar is displayed (own profile, public profile, event attendees, Edit
// Profile's current-photo preview) so that precedence logic lives in exactly
// one place.
//
// The legacy six-preset `avatar` integer (LOOP-XXX) is gone — every avatar is
// now either a real photo or a Bevo recipe. `avatar` stays on AvatarFields as
// an unused-but-still-present server column so this type doesn't have to
// diverge from the API response shape.
//
// Deliberately just the graphic, not the circular frame around it — every
// call site's wrapper already differs (size, border ring, stacking margin,
// an initial-letter fallback for attendees) and forcing one component to own
// all of that would need a prop for each variation. Wrap this in whatever
// `overflow-hidden rounded-full` container the call site already uses, the
// same way it wrapped a bare `<Image>` before.

import BevoAvatar from '@/app/components/avatar/BevoAvatar';
import { resolveBackgroundColor, type AvatarConfig } from '@/shared/avatar';
import React from 'react';
import { Image, View } from 'react-native';

export interface AvatarFields {
  avatar?: number | null;
  avatar_config?: AvatarConfig | null;
  profile_photo_url?: string | null;
}

// Matches BEVO_PALETTE_COLORS.beige and the Customize Bevo preview panel —
// the warm tan a rendered Bevo sits on in every Figma frame that shows one.
// Fixed rather than themed: part of the Bevo illustration world, not app UI
// chrome (same reasoning as BevoAvatarBadge's background). Used whenever the
// user hasn't picked a PFP background (background === 'none'), so a bare
// Bevo still sits on Bevo-world chrome instead of a transparent/blank circle.
const BEVO_PREVIEW_BG = '#F2E0BA'; // theme-exempt: fixed Bevo-world preview background

/** True when there's anything to render — lets callers gate their own fallback (e.g. an initial letter). */
export function hasAvatar(user: AvatarFields): boolean {
  return Boolean(user.profile_photo_url || user.avatar_config);
}

/**
 * Fills its parent — size it via the wrapping container, same as the
 * `avatarSource ? <Image style={{width:'100%',height:'100%'}}/> : null`
 * pattern this replaces. `size` is only needed for the Bevo branch, since
 * BevoAvatar takes a pixel height rather than a percentage.
 */
export function AvatarDisplay({ user, size }: { user: AvatarFields; size: number }) {
  if (user.profile_photo_url) {
    return (
      <Image
        source={{ uri: user.profile_photo_url }}
        style={{ width: '100%', height: '100%' }}
        resizeMode="cover"
      />
    );
  }

  if (user.avatar_config) {
    // 'none' (or unset) falls back to the fixed Bevo-world tan rather than a
    // transparent circle — a picked background overrides it.
    const background = resolveBackgroundColor(user.avatar_config) ?? BEVO_PREVIEW_BG;
    return (
      <View
        style={{
          width: size,
          height: size,
          alignItems: 'center',
          overflow: 'hidden',
          backgroundColor: background,
        }}
      >
        {/* BevoAvatar draws a full character (153:206 — taller than wide).
            Oversizing on height and anchoring to the top crops in on the
            head/torso instead of squeezing the whole figure into a circle. */}
        <BevoAvatar config={user.avatar_config} height={size * 1.35} />
      </View>
    );
  }

  return null;
}
