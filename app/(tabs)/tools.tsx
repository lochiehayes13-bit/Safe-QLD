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
    body: 'Standby capacity with the 72 h and monitored 24 h cases, alarm de-rating, charger checks and a baseline data block.',
  },
  {
    href: '/tools/vesda',
    icon: 'air-filter',
    title: 'VESDA battery calculator',
    body: 'Aspirating sizing, where the constantly running aspirator dominates standby and the supply is loaded 24/7.',
  },
  {
    href: '/tools/voltdrop',
    icon: 'flash-outline',
    title: 'Cable volt drop',
    body: 'Whether the device at the far end still sees enough voltage, and the smallest conductor that gets it there.',
  },
  {
    href: '/tools/ohms',
    icon: 'omega',
    title: 'Electrical',
    body: "Ohm's law from any two knowns, single and three phase power, and battery runtime.",
  },
  {
    href: '/tools/converter',
    icon: 'swap-horizontal',
    title: 'Unit converter',
    body: 'kPa, bar, psi and metres of head at once — plus flow, volume, temperature, power and mass.',
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
    title: 'Device address',
    body: 'DIP switches, Apollo XPERT cards and rotary dials, with the traps each protocol carries.',
  },
  {
    href: '/tools/detector-age',
    icon: 'calendar-clock',
    title: 'Detector age',
    body: 'The date code off a head, read every way it can be read — and whether it has passed the recommended replacement age.',
  },
  {
    href: '/tools/eol',
    icon: 'resistor-nodes',
    title: 'End-of-line reference',
    body: 'EOL values by panel and circuit, with the published state boundaries where they exist.',
  },
];

const REFERENCE: ToolDef[] = [
  {
    href: '/ask',
    icon: 'help-circle-outline',
    title: 'Ask Safe QLD',
    body: 'Search everything the app holds — routines, defects, addressing, end-of-line — with the source on every answer.',
  },
  {
    href: '/scan',
    icon: 'qrcode-scan',
    title: 'Scan a tag',
    body: 'Read an asset tag, device label or part barcode and open what it belongs to.',
  },
  {
    href: '/catalogue',
    icon: 'package-variant-closed',
    title: 'Parts catalogue',
    body: 'Part numbers and electrical specs harvested from supplier catalogues and datasheets.',
  },
  {
    href: '/tools/routines',
    icon: 'clipboard-list-outline',
    title: 'Service routines',
    body: 'What each routine covers, what counts as a pass, and where the requirement comes from.',
  },
  {
    href: '/tools/defects',
    icon: 'alert-circle-outline',
    title: 'Defect library',
    body: 'Coded defects with their standard wording, client wording and rectification.',
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

      <H2>Reference</H2>
      <View style={{ gap: t.space(2.5) }}>
        {REFERENCE.map((tool) => (
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
