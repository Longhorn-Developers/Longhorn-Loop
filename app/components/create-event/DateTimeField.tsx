// One labelled date + time pair, bound to a single ISO string.
//
// Extracted out of the "When is it?" wizard step for LOOP-136, because the
// edit overlay on the Org Management console edits exactly the two datetimes
// the create wizard collects. Copying the markup would have made this the
// second place in the app that decides what happens when you tap Done without
// moving the spinner, or how a date picked in one field seeds the other — and
// those are the details that quietly disagree.
//
// The wizard step keeps everything that is wizard-shaped (header, progress
// bar, Single Day / Date Range toggle, Continue). Only the field moved, and
// its behaviour is preserved verbatim, including the pre-seed on open: without
// it the picker's onChange never fires for a user who accepts the default, and
// Done becomes a silent no-op.

import CalendarIcon from '@/assets/images/calendar-input.svg';
import type { ThemeColors } from '@/app/lib/themeColors';
import { useThemeColors } from '@/app/lib/themeColors';
import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useMemo, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

/** Which half of the datetime the open picker is editing. */
type PickerKind = 'date' | 'time';

export function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

export function formatTime(iso: string | null): string {
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
export function withDate(existingIso: string | null, picked: Date): string {
  const base = existingIso ? new Date(existingIso) : new Date(picked);
  if (!existingIso) {
    base.setHours(9, 0, 0, 0);
  }
  base.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
  return base.toISOString();
}

// Combine an existing ISO's date with a new time portion.
export function withTime(existingIso: string | null, picked: Date): string {
  const base = existingIso ? new Date(existingIso) : new Date();
  base.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
  return base.toISOString();
}

export interface DateTimeFieldProps {
  label: string;
  /** Current value, or null when the slot is empty. */
  iso: string | null;
  onChange: (iso: string) => void;
  /** Earliest selectable date — pass the start when this field is the end. */
  minimumIso?: string | null;
  /** Seeds an empty slot when the picker opens. Defaults to now. */
  fallbackIso?: string | null;
}

export default function DateTimeField({
  label,
  iso,
  onChange,
  minimumIso,
  fallbackIso,
}: DateTimeFieldProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [picker, setPicker] = useState<PickerKind | null>(null);

  const openPicker = (kind: PickerKind) => {
    // Pre-fill an empty slot so that tapping Done without moving the picker
    // still saves a value.
    if (!iso) {
      const fallback = fallbackIso ? new Date(fallbackIso) : new Date();
      onChange(kind === 'date' ? withDate(null, fallback) : withTime(null, fallback));
    }
    setPicker(kind);
  };

  const closePicker = () => setPicker(null);

  const onPickerChange = (_event: unknown, selected?: Date) => {
    if (Platform.OS === 'android') closePicker();
    if (!selected || !picker) return;
    onChange(picker === 'date' ? withDate(iso, selected) : withTime(iso, selected));
  };

  const pickerValue: Date = iso ? new Date(iso) : fallbackIso ? new Date(fallbackIso) : new Date();

  const minimumDate = picker === 'date' && minimumIso ? new Date(minimumIso) : undefined;

  const dateLabel = formatDate(iso);
  const timeLabel = formatTime(iso);

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.row}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`${label} date`}
          onPress={() => openPicker('date')}
          activeOpacity={0.85}
          style={[styles.pickerInput, styles.dateInput]}
        >
          <Text style={[styles.pickerValue, !dateLabel && styles.pickerValueMuted]}>
            {dateLabel || 'mm/dd/yyyy'}
          </Text>
          <CalendarIcon width={14} height={15} color={colors.ink} />
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`${label} time`}
          onPress={() => openPicker('time')}
          activeOpacity={0.85}
          style={[styles.pickerInput, styles.timeInput]}
        >
          <Text style={[styles.pickerValue, !timeLabel && styles.pickerValueMuted]}>
            {timeLabel || '--:-- --'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* iOS: modal wraps the inline picker with a Done button.
          Android: DateTimePicker shows the system dialog directly. */}
      {picker !== null && Platform.OS === 'ios' && (
        <Modal transparent animationType="fade" visible onRequestClose={closePicker}>
          <Pressable style={styles.modalBackdrop} onPress={closePicker}>
            <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
              <DateTimePicker
                value={pickerValue}
                mode={picker}
                display={picker === 'date' ? 'inline' : 'spinner'}
                onChange={onPickerChange}
                minimumDate={minimumDate}
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
          mode={picker}
          display="default"
          onChange={onPickerChange}
          minimumDate={minimumDate}
        />
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    field: {
      marginBottom: 20,
    },
    fieldLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: c.ink,
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
      backgroundColor: c.surface,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.border,
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
      color: c.ink,
    },
    pickerValueMuted: {
      color: c.inkMuted,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: c.scrim,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 24,
    },
    modalCard: {
      width: '100%',
      backgroundColor: c.surface,
      borderRadius: 12,
      padding: 12,
    },
    doneButton: {
      backgroundColor: c.brand,
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
