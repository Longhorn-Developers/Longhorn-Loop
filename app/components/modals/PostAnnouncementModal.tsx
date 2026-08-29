// "Post Announcement" — a short update from the host to everyone attached to
// an event. Room changed, doors open early, bring a laptop.
//
// THE TOGGLE IS REAL, and it is worth being precise about what it does, since
// the obvious reading is wrong. There is no push infrastructure on the server
// — no token storage, no Expo push integration — so this cannot and does not
// send a system notification today.
//
// What it actually controls is whether the announcement reaches people at all:
// on, everyone who RSVP'd or saved the event gets a row in `notifications`, so
// it shows on the bell and the notifications screen; off, the announcement is
// still stored and still shows on the event, but nobody is told. That is a
// real difference a host would want, and when push delivery lands it reads the
// same `notify` flag — so the switch does not change meaning underneath
// anyone. The label says "notification" rather than "push notification" for
// exactly that reason.

import type { ThemeColors } from '@/app/lib/themeColors';
import { useThemeColors } from '@/app/lib/themeColors';
import BellIcon from '@/assets/images/bell.svg';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

/** Mirrors MAX_ANNOUNCEMENT_LENGTH on the server. Both are the Figma's 0/200. */
export const MAX_ANNOUNCEMENT_LENGTH = 200;

interface PostAnnouncementModalProps {
  visible: boolean;
  eventTitle: string;
  submitting?: boolean;
  onCancel: () => void;
  onPost: (body: string, notify: boolean) => void;
}

export default function PostAnnouncementModal({
  visible,
  eventTitle,
  submitting = false,
  onCancel,
  onPost,
}: PostAnnouncementModalProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [body, setBody] = useState('');
  const [notify, setNotify] = useState(true);

  // Clear on close, not on open. Reopening should be a blank slate, but wiping
  // on open would race the animation and blank the field under the user if the
  // modal ever re-renders while visible.
  useEffect(() => {
    if (!visible) {
      setBody('');
      setNotify(true);
    }
  }, [visible]);

  const trimmed = body.trim();
  const canPost = trimmed.length > 0 && !submitting;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.card}>
            <Text style={styles.title}>Post Announcement</Text>
            <Text style={styles.body}>Share an update with everyone going to “{eventTitle}”.</Text>

            <View style={styles.inputWrap}>
              <TextInput
                value={body}
                onChangeText={setBody}
                placeholder="Room change, bring your laptop, doors open at 5:45..."
                placeholderTextColor={colors.inkMuted}
                multiline
                // Hard stop rather than letting them overrun and rejecting on
                // submit. The counter is only honest if the limit is real.
                maxLength={MAX_ANNOUNCEMENT_LENGTH}
                textAlignVertical="top"
                style={styles.input}
                accessibilityLabel="Announcement text"
              />
              <Text style={styles.counter}>
                {body.length}/{MAX_ANNOUNCEMENT_LENGTH}
              </Text>
            </View>

            <View style={styles.toggleRow}>
              <View style={styles.toggleLabel}>
                <BellIcon width={15} height={15} color={colors.ink} />
                <Text style={styles.toggleText}>Send a notification</Text>
              </View>
              <Switch
                value={notify}
                onValueChange={setNotify}
                // theme-exempt: the filled track is brand in both themes, and
                // the knob is white on it either way.
                trackColor={{ false: colors.border, true: colors.brand }}
                thumbColor="#FFFFFF"
                accessibilityLabel="Send a notification"
              />
            </View>

            <Pressable
              onPress={() => onPost(trimmed, notify)}
              disabled={!canPost}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canPost }}
              style={[styles.primaryButton, !canPost && { opacity: 0.5 }]}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryLabel}>Post</Text>
              )}
            </Pressable>

            <Pressable
              onPress={onCancel}
              disabled={submitting}
              accessibilityRole="button"
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryLabel}>Cancel</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.4)', // theme-exempt: scrim over both themes
      paddingHorizontal: 20,
    },
    card: {
      width: 350,
      maxWidth: '100%',
      backgroundColor: c.surface,
      borderRadius: 20,
      padding: 30,
    },
    title: {
      fontSize: 24,
      fontWeight: '500' as const,
      color: c.ink,
      marginBottom: 16,
    },
    body: {
      fontSize: 16,
      fontWeight: '400' as const,
      color: c.ink,
      lineHeight: 19,
      marginBottom: 16,
    },
    inputWrap: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingTop: 10,
      paddingBottom: 22,
      marginBottom: 13,
    },
    input: {
      minHeight: 50,
      fontSize: 14,
      lineHeight: 18,
      color: c.ink,
      padding: 0,
    },
    counter: {
      position: 'absolute',
      right: 10,
      bottom: 6,
      fontSize: 10,
      color: c.inkSecondary,
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surfaceMuted,
      marginBottom: 13,
    },
    toggleLabel: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    toggleText: {
      fontSize: 12,
      fontWeight: '500' as const,
      color: c.ink,
    },
    primaryButton: {
      height: 45,
      borderRadius: 8,
      backgroundColor: c.brand,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 10,
    },
    primaryLabel: {
      color: '#FFFFFF', // theme-exempt: white label on the filled brand button
      fontSize: 20,
      fontWeight: '600' as const,
    },
    secondaryButton: {
      height: 45,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.inkSecondary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryLabel: {
      color: c.inkSecondary,
      fontSize: 20,
      fontWeight: '600' as const,
    },
  });
