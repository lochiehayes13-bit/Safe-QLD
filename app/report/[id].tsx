import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  addAssetRowsToReport, addCheckRows, addPointsToReport, assetIdsOnReport, createDefect, getPanel, getReport,
  getSite, listCheckRows, listDefects, listTestRows, queryPoints, recordTestRowOnAsset, setTestResult,
  updateCheckRow, updateReport, updateTestRow,
} from '@/db/repo';
import { queryAssets, setTestSheetEventDetail, type AssetRecord } from '@/db/assetRepo';
import { getCustomer, listJobsFor, readJobJson, scheduledJobExternalIds } from '@/db/mirrorRepo';
import { queueDefectNote, type JobRecord } from '@/db/opsRepo';
import type { CheckRow, Defect, Panel, ServiceReport, Site, TestResult, TestRow } from '@/domain/types';
import { isServiceable, testRowsFromAssets } from '@/domain/formsFromAssets';
import { jobToOffer, type JobOffer } from '@/domain/reportJobMatch';
import { jobIsOpen } from '@/domain/jobPresentation';
import { qldIsoDay } from '@/domain/qldTime';
import { DEVICE_TYPE_LABEL, DEFAULT_TEST_METHOD } from '@/parsers/deviceType';
import { SERVICE_ROUTINES, type ServiceRoutine } from '@/seed/serviceRoutines';
import { assetTypeById, type SystemKind } from '@/seed/assetTypes';
import {
  SEVERITY_LABEL, defectsForSystem, searchDefects, type DefectCode,
} from '@/seed/defectLibrary';
import { checkSheet, defectSheet, reportCoverSheet, testResultSheet, type ReportBundle } from '@/export/sheets';
import { serviceReportHtml } from '@/export/pdf';
import { shareFile, writePdf, writeXlsx } from '@/export/files';
import { notSharedNotice } from '@/export/shareOutcome';
import { safeFileName } from '@/export/fileNames';
import { JobFileCard } from '@/components/JobFileCard';
import {
  CERTIFICATION_STATEMENT, validateMaintenanceRecord, type MaintenanceRecord,
} from '@/domain/qldCompliance';
import { loadPrefs } from '@/app-prefs';
import { nowIso } from '@/db';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, Field, H2, Label, Rowed, Screen, SearchBox, Segmented, Txt,
} from '@/components/ui';
import { RecordGate } from '@/components/RecordGate';
import { useRecordPatch } from '@/hooks/useRecordPatch';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { SignaturePad } from '@/components/SignaturePad';
import { showAlert } from '@/components/alert';

/**
 * Test sheet.
 *
 * Marking a device is one tap, because a sheet can run to hundreds of rows and
 * anything slower gets done on paper and typed up later — which is where
 * accuracy goes. Everything else is behind a tab so the list stays the screen.
 *
 * The rows come from wherever the site's equipment is. A site with a panel
 * configuration gets its loop devices from the points; every site the office
 * syncs gets its equipment from the asset register, which is where the three
 * thousand Simpro sites keep theirs. Until the register was read here, "add
 * every device" on one of those sites added nothing and the sheet stayed blank.
 *
 * A result marked against a register asset is written back onto it — the
 * same timeline event and last-result update a routine run makes — so the
 * register stays true to what was done on the sheet.
 */
type Tab = 'devices' | 'checks' | 'sign';

