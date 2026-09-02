import React, { useCallback, useState } from 'react';
import { qldIsoDay } from '@/domain/qldTime';
import { Alert, Linking, Pressable, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  countPoints, createReport, deleteSite, getSite, listDefects, listPanels, listReports,
} from '@/db/repo';
import { createBaseline, listBaselines } from '@/db/baselineRepo';
import { createOccupierStatement, listOccupierStatements } from '@/db/occupierRepo';
import { createAssessment, listAssessments } from '@/db/assessmentRepo';
import { configTotals, siteToConfig } from '@/share/siteToConfig';
import { encodePack, formatBytes } from '@/share/pack';
import { shareFile, writePack, writePdf } from '@/export/files';
import { formatAuDate } from '@/export/sheets';
import { buildRoutineReport } from '@/db/routineReportRepo';
import { listJobs } from '@/db/opsRepo';
import { listJobsFor, listQuotes, siteStats, type CustomerStats } from '@/db/mirrorRepo';
import { contactActions } from '@/domain/jobPresentation';
import { formatCents } from '@/domain/rates';
import { siteCustomers, type SiteCustomer } from '@/domain/siteSimpro';
import { jobNumberForReport } from '@/domain/reportJobMatch';
import { routineServiceReportHtml, tallyReport } from '@/export/routineServiceReport';
import { nowIso } from '@/db';
import type { Defect, Panel, ServiceReport, Site } from '@/domain/types';
import { PANEL_CATALOGUE } from '@/parsers';
import { useTheme } from '@/theme';
import {
  Button, Card, Chip, EmptyState, H2, Label, Rowed, Screen, StatTile, Txt,
} from '@/components/ui';
import { RecordGate } from '@/components/RecordGate';

