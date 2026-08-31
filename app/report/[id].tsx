import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  addCheckRows, addPointsToReport, getPanel, getReport, getSite, listCheckRows,
  listDefects, listTestRows, queryPoints, setTestResult, updateCheckRow, updateReport,
} from '@/db/repo';
import type { CheckRow, Defect, Panel, ServiceReport, Site, TestResult, TestRow } from '@/domain/types';
import { DEVICE_TYPE_LABEL, DEFAULT_TEST_METHOD } from '@/parsers/deviceType';
import { SERVICE_ROUTINES, routinesForSystem, type ServiceRoutine } from '@/seed/serviceRoutines';
import { checkSheet, defectSheet, reportCoverSheet, testResultSheet, type ReportBundle } from '@/export/sheets';
import { serviceReportHtml } from '@/export/pdf';
import { shareFile, writePdf, writeXlsx } from '@/export/files';
import {
  CERTIFICATION_STATEMENT, validateMaintenanceRecord, type MaintenanceRecord,
} from '@/domain/qldCompliance';
import { loadPrefs } from '@/app-prefs';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, Field, H2, Label, Rowed, Screen, Segmented, Txt,
} from '@/components/ui';
import { SignaturePad } from '@/components/SignaturePad';

/**
 * Test sheet.
 *
 * Marking a device is one tap, because a sheet can run to hundreds of rows and
 * anything slower gets done on paper and typed up later — which is where
 * accuracy goes. Everything else is behind a tab so the list stays the screen.
 */
type Tab = 'devices' | 'checks' | 'sign';

