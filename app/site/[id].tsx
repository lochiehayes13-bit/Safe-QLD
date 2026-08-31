import React, { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  createReport, deleteSite, getSite, listDefects, listPanels, listReports, queryPoints,
} from '@/db/repo';
import { createBaseline, listBaselines } from '@/db/baselineRepo';
import type { Defect, Panel, ServiceReport, Site } from '@/domain/types';
import { PANEL_CATALOGUE } from '@/parsers';
import { useTheme } from '@/theme';
import {
  Button, Card, Chip, EmptyState, H2, Rowed, Screen, StatTile, Txt,
} from '@/components/ui';

/** Site detail — the hub every other screen hangs off. */
export default function SiteScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [site, setSite] = useState<Site | null>(null);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [reports, setReports] = useState<ServiceReport[]>([]);
  const [defects, setDefects] = useState<Defect[]>([]);
  const [pointCount, setPointCount] = useState(0);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const [s, p, r, d, pts] = await Promise.all([
      getSite(id),
      listPanels(id),
      listReports(id),
      listDefects(id),
      queryPoints({ siteId: id, limit: 100000 }),
    ]);
    setSite(s);
    setPanels(p);
    setReports(r);
    setDefects(d);
    setPointCount(pts.length);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const startReport = async () => {
    if (!site) return;
    setCreating(true);
    try {
      const report = await createReport({
        siteId: site.id,
        panelId: panels.length === 1 ? panels[0]!.id : undefined,
        title: `Service report — ${site.name}`,
        frequency: 'annual',
        serviceDate: new Date().toISOString().slice(0, 10),
        status: 'draft',
      });
      router.push({ pathname: '/report/[id]', params: { id: report.id } });
    } finally {
      setCreating(false);
    }
  };

  const confirmDelete = () => {
    if (!site) return;
    Alert.alert(
      'Delete site?',
      `This removes ${site.name} and everything under it — panels, points, reports and defects. It cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteSite(site.id);
            router.back();
          },
        },
      ],
    );
  };

  if (!site) {
    return (
      <Screen>
        <Txt tone="muted">Loading…</Txt>
      </Screen>
    );
  }

  const openDefects = defects.filter((d) => d.status === 'open');
  const criticalDefects = openDefects.filter((d) => d.severity === 'critical');

  return (
    <>
      <Stack.Screen options={{ title: site.name }} />
      <Screen>
        {site.address || site.suburb ? (
          <Txt tone="muted" size="sm">
            {[site.address, site.suburb, site.state, site.postcode].filter(Boolean).join(' ')}
          </Txt>
        ) : null}
        {site.clientName ? <Txt tone="faint" size="sm">{site.clientName}</Txt> : null}

        <Rowed gap={2}>
          <StatTile label="Panels" value={panels.length} />
          <StatTile label="Points" value={pointCount.toLocaleString()} />
          <StatTile label="Open defects" value={openDefects.length} tone={criticalDefects.length ? 'fail' : 'default'} />
        </Rowed>

        <Rowed gap={2}>
          <Button title="Start test sheet" onPress={startReport} loading={creating} style={{ flex: 1 }} />
          <Button
            title="Import"
            variant="secondary"
            onPress={() => router.push({ pathname: '/import', params: { siteId: site.id } })}
            style={{ flex: 1 }}
          />
        </Rowed>

        <H2>Browse</H2>
        <NavRow
          icon="format-list-bulleted"
          title="Points"
          subtitle={`${pointCount.toLocaleString()} devices — search by text, zone or address`}
          onPress={() => router.push({ pathname: '/site/points', params: { siteId: site.id } })}
        />
        <NavRow
          icon="cube-outline"
          title="Asset register"
          subtitle="Extinguishers, lights, hydrants, doors, pumps — each with its own history"
          onPress={() => router.push({ pathname: '/site/assets', params: { siteId: site.id } })}
        />
        <NavRow
          icon="shape-outline"
          title="Zones"
          subtitle="Zone list with device counts"
          onPress={() => router.push({ pathname: '/site/zones', params: { siteId: site.id } })}
        />
        <NavRow
          icon="clipboard-text-outline"
          title="Baseline data"
          subtitle="Commissioning record, filled from this site's own data"
          onPress={async () => {
            const existing = await listBaselines(site.id);
            const rec = existing[0] ?? (await createBaseline(site.id));
            router.push({ pathname: '/baseline/[id]', params: { id: rec.id } });
          }}
        />
        <NavRow
          icon="table-large"
          title="Cause & effect"
          subtitle="Matrix of causes against the outputs they operate"
          onPress={() => router.push({ pathname: '/site/cause-effect', params: { siteId: site.id } })}
        />
        <NavRow
          icon="alert-octagon-outline"
          title="Defects"
          subtitle={openDefects.length ? `${openDefects.length} open${criticalDefects.length ? `, ${criticalDefects.length} critical` : ''}` : 'None open'}
          tone={criticalDefects.length ? 'fail' : undefined}
          onPress={() => router.push({ pathname: '/site/defects', params: { siteId: site.id } })}
        />

        <H2>Panels</H2>
        {panels.length ? (
          panels.map((p) => <PanelCard key={p.id} panel={p} />)
        ) : (
          <EmptyState
            title="No panels yet"
            body="Import a device list exported from the panel's programming tool, or add points by hand."
            action={
              <Button
                title="Import a device list"
                onPress={() => router.push({ pathname: '/import', params: { siteId: site.id } })}
              />
            }
          />
        )}

        <H2>Reports</H2>
        {reports.length ? (
          reports.map((r) => (
            <Card key={r.id} onPress={() => router.push({ pathname: '/report/[id]', params: { id: r.id } })}>
              <Rowed>
                <View style={{ flex: 1 }}>
                  <Txt weight="700">{r.title}</Txt>
                  <Txt size="sm" tone="muted">
                    {r.frequency} · {r.serviceDate}
                  </Txt>
                </View>
                <Chip label={r.status === 'complete' ? 'Complete' : 'Draft'} tone={r.status === 'complete' ? 'pass' : 'warn'} />
              </Rowed>
            </Card>
          ))
        ) : (
          <Txt tone="faint" size="sm">No reports yet.</Txt>
        )}

        <View style={{ height: t.space(4) }} />
        <Button title="Delete site" variant="danger" onPress={confirmDelete} />
      </Screen>
    </>
  );
}

function PanelCard({ panel }: { panel: Panel }) {
  const entry = PANEL_CATALOGUE.find((p) => p.brand === panel.brand);
  return (
    <Card>
      <Rowed>
        <View style={{ flex: 1 }}>
          <Txt weight="700">{panel.name}</Txt>
          <Txt size="sm" tone="muted">
            {[entry?.brandLabel ?? panel.brand, panel.model].filter(Boolean).join(' · ')}
            {panel.nodeNumber !== undefined && panel.nodeNumber !== null ? ` · Node ${panel.nodeNumber}` : ''}
          </Txt>
        </View>
        <Chip label={sourceLabel(panel.source)} />
      </Rowed>
    </Card>
  );
}

function sourceLabel(s: Panel['source']): string {
  return {
    manual: 'Manual',
    'config-import': 'Config',
    'tabular-import': 'Imported',
    'shared-pack': 'Shared',
  }[s];
}

function NavRow({
  icon,
  title,
  subtitle,
  onPress,
  tone,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  subtitle: string;
  onPress: () => void;
  tone?: 'fail';
}) {
  const t = useTheme();
  return (
    <Card onPress={onPress}>
      <Rowed gap={3}>
        <MaterialCommunityIcons name={icon} size={22} color={tone === 'fail' ? t.color.fail : t.color.accentText} />
        <View style={{ flex: 1 }}>
          <Txt weight="600">{title}</Txt>
          <Txt size="sm" tone="muted">{subtitle}</Txt>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
      </Rowed>
    </Card>
  );
}
