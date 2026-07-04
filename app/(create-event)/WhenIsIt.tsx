import CalendarIcon from '@/assets/images/calendar-input.svg';
import { useCreateEvent } from '@/app/context/CreateEventContext';
import type { DateMode } from '@/app/context/CreateEventContext';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const BURNT_ORANGE = '#9D4A06';
const CARD_BG = '#FFFFFF';
const INPUT_BORDER = '#00000033';
const BG = '#F9F8F5';
const TEXT_SECONDARY = '#485656';
const TEXT_MUTED = '#9CA3AF';

// Which slot the current picker is editing, and whether it's the date or
// time portion. Both share the same ISO field on context; we just modify
// the corresponding half of the Date.
type PickerTarget = { slot: 'start' | 'end'; kind: 'date' | 'time' } | null;

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  let h = d.getHours();
  const m = d.getMinutes();
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  const mm = String(m).padStart(2, '0');
  return `${h}:${mm} ${suffix}`;
}

// Combine a date portion (year/month/day) with an existing ISO's time,
// or with 09:00 as a friendly default when the slot is empty.
function withDate(existingIso: string | null, picked: Date): string {
  const base = existingIso ? new Date(existingIso) : new Date(picked);
  if (!existingIso) {
    base.setHours(9, 0, 0, 0);
  }
  base.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
  return base.toISOString();
}

// Combine an existing ISO's date with a new time portion.
function withTime(existingIso: string | null, picked: Date): string {
  const base = existingIso ? new Date(existingIso) : new Date();
  base.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
  return base.toISOString();
}

export default function WhenIsIt() {
  const router = useRouter();
  const { data, update } = useCreateEvent();
  const [picker, setPicker] = useState<PickerTarget>(null);

  const canContinue =
    data.startDatetime !== null && (data.dateMode === 'single' || data.endDatetime !== null);

  const setMode = (mode: DateMode) => {
    if (mode === data.dateMode) return;
    update({ dateMode: mode, ...(mode === 'single' ? { endDatetime: null } : {}) });
  };

  const openPicker = (target: PickerTarget) => {
    // Pre-fill the slot with the default (today for start / start's day for
    // end) so that tapping Done without moving the picker still saves a
    // value. Without this, the picker's onChange never fires because the
    // user didn't change anything, and Done becomes a no-op.
    if (target) {
      const targetIso = target.slot === 'start' ? data.startDatetime : data.endDatetime;
      if (!targetIso) {
        const fallback =
          target.slot === 'end' && data.startDatetime ? new Date(data.startDatetime) : new Date();
        const seedIso =
          target.kind === 'date' ? withDate(null, fallback) : withTime(null, fallback);
        update(target.slot === 'start' ? { startDatetime: seedIso } : { endDatetime: seedIso });
      }
    }
    setPicker(target);
  };
  const closePicker = () => setPicker(null);

  const onPickerChange = (_event: unknown, selected?: Date) => {
    if (Platform.OS === 'android') closePicker();
    if (!selected || !picker) return;

    const target = picker.slot === 'start' ? data.startDatetime : data.endDatetime;
    const nextIso =
      picker.kind === 'date' ? withDate(target, selected) : withTime(target, selected);
    update(picker.slot === 'start' ? { startDatetime: nextIso } : { endDatetime: nextIso });
  };

  const pickerValue: Date = (() => {
    if (!picker) return new Date();
    const target = picker.slot === 'start' ? data.startDatetime : data.endDatetime;
    if (target) return new Date(target);
    // Sensible default when opening the End Date picker with no start yet.
    if (picker.slot === 'end' && data.startDatetime) return new Date(data.startDatetime);
    return new Date();
  })();

  const onContinue = () => {
    if (!canContinue) return;
    router.push('/(create-event)/OptionalExtras');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Create an Event</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.stepBlock}>
          <Text style={styles.stepLabel}>STEP 5 OF 6</Text>
          <Text style={styles.stepTitle}>When is it?</Text>
        </View>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: '83.33%' }]} />
        </View>

        <View style={styles.modeRow}>
          <ModeButton
            label="Single Day"
            active={data.dateMode === 'single'}
            onPress={() => setMode('single')}
          />
          <ModeButton
            label="Date Range"
            active={data.dateMode === 'range'}
            onPress={() => setMode('range')}
          />
        </View>

        {data.dateMode === 'single' ? (
          <>
            <DateTimeRow
              label="Date"
              iso={data.startDatetime}
              onPickDate={() => openPicker({ slot: 'start', kind: 'date' })}
              onPickTime={() => openPicker({ slot: 'start', kind: 'time' })}
            />
          </>
        ) : (
          <>
            <DateTimeRow
              label="Start"
              iso={data.startDatetime}
              onPickDate={() => openPicker({ slot: 'start', kind: 'date' })}
              onPickTime={() => openPicker({ slot: 'start', kind: 'time' })}
            />
            <DateTimeRow
              label="End"
              iso={data.endDatetime}
              onPickDate={() => openPicker({ slot: 'end', kind: 'date' })}
              onPickTime={() => openPicker({ slot: 'end', kind: 'time' })}
            />
          </>
        )}

        <TouchableOpacity
          onPress={onContinue}
          activeOpacity={canContinue ? 0.85 : 1}
          disabled={!canContinue}
          style={[styles.continueButton, canContinue && styles.continueButtonEnabled]}
        >
          <Text style={[styles.continueText, canContinue && styles.continueTextEnabled]}>
            Continue
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* iOS: modal wraps the inline picker with a Done button.
          Android: DateTimePicker shows the system dialog directly. */}
      {picker !== null && Platform.OS === 'ios' && (
        <Modal transparent animationType="fade" visible onRequestClose={closePicker}>
          <Pressable style={styles.modalBackdrop} onPress={closePicker}>
            <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
              <DateTimePicker
                value={pickerValue}
                mode={picker.kind}
                display={picker.kind === 'date' ? 'inline' : 'spinner'}
                onChange={onPickerChange}
                minimumDate={
                  picker.slot === 'end' && picker.kind === 'date' && data.startDatetime
                    ? new Date(data.startDatetime)
                    : undefined
                }
              />
              <TouchableOpacity
                style={styles.doneButton}
                onPress={closePicker}
                activeOpacity={0.85}
              >
                <Text style={styles.doneText}>Done</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {picker !== null && Platform.OS === 'android' && (
        <DateTimePicker
          value={pickerValue}
          mode={picker.kind}
          display="default"
          onChange={onPickerChange}
          minimumDate={
            picker.slot === 'end' && picker.kind === 'date' && data.startDatetime
              ? new Date(data.startDatetime)
              : undefined
          }
        />
      )}
    </SafeAreaView>
  );
}

function ModeButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.modeButton, active && styles.modeButtonActive]}
    >
      <Text style={[styles.modeText, active && styles.modeTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function DateTimeRow({
  label,
  iso,
  onPickDate,
  onPickTime,
}: {
  label: string;
  iso: string | null;
  onPickDate: () => void;
  onPickTime: () => void;
}) {
  const dateLabel = formatDate(iso);
  const timeLabel = formatTime(iso);

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.row}>
        <TouchableOpacity
          onPress={onPickDate}
          activeOpacity={0.85}
          style={[styles.pickerInput, styles.dateInput]}
        >
          <Text style={[styles.pickerValue, !dateLabel && styles.pickerValueMuted]}>
            {dateLabel || 'mm/dd/yyyy'}
          </Text>
          <CalendarIcon width={14} height={15} color="#020B12" />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onPickTime}
          activeOpacity={0.85}
          style={[styles.pickerInput, styles.timeInput]}
        >
          <Text style={[styles.pickerValue, !timeLabel && styles.pickerValueMuted]}>
            {timeLabel || '--:-- --'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  backArrow: {
    fontSize: 22,
    color: '#000000',
  },
  headerTitle: {
    fontSize: 19,
    fontWeight: '600',
    color: '#000000',
    letterSpacing: -0.5,
  },
  headerSpacer: {
    width: 22,
  },
  stepBlock: {
    marginBottom: 18,
  },
  stepLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: TEXT_SECONDARY,
    letterSpacing: 1,
    marginBottom: 6,
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: '500',
    color: '#000000',
  },
  progressTrack: {
    height: 10,
    backgroundColor: '#E5E1DA',
    borderRadius: 999,
    overflow: 'hidden',
    marginBottom: 24,
  },
  progressFill: {
    height: '100%',
    backgroundColor: BURNT_ORANGE,
    borderRadius: 999,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  modeButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BURNT_ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CARD_BG,
  },
  modeButtonActive: {
    backgroundColor: BURNT_ORANGE,
  },
  modeText: {
    fontSize: 14,
    fontWeight: '600',
    color: TEXT_SECONDARY,
  },
  modeTextActive: {
    color: '#FFFFFF',
  },
  field: {
    marginBottom: 20,
  },
  fieldLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#020B12',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  pickerInput: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: CARD_BG,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  dateInput: {
    flex: 3,
  },
  timeInput: {
    flex: 2,
    justifyContent: 'center',
  },
  pickerValue: {
    fontSize: 14,
    color: '#020B12',
  },
  pickerValueMuted: {
    color: TEXT_MUTED,
  },
  continueButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    backgroundColor: CARD_BG,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  continueButtonEnabled: {
    backgroundColor: BURNT_ORANGE,
    borderColor: BURNT_ORANGE,
  },
  continueText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#020B12',
  },
  continueTextEnabled: {
    color: '#FFFFFF',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    width: '100%',
    backgroundColor: CARD_BG,
    borderRadius: 12,
    padding: 12,
  },
  doneButton: {
    backgroundColor: BURNT_ORANGE,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  doneText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
