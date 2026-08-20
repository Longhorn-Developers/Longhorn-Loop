// Settings page shell (LOOP-184, build steps 2–7 — Figma Settings frame).
//
// Search field over collapsible accordion sections: Preferences,
// Notifications, Support & About, Account.
//
// The search filters *rows*, not sections: typing "dark" should surface the
// Dark Mode toggle wherever it lives, without the user knowing which section
// it's in. Sections with no matching rows collapse away entirely, and matching
// sections auto-expand — a search that leaves everything folded shut would be
// useless.
//
// Notification rows here coordinate with LOOP-125: that ticket owns when each
// notification fires, these are the stored preferences behind it.
//
// Account actions (LOOP-131). Log Out is a local teardown and finishes in the
// modal at the bottom of this file. Delete Account cannot: it is irreversible
// and needs proof the person holding the session also holds the mailbox, so
// this screen only opens the confirm dialog and requests an emailed code. The
// code entry and the delete itself are app/settings/delete-account.tsx.

import ProfileModal, { ModalAction } from '@/app/components/modals/ProfileModal';
import DeleteAccountModal from '@/app/components/modals/DeleteAccountModal';
import TextInputField from '@/app/components/inputs/TextInputField';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { ApiError, api } from '@/app/lib/api';
import { settings as settingsKeys } from '@/app/lib/queryKeys';
import { useAppTheme } from '@/app/context/ThemeContext';
import ArrowLeftIcon from '@/assets/images/arrow-left.svg';
import LhlSearchIcon from '@/assets/icons/LhlSearchIcon';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useThemeColors } from '@/app/lib/themeColors';

type ToggleKey =
  | 'dark_mode'
  | 'event_reminders'
  | 'new_events'
  | 'weekly_digest'
  | 'rsvp_confirmations'
  | 'channel_push'
  | 'channel_email'
  | 'channel_in_app';

interface SettingsResponse {
  settings: Record<ToggleKey, boolean> & { reminder_lead_minutes: number };
  reminder_options?: number[];
}

/** Minutes -> the label the dropdown shows. */
function leadLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes before`;
  if (minutes < 1440) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? '' : 's'} before`;
  }
  const days = minutes / 1440;
  return `${days} day${days === 1 ? '' : 's'} before`;
}

type Row =
  | { kind: 'toggle'; key: ToggleKey; label: string; hint?: string }
  | { kind: 'lead'; label: string }
  | { kind: 'link'; label: string; onPressKey: string }
  | { kind: 'danger'; label: string; onPressKey: string };

const SECTIONS: { title: string; rows: Row[] }[] = [
  {
    title: 'Preferences',
    rows: [{ kind: 'toggle', key: 'dark_mode', label: 'Dark Mode', hint: 'Use the dark theme' }],
  },
  {
    title: 'Notifications',
    rows: [
      { kind: 'toggle', key: 'event_reminders', label: 'Event reminders' },
      { kind: 'toggle', key: 'new_events', label: 'New events' },
      { kind: 'toggle', key: 'weekly_digest', label: 'Weekly digest' },
      { kind: 'toggle', key: 'rsvp_confirmations', label: 'RSVP confirmations' },
      { kind: 'lead', label: 'Reminder timing' },
      { kind: 'toggle', key: 'channel_push', label: 'Push' },
      { kind: 'toggle', key: 'channel_email', label: 'Email' },
      { kind: 'toggle', key: 'channel_in_app', label: 'In-App' },
    ],
  },
  {
    title: 'Support & About',
    rows: [
      { kind: 'link', label: 'Help Center & FAQ', onPressKey: 'help' },
      { kind: 'link', label: 'Send Feedback', onPressKey: 'feedback' },
      { kind: 'link', label: 'Report a Bug', onPressKey: 'bug' },
      { kind: 'link', label: 'Contact Support', onPressKey: 'support' },
      { kind: 'link', label: "What's New", onPressKey: 'whats-new' },
      { kind: 'link', label: 'Terms & Privacy', onPressKey: 'terms' },
    ],
  },
  {
    title: 'Account',
    rows: [
      { kind: 'link', label: 'Log Out', onPressKey: 'logout' },
      { kind: 'danger', label: 'Delete Account', onPressKey: 'delete' },
    ],
  },
];