export default function ReportScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [report, setReport] = useState<ServiceReport | null>(null);
  // Loaded-and-absent is not the same as still loading. See RecordGate.
  const [missing, setMissing] = useState(false);
  // And a read that threw is neither. See RecordGate.
  const [failed, setFailed] = useState<string | null>(null);
  const [site, setSite] = useState<Site | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [rows, setRows] = useState<TestRow[]>([]);
  const [checks, setChecks] = useState<CheckRow[]>([]);
  const [defects, setDefects] = useState<Defect[]>([]);
  /** The site's register, which is what the sheet is built from on an office site. */
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  /** The office's jobs at this site, and which of them the sheet is offered. */
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [offer, setOffer] = useState<JobOffer>({});
  const [technician, setTechnician] = useState('');
  const [tab, setTab] = useState<Tab>('devices');
  const [filter, setFilter] = useState<'all' | 'untested' | 'failed'>('all');
  const [busy, setBusy] = useState(false);
  const [qdcAffirmed, setQdcAffirmed] = useState(false);
  const [workingOrder, setWorkingOrder] = useState<boolean | null>(null);
  const [hardcopyLeft, setHardcopyLeft] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setFailed(null);
    try {
      const found = await getReport(id);
      setMissing(!found);
      if (!found) { setReport(null); return; }
      const today = qldIsoDay(nowIso()) ?? '';
      const [s, p, tr, cr, df, prefs, siteAssets, siteJobs, onSchedule] = await Promise.all([
        getSite(found.siteId),
        found.panelId ? getPanel(found.panelId) : Promise.resolve(null),
        listTestRows(found.id),
        listCheckRows(found.id),
        listDefects(found.siteId),
        loadPrefs(),
        queryAssets({ siteId: found.siteId, limit: 5000 }),
        listJobsFor({ siteId: found.siteId, limit: 200 }),
        // Today's booked jobs, from the schedule and for anyone: the job
        // record's own date is the day the office issued it, not the booking.
        scheduledJobExternalIds({ from: today, to: today }),
      ]);

      /*
       * What the app already knows goes on the report before anybody types.
       *
       * The technician, licence and company are in Settings; the customer and
       * site contact are on the site the office synced. Every report used to
       * open with all of them blank and "Technician name is blank" at the top
       * of the readiness list, on a phone that knew the name. Blanks only: a
       * report somebody has edited keeps what they wrote.
       */
      const patch: Partial<ServiceReport> = {};
      if (!found.technicianName?.trim() && prefs.technicianName) patch.technicianName = prefs.technicianName;
      if (!found.technicianLicence?.trim() && prefs.technicianLicence) patch.technicianLicence = prefs.technicianLicence;
      if (!found.companyName?.trim() && prefs.companyName) patch.companyName = prefs.companyName;
      if (!found.customerName?.trim() && s?.clientName) patch.customerName = s.clientName;
      if (!found.siteContactName?.trim() && s?.contactName) {
        patch.siteContactName = s.contactName;
        if (!found.siteContactPhone?.trim()) patch.siteContactPhone = s.contactMobile ?? s.contactWorkPhone;
      }
      const r = { ...found, ...patch };
      if (Object.keys(patch).length) await updateReport(r.id, patch);

      setReport(r);
      // The record-of-maintenance answers live on the report now, not on the
      // screen: they used to vanish when the screen was left.
      setQdcAffirmed(r.qdcCompliance === true);
      setWorkingOrder(r.inProperWorkingOrder ?? null);
      setHardcopyLeft(r.hardcopyLeftOnSite === true);
      setSite(s); setPanel(p); setRows(tr); setChecks(cr); setDefects(df);
      setAssets(siteAssets);
      setJobs(siteJobs);
      setTechnician(r.technicianName ?? prefs.technicianName);
      setOffer(jobToOffer(siteJobs, { siteId: r.siteId, today, scheduledToday: new Set(onSchedule) }));
    } catch (e) {
      setFailed(describeLoadFailure(e, 'this service report'));
    }
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

  /** Register assets not yet on the sheet, so the button can say how many it would add. */
  const notOnSheet = useMemo(() => {
    const held = new Set(rows.map((r) => r.assetId).filter(Boolean));
    return assets.filter((a) => isServiceable(a) && !held.has(a.id)).length;
  }, [assets, rows]);

  /**
   * The Simpro job a defect raised on this sheet is reported against, and the
   * sentence that says so on screen.
   *
   * A defect marked here used to be written to the phone and stop there: no
   * note, no job, nothing the office could see — which on a sheet is the worst
   * place for it, because a test sheet is the one screen where a technician marks
   * twenty failures in a row and trusts the app to be doing something with them.
   *
   * `jobExternalId` is what is read and `jobNumber` deliberately is not. The type
   * says why in as many words: the number is free text for the customer's copy
   * and can hold a purchase order or a note to somebody, while
   * `jobExternalId` is Simpro's own id and is only ever set by picking a job off
   * the mirror's list — the same field the report's PDF is filed under. Putting a
   * defect on a job number somebody typed would be reporting a fault against
   * whatever that text happened to match.
   *
   * With no job picked, the one-open-job rule stands in, and only that: where the
   * office has two jobs open at a site nothing is chosen, because filing a fault
   * against the wrong attendance is worse than filing it against none. Every
   * branch below returns a sentence, including the ones that return no job, so
   * the card that raises the defect can say what will and will not reach the
   * office before the technician taps it.
   */
  const defectJob = useMemo<{ jobId?: string; why: string }>(() => {
    const open = jobs.filter((j) => j.externalId && jobIsOpen(j));
    const picked = report?.jobExternalId?.trim();
    if (picked) {
      const known = jobs.find((j) => j.externalId === picked);
      // Known to the mirror and closed off: the note would still post, but it
      // would land on work the office has finished or invoiced and nobody is
      // looking at it. Said rather than hidden, because the technician is the
      // only one who can tell whether the sheet is on the right job.
      const closed = known && !jobIsOpen(known);
      return {
        jobId: picked,
        why: closed
          ? `Defects raised here go on Simpro job ${picked}, the job this sheet is filed under — but the office has `
            + 'closed that job off, so a note on it may not be picked up. Change the job under Finish if this sheet '
            + 'belongs to a job that is still open.'
          : `Defects raised here go on Simpro job ${picked}, the job this sheet is filed under. Each one is queued as `
            + 'its own note and sent as soon as this phone has signal.',
      };
    }
    if (open.length === 1) {
      const only = open[0]!.externalId!;
      return {
        jobId: only,
        why: `Defects raised here go on Simpro job ${only} — the only job the office has open at this site. Pick the `
          + 'job under Finish if this sheet belongs to a different one.',
      };
    }
    if (open.length > 1) {
      return {
        why: `The office has ${open.length} jobs open at this site, so the app will not pick one: a fault filed `
          + 'against the wrong attendance is somebody else\'s work. Defects raised now stay on this phone. Pick the '
          + 'job under Finish and the ones you raise after that go up on it.',
      };
    }
    return {
      why: 'The office has no open job at this site, so there is nowhere in Simpro to put a defect raised here. It '
        + 'still goes on the site\'s defect list and onto the customer\'s report — ring it through, or ask the office '
        + 'to raise a job.',
    };
  }, [jobs, report]);

  /**
   * The row whose failure has not been written up yet.
   *
   * Marking a device FAIL on the sheet used to write the result and stop.
   * The site's defect list stayed empty, the customer's report printed a
   * failed device with no defect against it, and the office never saw the
   * work — while the routine run and the bulk test, doing the same thing,
   * both raised one. So the sheet asks, once, the moment the fail is marked.
   */
  const [raiseFor, setRaiseFor] = useState<TestRow | null>(null);
  const [raiseQuery, setRaiseQuery] = useState('');

  const mark = async (row: TestRow, result: TestResult) => {
    // A second tap on the result already marked is a glove, not a decision:
    // re-writing it would only move the row's tested time.
    if (row.result === result) return;
    void Haptics.impactAsync(
      result === 'fail' ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light,
    );
    const at = nowIso();
    // Update locally first so a long list stays responsive.
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, result, testedAt: at } : r)));
    await setTestResult(row.id, result);
    // A row from the register carries its result back to the register.
    if (row.assetId) await recordTestRowOnAsset(row, result, technician, at);
    if (result === 'fail') {
      setRaiseQuery('');
      setRaiseFor(row);
    }
  };

  /**
   * Raises the defect the failure means, from the library.
   *
   * The library's wording is what the customer's report prints and what the
   * office quotes from, so it is offered rather than typed. `reportId` is set
   * on the way in: it is what lets this visit's defects be told from the ones
   * that were already outstanding when the technician walked in.
   *
   * And the office is told, which until now it never was from this screen. The
   * note is queued rather than posted, so a sheet filled in inside a sprinkler
   * valve room with no signal costs a wait and not the defect. Nothing but the
   * note failing is said out loud: a sheet can raise twenty defects in a row and
   * twenty confirmations is a screen a technician taps through blind. What is
   * going to happen is stated on the card that raises it instead, before the tap.
   */
  const raiseDefect = async (row: TestRow, code: DefectCode) => {
    if (!report) return;
    const asset = row.assetId ? assets.find((a) => a.id === row.assetId) : undefined;
    try {
      const defect = await createDefect({
        siteId: report.siteId,
        reportId: report.id,
        pointId: row.assetId,
        // Simpro's own job id off the report, never the typed job number. See
        // defectJob above, and the warning on ServiceReport.jobExternalId.
        jobId: defectJob.jobId,
        location: asset
          ? [asset.level, asset.room, asset.name || assetTypeById(asset.assetTypeId)?.label].filter(Boolean).join(' ')
          : [row.zoneText, row.deviceText].filter(Boolean).join(' — ') || row.pointRef || 'Location not recorded',
        description: [code.reportWording, row.comment?.trim()].filter(Boolean).join(' '),
        severity: code.severity === 'critical' ? 'critical' : 'non-critical',
        priority: code.severity === 'critical' ? undefined : code.severity,
        defectCode: code.code,
        as1851Class: code.severity === 'critical' ? 'critical' : 'non-critical',
        status: 'open',
        photos: [],
      });
      setRaiseFor(null);
      if (defectJob.jobId) {
        try {
          await queueDefectNote(defect, defectJob.jobId, {
            siteName: site?.name,
            technician: technician.trim() || undefined,
            // What the technician was doing when they found it, in the words
            // already on the record rather than a phrase invented here.
            foundDuring: report.title,
            /*
             * The service date, not the moment the row was tapped. A critical
             * defect's two statutory clocks run from when the maintenance was
             * carried out, and a sheet is often finished the evening after the
             * attendance — dating the clocks from the tap would state a deadline
             * the regulation does not support. A date with no time in it is
             * handled honestly by the note itself: it states the rectification
             * day and leaves the 24-hour notice deadline unstated rather than
             * inventing an hour nobody recorded.
             */
            maintenanceAt: report.serviceDate,
            /*
             * The customer's job number is what the office files this report by,
             * so it is the reference that actually finds the full record from a
             * desk — the note's closing line reads "routine service report
             * <that number> for <site>". It is free text and could be anything,
             * which is
             * exactly why it is only ever used to point somebody at a document
             * and never, above, to decide which job a defect goes on.
             */
            reportRef: report.jobNumber?.trim() || undefined,
          });
        } catch (e) {
          // The defect is on the phone and on the customer's report either way.
          // This is the one thing worth interrupting for, because a technician
          // who is not told will assume the office is dealing with it.
          showAlert(
            'Defect raised, the office not told',
            `${describeActionFailure(e, `queue the note for job ${defectJob.jobId}`)}\n\n`
            + 'The defect is recorded on this phone and on the report. Ring the office about this one.',
          );
        }
      }
      await load();
    } catch (e) {
      showAlert('Defect not raised', describeActionFailure(e, 'raising the defect'));
    }
  };

  const comment = async (row: TestRow, text: string) => {
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, comment: text } : r)));
    await updateTestRow(row.id, { comment: text });
    // The reason is typed after the tap that wrote the asset's event, so it
    // follows the comment onto the timeline rather than staying blank there.
    if (row.assetId && row.result !== 'untested') await setTestSheetEventDetail(row.assetId, row.reportId, text);
  };

  /**
   * Every device the site has, onto the sheet.
   *
   * A panel report takes its panel's points and nothing else. A site report
   * takes the points of every panel on the site and then the register — less
   * the detection system where a panel configuration already listed it, so a
   * detector is not on the sheet twice and the coverage figure is not halved.
   * Assets already on the sheet are skipped, so this can be pressed again
   * after a sync brought new equipment.
   */
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
      const added: string[] = [];
      const panelRowsAlready = rows.some((r) => r.pointId && !r.assetId);
      if (points.length && !panelRowsAlready) {
        const n = await addPointsToReport(report.id, points);
        added.push(`${n} panel device${n === 1 ? '' : 's'}`);
      }
      if (!report.panelId) {
        const fromRegister = testRowsFromAssets(assets, {
          skipAssetIds: await assetIdsOnReport(report.id),
          skipSystems: points.length || panelRowsAlready ? new Set(['detection']) : undefined,
          firstSortIndex: rows.length + (points.length && !panelRowsAlready ? points.length : 0),
        });
        const n = await addAssetRowsToReport(report.id, fromRegister);
        if (n) added.push(`${n} asset${n === 1 ? '' : 's'} from the register`);
      }
      if (!added.length) {
        showAlert(
          'No devices',
          report.panelId
            ? (points.length
              ? 'Every point on this panel is already on the sheet.'
              : 'This panel has no points yet. Import its configuration first.')
            : assets.length
              ? 'Every asset in the register is already on this sheet.'
              : 'The register holds no equipment for this site and no panel configuration has been imported. '
                + 'Sync from Simpro, import a register, or add assets to the site first.',
        );
        return;
      }
      showAlert('Added', `${added.join(' and ')} added to the test sheet.`);
      void load();
    } catch (e) {
      showAlert('Could not add the devices', describeActionFailure(e, 'add the devices to this sheet'));
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

  /*
   * Writes land immediately and a failure is said out loud.
   *
   * This used to be `void updateReport(...)`: a write that threw landed
   * nowhere, the screen kept showing the value, and the report on the phone
   * did not have it. A record that quietly does not save is worse than one
   * that refuses to.
   */
  const applyReport = useRecordPatch<ServiceReport>({
    record: report,
    setRecord: setReport,
    write: (next, patch) => updateReport(next.id, patch),
    what: 'report',
    reload: load,
  });

  const patchReport = (patch: Partial<ServiceReport>) => {
    if (patch.technicianName !== undefined) setTechnician(patch.technicianName);
    void applyReport(patch);
  };

  /**
   * Takes the offered job, and with it what the office knows about the job.
   *
   * The customer on the job outranks the customer on the site: a body
   * corporate's building can be serviced under a managing agent's job, and it
   * is the job's customer who receives the report. The site contact on the
   * job is the person the office booked it with.
   *
   * But a name already on the report may be one the technician typed — the
   * person they actually met on site — and by now it cannot be told from the
   * one the site prefilled. So where the job would replace a name that is
   * there and different, the change is put to the technician first, and
   * "keep" takes the number alone.
   */
  const acceptJob = async () => {
    if (!report || !offer.jobNumber) return;
    const patch: Partial<ServiceReport> = { jobNumber: offer.jobNumber };
    const job = jobs.find((j) => j.id === offer.job?.id);
    if (job) {
      const contact = readJobJson(job).siteContact;
      if (contact?.name) {
        patch.siteContactName = contact.name;
        patch.siteContactPhone = contact.mobile ?? contact.workPhone ?? report.siteContactPhone;
      }
      const customer = job.customerExternalId ? await getCustomer(job.customerExternalId) : null;
      if (customer?.name) patch.customerName = customer.name;
      else if (job.customerName) patch.customerName = job.customerName;
    }

    const differs = (was: string | undefined, now: string | undefined): boolean =>
      Boolean(was?.trim()) && Boolean(now?.trim()) && was!.trim() !== now!.trim();
    const changes: string[] = [];
    if (differs(report.customerName, patch.customerName)) changes.push(`Customer: "${report.customerName}" to "${patch.customerName}"`);
    if (differs(report.siteContactName, patch.siteContactName)) {
      changes.push(`Site contact: "${report.siteContactName}" to "${patch.siteContactName}"`);
    } else if (differs(report.siteContactPhone, patch.siteContactPhone)) {
      changes.push(`Site contact phone: "${report.siteContactPhone}" to "${patch.siteContactPhone}"`);
    }
    if (!changes.length) { patchReport(patch); return; }

    showAlert(
      `Use job ${offer.jobNumber}`,
      `The job would change what is on the report:\n\n${changes.join('\n')}`,
      [
        {
          text: 'Keep what is typed',
          onPress: () => patchReport({ jobNumber: offer.jobNumber }),
        },
        { text: 'Take the job\'s', onPress: () => patchReport(patch) },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
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

  /** The PDF itself, so the share sheet and the job attachment cannot differ. */
  const reportPdf = async () => {
    const b = bundle();
    if (!b) throw new Error('The report is not loaded.');
    const html = serviceReportHtml(b, nowIso(), {
      qdcCompliance: qdcAffirmed,
      inProperWorkingOrder: workingOrder,
      hardcopyLeftOnSite: hardcopyLeft,
    });
    return writePdf(`${b.report.title} - ${b.site.name}`, html);
  };

  const exportPdf = async () => {
    const b = bundle();
    if (!b) return;
    setBusy(true);
    try {
      const file = await reportPdf();
      const shared = await shareFile(file, 'Service report');
      if (!shared) {
        const notice = notSharedNotice(file.name, 'report');
        showAlert(notice.title, notice.body);
      }
    } catch (e) {
      showAlert('Could not create the PDF', e instanceof Error ? e.message : String(e));
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
      const shared = await shareFile(file, 'Service report');
      if (!shared) {
        const notice = notSharedNotice(file.name, 'spreadsheet');
        showAlert(notice.title, notice.body);
      }
    } catch (e) {
      showAlert('Could not build the spreadsheet', describeActionFailure(e, 'build the spreadsheet'));
    } finally {
      setBusy(false);
    }
  };

  if (!report) return <RecordGate missing={missing} what="service report" failed={failed} onRetry={() => { void load(); }} />;

  const offered = offer.jobNumber && report.jobNumber?.trim() !== offer.jobNumber ? offer : null;

  return (
    <>
      <Stack.Screen options={{ title: site?.name ?? 'Test sheet' }} />
      <Screen scroll={false} padded={false}>
        <View style={{ padding: t.space(4), gap: t.space(2.5) }}>
          <Rowed style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Txt weight="700" numberOfLines={1}>{report.title}</Txt>
              <Txt size="sm" tone="muted">
                {report.frequency} · {report.serviceDate}
                {report.jobNumber ? ` · Job ${report.jobNumber}` : ''}
              </Txt>
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
            <View style={{ paddingHorizontal: t.space(4), paddingBottom: t.space(2), gap: t.space(2) }}>
              {rows.length ? (
                <Rowed gap={2} wrap>
                  <Chip label="All" selected={filter === 'all'} onPress={() => setFilter('all')} />
                  <Chip label="Untested" selected={filter === 'untested'} onPress={() => setFilter('untested')} />
                  <Chip label="Failed" selected={filter === 'failed'} onPress={() => setFilter('failed')} tone="fail" />
                  {notOnSheet && !report.panelId ? (
                    <Chip label={`+ ${notOnSheet} from the register`} tone="accent" onPress={() => void addAllDevices()} />
                  ) : null}
                </Rowed>
              ) : (
                <>
                  <Button title="Add every device to this sheet" onPress={addAllDevices} loading={busy} />
                  <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
                    {report.panelId
                      ? 'The points on this panel.'
                      : assets.length
                        ? `${assets.filter(isServiceable).length} assets in this site's register, grouped by system and in walk order`
                          + (panel ? ', plus the panel points' : '') + '.'
                        : 'This site has nothing in its asset register yet. Sync from Simpro or import a register first.'}
                  </Txt>
                </>
              )}
            </View>

            {raiseFor ? (
              <View style={{ paddingHorizontal: t.space(4), paddingBottom: t.space(2) }}>
                <Card>
                  <Label>Write up the failure</Label>
                  <Txt size="sm" tone="muted" style={{ marginTop: t.space(1), lineHeight: 19 }}>
                    {[raiseFor.zoneText, raiseFor.deviceText].filter(Boolean).join(' — ') || raiseFor.pointRef}
                  </Txt>
                  <Txt size="sm" tone="muted" style={{ marginTop: t.space(1), lineHeight: 19 }}>
                    A failed device with no defect against it does not reach the customer’s report, the site’s defect
                    list or the office.
                  </Txt>
                  {/*
                    * Where this one is going, said before it is raised rather
                    * than confirmed twenty times afterwards. Both answers are
                    * here — the job it lands on, or why it lands nowhere — so a
                    * technician marking a wall of failures is never left
                    * believing the office was told when it was not.
                    */}
                  <Txt
                    size="sm"
                    tone={defectJob.jobId ? 'muted' : 'warn'}
                    style={{ marginTop: t.space(1), lineHeight: 19 }}
                  >
                    {defectJob.why}
                  </Txt>
                  <SearchBox value={raiseQuery} onChange={setRaiseQuery} placeholder="battery, obstruction, no alarm" />
                  {defectChoices(raiseFor, assets, raiseQuery).map((c) => (
                    <Card key={c.code} onPress={() => { void raiseDefect(raiseFor, c); }}>
                      <Rowed align="flex-start">
                        <View style={{ flex: 1 }}>
                          <Txt size="sm" weight="600">{c.code}</Txt>
                          <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{c.reportWording}</Txt>
                        </View>
                        <Chip label={SEVERITY_LABEL[c.severity]} tone={c.severity === 'critical' ? 'fail' : 'warn'} />
                      </Rowed>
                    </Card>
                  ))}
                  <Button title="Not a defect — just record the fail" variant="ghost" onPress={() => setRaiseFor(null)} />
                </Card>
              </View>
            ) : null}

            <FlatList
              data={shown}
              keyExtractor={(r) => r.id}
              contentContainerStyle={{ paddingHorizontal: t.space(4), paddingBottom: t.space(20) }}
              initialNumToRender={15}
              maxToRenderPerBatch={20}
              windowSize={11}
              removeClippedSubviews
              keyboardShouldPersistTaps="handled"
              renderItem={({ item, index }) => (
                <TestRowItem row={item} index={index} onMark={mark} onComment={comment} />
              )}
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
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: t.space(4), paddingTop: 0, gap: t.space(3), paddingBottom: t.space(20) }}
          >
            {readiness.length ? (
              <Banner
                tone="warn"
                title={`${readiness.length} thing${readiness.length === 1 ? '' : 's'} before this goes out`}
                body={readiness.join('\n')}
              />
            ) : (
              <Banner tone="pass" title="Ready to send" body="Everything the office asks for is filled in." />
            )}

            <H2>Job</H2>
            {offered ? (
              <Card>
                <Txt weight="600">
                  Simpro job {offered.jobNumber}
                  {offered.job?.title ? ` — ${offered.job.title}` : ''}
                </Txt>
                <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
                  {offered.basis === 'today'
                    ? 'The one job on today\'s schedule at this site.'
                    : offered.scheduleKnown
                      ? 'Nothing on today\'s schedule is at this site; this is the only open job here.'
                      : 'The schedule has nothing for today, or has not synced yet; this is the only open job at the site.'}
                  {' '}Accepting it puts the number on the report and takes the customer and site contact from the job.
                </Txt>
                <Button title={`Use job ${offered.jobNumber}`} variant="secondary" compact onPress={() => void acceptJob()} />
              </Card>
            ) : null}
            <Field
              label="Customer job number"
              value={report.jobNumber ?? ''}
              onChangeText={(v) => patchReport({ jobNumber: v })}
              autoCapitalize="characters"
              hint={offer.reason ?? 'What the office files the report by.'}
            />
            <Field
              label="Customer"
              value={report.customerName ?? ''}
              onChangeText={(v) => patchReport({ customerName: v })}
              autoCapitalize="words"
            />
            <Rowed gap={2} align="flex-start">
              <View style={{ flex: 3 }}>
                <Field
                  label="Site contact"
                  value={report.siteContactName ?? ''}
                  onChangeText={(v) => patchReport({ siteContactName: v })}
                  autoCapitalize="words"
                />
              </View>
              <View style={{ flex: 2 }}>
                <Field
                  label="Phone"
                  value={report.siteContactPhone ?? ''}
                  onChangeText={(v) => patchReport({ siteContactPhone: v })}
                  keyboardType="default"
                />
              </View>
            </Rowed>

            <H2>Technician</H2>
            <Field
              label="Technician"
              value={report.technicianName ?? ''}
              onChangeText={(v) => patchReport({ technicianName: v })}
              autoCapitalize="words"
            />
            <Field
              label="Licence number"
              value={report.technicianLicence ?? ''}
              onChangeText={(v) => patchReport({ technicianLicence: v })}
              autoCapitalize="characters"
            />
            <Field
              label="Company"
              value={report.companyName ?? ''}
              onChangeText={(v) => patchReport({ companyName: v })}
              autoCapitalize="words"
            />
            <Field
              label="Site representative"
              value={report.witnessName ?? ''}
              onChangeText={(v) => patchReport({ witnessName: v })}
              autoCapitalize="words"
              hint="Who witnessed the work and signs below. Often the site contact, not always."
            />
            <Field
              label="Notes"
              value={report.notes ?? ''}
              onChangeText={(v) => patchReport({ notes: v })}
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
                onChange={(v) => { setQdcAffirmed(v); patchReport({ qdcCompliance: v }); }}
              />
              <Divider />
              <TriRow
                label="Installation considered to be in proper working order"
                value={workingOrder}
                onChange={(v) => { setWorkingOrder(v); patchReport({ inProperWorkingOrder: v ?? undefined }); }}
              />
              <Divider />
              <YesNoRow
                label="Hardcopy record left on site"
                value={hardcopyLeft}
                onChange={(v) => { setHardcopyLeft(v); patchReport({ hardcopyLeftOnSite: v }); }}
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
              onChange={(v) => patchReport({ signatureTechnician: v })}
            />
            <SignaturePad
              label="Site representative signature"
              value={report.signatureWitness}
              onChange={(v) => patchReport({ signatureWitness: v })}
            />

            <Rowed gap={2}>
              <Button title="PDF" style={{ flex: 1 }} onPress={exportPdf} loading={busy} />
              <Button title="Spreadsheet" variant="secondary" style={{ flex: 1 }} onPress={exportXlsx} loading={busy} />
            </Rowed>

            {/*
              The report is the record produced on every single service, and
              until this card existed it had no way of reaching Simpro at all:
              it stayed on the phone that made it unless somebody emailed it to
              themselves. It goes on the job as an attachment, never as a note.
            */}
            <JobFileCard
              siteId={report.siteId}
              jobExternalId={report.jobExternalId}
              jobTitle={report.jobTitle}
              attachedAt={report.attachedAt}
              what="service report"
              filename={`${safeFileName(`${report.title} ${site?.name ?? ''}`.trim(), 'service-report')}.pdf`}
              subject={`${report.title}${site ? ` — ${site.name}` : ''}`}
              buildFile={reportPdf}
              onPickJob={(job: { externalId: string; title?: string } | null) => patchReport({ jobExternalId: job?.externalId, jobTitle: job?.title })}
              onAttached={(at: string | undefined) => patchReport({ attachedAt: at })}
              disabled={report.status !== 'complete'}
              disabledWhy="Mark the report complete first. A draft on the job file reads as the finished record of a service."
            />

            {/*
              * The same sentence the raise card shows, here beside the picker
              * that decides it. The job on this card is not only where the PDF
              * is filed any more — it is the job every defect marked on this
              * sheet is reported against, and somebody choosing it should be
              * told that while they are choosing.
              */}
            <Txt size="sm" tone={defectJob.jobId ? 'muted' : 'warn'} style={{ lineHeight: 19 }}>
              {defectJob.why}
            </Txt>

            <Button
              title={report.status === 'complete' ? 'Reopen as draft' : 'Mark complete'}
              variant="secondary"
              onPress={() => {
                const next = report.status === 'complete' ? 'draft' : 'complete';
                const commit = () => patchReport({ status: next });
                // Complete is what the office reads as "ready to send", so it
                // is not flipped over the top of the list of things that are
                // not. The list is repeated here because the banner is a
                // screen's length above the button.
                if (next === 'complete' && readiness.length) {
                  showAlert(
                    `${readiness.length} thing${readiness.length === 1 ? '' : 's'} before this goes out`,
                    readiness.join('\n'),
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Complete anyway', style: 'destructive', onPress: commit },
                    ],
                  );
                  return;
                }
                commit();
              }}
            />
          </ScrollView>
        ) : null}
      </Screen>
    </>
  );
}

