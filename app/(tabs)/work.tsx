import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { workHubCounts, type WorkHubCounts } from '@/db/opsRepo';
import { useTheme } from '@/theme';
import { Card, Chip, H2, IconPlate, Rowed, Screen, Txt } from '@/components/ui';
import { Reveal } from '@/components/motion';

/**
 * Work hub — everything that produces a record the office needs.
 *
 * The nine badges are nine counts in one statement. They were nine whole
 * tables read into memory to be measured with `.length`: every service report
 * with the technician's signature in it, every baseline with its zone
 * results, five hundred jobs with their descriptions — all of it thrown away
 * except the number of rows, every time the tab is opened.
 */
const NO_COUNTS: WorkHubCounts = {
  jobsOpen: 0, reportsDraft: 0, defectsOpen: 0, timesheetsDraft: 0, baselines: 0,
  purchasesDraft: 0, impairmentsOpen: 0, restock: 0, promisesOpen: 0,
};

export default function WorkScreen() {
  const t = useTheme();
  const [counts, setCounts] = useState<WorkHubCounts>(NO_COUNTS);

  const load = useCallback(async () => {
    setCounts(await workHubCounts());
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const groups: { title: string; rows: { label: string; sub: string; icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; href: string; badge?: number; tone?: 'fail' | 'warn' }[] }[] = [
    {
      title: 'On the tools',
      rows: [
        { label: 'Jobs', sub: 'Scheduled and outstanding work', icon: 'clipboard-list-outline', href: '/work/jobs', badge: counts.jobsOpen },
        { label: 'Month plan', sub: 'The month day by day, with what could not be planned said out loud', icon: 'calendar-month-outline', href: '/work/plan' },
        { label: 'Portfolio health', sub: 'How the whole book is going, coverage stated before any score', icon: 'chart-donut', href: '/work/portfolio' },
        { label: "Today's run", sub: 'Jobs ordered by how close they are, urgent first', icon: 'map-marker-path', href: '/work/route' },
        { label: 'Overdue and due', sub: 'Routines past their tolerance window, across every site', icon: 'calendar-alert', href: '/work/due' },
        { label: 'Impairments', sub: 'Systems currently out of service', icon: 'alert-octagon-outline', href: '/work/impairments', badge: counts.impairmentsOpen, tone: counts.impairmentsOpen ? 'fail' : undefined },
        { label: 'Defects', sub: 'Raised, quoted and outstanding', icon: 'alert-circle-outline', href: '/work/defects', badge: counts.defectsOpen, tone: counts.defectsOpen ? 'warn' : undefined },
        { label: 'Promises', sub: "Things you said you'd come back for", icon: 'hand-back-right-outline', href: '/work/promises', badge: counts.promisesOpen },
      ],
    },
    {
      title: 'Records',
      rows: [
        { label: 'Send to the office', sub: 'Push a finished service and its defects to the Simpro job', icon: 'cloud-upload-outline', href: '/work/outbound' },
        { label: 'Occupier statements', sub: 'Every statement across every site, closest to late first', icon: 'file-certificate-outline', href: '/occupier' },
        { label: 'Quotes', sub: 'What is out with clients and what is about to lapse', icon: 'file-sign', href: '/quotes' },
        { label: 'Test sheets', sub: 'Service reports and device testing', icon: 'file-document-outline', href: '/work/reports', badge: counts.reportsDraft },
        { label: 'Baseline data', sub: 'Commissioning records', icon: 'clipboard-text-outline', href: '/work/baselines', badge: counts.baselines },
        { label: 'Timesheets', sub: 'Weekly hours and sign off', icon: 'calendar-clock-outline', href: '/work/timesheets', badge: counts.timesheetsDraft },
      ],
    },
    {
      title: 'Parts and knowledge',
      rows: [
        { label: 'Asset labels', sub: 'Issue numbers to untagged assets and print the sheet', icon: 'tag-multiple-outline', href: '/work/labels' },
        { label: 'Van stock', sub: 'What you carry and what needs restocking', icon: 'van-utility', href: '/work/stock', badge: counts.restock, tone: counts.restock ? 'warn' : undefined },
        { label: 'Things I need', sub: 'Parts to grab, for now and for work still coming', icon: 'format-list-checks', href: '/work/needs' },
        { label: 'Purchase requests', sub: 'Parts to order', icon: 'cart-outline', href: '/work/purchases', badge: counts.purchasesDraft },
        { label: 'Company knowledge', sub: 'Tricks of the trade, approved and unverified', icon: 'lightbulb-on-outline', href: '/work/knowledge' },
      ],
    },
  ];

  return (
    <Screen>
      {groups.map((g) => (
        <View key={g.title} style={{ gap: t.space(2.5) }}>
          <H2>{g.title}</H2>
          {g.rows.map((row, i) => (
            <Reveal key={row.href} index={i}>
            <Card onPress={() => router.push(row.href as never)}>
              <Rowed gap={3}>
                <IconPlate icon={row.icon} size={40} tone={row.tone} muted={!row.tone} />
                <View style={{ flex: 1 }}>
                  <Txt weight="600">{row.label}</Txt>
                  <Txt size="sm" tone="muted">{row.sub}</Txt>
                </View>
                {row.badge ? <Chip label={String(row.badge)} tone={row.tone === 'fail' ? 'fail' : row.tone === 'warn' ? 'warn' : 'default'} /> : null}
                <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
              </Rowed>
            </Card>
            </Reveal>
          ))}
        </View>
      ))}
    </Screen>
  );
}
