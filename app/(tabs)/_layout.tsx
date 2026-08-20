import TabCreateActiveIcon from '@/assets/images/tab-create-active.svg';
import TabCreateIcon from '@/assets/images/tab-create.svg';
import TabExploreActiveIcon from '@/assets/images/tab-explore-active.svg';
import TabExploreIcon from '@/assets/images/tab-explore.svg';
import TabHomeActiveIcon from '@/assets/images/tab-home-active.svg';
import TabHomeIcon from '@/assets/images/tab-home.svg';
import TabProfileActiveIcon from '@/assets/images/tab-profile-active.svg';
import TabProfileIcon from '@/assets/images/tab-profile.svg';
import { CreateEventProvider } from '@/app/context/CreateEventContext';
import { useThemeColors } from '@/app/lib/themeColors';
import { Tabs } from 'expo-router';

// The tab bar sits above every screen, so leaving it white was the most
// visible thing dark mode missed. The icons are SVGs that used to carry their
// own greys and oranges; they now paint with `currentColor` and take the tint
// from here, which is why a single `color` prop is enough to flip all eight.
//
// The active icons are SOLID; the inactive ones are outlines. They used to be
// the same artwork in two colours — three of the four -active files were
// byte-identical to their inactive twin — so on a small screen, in sunlight, the
// only thing separating "you are here" from "you are not" was a hue shift on a
// 1.6pt stroke. Weight reads at a glance in a way colour does not, and it keeps
// working for the ~8% of men with a red-green deficiency.
export default function TabsLayout() {
  const colors = useThemeColors();
  const active = colors.accent;
  const inactive = colors.inkMuted;

  return (
    <CreateEventProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarShowLabel: false,
          tabBarActiveTintColor: 'transparent',
          tabBarInactiveTintColor: 'transparent',
          tabBarStyle: {
            // Surface, not background: the bar is raised off the page in both
            // themes, and in dark that separation is the only thing giving it
            // an edge beyond the hairline.
            backgroundColor: colors.surface,
            borderTopColor: colors.divider,
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
            tabBarIcon: ({ focused }) =>
              focused ? (
                <TabHomeActiveIcon width={42} height={39} color={active} />
              ) : (
                <TabHomeIcon width={42} height={39} color={inactive} />
              ),
          }}
        />

        <Tabs.Screen
          name="explore"
          options={{
            tabBarIcon: ({ focused }) =>
              focused ? (
                <TabExploreActiveIcon width={42} height={38} color={active} />
              ) : (
                <TabExploreIcon width={42} height={38} color={inactive} />
              ),
          }}
        />

        <Tabs.Screen
          name="create"
          options={{
            tabBarIcon: ({ focused }) =>
              focused ? (
                <TabCreateActiveIcon width={42} height={38} color={active} />
              ) : (
                <TabCreateIcon width={42} height={38} color={inactive} />
              ),
          }}
        />

        <Tabs.Screen
          name="profile"
          options={{
            tabBarIcon: ({ focused }) =>
              focused ? (
                <TabProfileActiveIcon width={42} height={38} color={active} />
              ) : (
                <TabProfileIcon width={42} height={38} color={inactive} />
              ),
          }}
        />
      </Tabs>
    </CreateEventProvider>
  );
}
