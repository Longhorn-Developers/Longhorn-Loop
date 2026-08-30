import TabCreateActiveIcon from '@/assets/images/tab-create-active.svg';
import TabCreateIcon from '@/assets/images/tab-create.svg';
import TabExploreActiveIcon from '@/assets/images/tab-explore-active.svg';
import TabExploreIcon from '@/assets/images/tab-explore.svg';
import TabHomeActiveIcon from '@/assets/images/tab-home-active.svg';
import TabHomeIcon from '@/assets/images/tab-home.svg';
import ProfileTabIcon from '@/app/components/ProfileTabIcon';
import { CreateEventProvider } from '@/app/context/CreateEventContext';
import { useThemeColors } from '@/app/lib/themeColors';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Height of the bar ABOVE the home indicator — the part the icons live in.
 *
 * The bar used to be a flat 72 with paddingBottom: 0, which put the icons
 * inside the ~34pt gesture strip on a home-indicator iPhone. Reaching for
 * Profile and getting the app-switcher instead is the bug bash's "move navbar
 * icons up so the user does not swipe out by accident".
 *
 * Instagram (and every well-behaved iOS tab bar) does the same thing: a fixed
 * content height, plus the device's bottom inset underneath it as padding, so
 * the icons sit clear of the indicator rather than sharing space with it.
 */
const TAB_BAR_CONTENT_HEIGHT = 64;

/** Floor for devices with no inset, so the bar is still taller than it was. */
const MIN_BOTTOM_PADDING = 10;

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
  const insets = useSafeAreaInsets();
  const active = colors.accent;
  const inactive = colors.inkMuted;

  const bottomPadding = Math.max(insets.bottom, MIN_BOTTOM_PADDING);

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
            height: TAB_BAR_CONTENT_HEIGHT + bottomPadding,
            paddingTop: 6,
            // The inset, as padding rather than height, is what lifts the icons
            // out of the gesture strip instead of just making the bar bigger.
            paddingBottom: bottomPadding,
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
            tabBarIcon: ({ focused }) => (
              <ProfileTabIcon focused={focused} activeColor={active} inactiveColor={inactive} />
            ),
          }}
        />
      </Tabs>
    </CreateEventProvider>
  );
}
