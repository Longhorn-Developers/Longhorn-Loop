// Building blocks shared by the Orgs tab and the redesigned org page
// (LOOP-330 – LOOP-335).
//
// Figma: "Orgs - My Orgs Toggle", "Orgs - Discover Toggle", "Org Page (…)".
// The two screens are drawn from the same parts -- the date-tile event row
// appears on My Orgs' Upcoming list AND the org page's Events tab, the section
// heading on every section of both -- so they live here once rather than as
// near-copies in each screen.
//
// Colours are lhl* tokens only. The frames' "LHL Light Orange Fill" (#F6E9DB)
// is lhlBrandTint and "LHL Beige Border" (#E8E3DC) is lhlBorderSoft; see
// app/globals.css for why the tint is its own token and not lhlBrandSoft.

import type { ApiEvent } from '@/app/components/EventCard';
import { hitSlopFor } from '@/app/lib/tapTarget';
import { useThemeColors } from '@/app/lib/themeColors';
import { ChevronRightIcon } from '@/assets/icons/LhlOrgsIcons';
import CheckIcon from '@/assets/images/check-selected.svg';
import { useRouter } from 'expo-router';
import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';

const WEEKDAY_SHORT = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const WEEKDAY_TITLE = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "AIAA" → "AIAA", "Longhorn Gaming" → "LG", "x" → "X". */
export function orgMonogram(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  // A single short all-caps word is already an acronym; the frame keeps
  // "AIAA" whole rather than cutting it to "A".
  if (words.length === 1) {
    const w = words[0];
    return w.length <= 4 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase();
  }
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}

/**
 * An org's picture in a rounded square, or its monogram on burnt orange.
 *
 * Square, not round: the redesign draws orgs as tiles and people as discs, so
 * the shape alone tells you which kind of account a row is. Most orgs have no
 * picture (HornsLink-scraped rows carry a name and little else), so the
 * monogram is the common case.
 */
export function OrgLogo({
  name,
  uri,
  size,
  radius = 8,
}: {
  name: string | null | undefined;
  uri: string | null | undefined;
  size: number;
  radius?: number;
}) {
  if (uri) {
    return (
      <Image
        source={{ uri }}
        accessibilityIgnoresInvertColors
        style={{ width: size, height: size, borderRadius: radius }}
        resizeMode="cover"
      />
    );
  }
  const label = orgMonogram(name);
  return (
    <View
      className="items-center justify-center bg-lhlBurntOrange"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      {/* theme-exempt: white on the filled brand colour, as on every button. */}
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        className="font-roboto-bold text-white"
        style={{ fontSize: Math.round(size * (label.length > 2 ? 0.3 : 0.36)) }}
      >
        {label}
      </Text>
    </View>
  );
}

/**
 * Section heading: optional burnt-orange eyebrow ("Right Now on Campus"), the
 * uppercase title, an optional count badge (NEEDS YOU ②) and "See all ›".
 */
export function SectionHeading({
  eyebrow,
  title,
  count,
  onSeeAll,
  right,
}: {
  eyebrow?: string;
  title: string;
  count?: number;
  onSeeAll?: () => void;
  right?: React.ReactNode;
}) {
  const colors = useThemeColors();
  return (
    <View className="flex-row items-end justify-between">
      <View className="shrink">
        {eyebrow ? (
          <Text className="font-roboto-medium text-[10px] leading-[12px] text-lhlAccent">
            {eyebrow}
          </Text>
        ) : null}
        <View className="flex-row items-center gap-[6px]">
          <Text
            accessibilityRole="header"
            className="font-roboto-bold text-[14px] uppercase leading-[18px] text-lhlSecondaryTextGrey"
          >
            {title}
          </Text>
          {count ? (
            <View className="h-[16px] min-w-[16px] items-center justify-center rounded-[8px] bg-lhlBurntOrange px-[4px]">
              <Text className="font-roboto-bold text-[10px] text-white">{count}</Text>
            </View>
          ) : null}
        </View>
      </View>
      {right}
      {onSeeAll ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`See all ${title.toLowerCase()}`}
          onPress={onSeeAll}
          hitSlop={hitSlopFor(18)}
          className="flex-row items-center"
        >
          <Text className="font-roboto-semibold text-[12px] text-lhlAccent">See all</Text>
          <ChevronRightIcon size={14} color={colors.accent} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** A pill chip: filter rows on Your Orgs, the category row on Discover, tags. */
export function Chip({
  label,
  selected = false,
  onPress,
  tone = 'neutral',
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  /**
   * 'neutral' — selected is the beige groove fill (Your Orgs' "All 5").
   * 'brand'   — selected is solid burnt orange (Discover's "All Orgs").
   */
  tone?: 'neutral' | 'brand';
}) {
  const selectedBox =
    tone === 'brand'
      ? 'border-lhlBurntOrange bg-lhlBurntOrange'
      : 'border-lhlSegmentTrack bg-lhlSegmentTrack';
  const selectedText = tone === 'brand' ? 'text-white' : 'text-lhlInk';
  const body = (
    <View
      className={`items-center justify-center rounded-full border px-[10px] py-[6px] ${
        selected ? selectedBox : 'border-lhlBorderSoft bg-lhlSurface'
      }`}
    >
      <Text
        className={`font-roboto-medium text-[12px] leading-[14px] ${
          selected ? selectedText : 'text-lhlInk'
        }`}
      >
        {label}
      </Text>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      hitSlop={hitSlopFor(28)}
    >
      {body}
    </Pressable>
  );
}

/**
 * Two-option segmented control — "Upcoming (3) | Past (2)".
 *
 * The groove is lhlSegmentTrack and the chosen segment is white (surface), the
 * frame's fill-2 + white pairing. Selected text is semibold, the other regular.
 */
export function SegmentedToggle<K extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <View
      accessibilityRole="tablist"
      className="h-[31px] flex-row rounded-[8px] bg-lhlSegmentTrack p-[4px]"
    >
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.key)}
            className={`flex-1 items-center justify-center rounded-[8px] ${
              active ? 'bg-lhlSurface' : ''
            }`}
          >
            <Text
              className={`text-[12px] leading-[14px] text-lhlInk ${
                active ? 'font-roboto-semibold' : 'font-roboto'
              }`}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The 40x42 "THU / 26" tile at the left of an event row. */
