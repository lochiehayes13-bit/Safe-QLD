import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { Card, H2, Rowed, Screen, Txt } from '@/components/ui';

/**
 * Tools hub.
 *
 * These are the reference calculations a fire tech looks up on site, where
 * signal is often nonexistent — every one works fully offline.
 */

interface ToolDef {
  href: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  body: string;
}

const CALCULATORS: ToolDef[] = [
  {
    href: '/tools/battery',
    icon: 'car-battery',
    title: 'FIP battery calculator',
    body: 'Standby capacity to AS 1670.1, with the 72 h and monitored 24 h cases, alarm de-rating and ageing.',
  },
  {
    href: '/tools/vesda',
    icon: 'air-filter',
    title: 'VESDA battery calculator',
    body: 'Aspirating detection sizing, where the constantly running aspirator dominates standby draw.',
  },
  {
    href: '/tools/resistor',
    icon: 'resistor',
    title: 'Resistor decoder',
    body: 'Colour bands to resistance and back, 3 to 6 bands, with E-series preferred values.',
  },
  {
    href: '/tools/dipswitch',
    icon: 'toggle-switch-outline',
    title: 'Dipswitch calculator',
    body: 'Switch pattern to device address per protocol, including reversed banks and XPERT cards.',
  },
  {
    href: '/tools/eol',
    icon: 'resistor-nodes',
    title: 'End-of-line reference',
    body: 'Common EOL values and what a conventional zone reads at normal, alarm and fault.',
  },
  {
    href: '/tools/voltdrop',
    icon: 'flash-outline',
    title: 'Cable volt drop',
    body: 'Voltage at the far end of a loop or sounder circuit, so devices still operate in alarm.',
  },
];

export default function ToolsScreen() {
  const t = useTheme();
  return (
    <Screen>
      <Txt tone="muted" size="sm" style={{ lineHeight: 20 }}>
        Everything here runs offline. Figures follow Australian practice — always confirm against the panel manual and the
        current standard before relying on a result.
      </Txt>

      <H2>Calculators</H2>
      <View style={{ gap: t.space(2.5) }}>
        {CALCULATORS.map((tool) => (
          <Card key={tool.href} onPress={() => router.push(tool.href as never)}>
            <Rowed gap={3} align="flex-start">
              <View
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: t.radius.md,
                  backgroundColor: t.color.surfaceAlt,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <MaterialCommunityIcons name={tool.icon} size={22} color={t.color.accentText} />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Txt weight="700" size="md">{tool.title}</Txt>
                <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{tool.body}</Txt>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
            </Rowed>
          </Card>
        ))}
      </View>
    </Screen>
  );
}
