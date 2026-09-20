// Explore's filter sheet — "College Lens" (design: Explore filters, Concept 01).
//
// THE ONE IDEA. A half-height sheet, not a full-screen takeover, so the results
// stay on screen behind it and the footer button counts: "Show 47 events",
// updating on every tap. You never commit blind, and a combination that would
// return nothing is visible as 0 before you press anything rather than as an
// empty screen after.
//
// LAYOUT ORDER IS THE PRIORITY ARGUMENT. College is first and has the biggest
// targets (54pt crests) because vertical position in a filter panel IS
// priority. Interests come second. Time and perks collapse into two summary
// rows at the bottom showing their current value, because they are secondary
// and the layout should say so.
//
// ---------------------------------------------------------------------------
// THREE THINGS THAT LOOK LIKE SHORTCUTS AND ARE NOT.
//
// 1. THE SHEET MECHANICS ARE SHARED, NOT COPIED. Swipe-down, the spring-in and
//    the scrim that fades with the drag all come from
//    components/modals/DragDismissSheet — the shell extracted out of
//    ManageEventSheet, which is where that behaviour was worked out and where
//    its comments explain what Fabric cost to get right. Both sheets are the
//    same sheet now, which is the point: they should not drift.
//
//    The one difference is WHERE the drag lives. This sheet's content scrolls,
//    so the pan is confined to the grabber and header (`dragFrom="header"`);
//    ManageEventSheet's content does not, so its pan owns the whole surface.
//    A pan over a scrolling list fights the list for every vertical gesture,
//    and the list usually loses — you flick to see more interests and dismiss
//    the sheet instead.
//
// 2. "INTERESTS IN COCKRELL" IS THE DIM RULE, NOT A SECOND QUERY. The design
//    says the tag list narrows to what the college actually runs. It does —
//    every chip carries its live count and a chip at 0 dims in place. That is
//    the contextual list, computed from events already in memory, and it keeps
//    the taxonomy STILL: chips that appear and vanish as you tap make the
//    vocabulary feel unstable and stop people exploring.
//
// 3. WHEN AND PERKS EXPAND INLINE. The frame draws a chevron, implying a
//    pushed sub-screen. They open in place instead. A sub-screen for "Today /
//    Tomorrow / This week" would put a navigation transition between the user
//    and a five-item radio group, and it would hide the live count — which is
//    the one thing this design exists to keep visible.
//
// Where is deliberately absent: it needs location permission and a distance
// filter, which is its own ticket. Adding an inert "Any distance" row would be
// a third control that does nothing.

import { useThemeColors } from '@/app/lib/themeColors';
import { COLLEGES } from '@/shared/colleges';
import { EVENT_BENEFIT_OPTIONS } from '@/shared/eventBenefits';
import {
  EMPTY_FILTERS,
  WHEN_OPTIONS,
  hasActiveFilters,
  toggleInArray,
  whenLabel,
  type ExploreFilters,
  type FacetCounts,
  type WhenId,
} from '@/shared/exploreFilters';
import { TAXONOMY_BUCKETS } from '@/shared/taxonomy';
import React, { useState } from 'react';
import DragDismissSheet from '@/app/components/modals/DragDismissSheet';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';

/** Tick inside the selection notch and on a chosen tag. Local because it is
 *  three lines and only this file needs it. */
