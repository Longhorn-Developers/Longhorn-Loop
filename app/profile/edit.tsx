// Edit Profile — Figma "Edit Profile" frame (reviewed 2026-08-01), building
// the form LOOP-130 designed.
//
// Order, matching the frame: avatar + Edit photo, First Name, Last Name,
// Linked Socials (3 max), Bio, What's your major(s)?, Classification.
//
// Two departures from the frame, both deliberate:
//   - Classification stays a pill row rather than the frame's dropdown —
//     Matthew preferred it (2026-08-01).
//   - Interests are edited here too, below Classification. The frame has no
//     interests field, but Profile Main's "Details and Interests" section has
//     a "+" that has to land somewhere, and this is the only edit surface.
//
// Two behaviours worth knowing before changing anything:
//
//   1. Socials save IMMEDIATELY, not on Save. Connecting an app is a
//      server-validated action that can fail on its own terms ("link was not
//      found"), so it can't sit in local form state waiting for a Save that
//      might never come. That's also why removing a social doesn't mark the
//      form dirty — it's already persisted. The avatar behaves the same way.
//   2. Everything else is deferred and diffed against the loaded profile, so
//      Save only lights up on a real change and backing out with edits
//      pending raises LeaveWithoutSavingModal (LOOP-182).

import AddSocialUrlModal from '@/app/components/modals/AddSocialUrlModal';
import ChooseApplicationModal from '@/app/components/modals/ChooseApplicationModal';
import LeaveWithoutSavingModal from '@/app/components/modals/LeaveWithoutSavingModal';
import OpenLinkModal, { useOpenLinkGuard } from '@/app/components/modals/OpenLinkModal';
import PillDropdownField from '@/app/components/inputs/PillDropdownField';
import SearchablePillDropdownField from '@/app/components/inputs/SearchablePillDropdownField';
import { AvatarDisplay } from '@/app/components/profile/AvatarDisplay';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { ApiError, api } from '@/app/lib/api';
import { ALL_INTEREST_TAGS, INTEREST_CATEGORIES } from '@/app/lib/interestCategories';
import { MAJORS } from '@/app/lib/majors';
import { user as userKeys } from '@/app/lib/queryKeys';
import { YEAR_OPTIONS, normalizeYear } from '@/app/lib/yearOptions';
import type { LinkedSocial, SocialPlatformId } from '@/app/lib/socialPlatforms';
import { getSocialPlatformUI } from '@/app/lib/socialPlatforms';
import LhlPillCross from '@/assets/icons/LhlPillCross';
import LhlSearchIcon from '@/assets/icons/LhlSearchIcon';
import ArrowLeftIcon from '@/assets/images/arrow-left.svg';
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
import { useThemeColors } from '@/app/lib/themeColors';
import { DEFAULT_AVATAR_CONFIG, type AvatarConfig } from '@/shared/avatar';
import { BIO_WARN_REMAINING, MAX_BIO, normalizeBio } from '@/shared/bio';

/** Mirrors UNIQUE_CLASS_OPTIONS in app/(onboarding)/CreateAccount.tsx. */
const UNIQUE_CLASS_OPTIONS = ['First Generation', 'International', 'Transfer', 'Not Applicable'];
const MAX_NAME = 50;
const MAX_SOCIALS = 3;

interface MeResponse {
  user: {
    first_name: string;
    last_name: string;
    year_classification: string | null;
    unique_classification: string[];
    bio: string | null;
    avatar: number | null;
    avatar_config: AvatarConfig | null;
    profile_photo_url: string | null;
    majors: string[];
    tags: string[];
    socials: LinkedSocial[];
  };
}

/** Order-insensitive compare, so re-picking the same values isn't a "change". */
function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text className="font-['Roboto-Flex'] mb-[6px] text-[13px] font-semibold text-lhlInk">
      {children}
    </Text>
  );
}

