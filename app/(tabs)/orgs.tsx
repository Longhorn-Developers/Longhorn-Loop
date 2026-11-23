// The Orgs tab (LOOP-330): "Find your place".
//
// Figma: "Orgs - My Orgs Toggle" / "Orgs - Discover Toggle". A burnt-orange
// eyebrow, the "Organizations" title, then an underline toggle between
// My Orgs (the orgs you're on or follow, and what they have coming up) and
// Discover (the whole directory). The two panels live in components/orgs/;
// this screen is the header, the toggle and the one scroll view they share.
//
// Discover stays mounted once visited rather than unmounting on every toggle,
// so a half-typed search or a "Show more"-expanded list survives a glance at
// My Orgs. My Orgs is cheap to re-render from cache, so it isn't kept alive.

import ProfileTabRow from '@/app/components/profile/ProfileTabRow';
import DiscoverPanel from '@/app/components/orgs/DiscoverPanel';
import MyOrgsPanel, { useMyOrgs } from '@/app/components/orgs/MyOrgsPanel';
import { useOnboarding } from '@/app/context/OnboardingContext';
import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type OrgsTab = 'mine' | 'discover';

export default function OrgsScreen() {
  const { data: onboarding } = useOnboarding();
  const token = onboarding.token || null;
  const [tab, setTab] = useState<OrgsTab>('mine');
  const [discoverVisited, setDiscoverVisited] = useState(false);
  // Same hook (and therefore the same cache entries) the panel reads, so the
  // tab count costs no extra request.
  const { rows } = useMyOrgs(token);

  const select = (next: OrgsTab) => {
    if (next === 'discover') setDiscoverVisited(true);
    setTab(next);
  };

  return (
    <SafeAreaView className="flex-1 bg-lhlBackgroundColor" edges={['top']}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="px-[20px]">
          <View className="gap-[4px] pb-[8px] pt-[12px]">
            <Text className="font-roboto-semibold text-[12px] text-lhlAccent">FIND YOUR PLACE</Text>
            <Text accessibilityRole="header" className="font-roboto-medium text-[24px] text-lhlInk">
              Organizations
            </Text>
          </View>
          <ProfileTabRow<OrgsTab>
            tabs={[
              { key: 'mine', label: 'My Orgs', count: token ? rows.length : undefined },
              { key: 'discover', label: 'Discover' },
            ]}
            value={tab}
            onChange={select}
          />
        </View>

        {tab === 'mine' ? (
          <MyOrgsPanel token={token} onDiscover={() => select('discover')} />
        ) : null}
        {discoverVisited ? (
          <View style={{ display: tab === 'discover' ? 'flex' : 'none' }}>
            <DiscoverPanel token={token} />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
