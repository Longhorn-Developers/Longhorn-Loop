import { useThemeColors } from '@/app/lib/themeColors';
import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

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
 *
 */

/* The Filters button used to head this row. It moved into the search bar
 * (ExploreFilterButton, LOOP-292), so this row is only the destinations. */

export type ExploreSelection =
  { kind: 'all' } | { kind: 'trending' } | { kind: 'newOrgs' } | { kind: 'orgs' };

/** Both org destinations: list-only, org cards, org filters. */
export function isOrgSelection(selection: ExploreSelection): boolean {
  return selection.kind === 'orgs' || selection.kind === 'newOrgs';
}

export function selectionKey(selection: ExploreSelection): string {
  return selection.kind;
}

type Props = {
  selection: ExploreSelection;
  /** The filter sheet's interests, which Social and Career write into. */
  interests: string[];
  onSelect: (selection: ExploreSelection) => void;
  onChangeInterests: (interests: string[]) => void;
};

/** Bucket ids in shared/taxonomy.ts. "Career" is the Education & Career bucket. */
const SOCIAL_BUCKET = 'social';
const CAREER_BUCKET = 'education';

type Chip = { key: string; label: string; active: boolean; onPress: () => void };

export default function ExploreToggles({
  selection,
  interests,
  onSelect,
  onChangeInterests,
}: Props) {
  const colors = useThemeColors();

  // Single-select, like the Figma row: a chip is lit only when it matches
  // exactly, so a sheet selection of Tech + Food lights none of Social/Career.
  const onlyInterest = (id: string) => interests.length === 1 && interests[0] === id;

  const chips: Chip[] = [
    {
      key: 'all',
      label: 'All Events',
      active: selection.kind === 'all' && interests.length === 0,
      onPress: () => {
        onSelect({ kind: 'all' });
        onChangeInterests([]);
      },
    },
    {
      key: 'orgs',
      label: 'Orgs',
      active: selection.kind === 'orgs',
      onPress: () => onSelect({ kind: 'orgs' }),
    },
    {
      key: 'trending',
      label: 'Trending',
      active: selection.kind === 'trending',
      onPress: () => onSelect({ kind: 'trending' }),
    },
    {
      key: 'social',
      label: 'Social',
      active: selection.kind === 'all' && onlyInterest(SOCIAL_BUCKET),
      onPress: () => {
        onSelect({ kind: 'all' });
        onChangeInterests([SOCIAL_BUCKET]);
      },
    },
    {
      key: 'career',
      label: 'Career',
      active: selection.kind === 'all' && onlyInterest(CAREER_BUCKET),
      onPress: () => {
        onSelect({ kind: 'all' });
        onChangeInterests([CAREER_BUCKET]);
      },
    },
  ];

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
        {chips.map((chip) => (
          <Pressable
            key={chip.key}
            onPress={chip.onPress}
            accessibilityRole="button"
            accessibilityState={{ selected: chip.active }}
            accessibilityLabel={chip.label}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 7,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: chip.active ? colors.brand : colors.border,
              backgroundColor: chip.active ? colors.brand : 'transparent',
            }}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: chip.active ? '700' : '500',
                color: chip.active ? colors.surface : colors.inkSecondary,
              }}
              numberOfLines={1}
            >
              {chip.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
