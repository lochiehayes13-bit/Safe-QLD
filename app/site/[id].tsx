import React, { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  createReport, deleteSite, getSite, listDefects, listPanels, listReports, queryPoints,
} from '@/db/repo';
import { createBaseline, listBaselines } from '@/db/baselineRepo';
import { createOccupierStatement, listOccupierStatements } from '@/db/occupierRepo';
import { createAssessment, listAssessments } from '@/db/assessmentRepo';
import { configTotals, siteToConfig } from '@/share/siteToConfig';
import { encodePack, formatBytes } from '@/share/pack';
import { shareFile, writePack, writePdf } from '@/export/files';
import { buildRoutineReport } from '@/db/routineReportRepo';
import { routineServiceReportHtml, tallyReport } from '@/export/routineServiceReport';
import { nowIso } from '@/db';
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
  const [sharing, setSharing] = useState(false);
  const [reporting, setReporting] = useState(false);

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

  /**
   * Packs this site for another technician.
   *
   * The pack carries the normalised data the app holds — zones, points, loops,
   * cause and effect — and never the vendor's original file, so sharing one
   * does not redistribute a customer's proprietary configuration. Until now the
   * app could open a pack but never make one, which meant no pack could exist.
   */
  /**
   * The routine service report for the most recent visit.
   *
   * The window is the day of the newest recorded result rather than a range
   * the technician picks: a service report is a record of a visit, and asking
   * someone to choose dates invites the wrong ones. A different visit can be
   * reported by picking it from the timeline.
   */
  const shareRoutineReport = async () => {
    if (!site) return;
    setReporting(true);
    try {
      const to = new Date();
      const from = new Date(to.getTime() - 30 * 24 * 3600 * 1000);
      const input = await buildRoutineReport({
        siteId: site.id,
        from: from.toISOString(),
        to: to.toISOString(),
        workRequested: 'Routine service of fire protection systems and assets',
      });

      if (!input) {
        Alert.alert(
          'Nothing to report yet',
          'No assets at this site have been passed, failed or recorded as not tested in the last '
          + 'month. Run a routine first — the report is built from what was actually recorded, not '
          + 'from the asset list.',
        );
        return;
      }

      const tally = tallyReport(input);
      const html = routineServiceReportHtml(input);
      const file = await writePdf(`${site.name} service report`, html);
      await shareFile(
        file,
        // The issued format carries no summary, so the counts go here where a
        // technician sees them before the document leaves the phone.
        `${site.name} — ${tally.total} assets: ${tally.pass} pass, ${tally.fail} fail`
        + `${tally.notTested ? `, ${tally.notTested} not tested` : ''}`
        + `${tally.missingReason ? ` (${tally.missingReason} with no reason given)` : ''}`,
      );
    } catch (e) {
      Alert.alert('Could not build the report', e instanceof Error ? e.message : String(e));
    } finally {
      setReporting(false);
    }
  };

  const sharePack = async () => {
    if (!site) return;
    setSharing(true);
    try {
      const config = await siteToConfig(site);
      const totals = configTotals(config);
      if (!totals.panels) {
        Alert.alert('Nothing to share', 'This site has no panel data yet. Import a device list first.');
        return;
      }
      const bytes = encodePack({
        meta: { app: 'Safe QLD', siteName: site.name, createdAt: nowIso() },
        config,
      });
      const file = writePack(`${site.name}`, bytes);
      await shareFile(
        file,
        `${site.name} — ${totals.panels} panel${totals.panels === 1 ? '' : 's'}, ` +
        `${totals.points} devices (${formatBytes(bytes.byteLength)})`,
      );
    } catch (e) {
      Alert.alert('Could not build the pack', e instanceof Error ? e.message : String(e));
    } finally {
      setSharing(false);
    }
  };

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
            title="Run a routine"
            variant="secondary"
            onPress={() => router.push({ pathname: '/routine/run', params: { siteId: site.id } })}
            style={{ flex: 1 }}
          />
        </Rowed>
        <Rowed gap={2}>
          <Button
            title="Service report"
            variant="secondary"
            onPress={shareRoutineReport}
            loading={reporting}
            style={{ flex: 1 }}
          />
          <Button
            title="Import a configuration"
            variant="secondary"
            onPress={() => router.push({ pathname: '/import', params: { siteId: site.id } })}
            style={{ flex: 1 }}
          />
        </Rowed>
        <Rowed gap={2}>
          <Button
            title="Share this site"
            variant="secondary"
            onPress={sharePack}
            loading={sharing}
            style={{ flex: 1 }}
          />
          <View style={{ flex: 1 }} />
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
          icon="calendar-clock"
          title="What is due"
          subtitle="Routines due or overdue here, with their tolerance windows"
          onPress={() => router.push({ pathname: '/site/due', params: { siteId: site.id } })}
        />
        <NavRow
          icon="cart-outline"
          title="Parts needed"
          subtitle="What the open defects need ordered, from their coded quote lines"
          onPress={() => router.push({ pathname: '/site/parts', params: { siteId: site.id } })}
        />
        <NavRow
          icon="help-circle-outline"
          title="Not tested"
          subtitle="Assets that were attempted and could not be tested, with the reason"
          onPress={() => router.push({ pathname: '/site/coverage', params: { siteId: site.id } })}
        />
        <NavRow
          icon="currency-usd"
          title="Rectification quote"
          subtitle="Price the open defects from their coded lines and the rate card"
          onPress={() => router.push({ pathname: '/site/quote', params: { siteId: site.id } })}
        />
        <NavRow
          icon="clipboard-check-outline"
          title="Form 72"
          subtitle="The department's hydrant and sprinkler form, and the occupier's copy of it"
          onPress={() => router.push({ pathname: '/site/form72', params: { siteId: site.id } })}
        />
        <NavRow
          icon="file-certificate-outline"
          title="Occupier statement"
          subtitle="Annual declaration, filled from this site's own register and defects"
          onPress={async () => {
            const existing = await listOccupierStatements(site.id);
            const rec = existing[0] ?? (await createOccupierStatement(site.id, {
              premisesName: site.name,
              premisesAddress: site.address ?? '',
            }));
            router.push({ pathname: '/occupier/[id]', params: { id: rec.id } });
          }}
        />
        <NavRow
          icon="history"
          title="Service history"
          subtitle="What has been done here, and whether it was done within tolerance"
          onPress={() => router.push({ pathname: '/site/history', params: { siteId: site.id } })}
        />
        <NavRow
          icon="clipboard-search-outline"
          title="Effectiveness assessment"
          subtitle="Visual and advisory — recommendations for a project, not a service"
          onPress={async () => {
            const existing = await listAssessments(site.id);
            // One assessment per site until there is a reason for more: a
            // second one raised by accident is a second report reference the
            // client has to reconcile.
            const rec = existing[0] ?? (await createAssessment({
              siteId: site.id,
              clientName: site.clientName ?? '',
              scopeLabel: site.name,
              attendanceDate: nowIso().slice(0, 10),
            }));
            router.push({ pathname: '/assessment/[id]', params: { id: rec.id } });
          }}
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
