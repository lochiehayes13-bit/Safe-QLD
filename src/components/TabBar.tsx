import React from 'react';
import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { Bounce } from './motion';
import { Txt } from './ui';

/**
 * The tab bar, floating.
 *
 * A bar that sits flush to the bottom edge is furniture; one that floats a
 * little above it, with the page scrolling underneath, reads as a control.
 * The active tab is a flame pill rather than a coloured icon, because a
 * coloured icon is the one thing in the row that does not look pressable and
 * the pill is the one thing that does.
 */

type Icon = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const ICONS: Record<string, { on: Icon; off: Icon }> = {
  index: { on: 'home-variant', off: 'home-variant-outline' },
  sites: { on: 'office-building-marker', off: 'office-building-marker-outline' },
  map: { on: 'map-marker-radius', off: 'map-marker-radius-outline' },
  tools: { on: 'calculator-variant', off: 'calculator-variant-outline' },
  work: { on: 'clipboard-check', off: 'clipboard-check-outline' },
  settings: { on: 'cog', off: 'cog-outline' },
};

/** The slice of React Navigation's tab bar props this needs, typed here so the file stays free of its package. */
export interface TabBarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  descriptors: Record<string, { options: { title?: string; tabBarLabel?: unknown } }>;
  navigation: {
    navigate: (name: string) => void;
    emit: (e: { type: 'tabPress'; target: string; canPreventDefault: true }) => { defaultPrevented: boolean };
  };
}

export function TabBar({ state, descriptors, navigation }: TabBarProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute', left: t.space(3), right: t.space(3), bottom: Math.max(insets.bottom, t.space(2)) + t.space(1),
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          backgroundColor: t.color.bgElevated,
          borderRadius: t.radius.xl,
          borderWidth: 1,
          borderColor: t.color.border,
          padding: t.space(1.5),
          ...t.shadow.float,
        }}
      >
        {state.routes.map((route, i) => {
          const active = state.index === i;
          const options = descriptors[route.key]?.options ?? {};
          const label = typeof options.title === 'string' ? options.title : route.name;
          const icon = ICONS[route.name] ?? { on: 'circle', off: 'circle-outline' };
          const press = () => {
            const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!active && !e.defaultPrevented) navigation.navigate(route.name);
          };
          return (
            <Bounce
              key={route.key}
              onPress={press}
              haptic="selection"
              scaleTo={0.94}
              accessibilityRole="tab"
              accessibilityLabel={label}
              style={{ flex: 1 }}
            >
              {active ? (
                <LinearGradient
                  colors={t.gradient.flame}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ borderRadius: t.radius.lg, minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 2 }}
                >
                  <MaterialCommunityIcons name={icon.on} size={22} color={t.color.onAccent} />
                  <Txt size="xs" weight="800" style={{ color: t.color.onAccent, letterSpacing: 0.3 }}>{label}</Txt>
                </LinearGradient>
              ) : (
                <View style={{ minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                  <MaterialCommunityIcons name={icon.off} size={22} color={t.color.textFaint} />
                  <Txt size="xs" weight="700" tone="faint">{label}</Txt>
                </View>
              )}
            </Bounce>
          );
        })}
      </View>
    </View>
  );
}
