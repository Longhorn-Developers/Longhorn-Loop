import StepPills from '@/app/components/StepPills';
import ImagePlusIcon from '@/assets/images/image-plus.svg';
import { useCreateEvent } from '@/app/context/CreateEventContext';
import { EVENT_BENEFIT_OPTIONS } from '@/shared/eventBenefits';
import type { CreateEventData } from '@/app/context/CreateEventContext';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { ApiError, api } from '@/app/lib/api';
import { appendImageFile } from '@/app/lib/imageForm';
import { events as eventsKeys, feed as feedKeys } from '@/app/lib/queryKeys';
import type { ThemeColors } from '@/app/lib/themeColors';
import { useThemeColors } from '@/app/lib/themeColors';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

type CreateEventResponse = { event: unknown };

function appendOptional(form: FormData, key: string, value: string | null | undefined) {
  const trimmed = value?.trim();
  if (trimmed) form.append(key, trimmed);
}

async function appendImageToForm(form: FormData, data: CreateEventData): Promise<void> {
  if (!data.imageUrl) return;
  await appendImageFile(form, 'image', {
    uri: data.imageUrl,
    name: data.imageName,
    mimeType: data.imageMimeType,
  });
}

async function buildCreateEventForm(data: CreateEventData): Promise<FormData> {
  const form = new FormData();

  form.append('title', data.title.trim());
  appendOptional(form, 'description', data.description);
  if (data.startDatetime) form.append('start_datetime', data.startDatetime);
  if (data.dateMode === 'range' && data.endDatetime) {
    form.append('end_datetime', data.endDatetime);
  }
  appendOptional(form, 'location', data.locationFull);
  appendOptional(form, 'rsvp_url', data.rsvpUrl);
  if (data.discoveryBucket) form.append('discoveryBucket', data.discoveryBucket);
  if (data.eventType) form.append('event_type', data.eventType);
  if (data.benefits.length > 0) {
    form.append('benefits', JSON.stringify(data.benefits));
  }
  if (data.interestTags.length > 0) {
    form.append('categories', JSON.stringify(data.interestTags));
  }

  await appendImageToForm(form, data);

  return form;
}

function getCreateEventErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message === 'AUTH_REQUIRED') {
    return 'Please sign in before posting an event.';
  }
  if (error instanceof Error && error.message === 'MISSING_REQUIRED_FIELDS') {
    return 'Add an event title and start time before posting.';
  }
  if (error instanceof Error && error.message === 'IMAGE_READ_FAILED') {
    return 'Could not read the selected image. Try choosing it again.';
  }
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Please sign in again before posting this event.';
    if (error.body && typeof error.body === 'object' && 'fields' in error.body) {
      const fields = (error.body as { fields?: Record<string, string> }).fields;
      const firstError = fields ? Object.values(fields)[0] : null;
      if (firstError) return firstError;
    }
    return error.message;
  }
  return 'Something went wrong while posting your event. Please try again.';
}

