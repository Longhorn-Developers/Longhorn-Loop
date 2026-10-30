import { useThemeColors } from '@/app/lib/themeColors';
import { useRouter } from 'expo-router';
import { SealCheckIcon } from 'phosphor-react-native';
import React from 'react';
import { Image, Text, TouchableOpacity, View } from 'react-native';

/**
 * One organization in Explore's search results / Orgs feed (LOOP-175, LOOP-177),
 * drawn as the "Horizontal Org Card" from the Explore Orgs frame (LOOP-293).
 *
 * Shape matches GET /orgs/search, which is the only org list endpoint that
 * exists today. `bio` is optional because the column is real but NULL on every
 * row until LOOP-261 builds the write path — rendering it now means this card
 * needs no edit when descriptions start arriving. `follower_count` is optional
 * for the same reason in reverse: a server older than LOOP-293 doesn't send it,
 * and a missing count must read as no count, not as "undefined followers".
 */
export type OrgSearchResult = {
  id: number;
  name: string;
  profile_picture: string | null;
  category: string | null;
  verified: boolean;
  bio?: string | null;
  follower_count?: number;
  /** SQLite `datetime('now')` text, UTC: "2025-10-04 18:22:01". */
  created_at?: string | null;
};

type Props = { org: OrgSearchResult };

/** Square-ish logo tile from the design (70pt, ~16 radius). */
const LOGO_SIZE = 70;
const LOGO_RADIUS = 16;

/**
 * "No followers yet", "1 follower", "1,280 followers".
 *
 * Following is new, so most production orgs sit at 0 (the ticket's own
 * warning) — the design's 1,280 is the exception, not the rule. A bare
 * "0 followers" leading every card reads as a directory of dead orgs, and
 * dropping the clause instead would leave most scraped orgs (no bio, no
 * category either) as a logo and a name with nothing under it. "No followers
 * yet" keeps every card the same shape and says the true thing. `undefined`
 * (a pre-LOOP-293 server) is the one case that gets no clause at all.
 */
export function followerLabel(count: number | undefined): string | null {
  if (count === undefined) return null;
  if (count < 1) return 'No followers yet';
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'follower' : 'followers'}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "Joined Oct 2025" from organizations.created_at — when Loop first saw the
 * org, which for scraped orgs is the scrape that found them (agreed with
 * Matthew for LOOP-293; never derived from event dates).
 *
 * Parsed by hand rather than through Date/toLocaleDateString: the column is
 * UTC text with a space instead of a "T", which Hermes and JSC disagree about,
 * and only the year and month are needed anyway. Anything unparseable gets no
 * clause rather than "Joined Invalid Date".
 */
export function joinedLabel(createdAt: string | null | undefined): string | null {
  const match = typeof createdAt === 'string' ? /^(\d{4})-(\d{2})/.exec(createdAt) : null;
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  return match && month ? `Joined ${month} ${match[1]}` : null;
}

export default function OrgResultRow({ org }: Props) {
  const colors = useThemeColors();
  const router = useRouter();

  // `org.name` is typed non-null and the column is NOT NULL, but this row
  // renders whatever GET /orgs/search returns for a query the user is still
  // typing — one scraped row with a missing name would throw on .split() and
  // take the whole Explore screen down mid-keystroke (LOOP-279). The filter
  // also drops empty segments, which is what a leading space produced before:
  // `''[0]` is undefined and the initials came out short or blank.
  const name = typeof org.name === 'string' ? org.name : '';
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase() || '?';

  const bio = org.bio?.trim() || null;
  const meta = [
    followerLabel(org.follower_count),
    org.category,
    joinedLabel(org.created_at),
  ].filter(Boolean) as string[];

  return (
    <TouchableOpacity
      onPress={() => router.push(`/org/${org.id}`)}
      accessibilityRole="button"
      accessibilityLabel={[name, org.verified ? 'verified' : null, ...meta]
        .filter(Boolean)
        .join(', ')}
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        paddingVertical: 14,
        paddingHorizontal: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.borderSoft,
        backgroundColor: colors.surface,
      }}
    >
      {/* Most orgs are scraped from HornsLink with no logo, so the fallback is
          the COMMON case, not an edge: an initials tile at the same size and
          radius keeps the text column aligned card to card. */}
      {org.profile_picture ? (
        <Image
          source={{ uri: org.profile_picture }}
          resizeMode="cover"
          style={{
            width: LOGO_SIZE,
            height: LOGO_SIZE,
            borderRadius: LOGO_RADIUS,
            backgroundColor: colors.surfaceMuted,
          }}
        />
      ) : (
        <View
          style={{
            width: LOGO_SIZE,
            height: LOGO_SIZE,
            borderRadius: LOGO_RADIUS,
            backgroundColor: colors.brandSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text className="font-roboto-bold" style={{ fontSize: 22, color: colors.accent }}>
            {initials}
          </Text>
        </View>
      )}

      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text
            className="font-roboto-semibold"
            style={{ fontSize: 16, color: colors.ink, flexShrink: 1 }}
            numberOfLines={1}
          >
            {name}
          </Text>
          {org.verified ? (
            // Unlabelled on purpose: the card's own accessibilityLabel already
            // says "verified", and the icon isn't a separate focus stop.
            <SealCheckIcon size={15} color={colors.accent} weight="fill" />
          ) : null}
        </View>

        {/* Two lines, ellipsised, from `bio`. No placeholder copy when it is
            NULL — inventing a description is worse than a shorter card. */}
        {bio ? (
          <Text
            className="font-roboto"
            style={{ fontSize: 12.5, lineHeight: 18, color: colors.inkSecondary }}
            numberOfLines={2}
          >
            {bio}
          </Text>
        ) : null}

        {meta.length > 0 ? (
          <Text
            className="font-roboto-medium"
            style={{ fontSize: 12, color: colors.ink }}
            numberOfLines={1}
          >
            {meta.join(' · ')}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}
