import type { InterestCategory } from '@/app/lib/interestCategories';
import { useThemeColors } from '@/app/lib/themeColors';
import { CaretRightIcon } from 'phosphor-react-native';
import { Pressable, Text, View } from 'react-native';

/**
 * "BROWSE BY INTEREST" (LOOP-292): a 2-wide grid of interest tiles, each with
 * an icon, the bucket name and how many events it has.
 *
 * Values are the Figma `categories-pills-section`. The counts are the filter
 * sheet's own facet counts, so a tile can only promise the number its tap then
 * delivers.
 */
export type InterestTile = InterestCategory & { count: number };

const ICON_CIRCLE = 28;
const ICON_SIZE = 16;

type Props = {
  tiles: InterestTile[];
  onSeeAll?: () => void;
  onSelect: (bucketId: string) => void;
};

export default function ExploreInterestGrid({ tiles, onSeeAll, onSelect }: Props) {
  const colors = useThemeColors();

  // Pairs rather than a wrapping row, so a lone last tile stays half width
  // instead of stretching across the page.
  const rows: InterestTile[][] = [];
  for (let i = 0; i < tiles.length; i += 2) rows.push(tiles.slice(i, i + 2));

  return (
    <View style={{ marginBottom: 20 }}>
      {onSeeAll ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <Text className="font-roboto-bold" style={{ fontSize: 16, color: colors.inkSecondary }}>
            BROWSE BY INTEREST
          </Text>
          <Pressable
            onPress={onSeeAll}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="See all interests"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
          >
            <Text className="font-roboto-semibold" style={{ fontSize: 13, color: colors.accent }}>
              See all
            </Text>
            <CaretRightIcon size={14} color={colors.accent} weight="bold" />
          </Pressable>
        </View>
      ) : null}

      <View style={{ gap: 8 }}>
        {rows.map((row) => (
          <View key={row[0].id} style={{ flexDirection: 'row', gap: 8 }}>
            {row.map((tile) => {
              const Icon = tile.icon;
              return (
                <Pressable
                  key={tile.id}
                  onPress={() => onSelect(tile.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${tile.label}, ${tile.count} active events`}
                  style={{
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    padding: 10,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: colors.borderSoft,
                    backgroundColor: colors.surface,
                  }}
                >
                  <View
                    style={{
                      width: ICON_CIRCLE,
                      height: ICON_CIRCLE,
                      borderRadius: ICON_CIRCLE / 2,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: colors.brandSoft,
                    }}
                  >
                    <Icon width={ICON_SIZE} height={ICON_SIZE} color={colors.accent} />
                  </View>
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text
                      className="font-roboto-semibold"
                      style={{ fontSize: 13, color: colors.ink }}
                      numberOfLines={1}
                    >
                      {tile.label}
                    </Text>
                    <Text className="font-roboto" style={{ fontSize: 11, color: colors.inkMuted }}>
                      {tile.count} active {tile.count === 1 ? 'event' : 'events'}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
            {/* Keeps a lone last tile at half width. */}
            {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
          </View>
        ))}
      </View>
    </View>
  );
}
