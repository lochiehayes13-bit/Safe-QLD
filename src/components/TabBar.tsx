import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { Bounce } from './motion';
import { Txt } from './ui';

/**
 * The tab bar, docked across the foot.
 *
 * Plain, as the website's header is: a bar with a hairline, the active tab
 * marked in crimson with a short rule over it. It used to float as a pill
 * with a filled gradient tab, which read as an app template rather than as
 * the company.
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
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}
    >
      {/*
        * Docked across the foot, as the website's header is across the top:
        * a plain bar with a hairline, the active tab in crimson with a short
        * rule over it. The floating pill with a filled, gradient tab read as
        * an app template rather than the company.
        */}
      <View
        style={{
          flexDirection: 'row',
          backgroundColor: t.color.bgElevated,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: t.color.borderStrong,
          paddingHorizontal: t.space(1),
          paddingBottom: Math.max(insets.bottom, t.space(1.5)),
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
              <View style={{ minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                <View
                  style={{
                    position: 'absolute', top: 0, height: 3, width: 28, borderRadius: 2,
                    backgroundColor: active ? t.color.accent : 'transparent',
                  }}
                />
                <MaterialCommunityIcons
                  name={active ? icon.on : icon.off}
                  size={22}
                  color={active ? t.color.accentText : t.color.textFaint}
                />
                <Txt size="xs" weight={active ? '800' : '600'} tone={active ? 'accent' : 'faint'} numberOfLines={1}>{label}</Txt>
              </View>
            </Bounce>
          );
        })}
      </View>
    </View>
  );
}