export function EventDateTile({ iso }: { iso: string }) {
  const d = new Date(iso);
  const valid = !Number.isNaN(d.getTime());
  return (
    <View className="h-[42px] w-[40px] items-center justify-center rounded-[8px] border border-lhlBurntOrange bg-lhlBrandTint">
      <Text className="font-roboto-semibold text-[12px] leading-[14px] text-lhlAccent">
        {valid ? WEEKDAY_SHORT[d.getDay()] : '—'}
      </Text>
      <Text className="font-roboto-semibold text-[16px] leading-[19px] text-lhlInk">
        {valid ? d.getDate() : ''}
      </Text>
    </View>
  );
}

/**
 * The right-hand pill on an event row: "✓ Going" (tinted) or "RSVP" (outline).
 *
 * RSVP opens the event rather than RSVPing in place. The event page is where
 * the RSVP flow, its external-link variant (rsvp_url) and its confirmation
 * live; a one-tap RSVP from a list row would skip all three.
 */
export function GoingPill({ going }: { going: boolean }) {
  const colors = useThemeColors();
  if (going) {
    return (
      <View className="h-[30px] flex-row items-center gap-[6px] rounded-[8px] bg-lhlBrandTint px-[8px]">
        <CheckIcon width={12} height={9} color={colors.accent} />
        <Text className="font-roboto-semibold text-[12px] text-lhlAccent">Going</Text>
      </View>
    );
  }
  return (
    <View className="h-[30px] items-center justify-center rounded-[8px] border border-lhlDivider bg-lhlBackgroundColor px-[8px]">
      <Text className="font-roboto-semibold text-[12px] text-lhlSecondaryTextGrey">RSVP</Text>
    </View>
  );
}

/** The white rounded card every list row on these screens sits in. */
export function RowCard({
  children,
  onPress,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const className =
    'min-h-[64px] flex-row items-center gap-[16px] rounded-[16px] border border-lhlBorderSoft bg-lhlSurface px-[12px] py-[10px]';
  if (!onPress) return <View className={className}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      className={className}
    >
      {children}
    </Pressable>
  );
}

/**
 * An upcoming event: date tile, title, "ORG · Location", Going/RSVP.
 *
 * `showOrg` is on for My Orgs (rows mix several orgs) and on the org page too,
 * where the frame still writes "TCBC · BLT 2.503" -- it reads as a byline.
 */
export function UpcomingEventRow({ event, going }: { event: ApiEvent; going: boolean }) {
  const router = useRouter();
  const where = event.location_short || event.location_full;
  const subtitle = [event.host_organization_name, where].filter(Boolean).join(' · ');
  return (
    <RowCard
      accessibilityLabel={`${event.title}${going ? ', going' : ''}`}
      onPress={() => router.push(`/event/${event.id}`)}
    >
      <EventDateTile iso={event.start_datetime} />
      <View className="flex-1 gap-[2px]">
        <Text
          numberOfLines={1}
          className="font-roboto-semibold text-[16px] leading-[19px] text-lhlInk"
        >
          {event.title}
        </Text>
        {subtitle ? (
          <Text
            numberOfLines={1}
            className="font-roboto text-[12px] leading-[14px] text-lhlSecondaryTextGrey"
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      <GoingPill going={going} />
    </RowCard>
  );
}

/** "Wed 12/3" -- the past-event row's date, in the device's local time. */
function shortWeekdayDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${WEEKDAY_TITLE[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * A past event: flyer thumbnail, title, "Wed 12/3 • Location", "N went", ›.
 *
 * "N went" is rsvp_count -- the people who said they were going. There is no
 * attendance record (LOOP-340), so it is the closest honest number. The
 * frame's "· 12 photos" has no source at all and is left off.
 */
export function PastEventRow({ event }: { event: ApiEvent }) {
  const router = useRouter();
  const colors = useThemeColors();
  const where = event.location_short || event.location_full;
  const meta = [shortWeekdayDate(event.start_datetime), where].filter(Boolean).join(' • ');
  const went = event.rsvp_count ?? 0;
  return (
    <RowCard accessibilityLabel={event.title} onPress={() => router.push(`/event/${event.id}`)}>
      {event.image_url ? (
        <Image
          source={{ uri: event.image_url }}
          accessibilityIgnoresInvertColors
          style={{ width: 64, height: 64, borderRadius: 8 }}
          resizeMode="cover"
        />
      ) : (
        <OrgLogo name={event.host_organization_name} uri={event.org_profile_picture} size={64} />
      )}
      <View className="flex-1 gap-[3px]">
        <Text
          numberOfLines={2}
          className="font-roboto-semibold text-[14px] leading-[17px] text-lhlInk"
        >
          {event.title}
        </Text>
        {meta ? (
          <Text
            numberOfLines={1}
            className="font-roboto text-[12px] leading-[14px] text-lhlSecondaryTextGrey"
          >
            {meta}
          </Text>
        ) : null}
        {went > 0 ? (
          <Text className="font-roboto text-[12px] leading-[14px] text-lhlSecondaryTextGrey">
            {went.toLocaleString()} went
          </Text>
        ) : null}
      </View>
      <ChevronRightIcon size={16} color={colors.ink} />
    </RowCard>
  );
}
