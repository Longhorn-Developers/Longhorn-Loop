// The Profile tab's icon: your own avatar, not a generic silhouette.
//
// Every other tab is an abstraction -- a house, a compass, a plus -- and a
// silhouette was the odd one out, because the thing behind it is not "a
// profile", it is YOURS. A tab bar showing your face is also how you tell at a
// glance which account the app is in, which matters more now that logging out
// and back in is a flow people actually use.
//
// SHARES THE PROFILE SCREEN'S QUERY, deliberately. Same key, so there is one
// fetch between the two and the tab updates the moment you change your picture
// on the screen it links to -- react-query hands both the same cache entry, so
// no invalidation or prop-drilling is involved.
//
// Falls back to the drawn icon whenever there is nothing to show: still
// loading, signed out, or an account with no avatar chosen. The fallback is
// the SAME asset the other tabs use, so a fresh account still gets a coherent
// bar rather than a gap.
//
// THE WORD "Profile" IS PART OF THE ARTWORK, not a tab bar label. Every tab
// SVG is a 42-wide artboard holding both the glyph (y 0..18) and its word
// (y ~26..35) -- which is why `tabBarShowLabel` is false and the tint prop
// colours both at once. Swapping the whole 42x38 asset for an avatar
// therefore took the word with it, and Profile was the only unlabelled tab.
// tab-profile-label.svg is that same word on the same artboard with the head
// glyph removed, so laying it under the avatar puts the text back on the
// exact baseline the other three sit on -- no font guessing, no drift if the
// artwork is ever redrawn.

import { AvatarDisplay, hasAvatar, type AvatarFields } from '@/app/components/profile/AvatarDisplay';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { api } from '@/app/lib/api';
import { user as userKeys } from '@/app/lib/queryKeys';
import TabProfileActiveIcon from '@/assets/images/tab-profile-active.svg';
import TabProfileLabel from '@/assets/images/tab-profile-label.svg';
import TabProfileIcon from '@/assets/images/tab-profile.svg';
import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { View } from 'react-native';

/** The tab artboard every icon is drawn on. */
const ART_WIDTH = 42;
const ART_HEIGHT = 38;

/**
 * The glyph zone on that artboard: every drawn tab icon sits in y 0..18,
 * horizontally centred, with its word underneath from y ~26. The avatar has to
 * live in the same band or the label lands lower than the other three.
 *
 * 22 rather than the glyphs' 18: a filled circle reads optically smaller than
 * an open outline, so matching the box exactly would make the avatar look like
 * the runt of the bar. It still clears the word by ~6 units.
 */
const AVATAR_SIZE = 22;
const GLYPH_CENTER_Y = 9;

interface MeResponse {
  user: AvatarFields;
}

export default function ProfileTabIcon({
  focused,
  activeColor,
  inactiveColor,
}: {
  focused: boolean;
  activeColor: string;
  inactiveColor: string;
}) {
  const { data: onboarding } = useOnboarding();
  const token = onboarding.token || null;

  const me = useQuery({
    queryKey: userKeys.me(),
    queryFn: () => api.get<MeResponse>('/users/me', { token }),
    enabled: !!token,
  });

  const user = me.data?.user;

  if (!user || !hasAvatar(user)) {
    return focused ? (
      <TabProfileActiveIcon width={42} height={38} color={activeColor} />
    ) : (
      <TabProfileIcon width={42} height={38} color={inactiveColor} />
    );
  }

  const tint = focused ? activeColor : inactiveColor;

  return (
    <View style={{ width: ART_WIDTH, height: ART_HEIGHT }}>
      {/* Absolute, at full artboard size, so the word keeps the y position it
          has in the original asset instead of being placed by hand. */}
      <TabProfileLabel
        width={ART_WIDTH}
        height={ART_HEIGHT}
        color={tint}
        style={{ position: 'absolute', left: 0, top: 0 }}
      />
      <View
        style={{
          position: 'absolute',
          left: (ART_WIDTH - AVATAR_SIZE) / 2,
          top: GLYPH_CENTER_Y - AVATAR_SIZE / 2,
          width: AVATAR_SIZE,
          height: AVATAR_SIZE,
          borderRadius: AVATAR_SIZE / 2,
          overflow: 'hidden',
          // The ring is the only thing marking the tab as active once the icon
          // is a photograph: the other tabs switch between a filled and an
          // outlined glyph, and an avatar cannot do that without recolouring
          // someone's face.
          borderWidth: focused ? 2 : 1,
          borderColor: tint,
        }}
      >
        <AvatarDisplay user={user} size={AVATAR_SIZE} />
      </View>
    </View>
  );
}