function CheckGlyph({ size = 12, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path
        d="M3.2 8.4l3.1 3.1 6.5-7"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function Chevron({ open, color }: { open: boolean; color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 16 16" fill="none">
      <Path
        d={open ? 'M3.5 10L8 5.5l4.5 4.5' : 'M6 3.5L10.5 8 6 12.5'}
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const CREST_SIZE = 54;

/**
 * How far the badge and notch hang off the tile's corners.
 *
 * Derived, not eyeballed, because THREE separate things have to leave room for
 * it and they were each getting it wrong independently — see the note on the
 * crest's outer box below. The badge overhangs 6 and the notch 4, so 6 is the
 * number everything else has to clear.
 */
const CREST_OVERHANG = 6;

/** The tile plus its overhang on both sides. Nothing may be narrower. */
const CREST_WIDTH = CREST_SIZE + CREST_OVERHANG * 2;

/**
 * Top padding the crest rail needs so the badge isn't shaved off.
 *
 * The badge sits at `top: -CREST_OVERHANG`, i.e. above the Pressable's own box,
 * and a ScrollView clips its content whatever `overflow` says. +2 for slack.
 */
const CREST_RAIL_PADDING_TOP = CREST_OVERHANG + 2;

/**
 * One college crest.
 *
 * Selected state is fill + a check notch, never colour alone — the same rule
 * the rest of the app follows, and the reason the notch exists at all.
 */
function Crest({
  monogram,
  label,
  count,
  selected,
  onPress,
  accessibilityLabel,
}: {
  monogram: string;
  label: string;
  count: number;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const colors = useThemeColors();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel}
      style={{ width: CREST_WIDTH, alignItems: 'center', gap: 6 }}
    >
      {/* THE DECORATIONS HANG OFF THIS BOX, NOT OFF THE TILE, and that is the
          fix rather than a nicety. They used to be children of the rounded tile
          below, and on Android a View with a borderRadius clips its children to
          that rounded shape — so the badge and the notch had their outer
          corners shaved off. This wrapper is the same size as the tile and has
          no radius of its own, so there is nothing to clip against. */}
      <View style={{ width: CREST_SIZE, height: CREST_SIZE }}>
        <View
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 15,
            borderWidth: 1.5,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: selected ? colors.brand : colors.surfaceMuted,
            borderColor: selected ? 'transparent' : colors.border,
          }}
        >
          <Text
            style={{
              fontSize: 13,
              fontWeight: '800',
              color: selected ? '#FFFFFF' : colors.inkSecondary,
            }}
          >
            {monogram}
          </Text>
        </View>

        {/* Count badge — only on the selected crest. On every crest it would be
            26 numbers competing with each other; on the chosen one it is the
            answer to "what did I just pick". */}
        {selected ? (
          <View
            style={{
              position: 'absolute',
              // The constant, not a literal 6: CREST_WIDTH and the rail's top
              // padding are both sized off it, and a bare number here is how
              // the three drifted apart in the first place.
              right: -CREST_OVERHANG,
              top: -CREST_OVERHANG,
              minWidth: 20,
              paddingHorizontal: 5,
              height: 17,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.ink,
            }}
          >
            <Text style={{ fontSize: 10, fontWeight: '700', color: colors.background }}>
              {count}
            </Text>
          </View>
        ) : null}

        {selected ? (
          <View
            style={{
              position: 'absolute',
              right: -4,
              bottom: -4,
              width: 18,
              height: 18,
              borderRadius: 9,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.surface,
              borderWidth: 2,
              borderColor: colors.brand,
            }}
          >
            <CheckGlyph size={9} color={colors.brand} />
          </View>
        ) : null}
      </View>

      <Text
        numberOfLines={2}
        style={{
          fontSize: 10.5,
          lineHeight: 13,
          textAlign: 'center',
          fontWeight: selected ? '800' : '600',
          color: selected ? colors.accent : colors.inkMuted,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** A group heading — "COLLEGE", "INTERESTS in Cockrell". */
function GroupLabel({ text, context }: { text: string; context?: string }) {
  const colors = useThemeColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 16, marginBottom: 8 }}>
      <Text
        style={{
          fontSize: 11.5,
          fontWeight: '800',
          letterSpacing: 1.2,
          textTransform: 'uppercase',
          color: colors.inkSecondary,
        }}
      >
        {text}
      </Text>
      {context ? (
        <Text style={{ fontSize: 12, fontWeight: '600', color: colors.inkMuted, marginLeft: 6 }}>
          {context}
        </Text>
      ) : null}
    </View>
  );
}

/** A tag / perk chip with its live count. */
function Chip({
  label,
  count,
  selected,
  onPress,
}: {
  label: string;
  /**
   * Omitted for single-select groups (When). A count there would mean "what if
   * I switched to this instead", which is a different question from the OR
   * groups' "what if I added this" — and rendering both as a bare number beside
   * a chip would make them look like the same promise.
   */
  count?: number;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();

  // A chip that would return nothing dims and stops responding — it does NOT
  // disappear. See note 2 in the file header.
  const empty = count === 0 && !selected;

  return (
    <Pressable
      onPress={onPress}
      disabled={empty}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: empty }}
      accessibilityLabel={
        count === undefined ? label : `${label}, ${count} event${count === 1 ? '' : 's'}`
      }
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 36,
        paddingHorizontal: 12,
        borderRadius: 10,
        borderWidth: 1.5,
        opacity: empty ? 0.45 : 1,
        backgroundColor: selected ? colors.brandSoft : colors.surface,
        borderColor: selected ? colors.brand : colors.border,
      }}
    >
      {selected ? <CheckGlyph size={12} color={colors.accent} /> : null}
      <Text
        style={{
          fontSize: 13,
          fontWeight: selected ? '700' : '600',
          color: selected ? colors.accent : colors.inkSecondary,
        }}
      >
        {label}
      </Text>
      {/* The count is what makes the chip a promise rather than a guess. Hidden
          on a selected chip, where it would be counting the set you are already
          looking at. */}
      {!selected && count !== undefined ? (
        <Text style={{ fontSize: 11, fontWeight: '600', color: colors.inkMuted }}>{count}</Text>
      ) : null}
    </Pressable>
  );
}

