// Organization registration — the whole flow (LOOP-141 + LOOP-185).
//
// Figma: "Organization Registration" frame, reviewed 2026-06-08.
//
// SCOPE. LOOP-185 built the *end* of the flow — the president-email step, its
// error state, the 4-digit code step, and the success screen — and left a note
// that the search/claim head was LOOP-141 and would arrive with an ?org=
// param. LOOP-141 is now here, and it did NOT arrive as a separate route.
//
// Screens 1-3 of the Figma frame are three states of ONE screen (empty, tags
// dropdown open, filled), and the president-email field is already on it. So
// the search + category + email steps are folded into the existing state
// machine as a single 'form' step rather than a second file that would have
// to hand three values across a navigation boundary. The ?org= / ?name= params
// still work as a deep link into a pre-selected org — see deepLinkedOrg's
// definition — so nothing that pointed here before is broken.
//
// The states the two tickets name, and where they are below:
//   - inactive button   -> Send Email / Verify stay outline-styled and disabled
//                          until every field on the step is valid
//   - already claimed   -> a picked org whose claim_state isn't 'available'
//                          shows a notice and cannot be submitted (LOOP-141)
//   - nothing found     -> the "skip for now" panel, which is a real branch,
//                          not decoration: see the comment on it
//   - email mismatch    -> red field border + "This email does not match the
//                          president on file."  (step 'form', error set)
//   - success           -> "Thank you for verifying!" + review-pending copy +
//                          Exit
//
// Generic UT email verification is still LOOP-134 and still not wired here.

import LhlSearchIcon from '@/assets/icons/LhlSearchIcon';
import DropdownSelectField from '@/app/components/inputs/DropdownSelectField';
import OtpInput from '@/app/components/inputs/OtpInputField';
import TextInputField from '@/app/components/inputs/TextInputField';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { ApiError, api } from '@/app/lib/api';
import { org as orgKeys } from '@/app/lib/queryKeys';
import ArrowLeftIcon from '@/assets/images/arrow-left.svg';
import { ORG_CATEGORIES, ORG_SEARCH_MIN_QUERY, type OrgClaimState } from '@/shared/orgRegistration';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TextInputKeyPressEventData,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useThemeColors } from '@/app/lib/themeColors';

type Step = 'form' | 'code' | 'success';

const CODE_LENGTH = 4;

/** How long the search field sits still before we ask the server. */
const SEARCH_DEBOUNCE_MS = 300;

/** One row of GET /orgs/search. */
interface OrgSearchResult {
  id: number;
  name: string;
  profile_picture: string | null;
  category: string | null;
  verified: boolean;
  claim_state: OrgClaimState;
  claimable: boolean;
}

interface OrgSearchResponse {
  query: string;
  organizations: OrgSearchResult[];
}

/**
 * Why a claimed org can't be claimed again, in the user's words.
 *
 * The server sends its own copy on the 409, but the button is disabled long
 * before anyone can submit, so this is what people actually read.
 */
const CLAIM_NOTICE: Record<Exclude<OrgClaimState, 'available'>, string> = {
  pending_review: 'This organization is already awaiting verification by our team.',
  claimed: 'This organization has already been claimed. Ask one of its admins to invite you.',
};

/**
 * Trailing-edge debounce.
 *
 * The search field is the first thing on the form and people type org names in
 * full, so keystroke-per-request would mean ~20 round trips and a results list
 * that reorders under the thumb. Local rather than in app/lib because nothing
 * else needs it yet.
 */
function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return settled;
}