/** Site detail — the hub every other screen hangs off. */
export default function SiteScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [site, setSite] = useState<Site | null>(null);
  // Loaded-and-absent is not the same as still loading. See RecordGate.
  const [missing, setMissing] = useState(false);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [reports, setReports] = useState<ServiceReport[]>([]);
  const [defects, setDefects] = useState<Defect[]>([]);
  const [pointCount, setPointCount] = useState(0);
  const [creating, setCreating] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [reporting, setReporting] = useState(false);
  // The office's side of this site — the customer, the counts and what is
  // owed — read from the mirror beside the phone's own records.
  const [office, setOffice] = useState<{ stats: CustomerStats; quoteCount: number; customers: SiteCustomer[] } | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const [s, p, r, d, n] = await Promise.all([
      getSite(id),
      listPanels(id),
      listReports(id),
      listDefects(id),
      // Counted in SQL. Reading every point row on a large site only to take
      // its length was the slowest thing on this screen.
      countPoints(id),
    ]);
    setSite(s);
    setMissing(!s);
    setPanels(p);
    setReports(r);
    setDefects(d);
    setPointCount(n);
    // The office's records last, so the mirror never holds up the site's own.
    const [stats, jobs, quotes] = await Promise.all([
      siteStats(id),
      listJobsFor({ siteId: id, limit: 500 }),
      listQuotes({ siteId: id, limit: 500 }),
    ]);
    setOffice({ stats, quoteCount: quotes.length, customers: siteCustomers(jobs, quotes) });
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
        // The day the service is being carried out in Queensland, which is
        // what the report is dated with and what it is later found by.
        serviceDate: qldIsoDay(nowIso()) ?? '',
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

  if (!site) return <RecordGate missing={missing} what="site" />;

  const openDefects = defects.filter((d) => d.status === 'open');
  const criticalDefects = openDefects.filter((d) => d.severity === 'critical');
  const customer = office?.customers[0];
  const otherCustomers = office ? Math.max(0, office.customers.length - 1) : 0;
  const ways = contactActions({ mobile: site.contactMobile, workPhone: site.contactWorkPhone, email: site.contactEmail });

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

      /*
       * The customer's job number, worked out rather than typed.
       *
       * Their report leads with it and the office files by it. Where the site
       * has more than one job in the period this deliberately prints none —
       * putting the wrong number on a service report files it against somebody
       * else's work — and says so below, where the technician sees it before
       * the document leaves the phone.
       */
      const job = jobNumberForReport(await listJobs({ limit: 500 }), {
        siteId: site.id,
        from: from.toISOString(),
        to: to.toISOString(),
      });

      const input = await buildRoutineReport({
        siteId: site.id,
        from: from.toISOString(),
        to: to.toISOString(),
        jobNumber: job.jobNumber,
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
        + `${tally.missingReason ? ` (${tally.missingReason} with no reason given)` : ''}`
        + `${job.reason ? `. ${job.reason}` : ''}`,
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

        {/*
          * The office's side of the site. Who it belongs to, who to ring and
          * what is owed live in Simpro, and until now only the office could
          * see them; a technician on the doorstep is the one who gets asked.
          */}
        {site.externalId || office?.stats.jobsTotal || office?.quoteCount ? (
          <>
            <H2>From Simpro</H2>
            <Card>
              <Label>Customer</Label>
              {customer ? (
                <Pressable
                  onPress={() => router.push({ pathname: '/customer/[id]', params: { id: customer.externalId } })}
                  hitSlop={4}
                  style={{ minHeight: 44, justifyContent: 'center' }}
                >
                  <Rowed gap={2}>
                    <Txt weight="700" tone="accent" style={{ flex: 1 }}>{customer.name ?? `Customer ${customer.externalId}`}</Txt>
                    <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
                  </Rowed>
                </Pressable>
              ) : (
                <Txt size="sm" tone="faint" style={{ marginTop: 4 }}>
                  {site.clientName
                    ? `${site.clientName} — the customer record opens once a job or quote here has synced.`
                    : 'The office has no job or quote here yet, so there is no customer to open.'}
                </Txt>
              )}
              {otherCustomers ? (
                <Txt size="xs" tone="faint">
                  Work here has also been billed to {otherCustomers} other customer{otherCustomers === 1 ? '' : 's'}.
                </Txt>
              ) : null}

              <View style={{ marginTop: t.space(3) }}>
                <Label>Site contact</Label>
                {site.contactName || ways.length ? (
                  <>
                    <Txt weight="700" style={{ marginTop: 4 }}>{site.contactName || 'Unnamed contact'}</Txt>
                    {ways.length ? (
                      <Rowed gap={2} wrap style={{ marginTop: t.space(2) }}>
                        {ways.map((w) => (
                          <Button
                            key={w.href}
                            title={w.label}
                            variant="secondary"
                            compact
                            icon={<MaterialCommunityIcons name={w.kind === 'email' ? 'email-outline' : w.kind === 'mobile' ? 'cellphone' : 'phone-outline'} size={18} color={t.color.text} />}
                            onPress={() => void Linking.openURL(w.href)}
                          />
                        ))}
                      </Rowed>
                    ) : (
                      <Txt size="sm" tone="faint">The office has no number or email for them.</Txt>
                    )}
                  </>
                ) : (
                  <Txt size="sm" tone="faint" style={{ marginTop: 4 }}>The office lists no contact for this site.</Txt>
                )}
              </View>
            </Card>
            {office ? (
              <>
                <NavRow
                  icon="clipboard-list-outline"
                  title="Jobs"
                  subtitle={office.stats.jobsTotal
                    ? `${office.stats.jobsTotal} job${office.stats.jobsTotal === 1 ? '' : 's'} on the books · ${office.stats.jobsOpen} open`
                    : 'None on the books for this site'}
                  onPress={() => router.push({ pathname: '/work/jobs', params: { siteId: site.id } })}
                />
                <NavRow
                  icon="file-sign"
                  title="Simpro quotes"
                  subtitle={office.quoteCount
                    ? `${office.quoteCount} quote${office.quoteCount === 1 ? '' : 's'} · ${office.stats.quotesOpen} still open`
                    : 'Nothing quoted for this site'}
                  onPress={() => router.push({ pathname: '/quotes/simpro', params: { siteId: site.id } })}
                />
                <NavRow
                  icon="receipt-text-outline"
                  title="Invoices"
                  subtitle={office.stats.invoicesUnpaidCents
                    ? `${formatCents(office.stats.invoicesUnpaidCents)} unpaid against this site's jobs`
                    : 'Nothing owing in the two years the phone holds'}
                  onPress={() => router.push({ pathname: '/invoices', params: { siteId: site.id } })}
                />
                <Txt size="xs" tone="faint">
                  {[
                    site.externalId ? `Simpro site ${site.externalId}.` : 'Not matched to a Simpro site.',
                    office.stats.lastJobAt ? `Last job issued ${formatAuDate(office.stats.lastJobAt)}.` : undefined,
                  ].filter(Boolean).join(' ')}
                </Txt>
              </>
            ) : null}
          </>
        ) : null}

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
              attendanceDate: qldIsoDay(nowIso()) ?? '',
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
