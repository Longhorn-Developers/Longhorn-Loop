import { useThemeColors } from '@/app/lib/themeColors';
import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

/**
 * The Explore feed selector (LOOP-177), narrowed to what it is actually for.
 *
 * ---------------------------------------------------------------------------
 * WHAT CHANGED, AND WHY THE BUCKET PILLS LEFT.
 *
 * This row used to carry three kinds of thing: Trending, Orgs, and one pill per
 * taxonomy bucket — twelve of them, generated from TAXONOMY_BUCKETS. The bucket
 * pills are now the Interests group inside ExploreFilterSheet ("College Lens"
 * design), and they could not stay here as well.
 *
 * Not for tidiness. Two independent controls over the same axis can disagree:
 * pick Technology in the sheet, and a Trending pill that is still lit says the
 * feed is unfiltered while the list says otherwise, and there is no correct
 * answer for what the second tap does. One place decides what "interest" means.
 *
 * What is left is the genuine choice this row always was: WHICH ENDPOINT am I
 * looking at — the ranked event feed, or the org directory. Those really are
 * different destinations (see the endpoint notes below), not filters.
 *
 *   trending -> GET /feed/explore    one ranked list across all buckets
 *   newOrgs  -> GET /orgs/search     ?sort=newest -- most recently added
 *                                    to Loop first (LOOP-293).
 *   orgs     -> GET /orgs/search     the directory, alphabetical and paged.
 *                                    Omitting ?q= asks for all of it
 *                                    (LOOP-264); a query filters it.
 *
 * Interests now reach /feed/explore as a client-side filter over the page it
 * already returns, which is why GET /feed/bucket/:id no longer has a caller
 * here. The endpoint still exists and still works; if the corpus outgrows one
 * feed page, the bucket route is the thing to route Interests back through.
 *
 * The Filters button sits at the head of the row rather than the tail so it is
 * reachable without scrolling, and carries a count of ACTIVE GROUPS (not
 * selected chips) — "3" means college, interests and time are all narrowing the
 * results, which is the number that explains why you are seeing what you see.
 *
 * The button stays on the org destinations too (LOOP-293), but opens the org
 * sheet and counts ORG filters only — the parent decides which count to pass,
 * because only it knows which sheet the button opens. An event filter left on
 * from Trending must not inflate the badge on a list it has no effect on.
 */

export type ExploreSelection = { kind: 'trending' } | { kind: 'newOrgs' } | { kind: 'orgs' };

/** Both org destinations: list-only, org cards, org filters. */
export function isOrgSelection(selection: ExploreSelection): boolean {
  return selection.kind === 'orgs' || selection.kind === 'newOrgs';
}

export function selectionKey(selection: ExploreSelection): string {
  return selection.kind;
}

function SliderGlyph({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 7h10M18 7h2M4 17h4M12 17h8"
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
      />
      <Path
        d="M16 4.8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4ZM10 14.8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4Z"
        stroke={color}
        strokeWidth={1.9}
      />
    </Svg>
  );
}

type Props = {
  selection: ExploreSelection;
  onSelect: (selection: ExploreSelection) => void;
  /** Active filter groups for whichever sheet the button opens. */
  activeCount: number;
  onOpenFilters: () => void;
};

type Entry = { key: string; label: string; selection: ExploreSelection };

const ENTRIES: Entry[] = [
  { key: 'trending', label: 'Trending', selection: { kind: 'trending' } },
  { key: 'newOrgs', label: 'New Orgs', selection: { kind: 'newOrgs' } },
  { key: 'orgs', label: 'Orgs', selection: { kind: 'orgs' } },
];

export default function ExploreToggles({ selection, onSelect, activeCount, onOpenFilters }: Props) {
  const colors = useThemeColors();
  const activeKey = selectionKey(selection);

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 20,
          gap: 8,
          paddingVertical: 2,
          alignItems: 'center',
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Filters. On the org destinations this opens the org sheet rather
            than the event one — an org has no start time, no perks and no
            taxonomy bucket, so the event sheet would offer four controls that
            do nothing there (LOOP-293). */}
        <Pressable
          onPress={onOpenFilters}
          accessibilityRole="button"
          accessibilityLabel={
            activeCount === 0
              ? 'Filters'
              : `Filters, ${activeCount} active filter group${activeCount === 1 ? '' : 's'}`
          }
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 12,
            paddingVertical: 7,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: activeCount > 0 ? colors.brand : colors.border,
            backgroundColor: activeCount > 0 ? colors.brandSoft : 'transparent',
          }}
        >
          <SliderGlyph color={activeCount > 0 ? colors.accent : colors.inkSecondary} />
          <Text
            style={{
              fontSize: 13,
              fontWeight: '700',
              color: activeCount > 0 ? colors.accent : colors.inkSecondary,
            }}
          >
            Filters
          </Text>
          {activeCount > 0 ? (
            <View
              style={{
                minWidth: 18,
                height: 18,
                paddingHorizontal: 5,
                borderRadius: 999,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.brand,
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: '800', color: '#FFFFFF' }}>
                {activeCount}
              </Text>
            </View>
          ) : null}
        </Pressable>

        {ENTRIES.map((entry) => {
          const isActive = entry.key === activeKey;
          return (
            <Pressable
              key={entry.key}
              onPress={() => onSelect(entry.selection)}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={entry.label}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 7,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: isActive ? colors.brand : colors.border,
                backgroundColor: isActive ? colors.brand : 'transparent',
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: isActive ? '700' : '500',
                  color: isActive ? colors.surface : colors.inkSecondary,
                }}
                numberOfLines={1}
              >
                {entry.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
