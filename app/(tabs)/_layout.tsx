import TabCreateActiveIcon from '@/assets/images/tab-create-active.svg';
import TabCreateIcon from '@/assets/images/tab-create.svg';
import TabExploreActiveIcon from '@/assets/images/tab-explore-active.svg';
import TabExploreIcon from '@/assets/images/tab-explore.svg';
import TabHomeInactiveIcon from '@/assets/images/tab-home-inactive.svg';
import TabHomeIcon from '@/assets/images/tab-home.svg';
import TabProfileActiveIcon from '@/assets/images/tab-profile-active.svg';
import TabProfileIcon from '@/assets/images/tab-profile.svg';
import { Tabs } from "expo-router";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: 'transparent',
        tabBarInactiveTintColor: 'transparent',
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopColor: '#E5E5E5',
          height: 72,
          paddingTop: 0,
          paddingBottom: 0,
        },
        tabBarItemStyle: {
          paddingVertical: 0,
        },
        tabBarIconStyle: {
          width: 42,
          height: 42,
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          tabBarIcon: ({ focused }) => focused
            ? <TabHomeIcon width={42} height={39} />
            : <TabHomeInactiveIcon width={42} height={39} />,
        }}
      />

      <Tabs.Screen
        name="explore"
        options={{
          tabBarIcon: ({ focused }) => focused
            ? <TabExploreActiveIcon width={42} height={38} />
            : <TabExploreIcon width={42} height={38} />,
        }}
      />

      <Tabs.Screen
        name="saved"
        options={{
          tabBarIcon: ({ focused }) => focused
            ? <TabCreateActiveIcon width={42} height={38} />
            : <TabCreateIcon width={42} height={38} />,
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          tabBarIcon: ({ focused }) => focused
            ? <TabProfileActiveIcon width={42} height={38} />
            : <TabProfileIcon width={42} height={38} />,
        }}
      />
    </Tabs>
  );
}
