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
 * The calculations and reference a fire tech looks up on site, where signal
 * is often nonexistent. Every one works offline.
 */

interface ToolDef {
  href: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  body: string;
}

const FIRE: ToolDef[] = [
  { href: '/tools/extinguisher', icon: 'fire-extinguisher', title: 'Extinguishers', body: 'Type, next test and weight check.' },
  { href: '/tools/emergency-lighting', icon: 'lightbulb-outline', title: 'Emergency lighting', body: 'Discharge, exit signs, battery age and spacing.' },
  { href: '/tools/hydrant', icon: 'fire-hydrant', title: 'Hydrant flow test', body: 'Flow, supply at brigade pressure, and the duty.' },
  { href: '/tools/hose-reel', icon: 'hydro-power', title: 'Hose reels', body: 'Reach, flow and next service.' },
  { href: '/tools/fire-door', icon: 'door-closed', title: 'Fire and smoke doors', body: 'Tag, gaps, close and latch.' },
  { href: '/tools/spl', icon: 'volume-high', title: 'Sound level', body: 'Is the warning loud enough in this room?' },
  { href: '/tools/battery', icon: 'car-battery', title: 'FIP battery', body: 'Standby and alarm load to battery size. VESDA included.' },
  { href: '/tools/dipswitch', icon: 'toggle-switch-outline', title: 'Device address', body: 'DIP switches, XPERT cards and rotary dials.' },
  { href: '/tools/detector-age', icon: 'calendar-clock', title: 'Detector age', body: 'Date code to age and replacement.' },
  { href: '/tools/eol', icon: 'resistor-nodes', title: 'End of line', body: 'EOL values by panel and circuit.' },
  { href: '/tools/resistor', icon: 'resistor', title: 'Resistor values', body: 'Colour bands to ohms and back.' },
];

const ELECTRICAL: ToolDef[] = [
  { href: '/tools/cable', icon: 'cable-data', title: 'Cable sizing', body: 'Capacity, volt drop, breaker and fault, to AS/NZS 3008.' },
  { href: '/tools/voltdrop', icon: 'flash-outline', title: 'Volt drop', body: 'Volts at the far end of the run.' },
  { href: '/tools/wiring', icon: 'book-open-page-variant-outline', title: 'Wiring rules tables', body: 'AS/NZS 3008 and AS/NZS 3000 tables.' },
  { href: '/tools/fault-loop', icon: 'flash-alert-outline', title: 'Fault loop', body: 'Loop impedance, trip check, max run and earth size.' },
  { href: '/tools/max-demand', icon: 'gauge-full', title: 'Maximum demand', body: 'Maximum demand per phase.' },
  { href: '/tools/ohms', icon: 'omega', title: "Ohm's law", body: "Ohm's law, power and battery runtime." },
  { href: '/tools/converter', icon: 'swap-horizontal', title: 'Unit converter', body: 'Pressure, flow, volume, temperature and more.' },
];

const REFERENCE: ToolDef[] = [
  { href: '/library', icon: 'bookshelf', title: 'Standards', body: 'Search every standard and your own PDFs.' },
  { href: '/tools/routines', icon: 'clipboard-list-outline', title: 'Service routines', body: 'What each routine checks, and how often.' },
  { href: '/tools/defects', icon: 'alert-circle-outline', title: 'Defect wording', body: 'Report wording and fix for each defect code.' },
  { href: '/scan', icon: 'qrcode-scan', title: 'Scan a tag', body: 'Open an asset from its label.' },
];

function Section({ title, tools }: { title: string; tools: ToolDef[] }) {
  const t = useTheme();
  return (
    <>
      <H2>{title}</H2>
      <View style={{ gap: t.space(2) }}>
        {tools.map((tool, i) => (
          <Reveal key={tool.href} index={i}>
            <Card onPress={() => router.push(tool.href as never)}>
              <Rowed gap={3}>
                <IconPlate icon={tool.icon} size={40} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt weight="700">{tool.title}</Txt>
                  <Txt size="sm" tone="muted">{tool.body}</Txt>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
              </Rowed>
            </Card>
          </Reveal>
        ))}
      </View>
    </>
  );
}

export default function ToolsScreen() {
  return (
    <Screen>
      <Txt tone="muted" size="sm">All offline. Check the panel manual and the current standard.</Txt>
      <Section title="Fire" tools={FIRE} />
      <Section title="Electrical" tools={ELECTRICAL} />
      <Section title="Reference" tools={REFERENCE} />
    </Screen>
  );
}
