import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { listReports, listDefects } from '@/db/repo';
import { listTimesheets } from '@/db/timesheetRepo';
import { listBaselines } from '@/db/baselineRepo';
import { listJobs, listPurchaseRequests, listImpairments, restockNeeded, listPromises } from '@/db/opsRepo';
import { useTheme } from '@/theme';
import { Card, Chip, H2, Rowed, Screen, Txt } from '@/components/ui';

/** Work hub — everything that produces a record the office needs. */
export default function WorkScreen() {
  const t = useTheme();
  const [counts, setCounts] = useState({
    jobs: 0, reports: 0, defects: 0, timesheets: 0, baselines: 0,
    purchases: 0, impairments: 0, restock: 0, promises: 0,
  });

  const load = useCallback(async () => {
    const [j, r, d, ts, bl, po, imp, rs, pr] = await Promise.all([
      listJobs({ limit: 500 }), listReports(), listDefects(undefined, 'open'),
      listTimesheets(), listBaselines(), listPurchaseRequests(),
      listImpairments(true), restockNeeded(), listPromises(true),
    ]);
    setCounts({
      jobs: j.filter((x) => x.status !== 'complete').length,
      reports: r.filter((x) => x.status === 'draft').length,
      defects: d.length,
      timesheets: ts.filter((x) => x.status === 'draft').length,
      baselines: bl.length,
      purchases: po.filter((x) => x.status === 'draft').length,
      impairments: imp.length,
      restock: rs.length,
      promises: pr.length,
    });
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const groups: { title: string; rows: { label: string; sub: string; icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; href: string; badge?: number; tone?: 'fail' | 'warn' }[] }[] = [
    {
      title: 'On the tools',
      rows: [
        { label: 'Jobs', sub: 'Scheduled and outstanding work', icon: 'clipboard-list-outline', href: '/work/jobs', badge: counts.jobs },
        { label: 'Month plan', sub: 'The month day by day, with what could not be planned said out loud', icon: 'calendar-month-outline', href: '/work/plan' },
        { label: "Today's run", sub: 'Jobs ordered by how close they are, urgent first', icon: 'map-marker-path', href: '/work/route' },
        { label: 'Overdue and due', sub: 'Routines past their tolerance window, across every site', icon: 'calendar-alert', href: '/work/due' },
        { label: 'Impairments', sub: 'Systems currently out of service', icon: 'alert-octagon-outline', href: '/work/impairments', badge: counts.impairments, tone: counts.impairments ? 'fail' : undefined },
        { label: 'Defects', sub: 'Raised, quoted and outstanding', icon: 'alert-circle-outline', href: '/work/defects', badge: counts.defects, tone: counts.defects ? 'warn' : undefined },
        { label: 'Promises', sub: "Things you said you'd come back for", icon: 'hand-back-right-outline', href: '/work/promises', badge: counts.promises },
      ],
    },
    {
      title: 'Records',
      rows: [
        { label: 'Send to the office', sub: 'Push a finished service and its defects to the Simpro job', icon: 'cloud-upload-outline', href: '/work/outbound' },
        { label: 'Test sheets', sub: 'Service reports and device testing', icon: 'file-document-outline', href: '/work/reports', badge: counts.reports },
        { label: 'Baseline data', sub: 'Commissioning records', icon: 'clipboard-text-outline', href: '/work/baselines', badge: counts.baselines },
        { label: 'Timesheets', sub: 'Weekly hours and sign off', icon: 'calendar-clock-outline', href: '/work/timesheets', badge: counts.timesheets },
      ],
    },
    {
      title: 'Parts and knowledge',
      rows: [
        { label: 'Asset labels', sub: 'Issue numbers to untagged assets and print the sheet', icon: 'tag-multiple-outline', href: '/work/labels' },
        { label: 'Van stock', sub: 'What you carry and what needs restocking', icon: 'van-utility', href: '/work/stock', badge: counts.restock, tone: counts.restock ? 'warn' : undefined },
        { label: 'Purchase requests', sub: 'Parts to order', icon: 'cart-outline', href: '/work/purchases', badge: counts.purchases },
        { label: 'Company knowledge', sub: 'Tricks of the trade, approved and unverified', icon: 'lightbulb-on-outline', href: '/work/knowledge' },
      ],
    },
  ];

  return (
    <Screen>
      {groups.map((g) => (
        <View key={g.title} style={{ gap: t.space(2.5) }}>
          <H2>{g.title}</H2>
          {g.rows.map((row) => (
            <Card key={row.href} onPress={() => router.push(row.href as never)}>
              <Rowed gap={3}>
                <MaterialCommunityIcons
                  name={row.icon}
                  size={22}
                  color={row.tone === 'fail' ? t.color.fail : row.tone === 'warn' ? t.color.warn : t.color.accentText}
                />
                <View style={{ flex: 1 }}>
                  <Txt weight="600">{row.label}</Txt>
                  <Txt size="sm" tone="muted">{row.sub}</Txt>
                </View>
                {row.badge ? <Chip label={String(row.badge)} tone={row.tone === 'fail' ? 'fail' : row.tone === 'warn' ? 'warn' : 'default'} /> : null}
                <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
              </Rowed>
            </Card>
          ))}
        </View>
      ))}
    </Screen>
  );
}
