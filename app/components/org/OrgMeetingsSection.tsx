// "Meetings" on an org's landing page (LOOP-319): when and where the org
// regularly meets, for its MEMBERS only.
//
// The caller renders this only when GET /orgs/:id/profile says the viewer is a
// member, but that is presentation. The real gate is the server:
// GET /orgs/:id/meetings 403s anyone who isn't in org_members, so a stranger
// calling the API directly gets nothing either. Admins add, edit and remove
// meetings here, on the page where they're shown, through MeetingFormSheet;
// editors see the list read-only (writes are admin-only on the server too).
//
// Weekly recurring only. A one-off gathering is an event. See
// shared/orgMeetings.ts for the rules and the display format.

import TextInputField from '@/app/components/inputs/TextInputField';
import DragDismissSheet from '@/app/components/modals/DragDismissSheet';
import ProfileModal, { ModalAction } from '@/app/components/modals/ProfileModal';
import { ApiError, api } from '@/app/lib/api';
import { org as orgKeys } from '@/app/lib/queryKeys';
import { MIN_TAP_TARGET, hitSlopFor } from '@/app/lib/tapTarget';
import { useThemeColors } from '@/app/lib/themeColors';
import PencilIcon from '@/assets/images/pencil.svg';
import {
  DAY_SHORT,
  MAX_MEETINGS_PER_ORG,
  formatMeetingWhen,
  formatTime,
  parseTimeInput,
  type OrgMeeting,
  type OrgMeetingInput,
} from '@/shared/orgMeetings';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

export interface OrgMeetingsSectionProps {
  orgId: number;
  role: 'admin' | 'editor';
  token: string | null;
}

