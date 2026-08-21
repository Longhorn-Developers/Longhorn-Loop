// Add a Profile Picture — Figma "Add Profile Picture" (3998:6689).
//
// Replaces the old 2x3 grid of six fixed Bevo PNGs with two paths: upload a
// real photo, or customize a Bevo (shared/avatar.ts AvatarConfig, rendered by
// BevoAvatar, picked on app/profile/customize-bevo.tsx). Stays at the same
// position in the flow — arrives from InterestSelection, still pushes to
// /TermsAndConditions, progress bar unchanged (step 3 of 4).
//
// The upload here only ever picks a LOCAL file. Nothing is sent to the server
// until OnboardingComplete's final submit, same as the create-event flyer
// upload — this screen just stages the choice in OnboardingContext.
//
// Photo and Bevo are mutually exclusive pending selections — the preview
// circle can only show one thing. Picking a new photo clears
// pendingBevoConfig and vice versa; "Cancel"/"Remove current picture" clears
// both. See OnboardingContext.tsx for why the Bevo config specifically comes
// back through `pendingBevoConfig` rather than being committed directly.
//
// No disabled-Next gate: the default Bevo counts as a real choice, so
// tapping "Skip" with nothing picked still submits a classic Bevo rather than
// blocking forward progress.

import PrimaryButton from '@/app/components/buttons/PrimaryButton';
import FlowLayout from '@/app/components/layouts/FlowLayout';
import BevoAvatar from '@/app/components/avatar/BevoAvatar';
import BevoAvatarBadge from '@/app/components/avatar/BevoAvatarBadge';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { useThemeColors } from '@/app/lib/themeColors';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { CaretRightIcon, ImageIcon, TrashIcon, UploadSimpleIcon } from 'phosphor-react-native';
import React, { useState } from 'react';
import { ActionSheetIOS, Alert, Image, Platform, Pressable, Text, View } from 'react-native';

interface PickedPhoto {
  uri: string;
  name: string | null;
  mimeType: string | null;
}

// Matches BEVO_PALETTE_COLORS.beige / the Customize Bevo preview panel — the
// warm tan the confirmed-Bevo circle sits on in the Figma frame, deliberately
// fixed rather than themed (part of the Bevo illustration world).
const BEVO_PREVIEW_BG = '#F2E0BA'; // theme-exempt: fixed Bevo-world preview background

function OptionRow({
  icon,
  title,
  subtitle,
  onPress,
  bareIcon = false,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onPress: () => void;
  /** Skip the grey box wrapper for icons (like BevoAvatarBadge) that already draw their own background/border. */
  bareIcon?: boolean;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      className="flex-row items-center gap-[12px] rounded-[12px] border border-lhlMutedBorder bg-lhlSurface px-[14px] py-[12px]"
    >
      {bareIcon ? (
        icon
      ) : (
        <View className="h-[40px] w-[40px] items-center justify-center overflow-hidden rounded-[10px] bg-lhlPlaceholderGrey">
          {icon}
        </View>
      )}
      <View className="flex-1">
        <Text className="font-['Roboto-Flex'] text-[15px] font-semibold text-lhlInk">{title}</Text>
        <Text className="font-['Roboto-Flex'] mt-[2px] text-[12px] text-lhlSecondaryTextGrey">
          {subtitle}
        </Text>
      </View>
      <CaretRightIcon size={18} color={colors.inkMuted} />
    </Pressable>
  );
}

