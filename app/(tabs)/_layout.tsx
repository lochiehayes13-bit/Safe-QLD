import React from 'react';
import { Tabs } from 'expo-router';
import { useTheme } from '@/theme';
import { TabBar, type TabBarProps } from '@/components/TabBar';

/**
 * Five tabs, ordered by how often a technician reaches for them.
 *
 * Everything else is reachable from the home hub rather than being
 * crammed into the bar — a tab bar with nine items is a menu, not navigation.
 * The bar itself floats over the page; see components/TabBar.
 */
export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      tabBar={(props) => <TabBar {...(props as unknown as TabBarProps)} />}
      screenOptions={{
        headerStyle: { backgroundColor: t.color.bgElevated },
        headerTintColor: t.color.text,
        headerTitleStyle: { fontWeight: '700', fontFamily: t.font.family('700') },
        headerShadowVisible: false,
        // The floating bar covers the last few rows otherwise; every scrolling
        // screen pads its own bottom, but the page ground has to reach under it.
        sceneStyle: { backgroundColor: t.color.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', headerShown: false }} />
      <Tabs.Screen name="sites" options={{ title: 'Sites' }} />
      <Tabs.Screen name="tools" options={{ title: 'Tools' }} />
      <Tabs.Screen name="work" options={{ title: 'Work' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
