// UI-facing view of the social-platform registry (LOOP-181).
//
// The DATA (ids, labels, accepted hosts, placeholders) lives in the
// framework-neutral shared module (shared/socialPlatforms.ts) so the Worker can
// validate submitted URLs with the exact same rules. This file only decorates
// each platform with its icon, mirroring how app/lib/interestCategories.ts
// decorates shared/taxonomy.ts.
//
// To add a platform, edit shared/socialPlatforms.ts and add an icon below.

import {
  DiscordIcon,
  GenericLinkIcon,
  InstagramIcon,
  LinkedInIcon,
  LinktreeIcon,
  SlackIcon,
  type SocialIconProps,
} from '@/assets/icons/social/SocialIcons';
import {
  SOCIAL_PLATFORMS,
  type SocialPlatform,
  type SocialPlatformId,
} from '@/shared/socialPlatforms';
import React from 'react';

export {
  MAX_LINKED_SOCIALS,
  getSocialPlatform,
  isSocialPlatformId,
  validateSocialUrl,
} from '@/shared/socialPlatforms';
export type { SocialPlatform, SocialPlatformId } from '@/shared/socialPlatforms';

const PLATFORM_ICONS: Record<SocialPlatformId, React.FC<SocialIconProps>> = {
  linkedin: LinkedInIcon,
  instagram: InstagramIcon,
  linktree: LinktreeIcon,
  discord: DiscordIcon,
  slack: SlackIcon,
  link: GenericLinkIcon,
};

export type DecoratedSocialPlatform = SocialPlatform & {
  icon: React.FC<SocialIconProps>;
};

export const SOCIAL_PLATFORMS_UI: DecoratedSocialPlatform[] = SOCIAL_PLATFORMS.map((platform) => ({
  ...platform,
  icon: PLATFORM_ICONS[platform.id],
}));

const UI_BY_ID = new Map(SOCIAL_PLATFORMS_UI.map((p) => [p.id, p]));

export function getSocialPlatformUI(id: string): DecoratedSocialPlatform | undefined {
  return UI_BY_ID.get(id as SocialPlatformId);
}

/** A social the user has actually connected, as returned by the API. */
export interface LinkedSocial {
  platform: SocialPlatformId;
  url: string;
}
