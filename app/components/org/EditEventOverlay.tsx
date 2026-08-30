// Edit Event overlay — Org Management console, Events tab (LOOP-136).
//
// Figma: "Organization Management" frame, Events tab, pencil affordance.
//
// SCOPE, decided by the product owner and deliberately narrower than the
// create flow:
//
//   IN  — title, description, start/end datetime, location, interest tags.
//   OUT — image replacement. Swapping a flyer means an authenticated upload to
//         R2 and orphaning the old object; PATCH /events/:id takes JSON only
//         and never touches image_url, so an event keeps the poster it was
//         created with.
//   OUT — recurrence. There is no schema support for it at all: `events` has a
//         single start/end pair and no series table, so "every Tuesday" would
//         have to be invented end to end. Not a field that was left out — a
//         feature that does not exist.
//
// Fields are edited through the same controls as the create flow (see
// DateTimeField, extracted from the wizard's "When is it?" step for exactly
// this reason) rather than a second set of inputs that drifts from it.
//
// The request sends ONLY what changed. PATCH is partial by contract, so an
// unchanged field is an absent key rather than a re-send — which is what keeps
// an overlay that knows about six fields from ever writing over the thirty it
// doesn't.

import DateTimeField from '@/app/components/create-event/DateTimeField';
import LeaveWithoutSavingModal from '@/app/components/modals/LeaveWithoutSavingModal';
import { ApiError, api } from '@/app/lib/api';
import { INTEREST_CATEGORIES } from '@/app/lib/interestCategories';
import {
  events as eventKeys,
  feed as feedKeys,
  org as orgKeys,
  user as userKeys,
} from '@/app/lib/queryKeys';
import { MAX_INTEREST_TAGS } from '@/app/context/CreateEventContext';
import { useThemeColors } from '@/app/lib/themeColors';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TITLE_MAX = 80;
const DESCRIPTION_MAX = 500;
const LOCATION_MAX = 200;

interface EditableEvent {
  title: string;
  description: string;
  startDatetime: string | null;
  endDatetime: string | null;
  location: string;
  bucket: string | null;
  tags: string[];
}

export interface EventEditSource {
  id: number;
  host_organization_id?: number | null;
  title: string;
  description: string | null;
  start_datetime: string;
  end_datetime: string | null;
  location_short: string | null;
  location_full: string | null;
  discovery_bucket?: string | null;
  tags: string[];
}

function toForm(event: EventEditSource): EditableEvent {
  return {
    title: event.title ?? '',
    description: event.description ?? '',
    startDatetime: event.start_datetime ?? null,
    endDatetime: event.end_datetime ?? null,
    location: event.location_full ?? event.location_short ?? '',
    bucket: event.discovery_bucket ?? null,
    tags: event.tags ?? [],
  };
}

function sameTags(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((tag) => b.includes(tag));
}

/**
 * The request body: only the fields that actually moved.
 *
 * Returning an empty object is meaningful — it means there is nothing to save,
 * which is how the Save button knows to stay disabled.
 */
function buildPatch(form: EditableEvent, initial: EditableEvent): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  if (form.title.trim() !== initial.title.trim()) patch.title = form.title.trim();
  if (form.description.trim() !== initial.description.trim()) {
    // "" is a deliberate clear on the server, not an omission.
    patch.description = form.description.trim();
  }
  if (form.startDatetime !== initial.startDatetime) patch.start_datetime = form.startDatetime;
  if (form.endDatetime !== initial.endDatetime) patch.end_datetime = form.endDatetime;
  if (form.location.trim() !== initial.location.trim()) patch.location = form.location.trim();

  // Tags and their bucket move together: the server only rewrites event_tags
  // when it receives both, so that fixing a typo in a title can't wipe the
  // classifier's work on a scraped event.
  if (form.bucket !== initial.bucket || !sameTags(form.tags, initial.tags)) {
    patch.categories = form.tags;
    if (form.bucket) patch.discovery_bucket = form.bucket;
  }

  return patch;
}

