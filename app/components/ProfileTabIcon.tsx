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

import { AvatarDisplay, hasAvatar, type AvatarFields } from '@/app/components/profile/AvatarDisplay';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { api } from '@/app/lib/api';
import { user as userKeys } from '@/app/lib/queryKeys';
import TabProfileActiveIcon from '@/assets/images/tab-profile-active.svg';
import TabProfileIcon from '@/assets/images/tab-profile.svg';
import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { View } from 'react-native';

/** Matches the drawn icons' optical size in the bar. */
const AVATAR_SIZE = 30;

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

  return (
    <View
      style={{
        width: AVATAR_SIZE,
        height: AVATAR_SIZE,
        borderRadius: AVATAR_SIZE / 2,
        overflow: 'hidden',
        // The ring is the only thing marking the tab as active once the icon
        // is a photograph: the other tabs switch between a filled and an
        // outlined glyph, and an avatar cannot do that without recolouring
        // someone's face.
        borderWidth: focused ? 2 : 1,
        borderColor: focused ? activeColor : inactiveColor,
      }}
    >
      <AvatarDisplay user={user} size={AVATAR_SIZE} />
    </View>
  );
}