export default function EditProfileScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { data: onboarding } = useOnboarding();
  const token = onboarding.token || null;
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: userKeys.me(),
    queryFn: () => api.get<MeResponse>('/users/me', { token }),
    enabled: !!token,
  });

  // --- Deferred form state -------------------------------------------------
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [year, setYear] = useState('');
  const [bio, setBio] = useState('');
  const [majors, setMajors] = useState<string[]>([]);
  const [uniqueClass, setUniqueClass] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [isEditingInterests, setIsEditingInterests] = useState(false);
  const [openCategory, setOpenCategory] = useState<string | null>(null);
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
    // normalizeYear, not `?? ''` — a profile saved as "Freshmen" before the
    // spelling was corrected has to still light its pill. See app/lib/yearOptions.ts.
    setYear(normalizeYear(loaded.year_classification));
    setBio(loaded.bio ?? '');
    setMajors(loaded.majors ?? []);
    setUniqueClass(loaded.unique_classification ?? []);
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
      // Compare against the normalized value too, or a legacy "Freshmen"
      // profile would open already dirty and trip LeaveWithoutSavingModal on
      // the way out. The correction still gets written on the next real save.
      year !== normalizeYear(loaded.year_classification) ||
      (normalizeBio(bio) ?? '') !== (loaded.bio ?? '') ||
      !sameSet(majors, loaded.majors ?? []) ||
      !sameSet(uniqueClass, loaded.unique_classification ?? []) ||
      !sameSet(tags, loaded.tags ?? [])
    );
  }, [loaded, firstName, lastName, year, bio, majors, uniqueClass, tags]);

  // --- Mutations -----------------------------------------------------------
  const saveProfile = useMutation({
    mutationFn: () =>
      api.patch('/users/me/profile', {
        token,
        body: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          year_classification: year || null,
          bio: normalizeBio(bio),
          majors,
          unique_classification: uniqueClass,
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
      throw new Error(
        message ?? `${getSocialPlatformUI(platform)?.label ?? 'That'} link was not found`,
      );
    }
  };

  // No cap on interests — the Worker accepts any number, so the pill
  // components' append-on-select behaviour needs no gate here.
  const applyTagSelection = (next: string[]) => {
    setTags(next);
  };

  if (!token) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-lhlBackgroundColor">
        <Text className="font-['Roboto-Flex'] text-[14px] text-lhlSecondaryTextGrey">
          Sign in to edit your profile.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-lhlBackgroundColor" edges={['top']}>
      <KeyboardAvoidingView
        className="flex-1 bg-lhlBackgroundColor"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header: back + Save, Save orange only once something changed */}
        <View className="flex-row items-center justify-between px-[20px] py-[12px]">
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={handleBack}>
            <ArrowLeftIcon width={22} height={22} color={colors.ink} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save"
            accessibilityState={{ disabled: !isDirty || saveProfile.isPending }}
            disabled={!isDirty || saveProfile.isPending}
            onPress={handleSave}
            className={`rounded-[6px] border px-[18px] py-[6px] ${
              isDirty
                ? 'border-lhlBurntOrange bg-lhlBurntOrange'
                : 'border-lhlMutedBorder bg-lhlSurface'
            }`}
          >
            <Text
              className={`font-['Roboto-Flex'] text-[13px] font-semibold ${
                isDirty ? 'text-white' : 'text-lhlSecondaryTextGrey'
              }`}
            >
              {saveProfile.isPending ? 'Saving…' : 'Save'}
            </Text>
          </Pressable>
        </View>

        {isLoading ? (
          <View className="flex-1 items-center justify-center bg-lhlBackgroundColor">
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : isError ? (
          // Without this the form renders blank with Save disabled, which reads
          // as a broken screen rather than a failed request.
          <View className="flex-1 items-center justify-center px-[30px] bg-lhlBackgroundColor">
            <Text className="font-['Roboto-Flex'] text-center text-[15px] font-semibold text-lhlInk">
              Couldn’t load your profile
            </Text>
            <Text className="font-['Roboto-Flex'] mt-[6px] text-center text-[12px] text-lhlSecondaryTextGrey">
              Editing is disabled until it loads, so you can’t overwrite your details with a blank
              form.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Try again"
              onPress={() => refetch()}
              className="mt-[18px] rounded-full bg-lhlBurntOrange px-[22px] py-[9px]"
            >
              <Text className="font-['Roboto-Flex'] text-[13px] font-semibold text-white">
                Try again
              </Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView
            className="flex-1 px-[20px] bg-lhlBackgroundColor"
            contentContainerStyle={{ paddingBottom: 50 }}
            keyboardShouldPersistTaps="handled"
          >
            <Text className="font-['Roboto-Flex'] text-center text-[17px] font-bold text-lhlInk">
              Editing Profile
            </Text>

            {/* Avatar + Edit photo */}
            <View className="mt-[14px] items-center">
              <View className="h-[92px] w-[92px] overflow-hidden rounded-full border-2 border-lhlInk bg-lhlPlaceholderGrey">
                {loaded ? <AvatarDisplay user={loaded} size={92} /> : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit photo"
                onPress={() =>
                  router.push({
                    pathname: '/profile/customize-bevo',
                    params: {
                      mode: 'edit',
                      // Same builder as onboarding (LOOP-XXX) — pass the
                      // committed config as JSON since customize-bevo has no
                      // other way to read an already-saved profile.
                      initial: JSON.stringify(loaded?.avatar_config ?? DEFAULT_AVATAR_CONFIG),
                    },
                  })
                }
                className="mt-[10px] rounded-full border border-lhlInk bg-lhlSurface px-[16px] py-[5px]"
              >
                <Text className="font-['Roboto-Flex'] text-[12px] font-medium text-lhlInk">
                  Edit photo
                </Text>
              </Pressable>
            </View>

            {/* First / Last name */}
            <View className="mt-[20px]">
              <View className="flex-row">
                <FieldLabel>First Name</FieldLabel>
                {showNameError && !isNameValid ? (
                  <Text className="font-['Roboto-Flex'] ml-[4px] text-[13px] text-lhlDestructiveRed">
                    *
                  </Text>
                ) : null}
              </View>
              <TextInput
                value={firstName}
                onChangeText={(t) => {
                  setFirstName(t);
                  setShowNameError(false);
                }}
                maxLength={MAX_NAME}
                className="font-['Roboto-Flex'] rounded-[6px] border bg-lhlSurface px-[12px] py-[10px] text-[13px] text-lhlInk"
                style={{
                  borderColor: showNameError && !isNameValid ? colors.destructive : colors.border,
                }}
              />
            </View>

            <View className="mt-[14px]">
              <FieldLabel>Last Name</FieldLabel>
              <TextInput
                value={lastName}
                onChangeText={(t) => {
                  setLastName(t);
                  setShowNameError(false);
                }}
                maxLength={MAX_NAME}
                className="font-['Roboto-Flex'] rounded-[6px] border bg-lhlSurface px-[12px] py-[10px] text-[13px] text-lhlInk"
                style={{
                  borderColor: showNameError && !isNameValid ? colors.destructive : colors.border,
                }}
              />
              {showNameError && !isNameValid ? (
                <Text className="font-['Roboto-Flex'] mt-[6px] text-[11px] text-lhlDestructiveRed">
                  Enter a first and last name ({MAX_NAME} characters max).
                </Text>
              ) : null}
            </View>

            {/* Linked Socials */}
            <View className="mt-[18px]">
              <FieldLabel>Linked Socials ({MAX_SOCIALS} max)</FieldLabel>
              <View className="flex-row flex-wrap items-center gap-[10px]">
                {socials.map((social) => {
                  const meta = getSocialPlatformUI(social.platform);
                  if (!meta) return null;
                  const Icon = meta.icon;
                  return (
                    <View key={social.platform} className="h-[34px] w-[34px]">
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${meta.label} link`}
                        onPress={() => openLink.request(social.url)}
                        className="h-[30px] w-[30px] items-center justify-center rounded-[8px] bg-lhlBurntOrange"
                      >
                        <Icon size={16} color="#FFFFFF" />
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${meta.label}`}
                        hitSlop={10}
                        disabled={removeSocial.isPending}
                        onPress={() => removeSocial.mutate(social.platform)}
                        className="absolute right-0 top-0 h-[14px] w-[14px] items-center justify-center rounded-full bg-lhlDestructiveRed"
                      >
                        {/* theme-exempt: cross sits on the filled destructive badge, white in both themes */}
                        <LhlPillCross size={6} color="#FFFFFF" />
                      </Pressable>
                    </View>
                  );
                })}

                {socials.length < MAX_SOCIALS ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Add a linked social"
                    onPress={() => setShowPicker(true)}
                    className="h-[30px] w-[30px] items-center justify-center rounded-[8px] bg-lhlBurntOrange"
                  >
                    <Text className="font-['Roboto-Flex'] text-[16px] leading-[18px] text-white">
                      +
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            {/* Bio */}
            <View className="mt-[18px]">
              <FieldLabel>Bio</FieldLabel>
              <View
                className="rounded-[6px] border bg-lhlSurface px-[12px] py-[10px]"
                style={{ borderColor: colors.border }}
              >
                <TextInput
                  value={bio}
                  onChangeText={setBio}
                  placeholder={'Tell people a bit about you.\nLine breaks are kept.'}
                  placeholderTextColor={colors.inkSecondary}
                  multiline
                  maxLength={MAX_BIO}
                  // Grows with the bio instead of scrolling inside 64px, so all
                  // 150 characters are visible while they're being written.
                  className="font-['Roboto-Flex'] min-h-[64px] text-[13px] text-lhlInk"
                  style={{ textAlignVertical: 'top' }}
                />
                <Text
                  className="font-['Roboto-Flex'] text-right text-[10px]"
                  style={{
                    color:
                      MAX_BIO - bio.length <= BIO_WARN_REMAINING
                        ? colors.destructive
                        : colors.inkSecondary,
                  }}
                >
                  {bio.length} / {MAX_BIO}
                </Text>
              </View>
            </View>

            {/* Majors */}
            <View className="mt-[18px]">
              <SearchablePillDropdownField
                label="Whats your major(s)?"
                leftIcon={<LhlSearchIcon size={14} color={colors.inkSecondary} />}
                placeholder="Search for your major..."
                options={MAJORS}
                selectedValues={majors}
                onSelect={setMajors}
                borderRadius={6}
              />
            </View>

            {/* Classification — pills, kept over the frame's dropdown */}
            <View className="mt-[18px]">
              <FieldLabel>Classification</FieldLabel>
              <View className="flex-row flex-wrap gap-[8px]">
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
                          : 'border-lhlMutedBorder bg-lhlSurface'
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

            {/* Unique Classification — onboarding collects this and nothing
                could change it afterwards, so it was write-once. */}
            <View className="mt-[18px]">
              <FieldLabel>Unique Classification</FieldLabel>
              <View className="flex-row flex-wrap gap-[8px]">
                {UNIQUE_CLASS_OPTIONS.map((option) => {
                  const isSelected = uniqueClass.includes(option);
                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      onPress={() =>
                        setUniqueClass((prev) =>
                          prev.includes(option)
                            ? prev.filter((v) => v !== option)
                            : [...prev, option],
                        )
                      }
                      className={`rounded-full border px-[14px] py-[7px] ${
                        isSelected
                          ? 'border-lhlBurntOrange bg-lhlBurntOrange'
                          : 'border-lhlMutedBorder bg-lhlSurface'
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

            {/* Interests — not in the frame; see the header comment.
                Presented exactly as onboarding does it (search + one
                accordion per category) rather than 100 flat chips: the user
                picked their interests this way at signup, and a different
                layout here is friction for no gain. */}
            <View className="mt-[22px]">
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-baseline gap-[6px]">
                  <FieldLabel>Interests</FieldLabel>
                  <Text className="font-['Roboto-Flex'] mb-[6px] text-[11px] text-lhlSecondaryTextGrey">
                    {tags.length} selected
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setIsEditingInterests((v) => !v)}
                >
                  <Text className="font-['Roboto-Flex'] text-[12px] font-semibold text-lhlAccent">
                    {isEditingInterests ? 'Done' : 'Edit'}
                  </Text>
                </Pressable>
              </View>

              {isEditingInterests ? (
                <>
                  <SearchablePillDropdownField
                    leftIcon={<LhlSearchIcon size={14} color={colors.inkSecondary} />}
                    placeholder="Search for interests, events, activities..."
                    options={ALL_INTEREST_TAGS}
                    selectedValues={tags}
                    onSelect={applyTagSelection}
                    borderRadius={6}
                  />

                  <View className="mt-[14px] gap-[12px]">
                    {INTEREST_CATEGORIES.map((category) => {
                      const Icon = category.icon;
                      const selectedInCategory = tags.filter((tag) => category.tags.includes(tag));

                      return (
                        <PillDropdownField
                          key={category.id}
                          titleText={category.label}
                          leftIcon={<Icon width={16} height={16} />}
                          options={category.tags}
                          selectedValues={selectedInCategory}
                          onSelect={(updated) => {
                            // The component reports only its own category, so
                            // merge it back over the tags from every other one.
                            const others = tags.filter((tag) => !category.tags.includes(tag));
                            applyTagSelection([...others, ...updated]);
                          }}
                          isOpen={openCategory === category.id}
                          onToggle={() =>
                            setOpenCategory((cur) => (cur === category.id ? null : category.id))
                          }
                          borderRadius={6}
                        />
                      );
                    })}
                  </View>
                </>
              ) : (
                <View className="flex-row flex-wrap gap-[8px]">
                  {tags.map((tag) => (
                    <View
                      key={tag}
                      className="rounded-full border border-lhlBurntOrange bg-lhlBurntOrange px-[12px] py-[6px]"
                    >
                      <Text className="font-['Roboto-Flex'] text-[12px] font-medium text-white">
                        {tag}
                      </Text>
                    </View>
                  ))}
                  {tags.length === 0 ? (
                    <Text className="font-['Roboto-Flex'] text-[12px] text-lhlSecondaryTextGrey">
                      No interests selected yet.
                    </Text>
                  ) : null}
                </View>
              )}
            </View>
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
