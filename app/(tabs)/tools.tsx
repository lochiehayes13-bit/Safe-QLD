import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { Card, H2, IconPlate, Rowed, Screen, Txt } from '@/components/ui';
import { Reveal } from '@/components/motion';

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
    href: '/tools/extinguisher',
    icon: 'fire-extinguisher',
    title: 'Extinguishers',
    body: 'What the type is and what it must never be pointed at, when the next test falls, and whether the cylinder is still full.',
  },
  {
    href: '/tools/emergency-lighting',
    icon: 'lightbulb-outline',
    title: 'Emergency lighting',
    body: 'Discharge outcome, exit sign viewing distance, battery age against what you saw, and whether the room has the light it needs.',
  },
  {
    href: '/tools/hydrant',
    icon: 'fire-hydrant',
    title: 'Hydrant flow test',
    body: 'Measure a flow, work out what the supply gives at the pressure the brigade needs, then check it against the duty.',
  },
  {
    href: '/tools/flow-certificate',
    icon: 'certificate-outline',
    title: 'Combined flow certificate',
    body: 'Sprinkler and hydrant duty on one page, converted before they are added, with the 150% overload run answered.',
  },
  {
    href: '/tools/hose-reel',
    icon: 'hydro-power',
    title: 'Hose reels',
    body: 'Whether the reel reaches the back of the room, whether it made its duty, and which service is next.',
  },
  {
    href: '/tools/fire-door',
    icon: 'door-closed',
    title: 'Fire and smoke doors',
    body: 'What the tag says, whether the gap passes, whether it closed and latched — with the clause behind every figure.',
  },
  {
    href: '/tools/spl',
    icon: 'volume-high',
    title: 'Sound pressure level',
    body: 'Whether the occupant warning is loud enough in the room you are standing in, and what a second sounder would add.',
  },
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
    href: '/tools/cable',
    icon: 'cable-data',
    title: 'Cable sizing',
    body: 'Capacity where it is installed, volt drop, breaker coordination and fault withstand — every size it rejected, with the check that stopped it.',
  },
  {
    href: '/tools/cable-tables',
    icon: 'table-search',
    title: 'Cable tables',
    body: 'Your own current-carrying capacity figures, searched by size or by what they carry, each one saying where it was read.',
  },
  {
    href: '/tools/sizing',
    icon: 'message-text-outline',
    title: 'Size it from a description',
    body: 'Say what you are installing in a sentence — the cable and the breaker come back off the standard’s tables, with the words it read.',
  },
  {
    href: '/tools/wiring',
    icon: 'book-open-page-variant-outline',
    title: 'Wiring rules tables',
    body: 'Every table in AS/NZS 3008 and the sizing tables of AS/NZS 3000, searched by what is in the column headings.',
  },
  {
    href: '/tools/fault-loop',
    icon: 'flash-alert-outline',
    title: 'Fault loop and earthing',
    body: 'Whether the device sees enough fault current to trip at once, how much of the run can stay, and the earth conductor that survives it.',
  },
  {
    href: '/tools/max-demand',
    icon: 'gauge-full',
    title: 'Maximum demand',
    body: 'What the main is sized on — counted per phase, with the one load worth moving named where moving it helps.',
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
    href: '/library',
    icon: 'bookshelf',
    title: 'Standards',
    body: 'The whole catalogue, offline — asked the way you would ask a mate, not the way the document is worded.',
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
        {CALCULATORS.map((tool, i) => (
          <Reveal key={tool.href} index={i}>
          <Card onPress={() => router.push(tool.href as never)}>
            <Rowed gap={3} align="flex-start">
              <IconPlate icon={tool.icon} size={44} />
              <View style={{ flex: 1, gap: 3 }}>
                <Txt weight="700" size="md">{tool.title}</Txt>
                <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{tool.body}</Txt>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
            </Rowed>
          </Card>
          </Reveal>
        ))}
      </View>

      <H2>Reference</H2>
      <View style={{ gap: t.space(2.5) }}>
        {REFERENCE.map((tool, i) => (
          <Reveal key={tool.href} index={i}>
          <Card onPress={() => router.push(tool.href as never)}>
            <Rowed gap={3} align="flex-start">
              <IconPlate icon={tool.icon} size={44} />
              <View style={{ flex: 1, gap: 3 }}>
                <Txt weight="700" size="md">{tool.title}</Txt>
                <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{tool.body}</Txt>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
            </Rowed>
          </Card>
          </Reveal>
        ))}
      </View>
    </Screen>
  );
}