export default function ReportScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [report, setReport] = useState<ServiceReport | null>(null);
  const [site, setSite] = useState<Site | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [rows, setRows] = useState<TestRow[]>([]);
  const [checks, setChecks] = useState<CheckRow[]>([]);
  const [defects, setDefects] = useState<Defect[]>([]);
  const [tab, setTab] = useState<Tab>('devices');
  const [filter, setFilter] = useState<'all' | 'untested' | 'failed'>('all');
  const [busy, setBusy] = useState(false);
  const [qdcAffirmed, setQdcAffirmed] = useState(false);
  const [workingOrder, setWorkingOrder] = useState<boolean | null>(null);
  const [hardcopyLeft, setHardcopyLeft] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const r = await getReport(id);
    setReport(r);
    if (!r) return;
    const [s, p, tr, cr, df] = await Promise.all([
      getSite(r.siteId),
      r.panelId ? getPanel(r.panelId) : Promise.resolve(null),
      listTestRows(r.id),
      listCheckRows(r.id),
      listDefects(r.siteId),
    ]);
    setSite(s); setPanel(p); setRows(tr); setChecks(cr); setDefects(df);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const progress = useMemo(() => {
    const tested = rows.filter((r) => r.result !== 'untested').length;
    const failed = rows.filter((r) => r.result === 'fail').length;
    return { tested, failed, total: rows.length, fraction: rows.length ? tested / rows.length : 0 };
  }, [rows]);

  const shown = useMemo(() => {
    if (filter === 'untested') return rows.filter((r) => r.result === 'untested');
    if (filter === 'failed') return rows.filter((r) => r.result === 'fail');
    return rows;
  }, [rows, filter]);

  const mark = async (row: TestRow, result: TestResult) => {
    void Haptics.impactAsync(
      result === 'fail' ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light,
    );
    // Update locally first so a long list stays responsive.
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, result, testedAt: new Date().toISOString() } : r)));
    await setTestResult(row.id, result);
  };

  const addAllDevices = async () => {
    if (!report) return;
    setBusy(true);
    try {
      const points = await queryPoints({
        siteId: report.panelId ? undefined : report.siteId,
        panelId: report.panelId ?? undefined,
        includeUnused: false,
        limit: 20000,
      });
      if (!points.length) {
        Alert.alert('No devices', 'This site has no device list yet. Import one, or add points by hand first.');
        return;
      }
      const n = await addPointsToReport(report.id, points);
      Alert.alert('Added', `${n} device${n === 1 ? '' : 's'} added to the test sheet.`);
      void load();
    } finally {
      setBusy(false);
    }
  };

  const addRoutine = async (routine: ServiceRoutine) => {
    if (!report) return;
    const systemChecks = routine.tests.filter((x) => !x.assetTypeId);
    await addCheckRows(
      report.id,
      systemChecks.map((c, i) => ({
        section: c.section,
        label: c.label,
        result: 'untested' as const,
        unit: c.measurementUnit,
        sortIndex: checks.length + i,
      })),
    );
    void load();
  };

  /**
   * What is stopping this report going out.
   *
   * Catching it here is far cheaper than the office sending it back.
   */
  const readiness = useMemo(() => {
    const issues: string[] = [];
    if (!report) return issues;
    if (!report.technicianName?.trim()) issues.push('Technician name is blank');
    if (!report.serviceDate) issues.push('Service date is not set');
    const untested = rows.filter((r) => r.result === 'untested').length;
    if (untested) issues.push(`${untested} device${untested === 1 ? '' : 's'} not tested`);
    const uncheckedChecks = checks.filter((c) => c.result === 'untested').length;
    if (uncheckedChecks) issues.push(`${uncheckedChecks} panel check${uncheckedChecks === 1 ? '' : 's'} not completed`);
    const failsWithoutComment = rows.filter((r) => r.result === 'fail' && !r.comment?.trim()).length;
    if (failsWithoutComment) issues.push(`${failsWithoutComment} failure${failsWithoutComment === 1 ? '' : 's'} with no comment`);

    // The statutory record has its own required fields, and they are what an
    // inspector actually checks — a perfect test sheet without them still fails.
    const statutory: MaintenanceRecord = {
      installationDescription: panel ? `${panel.brand} ${panel.model ?? ''} — ${panel.name}`.trim() : (site?.name ?? ''),
      technicianName: report.technicianName ?? '',
      technicianLicenceNumber: report.technicianLicence ?? '',
      maintenanceDate: report.serviceDate,
      maintenanceDescription: report.title,
      qdcCompliance: qdcAffirmed,
      inProperWorkingOrder: workingOrder,
      correctiveActionRequired: defects.filter((d) => d.status === 'open').map((d) => d.description).join('; '),
      certificationSignature: report.signatureTechnician,
      hardcopyLeftOnSite: hardcopyLeft,
    };
    for (const issue of validateMaintenanceRecord(statutory)) {
      issues.push(`${issue.message} (${issue.legalRef})`);
    }

    return issues;
  }, [report, rows, checks, panel, site, defects, qdcAffirmed, workingOrder, hardcopyLeft]);

  const bundle = (): ReportBundle | null => {
    if (!report || !site) return null;
    return { site, report, panel: panel ?? undefined, testRows: rows, checkRows: checks, defects };
  };

  const exportPdf = async () => {
    const b = bundle();
    if (!b) return;
    setBusy(true);
    try {
      const html = serviceReportHtml(b, new Date().toISOString());
      const file = await writePdf(`${b.report.title} - ${b.site.name}`, html);
      await shareFile(file, 'Service report');
    } catch (e) {
      Alert.alert('Could not create the PDF', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const exportXlsx = async () => {
    const b = bundle();
    if (!b) return;
    setBusy(true);
    try {
      const file = writeXlsx(`${b.report.title} - ${b.site.name}`, [
        reportCoverSheet(b),
        testResultSheet(b.testRows),
        checkSheet(b.checkRows),
        defectSheet(b.defects),
      ]);
      await shareFile(file, 'Service report');
    } finally {
      setBusy(false);
    }
  };

  if (!report) return <Screen><Txt tone="muted">Loading…</Txt></Screen>;

  return (
    <>
      <Stack.Screen options={{ title: site?.name ?? 'Test sheet' }} />
      <Screen scroll={false} padded={false}>
        <View style={{ padding: t.space(4), gap: t.space(2.5) }}>
          <Rowed style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Txt weight="700" numberOfLines={1}>{report.title}</Txt>
              <Txt size="sm" tone="muted">{report.frequency} · {report.serviceDate}</Txt>
            </View>
            <Chip label={report.status === 'complete' ? 'Complete' : 'Draft'} tone={report.status === 'complete' ? 'pass' : 'warn'} />
          </Rowed>

          <View style={{ height: 8, borderRadius: 4, backgroundColor: t.color.surfaceAlt, overflow: 'hidden' }}>
            <View
              style={{
                width: `${progress.fraction * 100}%`,
                height: '100%',
                backgroundColor: progress.failed ? t.color.warn : t.color.pass,
              }}
            />
          </View>
          <Rowed gap={2} wrap>
            <Txt size="sm" tone="muted">{progress.tested} of {progress.total} tested</Txt>
            {progress.failed ? <Txt size="sm" tone="fail" weight="700">{progress.failed} failed</Txt> : null}
          </Rowed>

          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'devices', label: `Devices ${rows.length ? `(${rows.length})` : ''}` },
              { value: 'checks', label: `Checks ${checks.length ? `(${checks.length})` : ''}` },
              { value: 'sign', label: 'Finish' },
            ]}
          />
        </View>

        {tab === 'devices' ? (
          <>
            <View style={{ paddingHorizontal: t.space(4), paddingBottom: t.space(2) }}>
              {rows.length ? (
                <Rowed gap={2} wrap>
                  <Chip label="All" selected={filter === 'all'} onPress={() => setFilter('all')} />
                  <Chip label="Untested" selected={filter === 'untested'} onPress={() => setFilter('untested')} />
                  <Chip label="Failed" selected={filter === 'failed'} onPress={() => setFilter('failed')} tone="fail" />
                </Rowed>
              ) : (
                <Button title="Add every device to this sheet" onPress={addAllDevices} loading={busy} />
              )}
            </View>

            <FlatList
              data={shown}
              keyExtractor={(r) => r.id}
              contentContainerStyle={{ paddingHorizontal: t.space(4), paddingBottom: t.space(20) }}
              initialNumToRender={15}
              maxToRenderPerBatch={20}
              windowSize={11}
              removeClippedSubviews
              renderItem={({ item, index }) => <TestRowItem row={item} index={index} onMark={mark} />}
              ListEmptyComponent={
                rows.length ? (
                  <Txt tone="faint" style={{ padding: t.space(6), textAlign: 'center' }}>
                    Nothing matches this filter.
                  </Txt>
                ) : null
              }
            />
          </>
        ) : null}

        {tab === 'checks' ? (
          <ScrollView contentContainerStyle={{ padding: t.space(4), paddingTop: 0, gap: t.space(3), paddingBottom: t.space(20) }}>
            {!checks.length ? (
              <>
                <Txt tone="muted" size="sm" style={{ lineHeight: 20 }}>
                  Add a routine and its system-level checks come with it — what to do, what counts as a pass, and the defect
                  raised if it fails.
                </Txt>
                {SERVICE_ROUTINES.map((r) => (
                  <Card key={r.id} onPress={() => addRoutine(r)}>
                    <Txt weight="600">{r.label}</Txt>
                    <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{r.description}</Txt>
                    <Txt size="xs" tone="faint" style={{ marginTop: 4 }}>
                      {r.tests.length} checks · {r.sourceRef ?? 'Safe QLD procedure'}
                    </Txt>
                  </Card>
                ))}
              </>
            ) : (
              checks.map((c) => (
                <CheckRowItem
                  key={c.id}
                  row={c}
                  onChange={async (patch) => {
                    setChecks((prev) => prev.map((x) => (x.id === c.id ? { ...x, ...patch } : x)));
                    await updateCheckRow(c.id, patch);
                  }}
                />
              ))
            )}
          </ScrollView>
        ) : null}

        {tab === 'sign' ? (
          <ScrollView contentContainerStyle={{ padding: t.space(4), paddingTop: 0, gap: t.space(3), paddingBottom: t.space(20) }}>
            {readiness.length ? (
              <Banner
                tone="warn"
                title={`${readiness.length} thing${readiness.length === 1 ? '' : 's'} before this goes out`}
                body={readiness.join('\n')}
              />
            ) : (
              <Banner tone="pass" title="Ready to send" body="Everything the office asks for is filled in." />
            )}

            <Field
              label="Technician"
              value={report.technicianName ?? ''}
              onChangeText={(v) => { setReport({ ...report, technicianName: v }); void updateReport(report.id, { technicianName: v }); }}
              autoCapitalize="words"
            />
            <Field
              label="Licence number"
              value={report.technicianLicence ?? ''}
              onChangeText={(v) => { setReport({ ...report, technicianLicence: v }); void updateReport(report.id, { technicianLicence: v }); }}
              autoCapitalize="characters"
            />
            <Field
              label="Site representative"
              value={report.witnessName ?? ''}
              onChangeText={(v) => { setReport({ ...report, witnessName: v }); void updateReport(report.id, { witnessName: v }); }}
              autoCapitalize="words"
            />
            <Field
              label="Notes"
              value={report.notes ?? ''}
              onChangeText={(v) => { setReport({ ...report, notes: v }); void updateReport(report.id, { notes: v }); }}
              multiline
            />

            <H2>Queensland record of maintenance</H2>
            <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
              These are required by the Building Fire Safety Regulation, separately from the test results. They are what an
              inspector checks.
            </Txt>

            <Card>
              <YesNoRow
                label="Maintenance was carried out in compliance with QDC MP 6.1"
                value={qdcAffirmed}
                onChange={setQdcAffirmed}
              />
              <Divider />
              <TriRow
                label="Installation considered to be in proper working order"
                value={workingOrder}
                onChange={setWorkingOrder}
              />
              <Divider />
              <YesNoRow
                label="Hardcopy record left on site"
                value={hardcopyLeft}
                onChange={setHardcopyLeft}
              />
            </Card>

            <Card>
              <Label>Certification</Label>
              <Txt size="sm" style={{ marginTop: 6, lineHeight: 20 }}>{CERTIFICATION_STATEMENT}</Txt>
              <Txt size="xs" tone="faint" style={{ marginTop: 6, lineHeight: 17 }}>
                Signing below is a distinct legal element — recording your name does not satisfy it.
              </Txt>
            </Card>

            <SignaturePad
              label="Technician signature"
              value={report.signatureTechnician}
              onChange={(v) => { setReport({ ...report, signatureTechnician: v }); void updateReport(report.id, { signatureTechnician: v }); }}
            />
            <SignaturePad
              label="Site representative signature"
              value={report.signatureWitness}
              onChange={(v) => { setReport({ ...report, signatureWitness: v }); void updateReport(report.id, { signatureWitness: v }); }}
            />

            <Rowed gap={2}>
              <Button title="PDF" style={{ flex: 1 }} onPress={exportPdf} loading={busy} />
              <Button title="Spreadsheet" variant="secondary" style={{ flex: 1 }} onPress={exportXlsx} loading={busy} />
            </Rowed>

            <Button
              title={report.status === 'complete' ? 'Reopen as draft' : 'Mark complete'}
              variant="secondary"
              onPress={() => {
                const next = report.status === 'complete' ? 'draft' : 'complete';
                setReport({ ...report, status: next });
                void updateReport(report.id, { status: next });
              }}
            />
          </ScrollView>
        ) : null}
      </Screen>
    </>
  );
}

