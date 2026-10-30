// Explore's filter sheet for ORG results (LOOP-293; design: "Explore Page Org
// Filters - Bottom Sheet", Figma 5774:34019).
//
// A sibling of ExploreFilterSheet, not a mode of it. The event sheet is built
// around live counts computed in memory over one feed page; org results are
// filtered and paged by the SERVER, so there is no in-memory set to count and
// every one of the event sheet's groups (college, interests, time, perks) would
// be a control that does nothing. The ticket's rule — hide what doesn't apply
// rather than show it inert — is easiest to keep when the org sheet simply
// never has those groups to hide.
//
// Same shell (DragDismissSheet, drag from the header) and the same chip
// language, so the two sheets read as one design.
//
// Deliberate gaps against the frame:
//   - No "Organization size": see app/lib/orgFilters.ts.
//   - No Sort pill in the title row: the New Orgs / Orgs chips already choose
//     the sort, and a second control over the same axis can disagree with them
//     (the reason the bucket pills left ExploreToggles).
//   - Category chips are ORG_CATEGORIES, the five values organizations.category
//     can actually hold. The frame's "Sports & Fitness 18 / Food & Drink 6"
//     list is placeholder copy with no column behind it, and uncounted here
//     because GET /orgs/search returns no facet counts.
//   - "Has upcoming events" is extra: the endpoint supports it and it is the
//     most useful thing to narrow a mostly-dormant scraped directory by.

import DragDismissSheet from '@/app/components/modals/DragDismissSheet';
import { EMPTY_ORG_FILTERS, activeOrgFilterCount, type OrgFilters } from '@/app/lib/orgFilters';
import { useThemeColors } from '@/app/lib/themeColors';
import { ORG_CATEGORIES, type OrgCategory } from '@/shared/orgRegistration';
import { toggleInArray } from '@/shared/exploreFilters';
import { CalendarCheckIcon, SealCheckIcon, type IconProps } from 'phosphor-react-native';
import React from 'react';
import { Pressable, ScrollView, Switch, Text, View, useWindowDimensions } from 'react-native';

export interface ExploreOrgFilterSheetProps {
  visible: boolean;
  filters: OrgFilters;
  onChange: (next: OrgFilters) => void;
  onClose: () => void;
}

function ToggleRow({
  Icon,
  label,
  caption,
  value,
  onValueChange,
}: {
  Icon: React.ComponentType<IconProps>;
  label: string;
  caption: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
}) {
  const colors = useThemeColors();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderColor: colors.borderSoft,
      }}
    >
      <Icon size={20} color={colors.accent} weight="fill" />
      <View style={{ flex: 1 }}>
        <Text className="font-roboto-semibold" style={{ fontSize: 15, color: colors.ink }}>
          {label}
        </Text>
        <Text className="font-roboto" style={{ fontSize: 12, color: colors.inkMuted }}>
          {caption}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        accessibilityLabel={label}
        trackColor={{ false: colors.segmentTrack, true: colors.brand }}
        // White knob on both platforms, as drawn; iOS ignores it when off.
        thumbColor={colors.surface}
        ios_backgroundColor={colors.segmentTrack}
      />
    </View>
  );
}

export default function ExploreOrgFilterSheet({
  visible,
  filters,
  onChange,
  onClose,
}: ExploreOrgFilterSheetProps) {
  const colors = useThemeColors();
  const { height } = useWindowDimensions();
  const sheetMaxHeight = Math.min(Math.round(height * 0.72), 560);
  const active = activeOrgFilterCount(filters) > 0;

  const header = (
    <View style={{ paddingHorizontal: 20, paddingBottom: 6 }}>
      <Text className="font-roboto-semibold" style={{ fontSize: 20, color: colors.ink }}>
        Organization Filters
      </Text>
    </View>
  );

  return (
    <DragDismissSheet
      visible={visible}
      onClose={onClose}
      dragFrom="header"
      header={header}
      sheetStyle={{ maxHeight: sheetMaxHeight }}
    >
      <View style={{ flexShrink: 1 }}>
        <ScrollView
          style={{ paddingHorizontal: 20 }}
          contentContainerStyle={{ paddingBottom: 16 }}
          showsVerticalScrollIndicator={false}
        >
          <ToggleRow
            Icon={SealCheckIcon}
            label="Verified orgs only"
            caption="Claimed and confirmed on Loop"
            value={filters.verifiedOnly}
            onValueChange={(verifiedOnly) => onChange({ ...filters, verifiedOnly })}
          />
          <ToggleRow
            Icon={CalendarCheckIcon}
            label="Has upcoming events"
            caption="Something on the calendar"
            value={filters.hasUpcomingEvents}
            onValueChange={(hasUpcomingEvents) => onChange({ ...filters, hasUpcomingEvents })}
          />

          <Text
            className="font-roboto-bold"
            style={{
              fontSize: 14,
              color: colors.inkSecondary,
              textTransform: 'uppercase',
              marginTop: 18,
              marginBottom: 10,
            }}
          >
            Organization type
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {ORG_CATEGORIES.map((category: OrgCategory) => {
              const selected = filters.categories.includes(category);
              return (
                <Pressable
                  key={category}
                  onPress={() =>
                    onChange({
                      ...filters,
                      // toggleInArray is typed over string[]; it only ever
                      // removes or re-adds `category`, so the narrower type holds.
                      categories: toggleInArray(filters.categories, category) as OrgCategory[],
                    })
                  }
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={category}
                  style={{
                    minHeight: 40,
                    justifyContent: 'center',
                    paddingHorizontal: 14,
                    borderRadius: 8,
                    borderWidth: 1.5,
                    borderColor: selected ? colors.brand : colors.inkMuted,
                    backgroundColor: selected ? colors.brandSoft : colors.surface,
                  }}
                >
                  <Text
                    className="font-roboto-medium"
                    style={{ fontSize: 14, color: selected ? colors.accent : colors.inkSecondary }}
                  >
                    {category}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>

      {/* Footer outside the scroll, as in the event sheet. No count on the
          primary button: the server pages these results and returns no total,
          and a number that only covered the first page would be a lie. */}
      <View
        style={{
          flexDirection: 'row',
          gap: 16,
          paddingHorizontal: 20,
          paddingTop: 11,
          paddingBottom: 26,
          borderTopWidth: 1,
          borderColor: colors.divider,
        }}
      >
        <Pressable
          onPress={() => onChange(EMPTY_ORG_FILTERS)}
          disabled={!active}
          accessibilityRole="button"
          accessibilityLabel="Clear all filters"
          style={{
            flex: 1,
            minHeight: 45,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.divider,
            backgroundColor: colors.surface,
            opacity: active ? 1 : 0.5,
          }}
        >
          <Text
            className="font-roboto-semibold"
            style={{ fontSize: 16, color: colors.inkSecondary }}
          >
            Clear All Filters
          </Text>
        </Pressable>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Show organizations"
          style={{
            flex: 1,
            minHeight: 45,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 8,
            backgroundColor: colors.brand,
          }}
        >
          <Text className="font-roboto-semibold" style={{ fontSize: 16, color: colors.surface }}>
            Show orgs
          </Text>
        </Pressable>
      </View>
    </DragDismissSheet>
  );
}
