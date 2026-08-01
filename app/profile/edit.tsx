// Edit Profile (LOOP-181, implementing the form LOOP-130 designed).
//
// Figma: Edit Profile frame (nodes 2793:3990, 2723:3741, 2723:3551), reviewed
// 2026-06-08.
//
// Sections: name, classification year, bio, Linked Socials, interests.
//
// Two behaviours worth knowing before changing anything here:
//
//   1. Socials save IMMEDIATELY, not on Save. Connecting an app is a
//      server-validated action that can fail on its own terms ("link was not
//      found"), so it can't sit in local form state waiting for a Save that
//      might never come. That's also why removing a social doesn't mark the
//      form dirty — it's already persisted.
//   2. Everything else is deferred and diffed against the loaded profile, so
//      Save only lights up on a real change and backing out with edits
//      pending raises LeaveWithoutSavingModal (LOOP-182).

import ArrowLeftIcon from '@/assets/images/arrow-left.svg';
import AddSocialUrlModal from '@/app/components/modals/AddSocialUrlModal';
import ChooseApplicationModal from '@/app/components/modals/ChooseApplicationModal';
import LeaveWithoutSavingModal from '@/app/components/modals/LeaveWithoutSavingModal';
import OpenLinkModal, { useOpenLinkGuard } from '@/app/components/modals/OpenLinkModal';
import LinkedSocialsRow from '@/app/components/profile/LinkedSocialsRow';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { ApiError, api } from '@/app/lib/api';
import { ALL_INTEREST_TAGS } from '@/app/lib/interestCategories';
import { user as userKeys } from '@/app/lib/queryKeys';
import type { LinkedSocial, SocialPlatformId } from '@/app/lib/socialPlatforms';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const BG = '#F9F8F5';
const BORDER = 'rgba(0,0,0,0.20)';

const YEAR_OPTIONS = ['Freshmen', 'Sophomore', 'Junior', 'Senior', 'Graduate'];
const MAX_BIO = 300;
const MAX_NAME = 50;

interface MeResponse {
  user: {
    first_name: string;
    last_name: string;
    year_classification: string | null;
    bio: string | null;
    tags: string[];
    socials: LinkedSocial[];
  };
}

/** Order-insensitive compare, so re-picking the same tags isn't a "change". */
function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((tag, i) => tag === sortedB[i]);
}