/** One device row. The three result buttons are the whole interaction. */
function TestRowItem({ row, index, onMark }: { row: TestRow; index: number; onMark: (row: TestRow, r: TestResult) => void }) {
  const t = useTheme();
  const address =
    row.loopNumber !== undefined && row.loopNumber !== null && row.address !== undefined && row.address !== null
      ? `L${row.loopNumber}.${String(row.address).padStart(3, '0')}`
      : (row.pointRef ?? String(row.address ?? '—'));

  const bg =
    row.result === 'pass' ? t.color.passBg
    : row.result === 'fail' ? t.color.failBg
    : row.result === 'na' ? t.color.warnBg
    : 'transparent';

  return (
    <View style={{ backgroundColor: bg, borderRadius: t.radius.md, marginBottom: t.space(1.5), padding: t.space(2.5) }}>
      <Rowed gap={2} align="flex-start">
        <Txt size="xs" tone="faint" mono style={{ minWidth: 28 }}>{index + 1}</Txt>
        <View style={{ flex: 1 }}>
          <Rowed gap={2}>
            <Txt mono size="sm" tone="accent" weight="700">{address}</Txt>
            <Txt weight="600" style={{ flex: 1 }} numberOfLines={1}>{row.deviceText || '(no text)'}</Txt>
          </Rowed>
          <Txt size="xs" tone="muted" numberOfLines={1}>
            {DEVICE_TYPE_LABEL[row.deviceType]}
            {row.zoneNumber !== undefined && row.zoneNumber !== null ? ` · Zone ${row.zoneNumber}` : ''}
            {row.zoneText ? ` — ${row.zoneText}` : ''}
          </Txt>
          {row.method || DEFAULT_TEST_METHOD[row.deviceType] ? (
            <Txt size="xs" tone="faint">{row.method ?? DEFAULT_TEST_METHOD[row.deviceType]}</Txt>
          ) : null}
          {row.comment ? <Txt size="xs" tone="warn" style={{ marginTop: 2 }}>{row.comment}</Txt> : null}
        </View>
      </Rowed>

      <Rowed gap={2} style={{ marginTop: t.space(2) }}>
        <ResultButton label="Pass" active={row.result === 'pass'} tone="pass" onPress={() => onMark(row, 'pass')} />
        <ResultButton label="Fail" active={row.result === 'fail'} tone="fail" onPress={() => onMark(row, 'fail')} />
        <ResultButton label="N/A" active={row.result === 'na'} tone="warn" onPress={() => onMark(row, 'na')} />
      </Rowed>
    </View>
  );
}

