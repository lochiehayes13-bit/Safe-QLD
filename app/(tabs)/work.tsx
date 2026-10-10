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

  type Row = {
    label: string; sub: string; icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; href: string;
    badge?: number; tone?: 'fail' | 'warn';
  };
  const groups: { title: string; rows: Row[] }[] = [
    {
      title: 'On the tools',
      rows: [
        { label: 'Clock on', sub: 'Hours go to Simpro', icon: 'timer-play-outline', href: '/work/clock' },
        { label: 'Jobs', sub: 'Scheduled and open jobs', icon: 'clipboard-list-outline', href: '/work/jobs', badge: counts.jobsOpen },
        { label: 'Schedule', sub: "Your day and the team's", icon: 'calendar-multiselect-outline', href: '/work/schedule' },
        { label: 'Plan work', sub: 'Build a day and book it in Simpro', icon: 'calendar-month-outline', href: '/work/plan' },
        { label: "Today's run", sub: 'Jobs in order of distance', icon: 'map-marker-path', href: '/work/route' },
        { label: 'Impairments', sub: 'Systems out of service', icon: 'alert-octagon-outline', href: '/work/impairments', badge: counts.impairmentsOpen, tone: counts.impairmentsOpen ? 'fail' : undefined },
        { label: 'Defects', sub: 'Raised, quoted and open', icon: 'alert-circle-outline', href: '/work/defects', badge: counts.defectsOpen, tone: counts.defectsOpen ? 'warn' : undefined },
      ],
    },
    {
      title: 'Records',
      rows: [
        { label: 'Waiting to send', sub: 'Queued work and finished services', icon: 'cloud-upload-outline', href: '/work/outbound' },
        { label: 'Timesheets', sub: 'Your weekly hours', icon: 'calendar-clock-outline', href: '/work/timesheets', badge: counts.timesheetsDraft },
        { label: 'Test sheets', sub: 'By site and date', icon: 'file-document-outline', href: '/work/reports', badge: counts.reportsDraft },
        { label: 'Quotes', sub: 'Your quotes and when they lapse', icon: 'file-sign', href: '/quotes' },
        { label: 'Occupier statements', sub: 'Every site, closest deadline first', icon: 'file-certificate-outline', href: '/occupier' },
        { label: 'Baseline data', sub: 'Commissioning records', icon: 'clipboard-text-outline', href: '/work/baselines', badge: counts.baselines },
      ],
    },
    {
      title: 'Parts',
      rows: [
        { label: 'Things I need', sub: 'Parts to get, now and for coming work', icon: 'format-list-checks', href: '/work/needs' },
        { label: 'Office catalogue', sub: 'Part numbers and sell prices', icon: 'clipboard-list-outline', href: '/office-catalogue' },
        { label: 'Purchase orders', sub: 'What the office has ordered', icon: 'package-variant', href: '/orders' },
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
