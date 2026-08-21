// Customize Bevo — Figma "Customize Bevo" (node 3998:6927), reached from the
// "Customize Bevo Avatar" row on Add a Profile Picture (app/(onboarding)/Avatar.tsx).
//
// This screen has no return-value mechanism back to Avatar.tsx (expo-router
// doesn't have one), so "Done" hands its result off through
// OnboardingContext's `pendingBevoConfig` rather than the committed
// `avatarConfig` — Avatar.tsx only folds it into the real committed value
// when ITS OWN "Save Changes" fires, so backing out of Avatar.tsx with
// "Cancel" still discards it. See the field's doc comment in
// OnboardingContext.tsx.
//
// The warm cream/tan palette here (preview panel, tile chrome) is
// deliberately fixed rather than themed — it's part of the Bevo illustration
// world (same reasoning as BevoAvatarBadge's fixed background), not app UI
// chrome that should invert in dark mode.

import BevoAvatar from '@/app/components/avatar/BevoAvatar';
import { HAT_ART, PATTERN_TILES } from '@/app/components/avatar/bevoAccessories';
import { useOnboarding } from '@/app/context/OnboardingContext';
import {
  BEVO_PALETTES,
  BEVO_PATTERNS,
  BEVO_PALETTE_COLORS,
  type AvatarConfig,
  type BevoHat,
  type BevoPalette,
  type BevoPattern,
} from '@/shared/avatar';
import { useRouter } from 'expo-router';
import { ArrowClockwiseIcon, ArrowLeftIcon } from 'phosphor-react-native';
import React, { useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Line, Path, Rect } from 'react-native-svg';

type Tab = 'skins' | 'colors' | 'accessories';

const PALETTE_LABELS: Record<BevoPalette, string> = {
  orange: 'Classic',
  beige: 'Cream',
  brown: 'Choco',
  cyan: 'Sea Foam',
  pink: 'Rosy',
  grey: 'Slate',
};

const PATTERN_LABELS: Record<BevoPattern, string> = {
  none: 'None',
  heart: 'Hearts',
  scales: 'Scales',
  stars: 'Stars',
  dots: 'Dots',
  honey: 'Honey',
};

const HAT_LABELS: Record<BevoHat, string> = {
  none: 'None',
  headphones: 'Headphones',
  topHat: 'Top Hat',
  cap: 'Cap',
  cowboyHat: 'Cowboy Hat',
  ribbon: 'Ribbon',
};

const HAT_ORDER: BevoHat[] = ['none', 'headphones', 'topHat', 'cap', 'cowboyHat', 'ribbon'];

const TAN_BG = '#F2E0BA'; // theme-exempt: fixed Bevo-world preview background, matches BEVO_PALETTE_COLORS.beige and the row badge
const PAGE_BG = '#F5E6C8'; // theme-exempt: fixed Bevo-world page background, behind the card
const CARD_BG = '#FAF1DC'; // theme-exempt: fixed Bevo-world card background, lighter than the page behind it
const TILE_BORDER = '#D9B98A'; // theme-exempt: fixed Bevo-world thin border — unselected tile, inactive tab
const TILE_LABEL_TEXT = '#5C3A21'; // theme-exempt: fixed Bevo-world body text on the cream card
const BURNT_ORANGE = '#C1621F'; // theme-exempt: fixed Bevo-world tile-header and accent colour
const BURNT_ORANGE_SELECTED = '#A84E15'; // theme-exempt: fixed Bevo-world selected-tile header, a shade darker than BURNT_ORANGE
const INK = '#5C3A21'; // theme-exempt: fixed Bevo-world thick dark-brown border — panel edge, selected tile, active tab
const DRAG_HANDLE = '#B08A4E'; // theme-exempt: fixed Bevo-world drag-handle indicator
const SKINS_ICON_COLOR = '#563427'; // theme-exempt: fixed Bevo-world tab icon colour, from the Figma icon source
const TAB_ICON_COLOR = '#331400'; // theme-exempt: fixed Bevo-world tab icon colour, from the Figma icon source (Colors, Accessories)