function ResultButton({ label, active, tone, onPress }: { label: string; active: boolean; tone: 'pass' | 'fail' | 'warn'; onPress: () => void }) {
  const t = useTheme();
  const colour = { pass: t.color.pass, fail: t.color.fail, warn: t.color.warn }[tone];
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: 44,
        borderRadius: t.radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? colour : t.color.surfaceAlt,
        borderWidth: 1,
        borderColor: active ? colour : t.color.border,
      }}
    >
      <Txt size="sm" weight="700" style={{ color: active ? '#fff' : t.color.textMuted }}>{label}</Txt>
    </Pressable>
  );
}

/** A plain yes/no affirmation, used where the regulation needs a positive answer. */
function YesNoRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={() => onChange(!value)} style={{ paddingVertical: t.space(2) }}>
      <Rowed gap={3}>
        <MaterialCommunityIcons
          name={value ? 'checkbox-marked' : 'checkbox-blank-outline'}
          size={24}
          color={value ? t.color.pass : t.color.textFaint}
        />
        <Txt style={{ flex: 1, lineHeight: 20 }} tone={value ? 'default' : 'muted'}>{label}</Txt>
      </Rowed>
    </Pressable>
  );
}

/** Three-state, because "not yet answered" is different from "no". */
function TriRow({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean) => void }) {
  const t = useTheme();
  return (
    <View style={{ paddingVertical: t.space(2), gap: t.space(2) }}>
      <Txt style={{ lineHeight: 20 }}>{label}</Txt>
      <Rowed gap={2}>
        <ResultButton label="Yes" active={value === true} tone="pass" onPress={() => onChange(true)} />
        <ResultButton label="No" active={value === false} tone="fail" onPress={() => onChange(false)} />
      </Rowed>
    </View>
  );
}