export interface ExploreFilterSheetProps {
  visible: boolean;
  filters: ExploreFilters;
  counts: FacetCounts;
  /** Total before any filter — the "of 214 pins" denominator. */
  totalEvents: number;
  /** Map mode counts pins and says so; list mode counts events. */
  unit: 'events' | 'pins';
  onChange: (next: ExploreFilters) => void;
  onClose: () => void;
}

export default function ExploreFilterSheet({
  visible,
  filters,
  counts,
  totalEvents,
  unit,
  onChange,
  onClose,
}: ExploreFilterSheetProps) {
  const colors = useThemeColors();
  const { height } = useWindowDimensions();

  const [openRow, setOpenRow] = useState<'when' | 'perks' | null>(null);

  // Half detent, bounded: tall enough for college + interests without
  // scrolling on a normal phone, never so tall that the results it exists to
  // keep visible are covered.
  const sheetMaxHeight = Math.min(Math.round(height * 0.72), 560);

  const selectedCollege = COLLEGES.find((c) => c.id === filters.collegeId);
  const interestContext = selectedCollege ? `in ${selectedCollege.short}` : undefined;

  const setWhen = (when: WhenId) => {
    onChange({ ...filters, when });
    setOpenRow(null);
  };

  /**
   * The drag region. Everything in here is draggable; everything below it
   * scrolls. The "Clear all" button lives inside it and still works — the pan
   * needs 8pt of vertical travel to activate, so a tap never becomes a drag.
   */
  const header = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingBottom: 10,
      }}
    >
      <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>Filters</Text>

      {/* On the map the header carries the denominator, because "47 of 214
          pins" is the only way to see the shape of what you excluded. */}
      {unit === 'pins' ? (
        <Text style={{ fontSize: 12, color: colors.inkMuted, fontWeight: '600' }}>
          <Text style={{ color: colors.accent, fontWeight: '700' }}>{counts.total}</Text> of{' '}
          {totalEvents} pins
        </Text>
      ) : (
        <Pressable
          onPress={() => onChange(EMPTY_FILTERS)}
          disabled={!hasActiveFilters(filters)}
          accessibilityRole="button"
          accessibilityLabel="Clear all filters"
          hitSlop={8}
          style={{ opacity: hasActiveFilters(filters) ? 1 : 0.4, paddingHorizontal: 4 }}
        >
          <Text style={{ fontSize: 13, fontWeight: '700', color: colors.accent }}>Clear all</Text>
        </Pressable>
      )}
    </View>
  );

  return (
    <DragDismissSheet
      visible={visible}
      onClose={onClose}
      // The content scrolls, so the pan is confined to the grabber and the
      // header — see the note on `dragFrom` in DragDismissSheet. A pan over the
      // whole sheet would spend every vertical gesture arguing with the chip
      // list underneath it.
      dragFrom="header"
      header={header}
      sheetStyle={{ maxHeight: sheetMaxHeight }}
    >
      <View style={{ flexShrink: 1 }}>
        <ScrollView
          style={{ paddingHorizontal: 16 }}
          contentContainerStyle={{ paddingBottom: 12 }}
          showsVerticalScrollIndicator={false}
        >
          {/* --- College --- */}
          <GroupLabel text="College" />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            // paddingTop clears the badge, which sits above each crest's own
            // box; a ScrollView clips its content whatever `overflow` says, so
            // without this the selected crest's badge loses its top edge.
            // paddingBottom clears the notch the same way.
            contentContainerStyle={{
              gap: 10,
              paddingTop: CREST_RAIL_PADDING_TOP,
              paddingBottom: 4,
            }}
          >
            {/* "All of UT" clears the college group. It is NOT the campus-wide
                college, which is a real, separate choice further along the rail:
                "no college constraint" and "events that belong to no college"
                are different questions. */}
            <Crest
              monogram="UT"
              label="All of UT"
              count={totalEvents}
              selected={filters.collegeId === null}
              onPress={() => onChange({ ...filters, collegeId: null })}
              accessibilityLabel="All of UT, no college filter"
            />
            {COLLEGES.map((college) => (
              <Crest
                key={college.id}
                monogram={college.monogram}
                label={college.short}
                count={counts.colleges[college.id] ?? 0}
                selected={filters.collegeId === college.id}
                onPress={() =>
                  onChange({
                    ...filters,
                    // Single-select, and tapping the chosen one clears it —
                    // otherwise the only way back to "all" is to find the UT
                    // crest again at the far left of a scrolled rail.
                    collegeId: filters.collegeId === college.id ? null : college.id,
                  })
                }
                accessibilityLabel={`${college.name}, ${counts.colleges[college.id] ?? 0} events`}
              />
            ))}
          </ScrollView>

          {/* --- Interests --- */}
          <GroupLabel text="Interests" context={interestContext} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
            {TAXONOMY_BUCKETS.map((bucket) => (
              <Chip
                key={bucket.id}
                label={bucket.label}
                count={counts.interests[bucket.id] ?? 0}
                selected={filters.interests.includes(bucket.id)}
                onPress={() =>
                  onChange({ ...filters, interests: toggleInArray(filters.interests, bucket.id) })
                }
              />
            ))}
          </View>

          {/* --- Secondary rows --- */}
          <View
            style={{
              marginTop: 16,
              borderWidth: 1,
              borderColor: colors.divider,
              borderRadius: 13,
              overflow: 'hidden',
            }}
          >
            <SummaryRow
              label="When"
              value={whenLabel(filters.when)}
              highlighted={filters.when !== 'any'}
              open={openRow === 'when'}
              onPress={() => setOpenRow(openRow === 'when' ? null : 'when')}
            />
            {openRow === 'when' ? (
              <View style={{ paddingHorizontal: 13, paddingBottom: 12, gap: 7 }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                  {WHEN_OPTIONS.map((option) => (
                    // Uncounted on purpose — see the `count` prop's note on Chip.
                    <Chip
                      key={option.id}
                      label={option.label}
                      selected={filters.when === option.id}
                      onPress={() => setWhen(option.id)}
                    />
                  ))}
                </View>
              </View>
            ) : null}

            <View style={{ height: 1, backgroundColor: colors.divider }} />

            <SummaryRow
              label="Perks"
              value={filters.perks.length ? filters.perks.join(', ') : 'Any'}
              highlighted={filters.perks.length > 0}
              open={openRow === 'perks'}
              onPress={() => setOpenRow(openRow === 'perks' ? null : 'perks')}
            />
            {openRow === 'perks' ? (
              <View style={{ paddingHorizontal: 13, paddingBottom: 12 }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                  {EVENT_BENEFIT_OPTIONS.map((perk) => (
                    <Chip
                      key={perk}
                      label={perk}
                      count={counts.perks[perk] ?? 0}
                      selected={filters.perks.includes(perk)}
                      onPress={() =>
                        onChange({ ...filters, perks: toggleInArray(filters.perks, perk) })
                      }
                    />
                  ))}
                </View>
              </View>
            ) : null}
          </View>
        </ScrollView>
      </View>

      {/* --- Footer ---
          Outside the scroll view, so the count and Reset stay put while you
          scroll the chips. It is the one part of this sheet that must never
          leave the screen. */}
      <View
        style={{
          flexDirection: 'row',
          gap: 9,
          paddingHorizontal: 16,
          paddingTop: 11,
          paddingBottom: 26,
          borderTopWidth: 1,
          borderColor: colors.divider,
        }}
      >
        <Pressable
          onPress={() => onChange(EMPTY_FILTERS)}
          disabled={!hasActiveFilters(filters)}
          accessibilityRole="button"
          accessibilityLabel="Reset filters"
          style={{
            minHeight: 48,
            paddingHorizontal: 16,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 13,
            borderWidth: 1.5,
            borderColor: colors.border,
            backgroundColor: colors.surface,
            opacity: hasActiveFilters(filters) ? 1 : 0.5,
          }}
        >
          <Text style={{ fontSize: 14.5, fontWeight: '700', color: colors.ink }}>Reset</Text>
        </Pressable>

        {/* The count IS the button. At zero it is spent — there is nothing to
              show, and a button that promises 0 results and then delivers an
              empty screen is the exact failure this design removes. */}
        <Pressable
          onPress={onClose}
          disabled={counts.total === 0}
          accessibilityRole="button"
          accessibilityLabel={`Show ${counts.total} ${unit}`}
          style={{
            flex: 1,
            minHeight: 48,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 13,
            backgroundColor: counts.total === 0 ? colors.surfaceMuted : colors.brand,
          }}
        >
          <Text
            style={{
              fontSize: 15.5,
              fontWeight: '700',
              color: counts.total === 0 ? colors.inkMuted : '#FFFFFF',
            }}
          >
            {counts.total === 0 ? 'No matches — widen a filter' : `Show ${counts.total} ${unit}`}
          </Text>
        </Pressable>
      </View>
    </DragDismissSheet>
  );
}

function SummaryRow({
  label,
  value,
  highlighted,
  open,
  onPress,
}: {
  label: string;
  value: string;
  highlighted: boolean;
  open: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${label}, currently ${value}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 13,
        minHeight: 48,
      }}
    >
      <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: colors.ink }}>{label}</Text>
      <Text
        numberOfLines={1}
        style={{
          fontSize: 13,
          fontWeight: highlighted ? '700' : '500',
          color: highlighted ? colors.accent : colors.inkMuted,
          maxWidth: 150,
        }}
      >
        {value}
      </Text>
      <Chevron open={open} color={colors.inkMuted} />
    </Pressable>
  );
}