export default function OptionalExtras() {
  const router = useRouter();
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { data, update, reset, goBack } = useCreateEvent();
  const { data: onboarding } = useOnboarding();
  const queryClient = useQueryClient();
  const token = onboarding.token || null;

  const createEvent = useMutation<CreateEventResponse>({
    mutationFn: async () => {
      if (!token) throw new Error('AUTH_REQUIRED');
      if (!data.title.trim() || !data.startDatetime) throw new Error('MISSING_REQUIRED_FIELDS');
      const form = await buildCreateEventForm(data);
      return api.postForm<CreateEventResponse>('/events/create', form, {
        token,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventsKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: feedKeys.all }),
      ]);
      reset();
      router.replace('/(tabs)/home?justPostedEvent=1');
    },
    onError: (error) => {
      if (__DEV__) {
        console.error('Create event failed', error);
      }
      Alert.alert('Could not post event', getCreateEventErrorMessage(error));
    },
  });

  const onUpload = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Photo access needed',
        'Enable photo library access in Settings to upload a flyer.',
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.85,
    });

    if (result.canceled) return;
    const asset = result.assets[0];
    if (asset?.uri) {
      update({
        imageUrl: asset.uri,
        imageName: asset.fileName ?? null,
        imageMimeType: asset.mimeType ?? null,
      });
    }
  };

  const onPreview = () => {
    // TODO: build a preview screen that renders the event card from the
    // current context state (title, description, image, poster, etc).
    // For now, navigate to a placeholder or noop until that screen exists.
  };

  const onPost = () => {
    if (createEvent.isPending) return;
    if (!token) {
      Alert.alert('Sign in required', 'Please sign in before posting an event.');
      return;
    }
    if (!data.title.trim() || !data.startDatetime) {
      Alert.alert('Missing details', 'Add an event title and start time before posting.');
      return;
    }
    createEvent.mutate();
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
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
            <Text style={styles.stepLabel}>STEP 6 OF 6</Text>
            <Text style={styles.stepTitle}>Optional Extras</Text>
          </View>

          <StepPills step={6} totalSteps={6} style={{ marginBottom: 20 }} />

          <Text style={styles.instruction}>
            All fields below are optional — add what makes your event shine.
          </Text>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Flyer/Cover Image</Text>
            <TouchableOpacity
              onPress={onUpload}
              activeOpacity={0.85}
              style={[styles.uploadTile, data.imageUrl ? styles.uploadTileFilled : null]}
            >
              {data.imageUrl ? (
                <Image
                  source={{ uri: data.imageUrl }}
                  style={styles.uploadImage}
                  contentFit="cover"
                />
              ) : (
                <View style={styles.uploadPrompt}>
                  <ImagePlusIcon width={22} height={22} color={colors.ink} />
                  <Text style={styles.uploadText}>Tap to Upload</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Location</Text>
            <TextInput
              value={data.locationFull}
              onChangeText={(text) => update({ locationFull: text })}
              placeholder="GDC 2.216, Zoom link, etc..."
              placeholderTextColor={colors.inkMuted}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {/* Perks. Multi-select, because an event can offer more than one and
              the filter is an OR over the set. Options come from
              shared/eventBenefits.ts, which is also what the HornsLink scrape
              writes — so a user event and a scraped one answer the same
              `?benefit=` query (LOOP-259). */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Perks</Text>
            <View style={styles.perkRow}>
              {EVENT_BENEFIT_OPTIONS.map((perk) => {
                const isSelected = data.benefits.includes(perk);
                return (
                  <TouchableOpacity
                    key={perk}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: isSelected }}
                    accessibilityLabel={perk}
                    onPress={() =>
                      update({
                        benefits: isSelected
                          ? data.benefits.filter((b) => b !== perk)
                          : [...data.benefits, perk],
                      })
                    }
                    style={[styles.perkChip, isSelected && styles.perkChipSelected]}
                  >
                    <Text style={[styles.perkText, isSelected && styles.perkTextSelected]}>
                      {perk}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>RSVP Link</Text>
            <TextInput
              value={data.rsvpUrl}
              onChangeText={(text) => update({ rsvpUrl: text })}
              placeholder="https://www..."
              placeholderTextColor={colors.inkMuted}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </View>

          <View style={styles.buttonRow}>
            <TouchableOpacity
              onPress={onPreview}
              activeOpacity={createEvent.isPending ? 1 : 0.85}
              disabled={createEvent.isPending}
              style={[styles.actionButton, styles.previewButton]}
            >
              <Text style={styles.previewText}>Preview Event</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onPost}
              activeOpacity={createEvent.isPending ? 1 : 0.85}
              disabled={createEvent.isPending}
              style={[
                styles.actionButton,
                styles.postButton,
                createEvent.isPending && styles.actionButtonDisabled,
              ]}
            >
              <Text style={styles.postText}>
                {createEvent.isPending ? 'Posting...' : 'Post Event'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    flex: {
      flex: 1,
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
    instruction: {
      fontSize: 14,
      color: c.ink,
      lineHeight: 20,
      marginBottom: 24,
    },
    field: {
      marginBottom: 20,
    },
    fieldLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: c.ink,
      marginBottom: 8,
    },
    uploadTile: {
      height: 160,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.border,
      borderStyle: 'dashed',
      backgroundColor: c.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    uploadTileFilled: {
      borderStyle: 'solid',
      backgroundColor: c.surface,
    },
    uploadPrompt: {
      alignItems: 'center',
      gap: 8,
    },
    uploadText: {
      fontSize: 14,
      color: c.ink,
    },
    uploadImage: {
      width: '100%',
      height: '100%',
    },
    perkRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    perkChip: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    perkChipSelected: {
      borderColor: c.brand,
      backgroundColor: c.brand,
    },
    perkText: {
      fontSize: 14,
      color: c.ink,
    },
    perkTextSelected: {
      color: '#FFFFFF',
      fontWeight: '600',
    },
    input: {
      backgroundColor: c.surface,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 16,
      paddingVertical: 12,
      fontSize: 14,
      color: c.ink,
    },
    buttonRow: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 12,
    },
    actionButton: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionButtonDisabled: {
      opacity: 0.65,
    },
    previewButton: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    postButton: {
      backgroundColor: c.brand,
    },
    previewText: {
      fontSize: 14,
      fontWeight: '600',
      color: c.ink,
    },
    postText: {
      fontSize: 14,
      fontWeight: '600',
      color: '#FFFFFF',
    },
  });