export default function OrgMeetingsSection({ orgId, role, token }: OrgMeetingsSectionProps) {
  const colors = useThemeColors();
  const isAdmin = role === 'admin';
  /** null = closed; 'new' = adding; a meeting = editing it. */
  const [editing, setEditing] = useState<OrgMeeting | 'new' | null>(null);

  const meetings = useQuery({
    queryKey: orgKeys.meetings(orgId),
    queryFn: () => api.get<{ meetings: OrgMeeting[] }>(`/orgs/${orgId}/meetings`, { token }),
    enabled: !!token && Number.isFinite(orgId),
  });

  const list = meetings.data?.meetings ?? [];
  const canAdd = isAdmin && list.length < MAX_MEETINGS_PER_ORG;

  return (
    <View className="mt-[24px] px-[20px]">
      <View className="flex-row items-center justify-between">
        <Text className="font-roboto-semibold text-[20px] leading-[24px] text-lhlInk">
          Meetings
        </Text>
        {canAdd ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a meeting time"
            onPress={() => setEditing('new')}
            hitSlop={hitSlopFor(32)}
            className="items-center justify-center rounded-[8px] bg-lhlBurntOrange px-[12px]"
            style={{ height: 32 }}
          >
            {/* theme-exempt: white on the filled brand button. */}
            <Text className="font-roboto-semibold text-[12px] text-white">Add</Text>
          </Pressable>
        ) : null}
      </View>
      <Text className="font-roboto mt-[4px] text-[12px] leading-[14px] text-lhlSecondaryTextGrey">
        Only members of this organization can see these.
      </Text>

      <View className="mt-[12px]">
        {meetings.isLoading ? (
          <ActivityIndicator color={colors.brand} />
        ) : meetings.isError ? (
          <Pressable accessibilityRole="button" onPress={() => meetings.refetch()}>
            <Text className="font-roboto text-[14px] text-lhlSecondaryTextGrey">
              Couldn’t load meeting times. Tap to try again.
            </Text>
          </Pressable>
        ) : list.length === 0 ? (
          <View className="rounded-[20px] border border-lhlBorderSoft bg-lhlSurface px-[16px] py-[18px]">
            <Text className="font-roboto text-[14px] leading-[18px] text-lhlSecondaryTextGrey">
              {isAdmin
                ? 'No meeting times yet. Add when and where the org meets.'
                : 'No meeting times yet.'}
            </Text>
          </View>
        ) : (
          <View className="gap-[12px]">
            {list.map((m) => (
              <View
                key={m.id}
                className="flex-row items-start rounded-[20px] border border-lhlBorderSoft bg-lhlSurface px-[16px] py-[14px]"
              >
                <View className="flex-1">
                  <Text className="font-roboto-medium text-[14px] leading-[18px] text-lhlInk">
                    {m.label}
                  </Text>
                  <Text className="font-roboto-medium mt-[4px] text-[12px] leading-[16px] text-lhlInk">
                    {formatMeetingWhen(m)}
                  </Text>
                  <Text className="font-roboto mt-[2px] text-[12px] leading-[16px] text-lhlSecondaryTextGrey">
                    {m.location}
                  </Text>
                  {m.notes ? (
                    <Text className="font-roboto mt-[6px] text-[12px] leading-[16px] text-lhlSecondaryTextGrey">
                      {m.notes}
                    </Text>
                  ) : null}
                </View>
                {isAdmin ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${m.label}`}
                    onPress={() => setEditing(m)}
                    className="items-center justify-center"
                    style={{ width: MIN_TAP_TARGET, height: MIN_TAP_TARGET, marginRight: -12 }}
                  >
                    <PencilIcon width={14} height={14} color={colors.ink} />
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        )}
      </View>

      {isAdmin ? (
        <MeetingFormSheet
          orgId={orgId}
          token={token}
          meeting={editing === 'new' ? null : editing}
          visible={editing !== null}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </View>
  );
}

type FieldErrors = Partial<Record<keyof OrgMeetingInput, string>>;

function MeetingFormSheet({
  orgId,
  token,
  meeting,
  visible,
  onClose,
}: {
  orgId: number;
  token: string | null;
  /** null when adding. */
  meeting: OrgMeeting | null;
  visible: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [day, setDay] = useState<number | null>(null);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Load the form on the closed -> open transition, during render rather than
  // in an effect, so the first frame already shows the meeting being edited.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setLabel(meeting?.label ?? '');
      setDay(meeting?.day_of_week ?? null);
      setStart(meeting ? formatTime(meeting.start_time) : '');
      setEnd(meeting?.end_time ? formatTime(meeting.end_time) : '');
      setLocation(meeting?.location ?? '');
      setNotes(meeting?.notes ?? '');
      setErrors({});
      setFormError(null);
    }
  }

  const parsedStart = parseTimeInput(start);
  const parsedEnd = end.trim() ? parseTimeInput(end) : null;

  const done = () => {
    queryClient.invalidateQueries({ queryKey: orgKeys.meetings(orgId) });
    onClose();
  };
  const fail = (err: unknown) => {
    const body = err instanceof ApiError ? (err.body as Record<string, unknown> | null) : null;
    if (body?.errors && typeof body.errors === 'object') setErrors(body.errors as FieldErrors);
    setFormError((body?.message as string) ?? 'Could not save that meeting. Try again.');
  };

  const save = useMutation({
    mutationFn: (input: OrgMeetingInput) =>
      meeting
        ? api.patch(`/orgs/${orgId}/meetings/${meeting.id}`, { token, body: input })
        : api.post(`/orgs/${orgId}/meetings`, { token, body: input }),
    onSuccess: done,
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/orgs/${orgId}/meetings/${meeting!.id}`, { token }),
    onSuccess: done,
    onError: fail,
  });

  const submit = () => {
    setFormError(null);
    // Check what the server would refuse up front, so the form can point at
    // the field. The server validates again with the same rules.
    const local: FieldErrors = {};
    if (!label.trim()) local.label = 'Give the meeting a name.';
    if (day === null) local.day_of_week = 'Pick a day.';
    if (!parsedStart) local.start_time = 'Try a time like 7pm or 19:00.';
    if (end.trim() && !parsedEnd) local.end_time = 'Try a time like 8:30pm.';
    if (!location.trim()) local.location = 'Say where it meets.';
    setErrors(local);
    if (Object.keys(local).length > 0) return;
    save.mutate({
      label: label.trim(),
      day_of_week: day!,
      start_time: parsedStart!,
      end_time: parsedEnd,
      location: location.trim(),
      notes: notes.trim() || null,
    });
  };

  const busy = save.isPending || remove.isPending;

  const header = (
    <View className="px-[20px] pb-[8px] pt-[4px]">
      <Text className="font-roboto-semibold text-[20px] text-lhlInk">
        {meeting ? 'Edit meeting' : 'Add a meeting'}
      </Text>
    </View>
  );

  return (
    <DragDismissSheet visible={visible} onClose={onClose} dragFrom="header" header={header}>
      <ScrollView
        style={{ maxHeight: 560 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 14 }}
        keyboardShouldPersistTaps="handled"
      >
        <Field error={errors.label}>
          <TextInputField
            label="Name"
            value={label}
            onChangeText={setLabel}
            placeholder="General meeting"
            height={44}
            borderRadius={8}
          />
        </Field>

        <Field error={errors.day_of_week}>
          <Text className="font-roboto-medium mb-[6px] text-[12px] text-lhlInk">Every</Text>
          <View className="flex-row flex-wrap gap-[6px]">
            {DAY_SHORT.map((d, i) => {
              const selected = day === i;
              return (
                <Pressable
                  key={d}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setDay(i)}
                  className={`items-center justify-center rounded-full px-[12px] ${
                    selected ? 'bg-lhlBurntOrange' : 'border border-lhlBorderSoft bg-lhlSurfaceGrey'
                  }`}
                  style={{ height: MIN_TAP_TARGET, minWidth: MIN_TAP_TARGET }}
                >
                  <Text
                    className={`font-roboto-medium text-[12px] ${
                      selected ? 'text-white' : 'text-lhlInk'
                    }`}
                  >
                    {d}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Field>

        <View className="flex-row gap-[10px]">
          <View className="flex-1">
            <Field
              error={errors.start_time}
              hint={parsedStart && start.trim() ? formatTime(parsedStart) : undefined}
            >
              <TextInputField
                label="Starts"
                value={start}
                onChangeText={setStart}
                placeholder="7pm"
                autoCapitalize="none"
                height={44}
                borderRadius={8}
              />
            </Field>
          </View>
          <View className="flex-1">
            <Field error={errors.end_time} hint={parsedEnd ? formatTime(parsedEnd) : undefined}>
              <TextInputField
                label="Ends (optional)"
                value={end}
                onChangeText={setEnd}
                placeholder="8:30pm"
                autoCapitalize="none"
                height={44}
                borderRadius={8}
              />
            </Field>
          </View>
        </View>

        <Field error={errors.location}>
          <TextInputField
            label="Where"
            value={location}
            onChangeText={setLocation}
            placeholder="GDC 2.216"
            height={44}
            borderRadius={8}
          />
        </Field>

        <Field error={errors.notes}>
          <TextInputField
            label="Notes (optional)"
            value={notes}
            onChangeText={setNotes}
            placeholder="Bring a laptop"
            height={44}
            borderRadius={8}
          />
        </Field>

        {formError ? (
          <Text className="font-roboto text-[12px] text-lhlDestructiveRed">{formError}</Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={submit}
          className={`items-center justify-center rounded-[8px] bg-lhlBurntOrange ${
            busy ? 'opacity-60' : ''
          }`}
          style={{ height: MIN_TAP_TARGET }}
        >
          <Text className="font-roboto-semibold text-[14px] text-white">
            {save.isPending ? 'Saving…' : 'Save'}
          </Text>
        </Pressable>

        {meeting ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => setConfirmingDelete(true)}
            className="items-center justify-center rounded-[8px] bg-lhlDestructiveSoft"
            style={{ height: MIN_TAP_TARGET }}
          >
            <Text className="font-roboto-semibold text-[14px] text-lhlDestructiveRed">
              Remove meeting
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <ProfileModal
        visible={confirmingDelete}
        title="Remove this meeting?"
        body="Members won’t see it on the org page any more."
        onDismiss={() => setConfirmingDelete(false)}
        actions={
          <>
            <ModalAction
              label="Cancel"
              variant="outline"
              onPress={() => setConfirmingDelete(false)}
            />
            <ModalAction
              label="Remove"
              variant="destructive"
              onPress={() => {
                setConfirmingDelete(false);
                remove.mutate();
              }}
            />
          </>
        }
      />
    </DragDismissSheet>
  );
}

function Field({
  error,
  hint,
  children,
}: {
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View>
      {children}
      {error ? (
        <Text className="font-roboto mt-[4px] text-[12px] text-lhlDestructiveRed">{error}</Text>
      ) : hint ? (
        <Text className="font-roboto mt-[4px] text-[12px] text-lhlSecondaryTextGrey">{hint}</Text>
      ) : null}
    </View>
  );
}