/** The universal "no selection" glyph — a rounded-square outline with a diagonal slash, matching Figma's None/Classic tiles. */
function NoneGlyph() {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 40 40">
      <Rect
        x={3}
        y={3}
        width={34}
        height={34}
        rx={8}
        ry={8}
        fill={CARD_BG} // theme-exempt: fixed Bevo-world glyph fill
        stroke={BURNT_ORANGE} // theme-exempt: fixed Bevo-world glyph colour
        strokeWidth={2.5}
      />
      <Line
        x1={11}
        y1={29}
        x2={29}
        y2={11}
        stroke={BURNT_ORANGE} // theme-exempt: fixed Bevo-world glyph colour
        strokeWidth={2.5}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function Tile({
  label,
  selected,
  onPress,
  children,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    // Shadow lives on this outer, unclipped view — overflow:hidden (needed to
    // clip the header/body corners below) would also clip the shadow itself
    // if the two were combined on one view.
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        flex: 1,
        borderRadius: 12,
        borderWidth: selected ? 2.5 : 1.5,
        borderColor: selected ? INK : TILE_BORDER, // theme-exempt: fixed Bevo-world tile border
        backgroundColor: '#FFFFFF',
        shadowColor: '#3A2410', // theme-exempt: fixed Bevo-world tile drop shadow
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 3,
        elevation: 2,
      }}
    >
      <View style={{ borderRadius: 10, overflow: 'hidden' }}>
        <View
          style={{
            alignItems: 'center',
            paddingVertical: 6,
            backgroundColor: selected ? BURNT_ORANGE_SELECTED : BURNT_ORANGE, // theme-exempt: fixed Bevo-world tile label chip
          }}
        >
          <Text
            numberOfLines={1}
            style={{
              fontFamily: 'Baloo2-Bold',
              fontSize: 11,
              color: '#FFFFFF',
            }}
          >
            {label}
          </Text>
        </View>
        <View
          style={{
            aspectRatio: 1.35,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#FFFFFF', // theme-exempt: fixed Bevo-world tile swatch ground
            padding: 9,
          }}
        >
          {children}
        </View>
      </View>
    </Pressable>
  );
}

