import ImagePlusIcon from '@/assets/images/image-plus.svg';
import { useCreateEvent } from '@/app/context/CreateEventContext';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React from 'react';
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

const BURNT_ORANGE = '#9D4A06';
const CARD_BG = '#FFFFFF';
const FILL = '#E8E3DC';
const INPUT_BORDER = '#00000033';
const BG = '#F9F8F5';
const TEXT_SECONDARY = '#485656';

export default function OptionalExtras() {
  const router = useRouter();
  const { data, update, reset } = useCreateEvent();

  const onUpload = async () => {
    // TODO: currently just holds a local URI in context. When the POST
    // endpoint is wired, upload the file to storage first and swap the
    // local URI for the permanent URL before submitting the event.
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
    const uri = result.assets[0]?.uri;
    if (uri) update({ imageUrl: uri });
  };

  const onPreview = () => {
    // TODO: build a preview screen that renders the event card from the
    // current context state (title, description, image, poster, etc).
    // For now, navigate to a placeholder or noop until that screen exists.
  };

  const onPost = () => {
    // TODO: replace with a real POST once the backend endpoint is wired.
    //   1. POST /events with the context payload
    //   2. On 2xx, invalidate the events + user's-events queries
    //   3. Attach the created event to the poster's profile so it shows
    //      up in their event list
    //   4. Only then reset() and route home
    // For now we optimistically reset and route straight to home; the
    // ?justPostedEvent=1 param triggers the success modal there.
    reset();
    router.replace('/(tabs)/home?justPostedEvent=1');
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
            <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
              <Text style={styles.backArrow}>←</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Create an Event</Text>
            <View style={styles.headerSpacer} />
          </View>

          <View style={styles.stepBlock}>
            <Text style={styles.stepLabel}>STEP 6 OF 6</Text>
            <Text style={styles.stepTitle}>Optional Extras</Text>
          </View>

          <View style={styles.progressTrack}>
            <View style={styles.progressFill} />
          </View>

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
                  <ImagePlusIcon width={22} height={22} color="#020B12" />
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
              placeholderTextColor="#9CA3AF"
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>RSVP Link</Text>
            <TextInput
              value={data.rsvpUrl}
              onChangeText={(text) => update({ rsvpUrl: text })}
              placeholder="https://www..."
              placeholderTextColor="#9CA3AF"
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </View>

          <View style={styles.buttonRow}>
            <TouchableOpacity
              onPress={onPreview}
              activeOpacity={0.85}
              style={[styles.actionButton, styles.previewButton]}
            >
              <Text style={styles.previewText}>Preview Event</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onPost}
              activeOpacity={0.85}
              style={[styles.actionButton, styles.postButton]}
            >
              <Text style={styles.postText}>Post Event</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
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
    marginBottom: 20,
  },
  progressFill: {
    height: '100%',
    width: '100%',
    backgroundColor: BURNT_ORANGE,
    borderRadius: 999,
  },
  instruction: {
    fontSize: 14,
    color: '#000000',
    lineHeight: 20,
    marginBottom: 24,
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
  uploadTile: {
    height: 160,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    borderStyle: 'dashed',
    backgroundColor: FILL,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  uploadTileFilled: {
    borderStyle: 'solid',
    backgroundColor: CARD_BG,
  },
  uploadPrompt: {
    alignItems: 'center',
    gap: 8,
  },
  uploadText: {
    fontSize: 14,
    color: '#020B12',
  },
  uploadImage: {
    width: '100%',
    height: '100%',
  },
  input: {
    backgroundColor: CARD_BG,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    color: '#020B12',
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
  previewButton: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
  },
  postButton: {
    backgroundColor: BURNT_ORANGE,
  },
  previewText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#020B12',
  },
  postText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
