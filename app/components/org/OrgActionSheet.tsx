// The org page's ••• sheet (LOOP-335).
//
// Figma: "Org Page (People Selected)", third variant (10034:39367). The frame
// lists six rows; this ships the ones that work:
//
//   Share organization   built (lib/shareOrg)
//   Copy Link            built, web only -- see lib/shareOrg for why
//   Notification settings  not in the frame; it is the old gear's job. The
//                        redesigned cover has one button, the •••, so the
//                        followed-org notification drawer moved in here rather
//                        than losing its only entry point on this page.
//   Mute updates, Hide this org, Report org, Block
//                        NOT RENDERED. None has a backend (LOOP-339), and a
//                        Block row that does nothing is worse than no row --
//                        someone reaching for it is usually trying to get away
//                        from something.

import DragDismissSheet from '@/app/components/modals/DragDismissSheet';
import { canCopyOrgLink, copyOrgLink, shareOrg } from '@/app/lib/shareOrg';
import { useThemeColors } from '@/app/lib/themeColors';
import { LinkIcon } from '@/assets/icons/LhlOrgsIcons';
import BellIcon from '@/assets/images/bell.svg';
import ShareIcon from '@/assets/images/share.svg';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

function SheetRow({
  icon,
  label,
  detail,
  onPress,
  last = false,
}: {
  icon: React.ReactNode;
  label: string;
  detail?: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={`min-h-[52px] flex-row items-center gap-[14px] py-[10px] ${
        last ? '' : 'border-b border-lhlBorderSoft'
      }`}
    >
      <View className="h-[28px] w-[28px] items-center justify-center rounded-[6px] bg-lhlBrandTint">
        {icon}
      </View>
      <View className="flex-1">
        <Text className="font-roboto text-[15px] leading-[18px] text-lhlInk">{label}</Text>
        {detail ? (
          <Text className="font-roboto text-[12px] leading-[15px] text-lhlSecondaryTextGrey">
            {detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export default function OrgActionSheet({
  visible,
  onClose,
  org,
  onOpenNotifications,
}: {
  visible: boolean;
  onClose: () => void;
  org: { id: number; name: string } | undefined;
  onOpenNotifications: () => void;
}) {
  const colors = useThemeColors();
  const [notice, setNotice] = useState<string | null>(null);

  const close = () => {
    setNotice(null);
    onClose();
  };

  return (
    <DragDismissSheet visible={visible} onClose={close} sheetStyle={{ paddingHorizontal: 20 }}>
      {org ? (
        <View className="pb-[24px]">
          <SheetRow
            icon={<ShareIcon width={14} height={14} color={colors.ink} />}
            label="Share organization"
            onPress={async () => {
              const outcome = await shareOrg(org);
              if (outcome === 'copied') setNotice('Link copied');
              else if (outcome === 'failed') setNotice('Couldn’t share this page.');
              else close();
            }}
          />
          {canCopyOrgLink() ? (
            <SheetRow
              icon={<LinkIcon size={14} color={colors.ink} />}
              label="Copy Link"
              onPress={async () => {
                const outcome = await copyOrgLink(org.id);
                setNotice(outcome === 'copied' ? 'Link copied' : 'Couldn’t copy the link.');
              }}
            />
          ) : null}
          <SheetRow
            icon={<BellIcon width={14} height={14} color={colors.ink} />}
            label="Notification settings"
            detail="What the orgs you follow can notify you about"
            last
            onPress={() => {
              close();
              onOpenNotifications();
            }}
          />
          {notice ? (
            <Text
              accessibilityLiveRegion="polite"
              className="font-roboto mt-[8px] text-center text-[12px] text-lhlSecondaryTextGrey"
            >
              {notice}
            </Text>
          ) : null}
        </View>
      ) : null}
    </DragDismissSheet>
  );
}
