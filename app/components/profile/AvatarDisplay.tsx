// Renders whatever a user actually has set for their avatar, in precedence
// order: an uploaded photo, a customized Bevo, the legacy 6-preset avatar, or
// nothing. Used everywhere an avatar is displayed (own profile, public
// profile, event attendees, Edit Profile's current-photo preview) so that
// precedence logic lives in exactly one place.
//
// Deliberately just the graphic, not the circular frame around it — every
// call site's wrapper already differs (size, border ring, stacking margin,
// an initial-letter fallback for attendees) and forcing one component to own
// all of that would need a prop for each variation. Wrap this in whatever
// `overflow-hidden rounded-full` container the call site already uses, the
// same way it wrapped a bare `<Image>` before.

import BevoAvatar from '@/app/components/avatar/BevoAvatar';
import { getAvatarSource } from '@/app/components/profile/AvatarPickerModal';
import type { AvatarConfig } from '@/shared/avatar';
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
// chrome (same reasoning as BevoAvatarBadge's background).
const BEVO_PREVIEW_BG = '#F2E0BA'; // theme-exempt: fixed Bevo-world preview background

/** True when there's anything to render — lets callers gate their own fallback (e.g. an initial letter). */
export function hasAvatar(user: AvatarFields): boolean {
  return Boolean(user.profile_photo_url || user.avatar_config || getAvatarSource(user.avatar));
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
    return (
      <View
        style={{
          width: size,
          height: size,
          alignItems: 'center',
          overflow: 'hidden',
          backgroundColor: BEVO_PREVIEW_BG,
        }}
      >
        {/* BevoAvatar draws a full character (153:206 — taller than wide).
            Oversizing on height and anchoring to the top crops in on the
            head/torso instead of squeezing the whole figure into a circle. */}
        <BevoAvatar config={user.avatar_config} height={size * 1.35} />
      </View>
    );
  }

  const legacySource = getAvatarSource(user.avatar);
  if (legacySource) {
    return (
      <Image source={legacySource} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
    );
  }

  return null;
}
