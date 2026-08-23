import { useThemeColors } from '@/app/lib/themeColors';
import { useRouter } from 'expo-router';
import React from 'react';
import { Image, Text, TouchableOpacity, View } from 'react-native';

/**
 * One organization in Explore's search results / Orgs feed (LOOP-175, LOOP-177).
 *
 * Shape matches GET /orgs/search, which is the only org list endpoint that
 * exists today. `bio` is optional because the column is real but NULL on every
 * row until LOOP-261 builds the write path — rendering it now means this row
 * needs no edit when descriptions start arriving.
 */
export type OrgSearchResult = {
  id: number;
  name: string;
  profile_picture: string | null;
  category: string | null;
  verified: boolean;
  bio?: string | null;
};

type Props = { org: OrgSearchResult };

export default function OrgResultRow({ org }: Props) {
  const colors = useThemeColors();
  const router = useRouter();

  const initials = org.name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

  const subtitle = org.bio?.trim() || org.category || null;

  return (
    <TouchableOpacity
      onPress={() => router.push(`/org/${org.id}`)}
      accessibilityRole="button"
      accessibilityLabel={org.name}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 12,
        paddingHorizontal: 4,
      }}
    >
      {org.profile_picture ? (
        <Image
          source={{ uri: org.profile_picture }}
          style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceMuted }}
        />
      ) : (
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: colors.surfaceMuted,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.inkSecondary }}>
            {initials}
          </Text>
        </View>
      )}

      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Text
            style={{ fontSize: 15, fontWeight: '600', color: colors.ink, flexShrink: 1 }}
            numberOfLines={1}
          >
            {org.name}
          </Text>
          {org.verified && (
            <Text
              style={{ fontSize: 12, color: colors.info }}
              accessibilityLabel="Verified organization"
            >
              ✓
            </Text>
          )}
        </View>
        {subtitle && (
          <Text style={{ fontSize: 13, color: colors.inkMuted, marginTop: 2 }} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}