function CheckRowItem({ row, onChange }: { row: CheckRow; onChange: (patch: Partial<CheckRow>) => void }) {
  const t = useTheme();
  return (
    <Card>
      <Label>{row.section}</Label>
      <Txt weight="600" style={{ marginTop: 4, lineHeight: 20 }}>{row.label}</Txt>
      <Rowed gap={2} style={{ marginTop: t.space(2.5) }}>
        <ResultButton label="Pass" active={row.result === 'pass'} tone="pass" onPress={() => onChange({ result: 'pass' })} />
        <ResultButton label="Fail" active={row.result === 'fail'} tone="fail" onPress={() => onChange({ result: 'fail' })} />
        <ResultButton label="N/A" active={row.result === 'na'} tone="warn" onPress={() => onChange({ result: 'na' })} />
      </Rowed>
      {row.unit ? (
        <View style={{ marginTop: t.space(2.5) }}>
          <Field
            label="Measured"
            value={row.value ?? ''}
            onChangeText={(v) => onChange({ value: v })}
            keyboardType="decimal-pad"
            suffix={row.unit}
          />
        </View>
      ) : null}
      {row.result === 'fail' ? (
        <View style={{ marginTop: t.space(2.5) }}>
          <Field label="What failed" value={row.comment ?? ''} onChangeText={(v) => onChange({ comment: v })} multiline />
        </View>
      ) : null}
    </Card>
  );
}