function TileRow({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>{children}</View>;
}

/** Splits a list into rows of 3, padding the last row with invisible spacers so tiles keep their width. */
function chunk3<T>(items: T[]): (T | null)[][] {
  const rows: (T | null)[][] = [];
  for (let i = 0; i < items.length; i += 3) {
    const row = items.slice(i, i + 3);
    while (row.length < 3) row.push(null as unknown as T);
    rows.push(row);
  }
  return rows;
}

function PatternSwatch({ pattern }: { pattern: BevoPattern }) {
  if (pattern === 'none') return <NoneGlyph />;
  const tile = PATTERN_TILES[pattern];
  return (
    <View style={{ width: '100%', height: '100%', borderRadius: 8, overflow: 'hidden' }}>
      <Image source={tile.src} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
    </View>
  );
}

function ColorSwatch({ palette }: { palette: BevoPalette }) {
  if (palette === 'orange') return <NoneGlyph />;
  return (
    <View
      style={{
        width: '100%',
        height: '100%',
        borderRadius: 8,
        backgroundColor: BEVO_PALETTE_COLORS[palette].body,
      }}
    />
  );
}

function HatSwatch({ hat }: { hat: BevoHat }) {
  if (hat === 'none') return <NoneGlyph />;
  const art = HAT_ART[hat];
  return (
    <Svg width="90%" height="90%" viewBox={`${art.vb.x ?? 0} ${art.vb.y ?? 0} ${art.vb.w} ${art.vb.h}`}>
      {art.render}
    </Svg>
  );
}

// Tab icons from Figma. Sized to fit inside the tab row without pushing the
// label — Accessories' source art is a wide 24x19 box, so at the same 15px
// "fit" size as the square Skins/Colors icons it would render ~19px wide and
// crowd the label; scaling by width instead of a fixed square keeps all
// three icons visually the same size.
const TAB_ICON_FIT = 15;

function SkinsTabIcon({ color }: { color: string }) {
  return (
    <Svg width={TAB_ICON_FIT} height={TAB_ICON_FIT} viewBox="0 0 29 29" fill="none">
      <Path
        d="M23.2671 3.5791H5.36937C4.3809 3.5791 3.57959 4.38041 3.57959 5.36888V23.2666C3.57959 24.2551 4.3809 25.0564 5.36937 25.0564H23.2671C24.2556 25.0564 25.0569 24.2551 25.0569 23.2666V5.36888C25.0569 4.38041 24.2556 3.5791 23.2671 3.5791Z"
        stroke={color}
        strokeWidth={1.9614}
        strokeLinejoin="round"
      />
      <Path
        d="M16.7046 3.5791L3.57959 16.7041M25.0569 11.9314L11.9319 25.0564M23.8637 4.77229L4.77277 23.8632M7.15914 13.1246L11.3353 17.3007M17.3012 11.3348L21.4773 15.5109"
        stroke={color}
        strokeWidth={1.9614}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ColorsTabIcon({ color }: { color: string }) {
  return (
    <Svg width={TAB_ICON_FIT} height={TAB_ICON_FIT} viewBox="0 0 24 24" fill="none">
      <Path
        d="M11.6843 23.5415C5.24627 23.5415 0 18.2953 0 11.8572C0 5.41912 5.24627 0.172852 11.6843 0.172852C18.1224 0.172852 23.3687 4.89332 23.3687 10.6888C23.3687 14.5563 20.2256 17.6994 16.3581 17.6994H14.2899C13.9628 17.6994 13.7057 17.9564 13.7057 18.2836C13.7057 18.4238 13.7642 18.5523 13.8576 18.6692C14.3367 19.2183 14.6054 19.9077 14.6054 20.6204C14.6054 21.3952 14.2977 22.1382 13.7499 22.686C13.2021 23.2338 12.4591 23.5415 11.6843 23.5415ZM11.6843 2.50972C6.53155 2.50972 2.33687 6.7044 2.33687 11.8572C2.33687 17.01 6.53155 21.2047 11.6843 21.2047C12.0115 21.2047 12.2686 20.9476 12.2686 20.6204C12.2649 20.4689 12.2069 20.3237 12.105 20.2115C11.6259 19.674 11.3689 18.9846 11.3689 18.2836C11.3689 17.5089 11.6766 16.7659 12.2244 16.2181C12.7722 15.6703 13.5152 15.3625 14.2899 15.3625H16.3581C18.9403 15.3625 21.0318 13.271 21.0318 10.6888C21.0318 6.1786 16.8371 2.50972 11.6843 2.50972Z"
        fill={color}
      />
      <Path
        d="M5.25778 13.0258C6.22574 13.0258 7.01043 12.2411 7.01043 11.2732C7.01043 10.3052 6.22574 9.52051 5.25778 9.52051C4.28982 9.52051 3.50513 10.3052 3.50513 11.2732C3.50513 12.2411 4.28982 13.0258 5.25778 13.0258Z"
        fill={color}
      />
      <Path
        d="M8.76376 8.35198C9.73172 8.35198 10.5164 7.56729 10.5164 6.59933C10.5164 5.63137 9.73172 4.84668 8.76376 4.84668C7.7958 4.84668 7.01111 5.63137 7.01111 6.59933C7.01111 7.56729 7.7958 8.35198 8.76376 8.35198Z"
        fill={color}
      />
      <Path
        d="M14.6059 8.35198C15.5739 8.35198 16.3586 7.56729 16.3586 6.59933C16.3586 5.63137 15.5739 4.84668 14.6059 4.84668C13.638 4.84668 12.8533 5.63137 12.8533 6.59933C12.8533 7.56729 13.638 8.35198 14.6059 8.35198Z"
        fill={color}
      />
      <Path
        d="M18.1102 13.0258C19.0782 13.0258 19.8628 12.2411 19.8628 11.2732C19.8628 10.3052 19.0782 9.52051 18.1102 9.52051C17.1422 9.52051 16.3575 10.3052 16.3575 11.2732C16.3575 12.2411 17.1422 13.0258 18.1102 13.0258Z"
        fill={color}
      />
    </Svg>
  );
}

function AccessoriesTabIcon({ color }: { color: string }) {
  const vb = { w: 23.5365, h: 18.8294 };
  return (
    <Svg width={TAB_ICON_FIT} height={TAB_ICON_FIT * (vb.h / vb.w)} viewBox={`0 0 ${vb.w} ${vb.h}`} fill="none">
      <Path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M15.8871 2.42707e-07C16.3259 2.13065e-05 16.749 0.163486 17.0738 0.458519C17.3987 0.753551 17.602 1.159 17.6441 1.59579L17.6523 1.76526V1.86176C19.3379 2.54357 20.7899 3.69887 21.8331 5.18809C22.8762 6.67731 23.4658 8.43673 23.5306 10.2538L23.5365 10.5915V12.9452C23.5365 13.237 23.4282 13.5183 23.2325 13.7347C23.0368 13.951 22.7677 14.087 22.4774 14.1162C21.7446 14.1899 21.0267 14.2448 20.3238 14.2809C16.9639 17.5219 14.3125 18.8294 11.6964 18.8294C10.35 18.8294 9.10966 18.4811 7.91164 18.0139C7.30234 17.7702 6.69996 17.5097 6.10519 17.2324L4.85774 16.657L4.23049 16.3745C3.48084 16.0415 2.99716 15.9791 2.66765 15.9862L2.48877 15.9944L1.89799 16.0674C1.81199 16.0764 1.72556 16.0808 1.63909 16.0803C1.39822 16.0825 1.1594 16.0359 0.93695 15.9435C0.714504 15.8511 0.513014 15.7147 0.344565 15.5425C0.235125 15.433 0.148357 15.303 0.0892307 15.16C0.0301047 15.0169 -0.000217463 14.8636 1.17397e-06 14.7088C0.000219811 14.554 0.030975 14.4008 0.0905048 14.2579C0.150035 14.115 0.23717 13.9853 0.346919 13.8761L0.455188 13.782L4.70946 10.4727C4.74014 8.04694 5.706 5.72667 7.40565 3.99567C9.1053 2.26466 11.4075 1.25656 13.8323 1.18155L14.2218 1.17684C14.3436 0.832522 14.5691 0.534436 14.8674 0.323664C15.1656 0.112892 15.5219 -0.000191213 15.8871 2.42707e-07ZM6.47236 12.0814L4.19283 13.8561C4.49567 13.9432 4.82636 14.0656 5.1849 14.2233L5.69447 14.4528L7.5174 15.2895C7.94224 15.4813 8.35295 15.659 8.76602 15.8202C9.82989 16.2357 10.7608 16.4757 11.6952 16.4757C13.0415 16.4757 14.6114 15.9732 16.7462 14.2962C13.564 14.1432 10.5125 13.5242 7.15022 12.3286L6.47236 12.0814ZM18.1584 4.79679C18.3726 5.32637 18.5597 5.88537 18.715 6.46084C19.1681 8.14137 19.367 10.0655 19.0681 11.9732C19.7738 11.9571 20.479 11.9218 21.1828 11.8672V10.5915C21.1829 9.45361 20.9079 8.33253 20.3812 7.32378C19.8546 6.31503 19.092 5.44731 18.1584 4.79679ZM14.1218 3.53052C12.3855 3.53036 10.7101 4.16994 9.41554 5.32704C8.12102 6.48415 7.29821 8.07764 7.10433 9.80307C10.5195 11.0999 13.5346 11.766 16.685 11.9367C17.0004 10.3244 16.858 8.61446 16.4425 7.0728C16.0377 5.5688 15.4034 4.32959 14.7985 3.56229C14.5736 3.54088 14.3478 3.53028 14.1218 3.53052Z"
        fill={color}
      />
    </Svg>
  );
}

function TabButton({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onPress: () => void;
}) {
  return (
    // A file-folder tab: content-width (not flex:1 — that's what was
    // squeezing "Accessories" past its border before), rounded only at the
    // top. The active tab drops its bottom border and sits flush on the
    // panel below (via the negative marginBottom on the row that holds
    // these), so tab and panel read as one continuous shape.
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 12,
        paddingTop: active ? 10 : 8,
        paddingBottom: active ? 12 : 8,
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
        borderWidth: active ? 2 : 1.5,
        borderBottomWidth: active ? 0 : 1.5,
        borderColor: active ? INK : TILE_BORDER, // theme-exempt: fixed Bevo-world tab border
        backgroundColor: CARD_BG, // theme-exempt: fixed Bevo-world tab chip, same as the panel it sits on
        zIndex: active ? 2 : 1,
      }}
    >
      {icon}
      <Text
        numberOfLines={1}
        style={{
          fontFamily: 'Baloo2-Bold',
          fontSize: 14,
          color: TILE_LABEL_TEXT, // theme-exempt: fixed Bevo-world tab label
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// The pedestal Bevo stands on. The exported SVG's own width/height attrs
// (191x103) don't match its path data, which actually spans y ~1 to ~152 —
// so the viewBox below uses the real bounding box rather than the stated
// one, or the artwork would render squashed.
const PEDESTAL_VB = { w: 191, h: 153 };

function Pedestal({ width = 84 }: { width?: number }) {
  const height = width * (PEDESTAL_VB.h / PEDESTAL_VB.w);
  return (
    <Svg
      width={width}
      height={height}
      viewBox={`0 0 ${PEDESTAL_VB.w} ${PEDESTAL_VB.h}`}
      style={{ marginTop: -14 }}
    >
      <Path
        d="M189 115.334C189 116.175 188.709 116.929 188.153 117.481C182.045 123.562 150.766 151.727 95.5001 151.727C43.9114 151.727 9.86694 123.678 2.98059 117.484C2.34326 116.911 2.00016 116.095 2.00012 115.186V24.1553L189 22.7334V115.334Z"
        fill="#DFAB74" // theme-exempt: fixed Bevo-world pedestal body colour, from design artwork
        stroke="#9D4A06" // theme-exempt: fixed Bevo-world pedestal outline, from design artwork
        strokeWidth={2}
      />
      <Path
        d="M95.3711 1C121.206 1 144.626 3.3541 161.614 7.17383C170.1 9.08184 177.036 11.3673 181.874 13.9395C184.292 15.225 186.235 16.6071 187.585 18.0898C188.94 19.5783 189.742 21.2228 189.742 22.9941C189.742 24.7655 188.94 26.41 187.585 27.8984C186.235 29.3812 184.292 30.7632 181.874 32.0488C177.035 34.621 170.1 36.9074 161.614 38.8154C144.626 42.6352 121.206 44.9883 95.3711 44.9883C69.5362 44.9883 46.1159 42.6352 29.1279 38.8154C20.6422 36.9074 13.7067 34.621 8.86816 32.0488C6.44982 30.7632 4.50667 29.3812 3.15723 27.8984C1.80266 26.41 1 24.7655 1 22.9941C1.00005 21.2228 1.80264 19.5783 3.15723 18.0898C4.5067 16.6071 6.44979 15.2251 8.86816 13.9395C13.7067 11.3673 20.6422 9.08185 29.1279 7.17383C46.1159 3.35411 69.5362 1.00001 95.3711 1Z"
        fill="#F2E0BA" // theme-exempt: fixed Bevo-world pedestal rim colour, from design artwork
        stroke="#9D4A06" // theme-exempt: fixed Bevo-world pedestal outline, from design artwork
        strokeWidth={2}
      />
    </Svg>
  );
}

export default function CustomizeBevo() {
  const router = useRouter();
  const { data, update } = useOnboarding();

  // The screen's own working copy — nothing here touches OnboardingContext
  // until "Done". initial captures what to revert to on "Reset".
  const [initial] = useState<AvatarConfig>(data.pendingBevoConfig ?? data.avatarConfig);
  const [draft, setDraft] = useState<AvatarConfig>(initial);
  const [tab, setTab] = useState<Tab>('skins');

  const setPalette = (palette: BevoPalette) => setDraft((d) => ({ ...d, palette }));
  const setPattern = (pattern: BevoPattern) => setDraft((d) => ({ ...d, pattern }));
  const setHat = (hat: BevoHat) => setDraft((d) => ({ ...d, hat }));

  const handleReset = () => setDraft(initial);

  const handleDone = () => {
    update({ pendingBevoConfig: draft });
    router.back();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: PAGE_BG }} edges={['top']}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}
      >
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()}>
          <ArrowLeftIcon size={22} color={TILE_LABEL_TEXT} />
        </Pressable>
        <Text style={{ fontFamily: 'Baloo2-Regular', fontSize: 17, color: TILE_LABEL_TEXT }}>
          Customize Bevo
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Reset" onPress={handleReset}>
          <ArrowClockwiseIcon size={20} color={TILE_LABEL_TEXT} />
        </Pressable>
      </View>

      <View style={{ backgroundColor: TAN_BG, alignItems: 'center', paddingTop: 8, paddingBottom: 14 }}>
        {/* zIndex keeps Bevo painting over the pedestal in the overlap zone
            below (Pedestal's own negative marginTop) — otherwise the
            pedestal, being the later sibling, paints over Bevo's feet
            instead of sitting behind them. */}
        <View style={{ zIndex: 1 }}>
          <BevoAvatar config={draft} height={128} />
        </View>
        <Pedestal width={150} />
      </View>

      <View
        style={{
          width: 36,
          height: 4,
          borderRadius: 2,
          backgroundColor: DRAG_HANDLE, // theme-exempt: fixed Bevo-world drag-handle indicator
          alignSelf: 'center',
          marginTop: 8,
          marginBottom: 8,
        }}
      />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
      >
        {/* The tab row sits above the card and overlaps its top border by
            2px (matching the card's own border width) so the active tab's
            open bottom edge paints over that border segment — zIndex above
            the card (a plain sibling here) is what makes that overlap render
            on top instead of getting drawn over by the card. */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginBottom: -2, zIndex: 2 }}>
          <TabButton
            label="Skins"
            icon={<SkinsTabIcon color={SKINS_ICON_COLOR} />}
            active={tab === 'skins'}
            onPress={() => setTab('skins')}
          />
          <TabButton
            label="Colors"
            icon={<ColorsTabIcon color={TAB_ICON_COLOR} />}
            active={tab === 'colors'}
            onPress={() => setTab('colors')}
          />
          <TabButton
            label="Accessories"
            icon={<AccessoriesTabIcon color={TAB_ICON_COLOR} />}
            active={tab === 'accessories'}
            onPress={() => setTab('accessories')}
          />
        </View>

        <View
          style={{
            backgroundColor: CARD_BG, // theme-exempt: fixed Bevo-world card background
            borderWidth: 2,
            borderColor: INK, // theme-exempt: fixed Bevo-world card border
            borderRadius: 20,
            padding: 14,
          }}
        >
          {tab === 'skins' &&
            chunk3(BEVO_PATTERNS as unknown as BevoPattern[]).map((row, i) => (
              <TileRow key={i}>
                {row.map((pattern, j) =>
                  pattern ? (
                    <Tile
                      key={pattern}
                      label={PATTERN_LABELS[pattern]}
                      selected={(draft.pattern ?? 'none') === pattern}
                      onPress={() => setPattern(pattern)}
                    >
                      <PatternSwatch pattern={pattern} />
                    </Tile>
                  ) : (
                    <View key={j} style={{ flex: 1 }} />
                  ),
                )}
              </TileRow>
            ))}

          {tab === 'colors' &&
            chunk3(BEVO_PALETTES as unknown as BevoPalette[]).map((row, i) => (
              <TileRow key={i}>
                {row.map((palette, j) =>
                  palette ? (
                    <Tile
                      key={palette}
                      label={PALETTE_LABELS[palette]}
                      selected={draft.palette === palette}
                      onPress={() => setPalette(palette)}
                    >
                      <ColorSwatch palette={palette} />
                    </Tile>
                  ) : (
                    <View key={j} style={{ flex: 1 }} />
                  ),
                )}
              </TileRow>
            ))}

          {tab === 'accessories' &&
            chunk3(HAT_ORDER).map((row, i) => (
              <TileRow key={i}>
                {row.map((hat, j) =>
                  hat ? (
                    <Tile
                      key={hat}
                      label={HAT_LABELS[hat]}
                      selected={(draft.hat ?? 'none') === hat}
                      onPress={() => setHat(hat)}
                    >
                      <HatSwatch hat={hat} />
                    </Tile>
                  ) : (
                    <View key={j} style={{ flex: 1 }} />
                  ),
                )}
              </TileRow>
            ))}
        </View>

        <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reset"
            onPress={handleReset}
            style={{
              flex: 1,
              height: 48,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: TILE_BORDER, // theme-exempt: fixed Bevo-world button border
              backgroundColor: CARD_BG, // theme-exempt: fixed Bevo-world button background
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontFamily: 'Baloo2-Bold', fontSize: 15, color: TILE_LABEL_TEXT }}>
              Reset
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Done"
            onPress={handleDone}
            style={{
              flex: 1,
              height: 48,
              borderRadius: 16,
              backgroundColor: BURNT_ORANGE, // theme-exempt: fixed Bevo-world primary action
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontFamily: 'Baloo2-Bold', fontSize: 15, color: '#FFFFFF' }}>
              Done
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
