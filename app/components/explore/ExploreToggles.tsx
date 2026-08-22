import { useThemeColors } from '@/app/lib/themeColors';
import { TAXONOMY_BUCKETS } from '@/shared/taxonomy';
import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

/**
 * The Explore feed selector (LOOP-177).
 *
 * Three kinds of destination share one row because they are one choice from
 * the user's point of view — "what am I looking at" — even though they hit
 * three different endpoints:
 *
 *   trending      -> GET /feed/explore      one ranked list across all buckets
 *   orgs          -> GET /orgs/search       (query-driven; see the note below)
 *   <bucket id>   -> GET /feed/bucket/:id   one ranked list inside a bucket
 *
 * The bucket entries are generated from TAXONOMY_BUCKETS rather than written
 * out here, so adding a bucket to the shared taxonomy adds a toggle for free
 * and the ids are guaranteed to match what /feed/bucket/:id will accept.
 */

export type ExploreSelection =
  { kind: 'trending' } | { kind: 'orgs' } | { kind: 'bucket'; id: string };

export function selectionKey(selection: ExploreSelection): string {
  return selection.kind === 'bucket' ? `bucket:${selection.id}` : selection.kind;
}

type Props = {
  selection: ExploreSelection;
  onSelect: (selection: ExploreSelection) => void;
};

type Entry = { key: string; label: string; selection: ExploreSelection };

const ENTRIES: Entry[] = [
  { key: 'trending', label: 'Trending', selection: { kind: 'trending' } },
  { key: 'orgs', label: 'Orgs', selection: { kind: 'orgs' } },
  ...TAXONOMY_BUCKETS.map((bucket) => ({
    key: `bucket:${bucket.id}`,
    label: bucket.label,
    selection: { kind: 'bucket' as const, id: bucket.id },
  })),
];

export default function ExploreToggles({ selection, onSelect }: Props) {
  const colors = useThemeColors();
  const activeKey = selectionKey(selection);

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingVertical: 2 }}
        // Keeps the active pill reachable without hunting when the row is long.
        keyboardShouldPersistTaps="handled"
      >
        {ENTRIES.map((entry) => {
          const isActive = entry.key === activeKey;
          return (
            <TouchableOpacity
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
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}
