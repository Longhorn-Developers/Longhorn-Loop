// Step 5 of the create flow. The date/time field itself lives in
// DateTimeField.tsx so the Org Management console's edit overlay (LOOP-136)
// edits datetimes through the same control; this step keeps the wizard
// chrome and the Single Day / Date Range decision, which is create-only.

import { useCreateEvent } from '@/app/context/CreateEventContext';
import type { DateMode } from '@/app/context/CreateEventContext';
import DateTimeField from '@/app/components/create-event/DateTimeField';
import type { ThemeColors } from '@/app/lib/themeColors';
import { useThemeColors } from '@/app/lib/themeColors';
import React, { useMemo } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function WhenIsIt() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { data, update, goNext, goBack } = useCreateEvent();

  const canContinue =
    data.startDatetime !== null && (data.dateMode === 'single' || data.endDatetime !== null);

  const setMode = (mode: DateMode) => {
    if (mode === data.dateMode) return;
    update({ dateMode: mode, ...(mode === 'single' ? { endDatetime: null } : {}) });
  };

  const onContinue = () => {
    if (!canContinue) return;
    goNext();
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} hitSlop={12}>
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
          <DateTimeField
            label="Date"
            iso={data.startDatetime}
            onChange={(iso) => update({ startDatetime: iso })}
          />
        ) : (
          <>
            <DateTimeField
              label="Start"
              iso={data.startDatetime}
              onChange={(iso) => update({ startDatetime: iso })}
            />
            <DateTimeField
              label="End"
              iso={data.endDatetime}
              onChange={(iso) => update({ endDatetime: iso })}
              minimumIso={data.startDatetime}
              fallbackIso={data.startDatetime}
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
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

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

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
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
      color: c.ink,
    },
    headerTitle: {
      fontSize: 19,
      fontWeight: '600',
      color: c.ink,
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
      color: c.inkSecondary,
      letterSpacing: 1,
      marginBottom: 6,
    },
    stepTitle: {
      fontSize: 24,
      fontWeight: '500',
      color: c.ink,
    },
    progressTrack: {
      height: 10,
      backgroundColor: c.placeholder,
      borderRadius: 999,
      overflow: 'hidden',
      marginBottom: 24,
    },
    progressFill: {
      height: '100%',
      backgroundColor: c.brand,
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
      borderColor: c.brand,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surface,
    },
    modeButtonActive: {
      backgroundColor: c.brand,
    },
    modeText: {
      fontSize: 14,
      fontWeight: '600',
      color: c.inkSecondary,
    },
    modeTextActive: {
      color: '#FFFFFF',
    },
    continueButton: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
      paddingVertical: 14,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 12,
    },
    continueButtonEnabled: {
      backgroundColor: c.brand,
      borderColor: c.brand,
    },
    continueText: {
      fontSize: 16,
      fontWeight: '600',
      color: c.ink,
    },
    continueTextEnabled: {
      color: '#FFFFFF',
    },
  });