export default function SettingsPreferencesScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { data: onboarding, reset } = useOnboarding();
  const token = onboarding.token || null;
  const queryClient = useQueryClient();
  const { setDarkMode } = useAppTheme();

  const [search, setSearch] = useState('');
  const [manuallyOpen, setManuallyOpen] = useState<Record<string, boolean>>({
    Preferences: true,
  });
  const [showLeadPicker, setShowLeadPicker] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: settingsKeys.mine(),
    queryFn: () => api.get<SettingsResponse>('/settings', { token }),
    enabled: !!token,
  });

  const update = useMutation({
    mutationFn: (patch: Record<string, boolean | number>) =>
      api.patch<SettingsResponse>('/settings', { token, body: patch }),
    // The PATCH returns the full merged settings, so seed the cache directly
    // rather than invalidating — avoids a round trip and a toggle flicker.
    onSuccess: (data, variables) => {
      queryClient.setQueryData(settingsKeys.mine(), data);
      // Dark mode is the one setting with an immediate global effect.
      if (typeof variables.dark_mode === 'boolean') setDarkMode(variables.dark_mode);
    },
    onError: (err) => {
      const body = err instanceof ApiError ? (err.body as Record<string, unknown> | null) : null;
      setError((body?.message as string) ?? (body?.error as string) ?? 'Could not save that.');
      queryClient.invalidateQueries({ queryKey: settingsKeys.mine() });
    },
  });

  const values = query.data?.settings;
  const leadOptions = query.data?.reminder_options ?? [15, 30, 60, 120, 360, 720, 1440, 2880];

  // Filter rows by the search text, dropping sections that end up empty.
  const visibleSections = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return SECTIONS;
    return SECTIONS.map((section) => ({
      ...section,
      rows: section.rows.filter(
        (row) =>
          row.label.toLowerCase().includes(term) ||
          section.title.toLowerCase().includes(term) ||
          ('hint' in row && row.hint?.toLowerCase().includes(term)),
      ),
    })).filter((section) => section.rows.length > 0);
  }, [search]);

  const isSearching = search.trim().length > 0;

  const handleLink = (key: string) => {
    setError(null);
    switch (key) {
      case 'feedback':
        router.push('/settings/feedback?kind=feedback');
        break;
      case 'bug':
        router.push('/settings/feedback?kind=bug');
        break;
      case 'support':
        router.push('/settings/feedback?kind=support');
        break;
      case 'logout':
        setConfirmLogout(true);
        break;
      case 'delete':
        setConfirmDelete(true);
        break;
      default:
        // Help Center, What's New and Terms & Privacy need real destinations
        // (a hosted docs URL or in-app content) that don't exist yet. Showing
        // a note beats a dead tap that looks broken.
        setError('That page isn’t available yet.');
    }
  };

  if (!token) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-lhlBackgroundColor">
        <Text className="font-['Roboto-Flex'] text-[14px] text-lhlSecondaryTextGrey">
          Sign in to change your settings.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-lhlBackgroundColor" edges={['top']}>
      <View className="flex-row items-center px-[20px] py-[12px]">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
        >
          <ArrowLeftIcon width={22} height={22} color={colors.ink} />
        </Pressable>
        <View className="ml-[12px] flex-1 bg-lhlBackgroundColor">
          <Text className="font-['Roboto-Flex'] text-[20px] font-semibold text-lhlInk">
            Settings
          </Text>
          <Text className="font-['Roboto-Flex'] text-[11px] text-lhlSecondaryTextGrey">
            Customize your experience and manage your account.
          </Text>
        </View>
      </View>

      <View className="px-[20px]">
        <TextInputField
          value={search}
          onChangeText={setSearch}
          placeholder="Search settings…"
          autoCapitalize="none"
          autoCorrect={false}
          borderRadius={8}
          clearable
          leftIcon={<LhlSearchIcon size={15} color={colors.inkSecondary} />}
        />
      </View>

      {query.isLoading ? (
        <View className="flex-1 items-center justify-center bg-lhlBackgroundColor">
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : (
        <ScrollView
          className="mt-[14px] flex-1 px-[20px] bg-lhlBackgroundColor"
          contentContainerStyle={{ paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          {error ? (
            <Text className="font-['Roboto-Flex'] mb-[10px] text-[12px] text-lhlDestructiveRed">
              {error}
            </Text>
          ) : null}

          {visibleSections.length === 0 ? (
            <Text className="font-['Roboto-Flex'] mt-[20px] text-center text-[13px] text-lhlSecondaryTextGrey">
              No settings match “{search.trim()}”.
            </Text>
          ) : null}

          {visibleSections.map((section) => {
            // While searching, force every surviving section open — the whole
            // point of the search is to reveal the matching row.
            const isOpen = isSearching || manuallyOpen[section.title];

            return (
              <View
                key={section.title}
                className="mb-[12px] overflow-hidden rounded-[12px] border border-lhlMutedBorder bg-lhlSurface"
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: !!isOpen }}
                  onPress={() =>
                    setManuallyOpen((prev) => ({ ...prev, [section.title]: !prev[section.title] }))
                  }
                  className="flex-row items-center justify-between px-[14px] py-[13px]"
                >
                  <Text className="font-['Roboto-Flex'] text-[14px] font-semibold text-lhlInk">
                    {section.title}
                  </Text>
                  <Text className="font-['Roboto-Flex'] text-[13px] text-lhlSecondaryTextGrey">
                    {isOpen ? '⌃' : '⌄'}
                  </Text>
                </Pressable>

                {isOpen ? (
                  <View className="border-t border-lhlMutedBorder">
                    {section.rows.map((row, index) => {
                      if (row.kind === 'toggle') {
                        return (
                          <View
                            key={row.key}
                            className={`flex-row items-center justify-between px-[14px] py-[12px] ${
                              index > 0 ? 'border-t border-lhlSurfaceGrey' : ''
                            }`}
                          >
                            <View className="flex-1 pr-[12px] bg-lhlBackgroundColor">
                              <Text className="font-['Roboto-Flex'] text-[13px] text-lhlInk">
                                {row.label}
                              </Text>
                              {row.hint ? (
                                <Text className="font-['Roboto-Flex'] mt-[1px] text-[11px] text-lhlSecondaryTextGrey">
                                  {row.hint}
                                </Text>
                              ) : null}
                            </View>
                            <Switch
                              value={values?.[row.key] ?? false}
                              disabled={update.isPending}
                              onValueChange={(next) => {
                                setError(null);
                                update.mutate({ [row.key]: next });
                              }}
                              trackColor={{ false: colors.border, true: colors.brand }}
                              thumbColor={colors.surface}
                            />
                          </View>
                        );
                      }

                      if (row.kind === 'lead') {
                        return (
                          <Pressable
                            key="lead"
                            accessibilityRole="button"
                            onPress={() => setShowLeadPicker(true)}
                            className={`flex-row items-center justify-between px-[14px] py-[12px] ${
                              index > 0 ? 'border-t border-lhlSurfaceGrey' : ''
                            }`}
                          >
                            <Text className="font-['Roboto-Flex'] text-[13px] text-lhlInk">
                              {row.label}
                            </Text>
                            <Text className="font-['Roboto-Flex'] text-[12px] text-lhlSecondaryTextGrey">
                              {leadLabel(values?.reminder_lead_minutes ?? 1440)} ⌄
                            </Text>
                          </Pressable>
                        );
                      }

                      return (
                        <Pressable
                          key={row.label}
                          accessibilityRole="button"
                          onPress={() => handleLink(row.onPressKey)}
                          className={`flex-row items-center justify-between px-[14px] py-[13px] ${
                            index > 0 ? 'border-t border-lhlSurfaceGrey' : ''
                          }`}
                        >
                          <Text
                            className={`font-['Roboto-Flex'] text-[13px] ${
                              row.kind === 'danger' ? 'text-lhlDestructiveRed' : 'text-lhlInk'
                            }`}
                          >
                            {row.label}
                          </Text>
                          <Text className="font-['Roboto-Flex'] text-[15px] text-lhlSecondaryTextGrey">
                            ›
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* Reminder timing picker */}
      <ProfileModal
        visible={showLeadPicker}
        onDismiss={() => setShowLeadPicker(false)}
        title="Reminder timing"
        body="How long before an event should we remind you?"
        actions={
          <ModalAction
            label="Cancel"
            variant="outline"
            fullWidth
            onPress={() => setShowLeadPicker(false)}
          />
        }
      >
        <View className="w-full">
          {leadOptions.map((minutes) => {
            const isSelected = values?.reminder_lead_minutes === minutes;
            return (
              <Pressable
                key={minutes}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                onPress={() => {
                  setError(null);
                  update.mutate({ reminder_lead_minutes: minutes });
                  setShowLeadPicker(false);
                }}
                className={`mb-[6px] items-center rounded-full border py-[7px] ${
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
                  {leadLabel(minutes)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ProfileModal>

      {/* Log Out confirm. */}
      <ProfileModal
        visible={confirmLogout}
        onDismiss={() => setConfirmLogout(false)}
        title="Log out?"
        body="You'll need to sign in again to see your saved events."
        actions={
          <>
            <ModalAction label="Cancel" variant="outline" onPress={() => setConfirmLogout(false)} />
            <ModalAction
              label="Log out"
              variant="ink"
              onPress={() => {
                setConfirmLogout(false);
                reset();
                queryClient.clear();
                router.replace('/');
              }}
            />
          </>
        }
      />

      {/* Delete Account confirm (LOOP-131). Confirming only requests the
          emailed code — the delete itself happens on /settings/delete-account
          once that code is entered. */}
      <DeleteAccountModal
        visible={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          try {
            await api.post('/users/me/delete/request', { token });
          } catch (err) {
            // ApiError.message is the raw server code (RESEND_TOO_SOON);
            // the human sentence is in the body. Translate here so the modal
            // can stay a plain Error consumer, like InviteEditorModal.
            const body =
              err instanceof ApiError ? (err.body as Record<string, unknown> | null) : null;
            throw new Error(
              (body?.message as string) ??
                (err instanceof ApiError && err.isNetworkError
                  ? err.message
                  : 'Could not start that. Try again.'),
            );
          }
          setConfirmDelete(false);
          // push, not replace: backing out of the code screen should land on
          // Settings rather than dumping the user out of the app.
          router.push('/settings/delete-account');
        }}
      />
    </SafeAreaView>
  );
}
