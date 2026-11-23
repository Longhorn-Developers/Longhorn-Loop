// The org page's People tab (LOOP-334).
//
// Figma: "Org Page (People Selected)" (10034:38331). LEADERSHIP lists the
// officers, MEMBERS gives the headcount.
//
// What feeds it: GET /orgs/:id/profile's `leadership` and `org.member_count`,
// both new with this ticket. org_members is the management team only (admin |
// editor) -- there is no regular-member role yet (LOOP-336) -- so "members"
// here honestly means "people running this org on Loop", and the copy says so
// rather than borrowing the frame's "1,280 members".
//
// Left out, each for a missing backend:
//   * The "Questions about joining?" card (Ask a question / Email the org):
//     no org contact channel exists (LOOP-337).
//   * Officer titles ("President", "Events"): org_members stores a role, not a
//     title (LOOP-337). Rows say Admin / Editor until it does.
//   * "Maya, Sam + 4 friends" and the "Members only" lock: there is no member
//     list to intersect with your follows, and nothing is members-only yet.
//
// An older deployed Worker sends neither field. `leadership === undefined` is
// that case, and the tab says it can't show the team rather than claiming the
// org has none.

import React from 'react';
import { Text, View } from 'react-native';

export interface OrgLeader {
  first_name: string;
  last_name: string;
  role: 'admin' | 'editor';
}

/**
 * Disc tints for the initials, cycled by row. Fixed hues rather than tokens on
 * purpose -- they are identity colours, not theme surfaces -- and each is dark
 * enough that its white 12pt initials clear 4.5:1, in either theme.
 */
const DISC_COLORS = [
  '#3F7A72', // theme-exempt: identity colour, see above
  '#9A5A1C', // theme-exempt: identity colour
  '#7A4E87', // theme-exempt: identity colour
  '#456596', // theme-exempt: identity colour
  '#8A4436', // theme-exempt: identity colour
];

function LeaderRow({ leader, index, last }: { leader: OrgLeader; index: number; last: boolean }) {
  const initials =
    `${leader.first_name.charAt(0)}${leader.last_name.charAt(0)}`.toUpperCase() || '?';
  return (
    <View
      className={`flex-row items-center gap-[12px] py-[10px] ${last ? '' : 'border-b border-lhlBorderSoft'}`}
    >
      <View
        className="h-[32px] w-[32px] items-center justify-center rounded-full"
        style={{ backgroundColor: DISC_COLORS[index % DISC_COLORS.length] }}
      >
        {/* theme-exempt: white on a fixed identity colour, see DISC_COLORS. */}
        <Text className="font-roboto-semibold text-[12px] text-white">{initials}</Text>
      </View>
      <View className="flex-1">
        <Text
          numberOfLines={1}
          className="font-roboto-semibold text-[14px] leading-[17px] text-lhlInk"
        >
          {`${leader.first_name} ${leader.last_name}`.trim()}
        </Text>
        <Text className="font-roboto text-[12px] leading-[15px] text-lhlSecondaryTextGrey">
          {leader.role === 'admin' ? 'Admin' : 'Editor'}
        </Text>
      </View>
    </View>
  );
}

export default function OrgPeopleTab({
  leadership,
  memberCount,
}: {
  leadership: OrgLeader[] | undefined;
  memberCount: number | undefined;
}) {
  if (leadership === undefined) {
    return (
      <Text className="font-roboto mt-[16px] text-[13px] text-lhlSecondaryTextGrey">
        The team list isn’t available yet.
      </Text>
    );
  }

  const count = memberCount ?? leadership.length;

  return (
    <View className="mt-[16px] gap-[16px]">
      <View className="gap-[8px]">
        <Text
          accessibilityRole="header"
          className="font-roboto-medium text-[12px] uppercase text-lhlSecondaryTextGrey"
        >
          Leadership
        </Text>
        {leadership.length === 0 ? (
          <View className="rounded-[16px] border border-lhlBorderSoft bg-lhlSurface px-[12px] py-[14px]">
            <Text className="font-roboto text-[13px] leading-[18px] text-lhlSecondaryTextGrey">
              Nobody has claimed this org on Loop yet.
            </Text>
          </View>
        ) : (
          <View className="rounded-[16px] border border-lhlBorderSoft bg-lhlSurface px-[12px]">
            {leadership.map((l, i) => (
              <LeaderRow
                key={`${l.first_name}-${l.last_name}-${i}`}
                leader={l}
                index={i}
                last={i === leadership.length - 1}
              />
            ))}
          </View>
        )}
      </View>

      <View className="gap-[8px]">
        <Text
          accessibilityRole="header"
          className="font-roboto-medium text-[12px] uppercase text-lhlSecondaryTextGrey"
        >
          Members
        </Text>
        <View className="rounded-[16px] border border-lhlBorderSoft bg-lhlSurface px-[12px] py-[12px]">
          <Text className="font-roboto-semibold text-[14px] text-lhlInk">
            {count.toLocaleString()} {count === 1 ? 'member' : 'members'}
          </Text>
          <Text className="font-roboto mt-[2px] text-[12px] text-lhlSecondaryTextGrey">
            Officers and editors running this org on Loop
          </Text>
        </View>
      </View>
    </View>
  );
}