/**
 * One device row. The three result buttons are the whole interaction.
 *
 * A failure asks what failed, on the row, because the readiness check refuses
 * a failure with no comment and there was nowhere on this screen to write
 * one — the sheet asked for something it gave no way to supply.
 */
/**
 * The defect codes worth offering for a failed row.
 *
 * Narrowed to the system the device belongs to where the row came from the
 * register, because a hydrant code on a smoke detector is noise. A typed
 * search searches the whole library, since the narrowing is a convenience and
 * not a rule.
 */
function defectChoices(row: TestRow, assets: AssetRecord[], query: string): DefectCode[] {
  if (query.trim()) return searchDefects(query).slice(0, 8);
  const asset = row.assetId ? assets.find((a) => a.id === row.assetId) : undefined;
  const system = asset ? assetTypeById(asset.assetTypeId)?.system : undefined;
  const narrowed = system ? defectsForSystem(system as SystemKind) : [];
  return (narrowed.length ? narrowed : searchDefects('')).slice(0, 8);
}

function TestRowItem({
  row, index, onMark, onComment,
}: {
  row: TestRow;
  index: number;
  onMark: (row: TestRow, r: TestResult) => void;
  onComment: (row: TestRow, text: string) => void;
}) {
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

  // A register row's zone text is its system heading; a panel row's is the
  // zone it reports to. Either reads as "where this belongs".
  const type = row.assetType ?? DEVICE_TYPE_LABEL[row.deviceType];
  const method = row.method ?? DEFAULT_TEST_METHOD[row.deviceType];

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
            {type}
            {row.zoneNumber !== undefined && row.zoneNumber !== null ? ` · Zone ${row.zoneNumber}` : ''}
            {row.zoneText ? ` — ${row.zoneText}` : ''}
          </Txt>
          {method ? <Txt size="xs" tone="faint">{method}</Txt> : null}
        </View>
      </Rowed>

      <Rowed gap={2} style={{ marginTop: t.space(2) }}>
        <ResultButton label="Pass" active={row.result === 'pass'} tone="pass" onPress={() => onMark(row, 'pass')} />
        <ResultButton label="Fail" active={row.result === 'fail'} tone="fail" onPress={() => onMark(row, 'fail')} />
        <ResultButton label="N/A" active={row.result === 'na'} tone="warn" onPress={() => onMark(row, 'na')} />
      </Rowed>

      {row.result === 'fail' || row.result === 'na' || row.comment ? (
        <View style={{ marginTop: t.space(2) }}>
          <Field
            label={row.result === 'fail' ? 'What failed' : 'Comment'}
            value={row.comment ?? ''}
            onChangeText={(v) => onComment(row, v)}
            placeholder={row.result === 'na' ? 'Why it does not apply' : undefined}
          />
        </View>
      ) : null}
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
      <Txt size="sm" weight="700" style={{ color: active ? t.color.onAccent : t.color.textMuted }}>{label}</Txt>
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