export default function AddProfilePicture() {
  const colors = useThemeColors();
  const router = useRouter();
  const { data, update } = useOnboarding();
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const pendingBevo = data.pendingBevoConfig;
  const hasPendingSelection = Boolean(photo) || Boolean(pendingBevo);

  const goToTerms = () => router.push('/TermsAndConditions');

  const openPhotoLibrary = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Photo access needed',
        'Enable photo library access in Settings to upload a picture.',
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (asset?.uri) {
      setPhoto({ uri: asset.uri, name: asset.fileName ?? null, mimeType: asset.mimeType ?? null });
      update({ pendingBevoConfig: null });
    }
  };

  const openCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera access needed', 'Enable camera access in Settings to take a picture.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (asset?.uri) {
      setPhoto({ uri: asset.uri, name: asset.fileName ?? null, mimeType: asset.mimeType ?? null });
      update({ pendingBevoConfig: null });
    }
  };

  const onUploadPress = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: 'Add photo',
          options: ['Take Photo', 'Select from Photo Library', 'Cancel'],
          cancelButtonIndex: 2,
        },
        (index) => {
          if (index === 0) void openCamera();
          if (index === 1) void openPhotoLibrary();
        },
      );
      return;
    }

    // Android has no ActionSheetIOS equivalent; Alert's button list is the
    // platform-idiomatic stand-in.
    Alert.alert('Add photo', undefined, [
      { text: 'Take Photo', onPress: () => void openCamera() },
      { text: 'Select from Photo Library', onPress: () => void openPhotoLibrary() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const onCustomizeBevoPress = () => {
    router.push('/profile/customize-bevo');
  };

  const handleSkipOrSaveChanges = () => {
    if (photo) {
      update({
        avatarPhotoUri: photo.uri,
        avatarPhotoName: photo.name,
        avatarPhotoMimeType: photo.mimeType,
        pendingBevoConfig: null,
      });
    } else if (pendingBevo) {
      update({
        avatarConfig: pendingBevo,
        pendingBevoConfig: null,
        avatarPhotoUri: null,
        avatarPhotoName: null,
        avatarPhotoMimeType: null,
      });
    }
    goToTerms();
  };

  const clearSelection = () => {
    setPhoto(null);
    update({ pendingBevoConfig: null });
  };

  return (
    <FlowLayout
      title="Add a Profile Picture"
      onBackPress={() => router.back()}
      showProgressBar
      step={3}
      totalSteps={4}
      footer={
        <View className="mb-[42px] mt-[16px]">
          {hasPendingSelection ? (
            <View className="flex-row gap-[12px]">
              <View className="flex-1">
                <PrimaryButton label="Cancel" onPress={clearSelection} />
              </View>
              <View className="flex-1">
                <PrimaryButton label="Save Changes" isFilled onPress={handleSkipOrSaveChanges} />
              </View>
            </View>
          ) : (
            <PrimaryButton label="Skip" onPress={handleSkipOrSaveChanges} />
          )}
        </View>
      }
    >
      <View className="mt-[24px] items-center">
        <View className="h-[160px] w-[160px] items-center justify-center overflow-hidden rounded-full">
          {photo ? (
            <Image
              source={{ uri: photo.uri }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
            />
          ) : pendingBevo ? (
            <View
              className="h-full w-full items-center justify-center"
              style={{ backgroundColor: BEVO_PREVIEW_BG }} // theme-exempt: fixed Bevo-world preview background
            >
              <BevoAvatar config={pendingBevo} height={220} />
            </View>
          ) : (
            <View className="h-full w-full items-center justify-center bg-lhlPlaceholderGrey">
              <ImageIcon size={40} color={colors.inkMuted} />
            </View>
          )}
        </View>

        <Text className="font-['Roboto-Flex'] mt-[16px] px-[24px] text-center text-[13px] text-lhlSecondaryTextGrey">
          {hasPendingSelection
            ? 'Looks good! Save to use this as your profile picture.'
            : 'Add a profile picture and make your profile your own. It will be visible to other Longhorn Loop users.'}
        </Text>
      </View>

      <View className="mt-[24px] gap-[10px]">
        <OptionRow
          icon={<UploadSimpleIcon size={20} color={colors.ink} />}
          title="Upload a Photo"
          subtitle="Use a picture from your photo library"
          onPress={onUploadPress}
        />
        <OptionRow
          icon={<BevoAvatarBadge size={40} />}
          bareIcon
          title="Customize Bevo Avatar"
          subtitle="Choose your Bevo avatar's look!"
          onPress={onCustomizeBevoPress}
        />
      </View>

      {hasPendingSelection ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Remove current picture"
          onPress={clearSelection}
          className="mt-[18px] flex-row items-center justify-center gap-[6px]"
        >
          <TrashIcon size={14} color={colors.destructive} />
          <Text
            className="font-['Roboto-Flex'] text-[13px] font-medium"
            style={{ color: colors.destructive }}
          >
            Remove current picture
          </Text>
        </Pressable>
      ) : null}
    </FlowLayout>
  );
}