export default function EditProfileScreen() {
  const router = useRouter();
  const { data: onboarding } = useOnboarding();
  const token = onboarding.token || null;
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: userKeys.me(),
    queryFn: () => api.get<MeResponse>('/users/me', { token }),
    enabled: !!token,
  });

  // --- Deferred form state -------------------------------------------------
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [year, setYear] = useState('');
  const [bio, setBio] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [isEditingInterests, setIsEditingInterests] = useState(false);
  const [showNameError, setShowNameError] = useState(false);

  // --- Modal state ---------------------------------------------------------
  const [showPicker, setShowPicker] = useState(false);
  const [pendingPlatform, setPendingPlatform] = useState<SocialPlatformId | null>(null);
  const [showLeaveModal, setShowLeaveModal] = useState(false);

  const openLink = useOpenLinkGuard();

  // Seed the form once the profile arrives. Keyed on the loaded values rather
  // than a ran-once flag so a background refetch that changes the server copy
  // is still reflected.
  const loaded = data?.user;
  useEffect(() => {
    if (!loaded) return;
    setFirstName(loaded.first_name ?? '');
    setLastName(loaded.last_name ?? '');
    setYear(loaded.year_classification ?? '');
    setBio(loaded.bio ?? '');
    setTags(loaded.tags ?? []);
  }, [loaded]);

  const socials = loaded?.socials ?? [];
  const connected = socials.map((s) => s.platform);

  const isNameValid =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    firstName.trim().length <= MAX_NAME &&
    lastName.trim().length <= MAX_NAME;

  // Save is inactive until something actually differs from the loaded profile.
  const isDirty = useMemo(() => {
    if (!loaded) return false;
    return (
      firstName.trim() !== (loaded.first_name ?? '') ||
      lastName.trim() !== (loaded.last_name ?? '') ||
      year !== (loaded.year_classification ?? '') ||
      bio.trim() !== (loaded.bio ?? '') ||
      !sameTags(tags, loaded.tags ?? [])
    );
  }, [loaded, firstName, lastName, year, bio, tags]);

  // --- Mutations -----------------------------------------------------------
  const saveProfile = useMutation({
    mutationFn: () =>
      api.patch('/users/me/profile', {
        token,
        body: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          year_classification: year || null,
          bio: bio.trim() || null,
          tags,
        },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: userKeys.me() }),
  });

  const addSocial = useMutation({
    mutationFn: ({ platform, url }: { platform: SocialPlatformId; url: string }) =>
      api.post('/users/me/socials', { token, body: { platform, url } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: userKeys.me() }),
  });

  const removeSocial = useMutation({
    mutationFn: (platform: SocialPlatformId) =>
      api.delete(`/users/me/socials/${platform}`, { token }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: userKeys.me() }),
  });

  // --- Handlers ------------------------------------------------------------
  const handleBack = () => {
    if (isDirty) {
      setShowLeaveModal(true);
      return;
    }
    router.back();
  };

  const handleSave = async () => {
    if (!isNameValid) {
      setShowNameError(true);
      return;
    }
    await saveProfile.mutateAsync();
    router.back();
  };

  const handleAddSocial = async (platform: SocialPlatformId, url: string) => {
    try {
      await addSocial.mutateAsync({ platform, url });
    } catch (err) {
      // The Worker sends human-readable copy for the states the design names
      // ("Instagram link was not found", "... has already been linked"); fall
      // back to the generic message for anything unexpected.
      const message =
        err instanceof ApiError && err.body && typeof err.body === 'object'
          ? ((err.body as Record<string, unknown>).message as string | undefined)
          : undefined;
      throw new Error(message ?? 'That link could not be added.');
    }
  };

  const toggleTag = (tag: string) => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  if (!token) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center" style={{ backgroundColor: BG }}>
        <Text className="font-['Roboto-Flex'] text-[14px] text-lhlSecondaryTextGrey">
          Sign in to edit your profile.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: BG }} edges={['top']}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View className="flex-row items-center px-[20px] py-[12px]">
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={handleBack}>
            <ArrowLeftIcon width={22} height={22} />
          </Pressable>
          <Text className="font-['Roboto-Flex'] ml-[12px] text-[20px] font-semibold text-lhlInk">
            Edit Profile
          </Text>
        </View>

        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#BD5500" />
          </View>
        ) : (
          <ScrollView
            className="flex-1 px-[20px]"
            contentContainerStyle={{ paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Name */}
            <View className="mt-[8px]">
              <View className="flex-row">
                <Text className="font-['Roboto-Flex'] text-[14px] font-semibold text-lhlInk">
                  Name
                </Text>
                {showNameError && !isNameValid ? (
                  <Text className="font-['Roboto-Flex'] ml-[4px] text-[14px] text-lhlDestructiveRed">
                    *
                  </Text>
                ) : null}
              </View>

              <View className="mt-[8px] flex-row gap-[10px]">
                <TextInput
                  value={firstName}
                  onChangeText={(t) => {
                    setFirstName(t);
                    setShowNameError(false);
                  }}
                  placeholder="First name"
                  maxLength={MAX_NAME}
                  className="font-['Roboto-Flex'] flex-1 rounded-[8px] border bg-white px-[12px] py-[10px] text-[14px] text-lhlInk"
                  style={{
                    borderColor: showNameError && !isNameValid ? '#B30404' : BORDER,
                  }}
                />
                <TextInput
                  value={lastName}
                  onChangeText={(t) => {
                    setLastName(t);
                    setShowNameError(false);
                  }}
                  placeholder="Last name"
                  maxLength={MAX_NAME}
                  className="font-['Roboto-Flex'] flex-1 rounded-[8px] border bg-white px-[12px] py-[10px] text-[14px] text-lhlInk"
                  style={{
                    borderColor: showNameError && !isNameValid ? '#B30404' : BORDER,
                  }}
                />
              </View>

              {showNameError && !isNameValid ? (
                <Text className="font-['Roboto-Flex'] mt-[6px] text-[11px] text-lhlDestructiveRed">
                  Enter a first and last name (50 characters max).
                </Text>
              ) : null}
            </View>

            {/* Year */}
            <View className="mt-[22px]">
              <Text className="font-['Roboto-Flex'] text-[14px] font-semibold text-lhlInk">
                Classification
              </Text>
              <View className="mt-[8px] flex-row flex-wrap gap-[8px]">
                {YEAR_OPTIONS.map((option) => {
                  const isSelected = year === option;
                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      onPress={() => setYear(isSelected ? '' : option)}
                      className={`rounded-full border px-[14px] py-[7px] ${
                        isSelected
                          ? 'border-lhlBurntOrange bg-lhlBurntOrange'
                          : 'border-lhlMutedBorder bg-white'
                      }`}
                    >
                      <Text
                        className={`font-['Roboto-Flex'] text-[12px] font-medium ${
                          isSelected ? 'text-white' : 'text-lhlSecondaryTextGrey'
                        }`}
                      >
                        {option}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Bio */}
            <View className="mt-[22px]">
              <Text className="font-['Roboto-Flex'] text-[14px] font-semibold text-lhlInk">
                Bio
              </Text>
              <TextInput
                value={bio}
                onChangeText={setBio}
                placeholder="Tell people a bit about you"
                multiline
                maxLength={MAX_BIO}
                className="font-['Roboto-Flex'] mt-[8px] h-[92px] rounded-[8px] border bg-white px-[12px] py-[10px] text-[14px] text-lhlInk"
                style={{ borderColor: BORDER, textAlignVertical: 'top' }}
              />
              <Text className="font-['Roboto-Flex'] mt-[4px] text-right text-[11px] text-lhlSecondaryTextGrey">
                {bio.length}/{MAX_BIO}
              </Text>
            </View>

            {/* Linked socials */}
            <View className="mt-[22px]">
              <LinkedSocialsRow
                socials={socials}
                onAdd={() => setShowPicker(true)}
                onRemove={(social) => removeSocial.mutate(social.platform)}
                onPreview={(social) => openLink.request(social.url)}
                disabled={removeSocial.isPending}
              />
            </View>

            {/* Interests */}
            <View className="mt-[26px]">
              <View className="flex-row items-center justify-between">
                <Text className="font-['Roboto-Flex'] text-[14px] font-semibold text-lhlInk">
                  Interests
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setIsEditingInterests((v) => !v)}
                >
                  <Text className="font-['Roboto-Flex'] text-[13px] font-semibold text-lhlBurntOrange">
                    {isEditingInterests ? 'Done' : 'Edit'}
                  </Text>
                </Pressable>
              </View>

              <View className="mt-[10px] flex-row flex-wrap gap-[8px]">
                {(isEditingInterests ? ALL_INTEREST_TAGS : tags).map((tag) => {
                  const isSelected = tags.includes(tag);
                  return (
                    <Pressable
                      key={tag}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      disabled={!isEditingInterests}
                      onPress={() => toggleTag(tag)}
                      className={`flex-row items-center rounded-full border px-[12px] py-[6px] ${
                        isSelected
                          ? 'border-lhlBurntOrange bg-lhlBurntOrange'
                          : 'border-lhlMutedBorder bg-white'
                      }`}
                    >
                      <Text
                        className={`font-['Roboto-Flex'] text-[12px] font-medium ${
                          isSelected ? 'text-white' : 'text-lhlSecondaryTextGrey'
                        }`}
                      >
                        {tag}
                      </Text>
                      {isEditingInterests ? (
                        <Text
                          className={`font-['Roboto-Flex'] ml-[6px] text-[12px] ${
                            isSelected ? 'text-white' : 'text-lhlSecondaryTextGrey'
                          }`}
                        >
                          {isSelected ? '✓' : '+'}
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })}

                {!isEditingInterests && tags.length === 0 ? (
                  <Text className="font-['Roboto-Flex'] text-[12px] text-lhlSecondaryTextGrey">
                    No interests selected yet.
                  </Text>
                ) : null}
              </View>
            </View>

            {/* Save */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save changes"
              accessibilityState={{ disabled: !isDirty || saveProfile.isPending }}
              disabled={!isDirty || saveProfile.isPending}
              onPress={handleSave}
              className={`mt-[30px] h-[50px] items-center justify-center rounded-[10px] border ${
                isDirty
                  ? 'border-lhlBurntOrange bg-lhlBurntOrange'
                  : 'border-lhlMutedBorder bg-white opacity-60'
              }`}
            >
              <Text
                className={`font-['Roboto-Flex'] text-[16px] font-semibold ${
                  isDirty ? 'text-white' : 'text-lhlSecondaryTextGrey'
                }`}
              >
                {saveProfile.isPending ? 'Saving…' : 'Save'}
              </Text>
            </Pressable>
          </ScrollView>
        )}
      </KeyboardAvoidingView>

      {/* --- Modals --- */}
      <ChooseApplicationModal
        visible={showPicker}
        connected={connected}
        onSelect={(platform) => {
          setShowPicker(false);
          setPendingPlatform(platform);
        }}
        onClose={() => setShowPicker(false)}
      />

      <AddSocialUrlModal
        visible={pendingPlatform !== null}
        platform={pendingPlatform}
        onAdd={handleAddSocial}
        onClose={() => setPendingPlatform(null)}
        onBack={() => {
          setPendingPlatform(null);
          setShowPicker(true);
        }}
      />

      <LeaveWithoutSavingModal
        visible={showLeaveModal}
        isSaving={saveProfile.isPending}
        onDiscard={() => {
          setShowLeaveModal(false);
          router.back();
        }}
        onSave={async () => {
          if (!isNameValid) {
            setShowLeaveModal(false);
            setShowNameError(true);
            return;
          }
          await saveProfile.mutateAsync();
          setShowLeaveModal(false);
          router.back();
        }}
        onDismiss={() => setShowLeaveModal(false)}
      />

      <OpenLinkModal {...openLink.modalProps} />
    </SafeAreaView>
  );
}
