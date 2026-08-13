// Follow button + the Block action attached to it (LOOP-180).
//
// Figma: "Profile Main" frame, public user profile, reviewed 2026-06-08. This
// is what replaces "Edit Profile" when the profile on screen is not yours —
// same position, same pill geometry, so the two variants of the header line up
// pixel for pixel.
//
// Block lives on a menu ATTACHED TO the Follow control rather than as a
// sibling button, which is what the frame shows and is also the safer layout:
// the destructive action is one deliberate tap away from the primary one
// instead of adjacent to it. Orgs pass no `onBlock` and get the button with no
// menu, because blocks are between people — see the header of
// server/src/lib/blocks.ts.
//
// The confirmation modal lives here rather than in the screen so that every
// caller gets it. Blocking is destructive in a way the button does not
// advertise: it silently deletes any follow in BOTH directions, and the server
// then 404s the profile you are standing on. A caller that forgot to confirm
// would ship a one-tap version of that.
//
// State is driven entirely by props. The screens own the mutation so they can
// also own what happens afterwards — a block has to navigate away, because the
// screen behind the modal is about to stop existing.

import React, { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import ProfileModal, { ModalAction } from '@/app/components/modals/ProfileModal';

export interface FollowControlProps {
  isFollowing: boolean;
  /** Disables both controls while a follow/unfollow is in flight. */
  pending?: boolean;
  onToggleFollow: () => void;
  /**
   * Called once the user has confirmed. Omit to hide the menu entirely, which
   * is what the org profile does.
   */
  onBlock?: () => void;
  /** Shown in the confirmation copy: "Block Todd?" reads better than "Block?" */
  displayName?: string;
}

export default function FollowControl({
  isFollowing,
  pending = false,
  onToggleFollow,
  onBlock,
  displayName,
}: FollowControlProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const name = displayName?.trim() || 'this person';

  return (
    <View className="items-center">
      <View className="flex-row items-center gap-[6px]">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isFollowing ? `Unfollow ${name}` : `Follow ${name}`}
          accessibilityState={{ selected: isFollowing, disabled: pending }}
          disabled={pending}
          onPress={onToggleFollow}
          // Filled while unfollowed (it is the primary action on the screen),
          // outline once followed — the same inversion the rest of the app
          // uses for a completed toggle, and it stops "Following" reading as a
          // call to action.
          className={`min-w-[104px] flex-row items-center justify-center gap-[5px] rounded-full px-[18px] py-[6px] ${
            isFollowing
              ? 'border border-lhlMutedBorder bg-lhlSurface'
              : 'border border-lhlBurntOrange bg-lhlBurntOrange'
          } ${pending ? 'opacity-60' : ''}`}
        >
          <Text
            className={`font-['Roboto-Flex'] text-[12px] font-semibold ${
              isFollowing ? 'text-lhlInk' : 'text-white'
            }`}
          >
            {isFollowing ? 'Following' : 'Follow'}
          </Text>
          {pending ? <ActivityIndicator size="small" /> : null}
        </Pressable>

        {onBlock ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="More options"
            accessibilityState={{ expanded: menuOpen }}
            onPress={() => setMenuOpen((v) => !v)}
            hitSlop={8}
            className="h-[30px] w-[30px] items-center justify-center rounded-full border border-lhlMutedBorder bg-lhlSurface"
          >
            {/* Three dots, drawn rather than a "…" glyph so the spacing is the
                same on both platforms — the same reason the profile hamburger
                is three Views. */}
            <View className="flex-row items-center gap-[2px]">
              {[0, 1, 2].map((i) => (
                <View key={i} className="h-[3px] w-[3px] rounded-full bg-lhlInk" />
              ))}
            </View>
          </Pressable>
        ) : null}
      </View>

      {menuOpen && onBlock ? (
        <View className="mt-[6px] overflow-hidden rounded-[10px] border border-lhlMutedBorder bg-lhlSurface">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Block ${name}`}
            onPress={() => {
              setMenuOpen(false);
              setConfirming(true);
            }}
            className="px-[18px] py-[10px]"
          >
            <Text className="font-['Roboto-Flex'] text-[13px] font-medium text-lhlDestructiveRed">
              Block
            </Text>
          </Pressable>
        </View>
      ) : null}

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
                // Optional-called rather than asserted: `confirming` can only
                // be true when the menu that sets it exists, which requires
                // onBlock, but the compiler can't see that and an assertion
                // here would be a lie waiting for someone to add a second way
                // to open this modal.
                onBlock?.();
              }}
            />
          </>
        }
      />
    </View>
  );
}
