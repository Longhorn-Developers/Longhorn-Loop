// Edit Org Profile — Org Management console header (LOOP-261).
//
// `organizations.bio` shipped with migration 0016 for the public org profile
// (LOOP-180), and until now nothing wrote it. The schema comment said so
// outright: "nothing writes it yet -- the org console has no edit-profile
// screen -- so this is the read side only." This is that screen.
//
// SCOPE is one field on purpose. Name, category, and profile picture are all
// writable in principle, but each carries a question this ticket does not
// answer: the name is what org search matches on and what the HornsLink scrape
// upserts against, the category is a fixed vocabulary shared with registration,
// and a picture means an R2 upload path that PATCH /orgs/:orgId (JSON only)
// does not have. A bio has no such entanglement, and it is the field LOOP-257
// is waiting on.
//
// The counter and the cap come from shared/bio.ts — the same module the user
// Edit Profile screen uses — so an org bio and a user bio cannot end up with
// two different limits.

import { api } from '@/app/lib/api';
import { org as orgKeys } from '@/app/lib/queryKeys';
import { useThemeColors } from '@/app/lib/themeColors';
import { BIO_WARN_REMAINING, MAX_BIO, normalizeBio } from '@/shared/bio';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

export interface EditOrgProfileModalProps {
  visible: boolean;
  orgId: number;
  token: string | null;
  /** Current stored bio, used to seed the field and to detect "no change". */
  bio: string | null;
  onClose: () => void;
}

export default function EditOrgProfileModal({
  visible,
  orgId,
  token,
  bio,
  onClose,
}: EditOrgProfileModalProps) {
  const colors = useThemeColors();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(bio ?? '');
  const [error, setError] = useState<string | null>(null);

  // Reseed each time the sheet opens rather than once on mount: the modal stays
  // mounted between opens, so without this a cancelled edit would still be
  // sitting in the field the next time it appears.
  useEffect(() => {
    if (visible) {
      setDraft(bio ?? '');
      setError(null);
    }
  }, [visible, bio]);

  // Compare normalized, not raw. Adding a trailing space is not an edit, and
  // firing a PATCH for it would invalidate the console's queries for nothing.
  const isDirty = normalizeBio(draft) !== normalizeBio(bio);

  const save = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error('AUTH_REQUIRED');
      return api.patch(`/orgs/${orgId}`, { token, body: { bio: normalizeBio(draft) } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orgKeys.detail(orgId) });
      // The public profile renders the same column, so it is stale now too.
      queryClient.invalidateQueries({ queryKey: orgKeys.publicProfile(orgId) });
      onClose();
    },
    onError: () => {
      setError('Could not save. Check your connection and try again.');
    },
  });

  const remaining = MAX_BIO - draft.length;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: colors.scrim }}>
        <View className="max-h-[80%] rounded-t-[16px] bg-lhlBackgroundColor px-[20px] pb-[28px] pt-[18px]">
          <View className="flex-row items-center justify-between">
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
              <Text className="font-['Roboto-Flex'] text-[14px] text-lhlSecondaryTextGrey">
                Cancel
              </Text>
            </Pressable>

            <Text className="font-['Roboto-Flex'] text-[15px] font-semibold text-lhlInk">
              Edit Profile
            </Text>

            <Pressable
              onPress={() => save.mutate()}
              disabled={!isDirty || save.isPending}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityState={{ disabled: !isDirty || save.isPending }}
            >
              {save.isPending ? (
                <ActivityIndicator color={colors.brand} />
              ) : (
                <Text
                  className="font-['Roboto-Flex'] text-[14px] font-semibold"
                  style={{ color: isDirty ? colors.brand : colors.inkMuted }}
                >
                  Save
                </Text>
              )}
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" className="mt-[18px]">
            <Text className="font-['Roboto-Flex'] text-[13px] font-semibold text-lhlInk">
              Description
            </Text>
            <Text className="font-['Roboto-Flex'] mt-[2px] text-[11px] text-lhlSecondaryTextGrey">
              Shown on your public org page and in search results.
            </Text>

            <View className="mt-[8px] rounded-[8px] border border-lhlMutedBorder bg-lhlSurface px-[12px] py-[10px]">
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={'What is your org about?\nLine breaks are kept.'}
                placeholderTextColor={colors.inkSecondary}
                multiline
                maxLength={MAX_BIO}
                accessibilityLabel="Organization description"
                className="font-['Roboto-Flex'] min-h-[80px] text-[13px] text-lhlInk"
                style={{ textAlignVertical: 'top' }}
              />
              <Text
                className="font-['Roboto-Flex'] text-right text-[10px]"
                style={{
                  color: remaining <= BIO_WARN_REMAINING ? colors.destructive : colors.inkSecondary,
                }}
              >
                {draft.length} / {MAX_BIO}
              </Text>
            </View>

            {error ? (
              <Text className="font-['Roboto-Flex'] mt-[10px] text-[12px] text-lhlDestructiveRed">
                {error}
              </Text>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
