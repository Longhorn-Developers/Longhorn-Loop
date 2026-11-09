// Follow button + Block, for a profile that isn't yours (LOOP-180, restyled
// for LOOP-312).
//
// Figma: "Profile - Public User View" V4. This is what replaces "Edit Profile"
// when the profile on screen is not yours -- same slot, same 36pt height and
// 8pt radius, so the variants of the header line up.
//
// BLOCK MOVED OUT OF THE "..." MENU. LOOP-180 hid Block behind a menu on the
// Follow control so the destructive action was not adjacent to the primary
// one. V4 draws it as its own tinted pill at the end of the row, and the
// guarantee that mattered is kept a different way: Block still only opens the
// confirmation below, so it is never one tap from done. It also sits after
// the social icons rather than next to Follow, so the two are not neighbours.
// Orgs render no BlockButton, because blocks are between people -- see
// server/src/lib/blocks.ts.
//
// The confirmation modal lives here rather than in the screen so that every
// caller gets it. Blocking is destructive in a way the button does not
// advertise: it silently deletes any follow in BOTH directions, and the server
// then 404s the profile you are standing on.
//
// State is driven entirely by props. The screens own the mutation so they can
// also own what happens afterwards -- a block has to navigate away, because the
// screen behind the modal is about to stop existing.

import React, { useState } from 'react';
import { ActivityIndicator, Pressable, Text } from 'react-native';

import ProfileModal, { ModalAction } from '@/app/components/modals/ProfileModal';
import { hitSlopFor } from '@/app/lib/tapTarget';
import { useThemeColors } from '@/app/lib/themeColors';

/** Figma: every control in the identity row is 36 tall. */
export const PROFILE_ACTION_HEIGHT = 36;

export interface FollowButtonProps {
  isFollowing: boolean;
  /** Disables the button while a follow/unfollow is in flight. */
  pending?: boolean;
  onToggleFollow: () => void;
  displayName?: string;
}

export function FollowButton({
  isFollowing,
  pending = false,
  onToggleFollow,
  displayName,
}: FollowButtonProps) {
  const colors = useThemeColors();
  const name = displayName?.trim() || 'this account';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isFollowing ? `Unfollow ${name}` : `Follow ${name}`}
      accessibilityState={{ selected: isFollowing, disabled: pending }}
      disabled={pending}
      onPress={onToggleFollow}
      hitSlop={hitSlopFor(PROFILE_ACTION_HEIGHT)}
      // Filled while unfollowed (it is the primary action on the screen),
      // outline once followed -- the same inversion the rest of the app uses
      // for a completed toggle, and it stops "Following" reading as a call to
      // action.
      className={`w-[148px] flex-row items-center justify-center gap-[6px] rounded-[8px] border ${
        isFollowing
          ? 'border-lhlBorderSoft bg-lhlSurface'
          : 'border-lhlBurntOrange bg-lhlBurntOrange'
      } ${pending ? 'opacity-60' : ''}`}
      style={{ height: PROFILE_ACTION_HEIGHT }}
    >
      <Text
        className={`font-roboto-medium text-[14px] ${isFollowing ? 'text-lhlInk' : 'text-white'}`}
      >
        {isFollowing ? 'Following' : 'Follow'}
      </Text>
      {pending ? (
        <ActivityIndicator size="small" color={isFollowing ? colors.ink : colors.surface} />
      ) : null}
    </Pressable>
  );
}

export interface BlockButtonProps {
  /** Called once the user has confirmed. */
  onBlock: () => void;
  pending?: boolean;
  /** Shown in the confirmation copy: "Block Todd?" reads better than "Block?" */
  displayName?: string;
}

export function BlockButton({ onBlock, pending = false, displayName }: BlockButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const name = displayName?.trim() || 'this person';

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Block ${name}`}
        accessibilityState={{ disabled: pending }}
        disabled={pending}
        onPress={() => setConfirming(true)}
        hitSlop={hitSlopFor(PROFILE_ACTION_HEIGHT)}
        className={`items-center justify-center rounded-[8px] bg-lhlDestructiveSoft px-[14px] ${
          pending ? 'opacity-60' : ''
        }`}
        style={{ height: PROFILE_ACTION_HEIGHT }}
      >
        <Text className="font-roboto-medium text-[14px] text-lhlDestructiveRed">Block</Text>
      </Pressable>

      <ProfileModal
        visible={confirming}
        title={`Block ${name}?`}
        // States the two consequences that are not obvious from the word
        // "block": it is mutual, and it throws away the follows rather than
        // pausing them.
        body={`You won’t see each other’s profiles or events, and you’ll both stop following each other.`}
        onDismiss={() => setConfirming(false)}
        actions={
          <>
            <ModalAction label="Cancel" variant="outline" onPress={() => setConfirming(false)} />
            <ModalAction
              label="Block"
              variant="destructive"
              onPress={() => {
                setConfirming(false);
                onBlock();
              }}
            />
          </>
        }
      />
    </>
  );
}