export interface EditEventOverlayProps {
  visible: boolean;
  /** The row whose pencil was tapped. Null while the overlay is closed. */
  event: EventEditSource | null;
  /** Present when the edited event also belongs to an organization console. */
  orgId?: number | null;
  token: string | null;
  onClose: () => void;
}

export default function EditEventOverlay({
  visible,
  event,
  orgId,
  token,
  onClose,
}: EditEventOverlayProps) {
  const colors = useThemeColors();
  const queryClient = useQueryClient();

  /**
   * Insets from the ROOT provider, applied as padding by hand.
   *
   * `<SafeAreaView edges={['top']}>` was here and did nothing. A React Native
   * Modal is its own native window, and react-native-safe-area-context measures
   * whichever window it is mounted in — so inside a Modal it reports a top
   * inset of 0 and the header renders under the status bar. Invisible until
   * `edgeToEdgeEnabled` (app.json) let the app draw up there at all.
   *
   * This hook reads the provider that measured the real window, so the value is
   * the true status-bar height on both platforms.
   */
  const insets = useSafeAreaInsets();

  const initial = useMemo<EditableEvent | null>(() => (event ? toForm(event) : null), [event]);
  const [form, setForm] = useState<EditableEvent | null>(initial);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed whenever a different row is opened. Keyed on the event id rather
  // than on `visible` so reopening the same row after a save doesn't resurrect
  // the pre-save draft.
  useEffect(() => {
    setForm(initial);
    setError(null);
    setConfirmLeave(false);
  }, [initial]);

  const patch = form && initial ? buildPatch(form, initial) : {};
  const isDirty = Object.keys(patch).length > 0;

  const bucket = useMemo(
    () => INTEREST_CATEGORIES.find((category) => category.id === form?.bucket) ?? null,
    [form?.bucket],
  );

  const save = useMutation({
    mutationFn: () => {
      if (!event) throw new Error('NO_EVENT');
      return api.patch(`/events/${event.id}`, { token, body: patch });
    },
    onSuccess: () => {
      // Every cached view of this event is now stale: the console list, the
      // Analytics tab's per-event cards (a retitled event renames its card),
      // the event detail screen, and the ranked feeds that read its tags.
      if (orgId != null) {
        queryClient.invalidateQueries({ queryKey: orgKeys.eventsAll(orgId) });
        queryClient.invalidateQueries({ queryKey: orgKeys.analyticsAll(orgId) });
      }
      queryClient.invalidateQueries({ queryKey: userKeys.myEventsAll() });
      if (event) queryClient.invalidateQueries({ queryKey: eventKeys.detail(event.id) });
      queryClient.invalidateQueries({ queryKey: eventKeys.lists() });
      queryClient.invalidateQueries({ queryKey: feedKeys.all });
      setConfirmLeave(false);
      onClose();
    },
    onError: (err) => {
      setConfirmLeave(false);
      setError(describeSaveError(err));
    },
  });

  const update = (partial: Partial<EditableEvent>) =>
    setForm((prev) => (prev ? { ...prev, ...partial } : prev));

  const requestClose = () => {
    if (save.isPending) return;
    if (isDirty) {
      setConfirmLeave(true);
      return;
    }
    onClose();
  };

  const toggleTag = (tag: string) => {
    if (!form) return;
    if (form.tags.includes(tag)) {
      update({ tags: form.tags.filter((t) => t !== tag) });
      return;
    }
    if (form.tags.length >= MAX_INTEREST_TAGS) return;
    update({ tags: [...form.tags, tag] });
  };

  const pickBucket = (id: string) => {
    if (!form) return;
    // Tags are scoped to a bucket, so changing the bucket has to drop any tag
    // that no longer belongs — otherwise the server silently discards them and
    // the chips lie about what was saved.
    const allowed = new Set(INTEREST_CATEGORIES.find((c) => c.id === id)?.tags ?? []);
    update({ bucket: id, tags: form.tags.filter((tag) => allowed.has(tag)) });
  };

  return (
    <Modal
      visible={visible && !!form}
      animationType="slide"
      transparent={false}
      statusBarTranslucent
      onRequestClose={requestClose}
    >
      <View className="flex-1 bg-lhlBackgroundColor" style={{ paddingTop: insets.top }}>
        <View className="flex-row items-center justify-between border-b border-lhlDivider px-[20px] py-[12px]">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            disabled={save.isPending}
            onPress={requestClose}
            hitSlop={10}
          >
            <Text className="font-['Roboto-Flex'] text-[13px] text-lhlSecondaryTextGrey">
              Cancel
            </Text>
          </Pressable>

          <Text className="font-['Roboto-Flex'] text-[16px] font-semibold text-lhlInk">
            Edit Event
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save changes"
            accessibilityState={{ disabled: !isDirty || save.isPending }}
            disabled={!isDirty || save.isPending}
            onPress={() => {
              setError(null);
              save.mutate();
            }}
            hitSlop={10}
          >
            {save.isPending ? (
              <ActivityIndicator color={colors.brand} />
            ) : (
              <Text
                className={`font-['Roboto-Flex'] text-[13px] font-semibold ${
                  isDirty ? 'text-lhlAccent' : 'text-lhlMutedText'
                }`}
              >
                Save
              </Text>
            )}
          </Pressable>
        </View>

        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            className="flex-1 bg-lhlBackgroundColor px-[20px]"
            contentContainerStyle={{ paddingTop: 16, paddingBottom: 48 + insets.bottom }}
            keyboardShouldPersistTaps="handled"
          >
            {error ? (
              <View className="mb-[14px] rounded-[8px] bg-lhlDestructiveSoft px-[12px] py-[10px]">
                <Text className="font-['Roboto-Flex'] text-[12px] text-lhlDestructiveRed">
                  {error}
                </Text>
              </View>
            ) : null}

            <FieldLabel>Event Title</FieldLabel>
            <TextInput
              value={form?.title ?? ''}
              onChangeText={(text) => update({ title: text })}
              placeholder="Enter Event Title"
              placeholderTextColor={colors.inkMuted}
              maxLength={TITLE_MAX}
              className="rounded-[8px] border border-lhlMutedBorder bg-lhlSurface px-[16px] py-[12px] text-[14px] text-lhlInk"
            />

            <FieldLabel className="mt-[20px]">Description</FieldLabel>
            <TextInput
              value={form?.description ?? ''}
              onChangeText={(text) => update({ description: text })}
              placeholder="Tell people what your event is about..."
              placeholderTextColor={colors.inkMuted}
              maxLength={DESCRIPTION_MAX}
              multiline
              textAlignVertical="top"
              className="min-h-[120px] rounded-[8px] border border-lhlMutedBorder bg-lhlSurface px-[16px] py-[12px] text-[14px] text-lhlInk"
            />

            <View className="mt-[20px]">
              <DateTimeField
                label="Start"
                iso={form?.startDatetime ?? null}
                onChange={(iso) => update({ startDatetime: iso })}
              />
              <DateTimeField
                label="End"
                iso={form?.endDatetime ?? null}
                onChange={(iso) => update({ endDatetime: iso })}
                minimumIso={form?.startDatetime ?? null}
                fallbackIso={form?.startDatetime ?? null}
              />
            </View>

            <FieldLabel>Location</FieldLabel>
            <TextInput
              value={form?.location ?? ''}
              onChangeText={(text) => update({ location: text })}
              placeholder="Where is it?"
              placeholderTextColor={colors.inkMuted}
              maxLength={LOCATION_MAX}
              className="rounded-[8px] border border-lhlMutedBorder bg-lhlSurface px-[16px] py-[12px] text-[14px] text-lhlInk"
            />

            <FieldLabel className="mt-[24px]">Category</FieldLabel>
            <View className="flex-row flex-wrap gap-[8px]">
              {INTEREST_CATEGORIES.map((category) => {
                const isSelected = category.id === form?.bucket;
                return (
                  <Pressable
                    key={category.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => pickBucket(category.id)}
                    className={`rounded-full border px-[12px] py-[7px] ${
                      isSelected
                        ? 'border-lhlBurntOrange bg-lhlBurntOrange'
                        : 'border-lhlMutedBorder bg-lhlSurface'
                    }`}
                  >
                    <Text
                      className={`font-['Roboto-Flex'] text-[12px] font-medium ${
                        isSelected ? 'text-white' : 'text-lhlInk'
                      }`}
                    >
                      {category.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View className="mt-[20px] flex-row items-center justify-between">
              <Text className="font-['Roboto-Flex'] text-[16px] font-semibold text-lhlInk">
                Interest Tags
              </Text>
              <View className="rounded-full border border-lhlMutedBorder bg-lhlSurface px-[10px] py-[4px]">
                <Text className="font-['Roboto-Flex'] text-[11px] text-lhlInk">
                  {form?.tags.length ?? 0}/{MAX_INTEREST_TAGS}
                </Text>
              </View>
            </View>

            {bucket ? (
              <View className="mt-[10px] flex-row flex-wrap gap-[8px]">
                {bucket.tags.map((tag) => {
                  const isSelected = !!form?.tags.includes(tag);
                  const atLimit = (form?.tags.length ?? 0) >= MAX_INTEREST_TAGS;
                  return (
                    <Pressable
                      key={tag}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      disabled={!isSelected && atLimit}
                      onPress={() => toggleTag(tag)}
                      className={`rounded-full border px-[12px] py-[7px] ${
                        isSelected
                          ? 'border-lhlBurntOrange bg-lhlBurntOrange'
                          : 'border-lhlMutedBorder bg-lhlSurface'
                      } ${!isSelected && atLimit ? 'opacity-40' : ''}`}
                    >
                      <Text
                        className={`font-['Roboto-Flex'] text-[12px] font-medium ${
                          isSelected ? 'text-white' : 'text-lhlInk'
                        }`}
                      >
                        {tag}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <Text className="font-['Roboto-Flex'] mt-[10px] text-[12px] text-lhlSecondaryTextGrey">
                Pick a category above to choose interest tags.
              </Text>
            )}

            {/* Named rather than silently absent, so nobody spends ten minutes
                looking for the flyer field that was never built. */}
            <Text className="font-['Roboto-Flex'] mt-[26px] text-[11px] leading-[16px] text-lhlSecondaryTextGrey">
              Event images and repeating schedules can’t be changed here yet.
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>

      <LeaveWithoutSavingModal
        visible={confirmLeave}
        isSaving={save.isPending}
        onDismiss={() => setConfirmLeave(false)}
        onDiscard={() => {
          setConfirmLeave(false);
          onClose();
        }}
        onSave={() => {
          setError(null);
          save.mutate();
        }}
      />
    </Modal>
  );
}

function FieldLabel({ children, className = '' }: { children: string; className?: string }) {
  return (
    <Text
      className={`font-['Roboto-Flex'] mb-[8px] text-[16px] font-semibold text-lhlInk ${className}`}
    >
      {children}
    </Text>
  );
}

/**
 * Surface the server's own words where it has any.
 *
 * VALIDATION_ERROR carries a per-field message ("Must be 80 characters or
 * fewer"), which is more useful than a generic failure, and FORBIDDEN is worth
 * spelling out because it means the caller's role changed underneath them —
 * the pencil they just tapped shouldn't have been there.
 */
function describeSaveError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.isNetworkError) return err.message;
    if (err.status === 401) return 'Your session expired. Sign in again.';
    if (err.status === 403) return 'You no longer have permission to edit this event.';
    if (err.status === 404) return 'That event no longer exists.';

    const body = err.body as { fields?: Record<string, string> } | null;
    const first = body?.fields ? Object.values(body.fields)[0] : null;
    if (first) return first;
    return err.message;
  }
  return 'Could not save those changes. Try again.';
}