/** Org avatar, falling back to the initial when there's no picture on file. */
function OrgAvatar({
  org,
  size,
}: {
  org: { name: string; profile_picture: string | null };
  size: number;
}) {
  if (org.profile_picture) {
    return (
      <Image
        source={{ uri: org.profile_picture }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
    );
  }
  return (
    <View
      className="items-center justify-center rounded-full bg-lhlSurfaceGrey"
      style={{ width: size, height: size }}
    >
      <Text
        className="font-['Roboto-Flex'] font-semibold text-lhlAccent"
        style={{ fontSize: Math.round(size * 0.45) }}
      >
        {org.name.trim().charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

export default function OrgRegisterScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ org?: string; name?: string }>();
  const { data: onboarding } = useOnboarding();
  const token = onboarding.token || null;

  const [step, setStep] = useState<Step>('form');

  // --- form step state ----------------------------------------------------
  //
  // Deep-link entry (?org=&name=). We only have the two values the caller
  // passed, so claim state is unknown and assumed claimable; the 409 from
  // /register/verify-president is the backstop. Searching for it here to learn
  // its real state would trade a guaranteed request for a rare one.
  //
  // Only ever consumed by the useState initializers below, so it is read once
  // at mount and re-deriving it on later renders can't stomp on what the user
  // has since picked.
  const deepLinkedOrg: OrgSearchResult | null =
    params.org && Number.isFinite(Number(params.org))
      ? {
          id: Number(params.org),
          name: params.name ?? 'your organization',
          profile_picture: null,
          category: null,
          verified: false,
          claim_state: 'available',
          claimable: true,
        }
      : null;

  // The field shows the deep-linked name too, or it reads as empty next to an
  // avatar that says otherwise.
  const [query, setQuery] = useState(deepLinkedOrg?.name ?? '');
  const [selectedOrg, setSelectedOrg] = useState<OrgSearchResult | null>(deepLinkedOrg);
  const [category, setCategory] = useState('');
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [email, setEmail] = useState('');

  // --- code step state ----------------------------------------------------
  // OtpInput is the existing 2FA component (app/(auth)/AccountVerification):
  // it owns per-digit boxes and expects a char array plus focus refs, so the
  // digit-advance / backspace handling below mirrors that screen rather than
  // reimplementing the component with a string API.
  const [code, setCode] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const inputs = useRef<(TextInput | null)[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const codeValue = code.join('');

  const debouncedQuery = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  const searchEnabled = !!token && !selectedOrg && debouncedQuery.length >= ORG_SEARCH_MIN_QUERY;

  const search = useQuery({
    queryKey: orgKeys.search(debouncedQuery),
    queryFn: () =>
      api.get<OrgSearchResponse>(`/orgs/search?q=${encodeURIComponent(debouncedQuery)}`, { token }),
    enabled: searchEnabled,
  });

  const results = search.data?.organizations ?? [];
  // Only a settled, non-empty search counts as "we looked and found nothing" —
  // otherwise the empty panel flashes between keystrokes.
  const showNoResults = searchEnabled && search.isSuccess && results.length === 0;

  // Build steps 4 + 5: the primary action stays secondary/outline and disabled
  // until its field is valid, then turns burnt orange. A blank field must
  // never be submittable.
  const isEmailValid = /^[^\s@]+@([\w-]+\.)*utexas\.edu$/i.test(email.trim());
  const isCodeValid = codeValue.length === CODE_LENGTH && !code.some((d) => d === '');
  const isFormValid = !!selectedOrg && selectedOrg.claimable && !!category && isEmailValid;

  const handleCodeChange = (text: string, index: number) => {
    const digitsOnly = text.replace(/[^0-9]/g, '');
    if (text.length > 0 && digitsOnly.length === 0) return;

    const next = [...code];
    next[index] = text.slice(-1);
    setCode(next);
    setError(null);

    if (text && index < CODE_LENGTH - 1) inputs.current[index + 1]?.focus();
  };

  const handleCodeKeyPress = (
    e: NativeSyntheticEvent<TextInputKeyPressEventData>,
    index: number,
  ) => {
    if (e.nativeEvent.key !== 'Backspace') return;
    const next = [...code];
    if (code[index]) {
      next[index] = '';
      setCode(next);
    } else if (index > 0) {
      next[index - 1] = '';
      setCode(next);
      inputs.current[index - 1]?.focus();
    }
  };

  const orgName = selectedOrg?.name ?? 'your organization';

  const describeError = (err: unknown, fallback: string) => {
    const body = err instanceof ApiError ? (err.body as Record<string, unknown> | null) : null;
    return (body?.message as string) ?? fallback;
  };

  const pickOrg = (org: OrgSearchResult) => {
    setSelectedOrg(org);
    setQuery(org.name);
    setError(null);
    // An org that already carries a category prefills it — the claimant is
    // confirming what we know rather than retyping it.
    if (org.category) setCategory(org.category);
  };

  const clearOrg = (text: string) => {
    setSelectedOrg(null);
    setQuery(text);
    setError(null);
  };

  // "Skip for now" — the acceptance criteria's escape hatch, and load-bearing
  // here: `organizations` is populated as a side effect of event ingestion, so
  // an org that has never posted an event genuinely cannot be found by the
  // search above. Leaving on /settings rather than deeper into the flow,
  // because there is nothing further to do without an org.
  const skipForNow = () => router.replace('/settings');

  const sendEmail = async () => {
    if (!isFormValid || isSubmitting || !selectedOrg) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await api.post('/orgs/register/verify-president', {
        token,
        body: { org_id: selectedOrg.id, email: email.trim() },
      });
      setStep('code');
    } catch (err) {
      // The mismatch case is the one the design calls out explicitly; the
      // server returns PRESIDENT_EMAIL_MISMATCH with this exact copy. A 409
      // (someone claimed the org between the search and this tap) arrives the
      // same way, carrying its own message.
      setError(describeError(err, 'This email does not match the president on file.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const verifyCode = async () => {
    if (!isCodeValid || isSubmitting || !selectedOrg) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await api.post('/orgs/register/confirm', {
        token,
        // The category rides along here rather than with the email above: it
        // is only persisted once the code proves who is asking.
        body: { org_id: selectedOrg.id, code: codeValue, category: category || undefined },
      });
      queryClient.invalidateQueries({ queryKey: orgKeys.mine() });
      setStep('success');
    } catch (err) {
      setError(describeError(err, 'That code isn’t right. Check it and try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- Success (build step 1) ---------------------------------------------
  if (step === 'success') {
    return (
      <SafeAreaView className="flex-1 bg-lhlBackgroundColor" edges={['top']}>
        <View className="flex-1 items-center justify-center px-[36px] bg-lhlBackgroundColor">
          <View className="h-[72px] w-[72px] items-center justify-center rounded-full bg-lhlSurfaceGrey">
            <Text className="text-[30px] text-lhlAccent">✓</Text>
          </View>

          <Text className="font-['Roboto-Flex'] mt-[20px] text-center text-[22px] font-semibold text-lhlInk">
            Thank you for verifying!
          </Text>

          <Text className="font-['Roboto-Flex'] mt-[10px] text-center text-[13px] leading-[19px] text-lhlSecondaryTextGrey">
            Our team at Longhorn Loop will review the verification request and send a notification
            with the result.
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Exit"
            // Dismisses the whole registration flow rather than stepping back
            // into the code screen, which is already spent.
            onPress={() => router.replace('/settings')}
            className="mt-[28px] h-[50px] w-full items-center justify-center rounded-[10px] bg-lhlBurntOrange"
          >
            <Text className="font-['Roboto-Flex'] text-[16px] font-semibold text-white">Exit</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // --- Form + code steps ---------------------------------------------------
  const isFormStep = step === 'form';
  const canSubmit = isFormStep ? isFormValid : isCodeValid;
  const claimNotice =
    selectedOrg && !selectedOrg.claimable && selectedOrg.claim_state !== 'available'
      ? CLAIM_NOTICE[selectedOrg.claim_state]
      : null;

  return (
    <SafeAreaView className="flex-1 bg-lhlBackgroundColor" edges={['top']}>
      <KeyboardAvoidingView
        className="flex-1 bg-lhlBackgroundColor"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View className="flex-row items-center px-[20px] py-[12px]">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => {
              if (!isFormStep) {
                setStep('form');
                setError(null);
                setCode(Array(CODE_LENGTH).fill(''));
                return;
              }
              router.back();
            }}
          >
            <ArrowLeftIcon width={22} height={22} color={colors.ink} />
          </Pressable>
          <Text className="font-['Roboto-Flex'] ml-[12px] text-[18px] font-semibold text-lhlInk">
            {isFormStep ? 'Register an organization' : 'Verify Organization'}
          </Text>
        </View>

        <ScrollView
          className="flex-1 px-[20px] bg-lhlBackgroundColor"
          contentContainerStyle={{ paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          {isFormStep ? (
            <>
              {/* --- Find your organization (Figma screen 1) --- */}
              <View className="mt-[10px]">
                <TextInputField
                  label="Find your organization"
                  placeholder="Search org name..."
                  value={query}
                  onChangeText={clearOrg}
                  autoCapitalize="none"
                  autoCorrect={false}
                  clearable
                  borderRadius={8}
                  leftIcon={
                    // Figma screen 3 swaps the magnifier for the picked org's
                    // avatar, which is the only confirmation that the tap
                    // registered on a field that still shows plain text.
                    selectedOrg ? (
                      <OrgAvatar org={selectedOrg} size={20} />
                    ) : (
                      <LhlSearchIcon size={14} color={colors.inkSecondary} />
                    )
                  }
                />
              </View>

              {search.isFetching && searchEnabled ? (
                <View className="mt-[10px] flex-row items-center gap-[8px]">
                  <ActivityIndicator size="small" color={colors.brand} />
                  <Text className="font-['Roboto-Flex'] text-[12px] text-lhlSecondaryTextGrey">
                    Searching organizations…
                  </Text>
                </View>
              ) : null}

              {!selectedOrg && results.length > 0 ? (
                <View className="mt-[8px] overflow-hidden rounded-[8px] border border-lhlBorderColor bg-lhlSurface">
                  {results.map((org, index) => (
                    <Pressable
                      key={org.id}
                      accessibilityRole="button"
                      accessibilityLabel={org.name}
                      onPress={() => pickOrg(org)}
                      className={`flex-row items-center gap-[10px] px-[12px] py-[10px] ${
                        index === results.length - 1 ? '' : 'border-b border-lhlDivider'
                      }`}
                    >
                      <OrgAvatar org={org} size={28} />
                      <Text
                        numberOfLines={1}
                        className="font-['Roboto-Flex'] flex-1 text-[14px] text-lhlInk"
                      >
                        {org.name}
                      </Text>
                      {/* Flag the dead ends in the list itself, so nobody
                          picks one and then reads why they can't continue. */}
                      {org.claimable ? null : (
                        <Text className="font-['Roboto-Flex'] text-[11px] text-lhlSecondaryTextGrey">
                          {org.claim_state === 'pending_review' ? 'Pending review' : 'Claimed'}
                        </Text>
                      )}
                    </Pressable>
                  ))}
                </View>
              ) : null}

              {showNoResults ? (
                <View className="mt-[8px] rounded-[8px] border border-lhlBorderColor bg-lhlSurface px-[12px] py-[12px]">
                  <Text className="font-['Roboto-Flex'] text-[13px] font-semibold text-lhlInk">
                    No organizations match “{debouncedQuery}”.
                  </Text>
                  <Text className="font-['Roboto-Flex'] mt-[6px] text-[12px] leading-[18px] text-lhlSecondaryTextGrey">
                    Only organizations that have already posted an event on Longhorn Loop show up
                    here. If yours hasn’t yet, you can skip this for now and register once it has.
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Skip for now"
                    onPress={skipForNow}
                    className="mt-[10px] self-start"
                  >
                    <Text className="font-['Roboto-Flex'] text-[13px] font-semibold text-lhlAccent">
                      Skip for now
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              {claimNotice ? (
                <View className="mt-[10px] rounded-[8px] bg-lhlDestructiveSoft px-[12px] py-[10px]">
                  <Text className="font-['Roboto-Flex'] text-[12px] leading-[18px] text-lhlDestructiveRed">
                    {claimNotice}
                  </Text>
                </View>
              ) : null}

              {/* --- What best describes this organization? (screen 2) --- */}
              <View className="mt-[18px]">
                <DropdownSelectField
                  label="What best describes this organization?"
                  placeholder="Enter tags..."
                  options={[...ORG_CATEGORIES]}
                  selectedValue={category}
                  onSelect={setCategory}
                  isOpen={categoryOpen}
                  onToggle={() => setCategoryOpen((open) => !open)}
                  borderRadius={8}
                />
              </View>

              {/* --- President's email (LOOP-185's step, now on this screen) --- */}
              <Text className="font-['Roboto-Flex'] mt-[18px] text-[16px] font-semibold text-lhlInk">
                Enter the president’s email
              </Text>
              <Text className="font-['Roboto-Flex'] mt-[4px] text-[12px] leading-[18px] text-lhlSecondaryTextGrey">
                We’ll send a verification code to the president on file for {orgName}.
              </Text>

              <TextInput
                value={email}
                onChangeText={(text) => {
                  setEmail(text);
                  if (error) setError(null);
                }}
                placeholder="president@utexas.edu"
                placeholderTextColor={colors.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                accessibilityLabel="President's email"
                className="font-['Roboto-Flex'] mt-[10px] rounded-[8px] border bg-lhlSurface px-[12px] py-[12px] text-[14px] text-lhlInk"
                // Build step 3: red border on mismatch, and the form stays
                // editable so the user can correct and resubmit.
                style={{ borderColor: error ? colors.destructive : colors.border }}
              />

              {error ? (
                <Text className="font-['Roboto-Flex'] mt-[6px] text-[12px] text-lhlDestructiveRed">
                  {error}
                </Text>
              ) : null}
            </>
          ) : (
            <>
              <Text className="font-['Roboto-Flex'] mt-[10px] text-[15px] font-semibold text-lhlInk">
                Enter the 4-digit code
              </Text>
              <Text className="font-['Roboto-Flex'] mt-[6px] text-[12px] leading-[18px] text-lhlSecondaryTextGrey">
                Sent to {email.trim()}.
              </Text>

              <View className="mt-[18px]">
                <OtpInput
                  code={code}
                  error={!!error}
                  inputs={inputs}
                  handleChange={handleCodeChange}
                  handleKeyPress={handleCodeKeyPress}
                />
              </View>

              {error ? (
                <Text className="font-['Roboto-Flex'] mt-[10px] text-[12px] text-lhlDestructiveRed">
                  {error}
                </Text>
              ) : null}
            </>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isFormStep ? 'Send Email' : 'Verify'}
            accessibilityState={{ disabled: !canSubmit || isSubmitting }}
            disabled={!canSubmit || isSubmitting}
            onPress={isFormStep ? sendEmail : verifyCode}
            className={`mt-[26px] h-[50px] items-center justify-center rounded-[10px] border ${
              canSubmit
                ? 'border-lhlBurntOrange bg-lhlBurntOrange'
                : 'border-lhlMutedBorder bg-lhlSurface opacity-60'
            }`}
          >
            {isSubmitting ? (
              <ActivityIndicator color={canSubmit ? '#FFFFFF' : colors.inkSecondary} />
            ) : (
              <Text
                className={`font-['Roboto-Flex'] text-[16px] font-semibold ${
                  canSubmit ? 'text-white' : 'text-lhlSecondaryTextGrey'
                }`}
              >
                {isFormStep ? 'Send Email' : 'Verify'}
              </Text>
            )}
          </Pressable>

          {/* The same escape hatch as the no-results panel, always reachable:
              someone who knows their org has never posted shouldn't have to
              search for it first to find out they can leave. */}
          {isFormStep ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Skip for now"
              onPress={skipForNow}
              className="mt-[14px] items-center"
            >
              <Text className="font-['Roboto-Flex'] text-[13px] text-lhlSecondaryTextGrey">
                I don’t have a registered organization yet —{' '}
                <Text className="font-['Roboto-Flex'] font-semibold text-lhlAccent">
                  skip for now
                </Text>
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
