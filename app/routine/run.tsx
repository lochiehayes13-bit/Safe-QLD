import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { addAssetEvent, queryAssets, updateAsset, type AssetRecord } from '@/db/assetRepo';
import { createDefect, getSite } from '@/db/repo';
import { listJobsFor } from '@/db/mirrorRepo';
import { queueDefectNote } from '@/db/opsRepo';
import { recordRoutineRun } from '@/db/routineRunRepo';
import { defectByCode } from '@/seed/defectLibrary';
import {
  FREQUENCY_LABEL, SERVICE_ROUTINES, SOURCE_LABEL, routineById,
  type ServiceRoutine, type TestDef,
} from '@/seed/serviceRoutines';
import { SYSTEM_LABELS, assetTypeById } from '@/seed/assetTypes';
import type { Defect, Site } from '@/domain/types';
import { jobIsOpen } from '@/domain/jobPresentation';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { loadPrefs } from '@/app-prefs';
import { nowIso } from '@/db';
import { useDraft } from '@/hooks/useDraft';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, EmptyState, Field, H2, Label, Rowed, Screen, Txt,
} from '@/components/ui';
import { ContextGate } from '@/components/ContextGate';
import { contextId } from '@/domain/screenContext';
import { showAlert } from '@/components/alert';

/**
 * Running a service routine against a site's assets.
 *
 * This is what turns the routine definitions from a reference into work. The
 * technician picks a routine, the app finds the assets it applies to, and each
 * check is answered per asset. A failure raises its coded defect automatically
 * and writes the result onto the asset's timeline, so the history builds itself.
 *
 * "Not tested" is a distinct answer from "fail". Inaccessible devices are the
 * dominant real-world outcome on an annual, and treating them as a pass hides a
 * coverage gap while treating them as a failure invents a defect that is not
 * there.
 *
 * The assets are a list that narrows as you type, and the whole screen is that
 * list. A site with three hundred extinguishers is the normal case, not the
 * edge, and a horizontal strip of three hundred chips is a strip nobody can
 * find anything on. Tapping an asset opens its checks underneath it, so the
 * thing being answered stays on screen next to the thing it is about.
 */
type Verdict = 'pass' | 'fail' | 'na' | 'not-tested';

interface Answer {
  verdict: Verdict;
  comment?: string;
  measurement?: string;
  /** Why it could not be tested — required when the verdict is not-tested. */
  reason?: string;
}

/**
 * What the mirror said about the site's open jobs, with the site it was asked about.
 *
 * Kept together so "the office has no open job here" can be told from "nobody
 * has asked yet". Both look like an empty list, and only one of them is a fact.
 */
interface JobsAtSite {
  siteId: string;
  open: { externalId: string; title?: string }[];
  failed?: string;
}

const NOT_TESTED_REASONS = [
  'No access to the area',
  'Access equipment required',
  'Tenant refused entry',
  'Device could not be located',
  'Isolated for other works',
  'Unsafe to test',
];

/** The words a technician might type to find an asset. */
function searchText(a: AssetRecord): string {
  return [a.name, a.code, a.level, a.room, a.locationNote, a.serial, assetTypeById(a.assetTypeId)?.label]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export default function RunRoutineScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ siteId?: string; routineId?: string }>();
  // `contextId` rather than the raw parameter: several screens push
  // `siteId: siteId ?? ''`, so "no site" arrives here as an empty string.
  const siteId = contextId(params.siteId);
  const [site, setSite] = useState<Site | null>(null);
  const [routine, setRoutine] = useState<ServiceRoutine | null>(
    params.routineId ? (routineById(params.routineId) ?? null) : null,
  );
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [activeAsset, setActiveAsset] = useState<string>();
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const draft = useDraft<Record<string, Answer>>(
    `routine:${siteId ?? 'x'}:${routine?.id ?? 'x'}`,
    {},
  );

  useEffect(() => {
    if (siteId) void getSite(siteId).then(setSite);
  }, [siteId]);

  /**
   * The office's open jobs at this site, read for the defects this run raises.
   *
   * There is no job picker on this screen and there is deliberately not one now:
   * a routine run is a walk answered check by check, and interrupting it to ask
   * which Simpro job it belongs to is a question the technician already answered
   * by being here. But the defects a run raises have to reach the office, and
   * until this read existed they reached nothing — `recordRoutineRun` files the
   * run on the phone and the defects went onto the site's list with no job on
   * them at all.
   *
   * `jobForRun` looks like the answer and is not, which is worth writing down so
   * nobody spends an afternoon on it again. It reads `outbound_job_link` by run
   * id, and that link is written by the send screen once somebody picks a job for
   * a run that has already been recorded. At the moment a defect is raised here
   * the run does not exist yet, so there is no id to look up and nothing to find.
   * The site's own open jobs are what this screen can honestly know.
   */
  const [jobsAtSite, setJobsAtSite] = useState<JobsAtSite | null>(null);

  useEffect(() => {
    if (!siteId) return;
    let cancelled = false;
    const forSite = siteId;
    void listJobsFor({ siteId: forSite, limit: 50 })
      .then((rows) => {
        if (cancelled) return;
        setJobsAtSite({
          siteId: forSite,
          open: rows
            .filter((j) => j.externalId && jobIsOpen(j))
            .map((j) => ({ externalId: j.externalId!, title: j.title })),
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setJobsAtSite({ siteId: forSite, open: [], failed: describeLoadFailure(e, "the office's jobs at this site") });
      });
    return () => { cancelled = true; };
  }, [siteId]);

  const jobsHere = jobsAtSite && jobsAtSite.siteId === siteId ? jobsAtSite : null;
  /**
   * The job this run's defects are reported against, or undefined for nowhere.
   *
   * Exactly one open job, or nothing. Two open jobs at a site is the case where
   * guessing does real harm — a fault filed against the wrong attendance is
   * somebody else's work, and the office quotes and invoices off it — so the app
   * declines to choose and the footer says it declined. That limit is stated on
   * screen for the same reason it exists: a technician must never leave a site
   * believing the office was told when it was not.
   */
  const officeJob = jobsHere?.open.length === 1 ? jobsHere.open[0]!.externalId : undefined;

  const load = useCallback(async () => {
    if (!routine || !siteId) return;
    setAssets(await queryAssets({ siteId, system: routine.system, limit: 2000 }));
  }, [routine, siteId]);

  useEffect(() => { void load(); }, [load]);

  const answer = (key: string, patch: Partial<Answer>) =>
    draft.setValue((p) => ({ ...p, [key]: { verdict: 'not-tested', ...p[key], ...patch } }));

  const systemChecks = useMemo(() => routine?.tests.filter((x) => !x.assetTypeId) ?? [], [routine]);
  const assetChecks = useMemo(() => routine?.tests.filter((x) => x.assetTypeId) ?? [], [routine]);

  /*
   * The assets this routine has checks for. A site's extinguishers and its
   * hose reels share a system, and a routine written for one has nothing to
   * ask about the other — listing it would be a row that can never be answered.
   */
  const applicable = useMemo(
    () => assets.filter((a) => assetChecks.some((c) => c.assetTypeId === a.assetTypeId)),
    [assets, assetChecks],
  );

  const progress = useMemo(() => {
    if (!routine) return { done: 0, total: 0, failed: 0, gaps: 0 };
    let total = 0;
    let done = 0;
    let failed = 0;
    // A check that could not be carried out, with the reason given. Not a
    // result, but not nothing either: it is what makes the run recordable
    // when every device was behind a locked door.
    let gaps = 0;
    const tally = (a: Answer | undefined) => {
      total++;
      if (a && a.verdict !== 'not-tested') done++;
      else if (a?.verdict === 'not-tested' && a.reason) gaps++;
      if (a?.verdict === 'fail') failed++;
    };
    // System-level checks are answered once; asset checks once per asset.
    for (const test of routine.tests) {
      if (!test.assetTypeId) {
        tally(draft.value[test.id]);
      } else {
        for (const asset of assets.filter((x) => x.assetTypeId === test.assetTypeId)) {
          tally(draft.value[`${test.id}:${asset.id}`]);
        }
      }
    }
    return { done, total, failed, gaps };
  }, [routine, assets, draft.value]);

  /** Nothing answered and nothing explained: the run is empty. */
  const nothingAnswered = progress.done + progress.gaps === 0;
  /** Checks with no answer at all, which the record will show as a gap. */
  const blank = progress.total - progress.done - progress.gaps;

  /** Whether every check on an asset has an answer. */
  const answered = useCallback((a: AssetRecord) => {
    const checks = assetChecks.filter((c) => c.assetTypeId === a.assetTypeId);
    return checks.length > 0 && checks.every((c) => {
      const v = draft.value[`${c.id}:${a.id}`]?.verdict;
      return v !== undefined && v !== 'not-tested';
    });
  }, [assetChecks, draft.value]);

  const answeredCount = useMemo(() => applicable.filter(answered).length, [applicable, answered]);

  const shownAssets = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return applicable;
    return applicable.filter((a) => searchText(a).includes(q));
  }, [applicable, search]);

  const record = async () => {
    if (!routine || !site) return;
    setSaving(true);
    try {
      const prefs = await loadPrefs();
      const now = nowIso();
      let defectsRaised = 0;
      let recorded = 0;
      let gaps = 0;
      let passed = 0;
      let failed = 0;
      /*
       * The defects this run raises, kept so each one can be reported to the
       * office once the run itself is on the phone. Nothing is queued inside the
       * loop: a queue that will not write must not stop the run being recorded,
       * and a run recorded is what stops the schedule asking for it again.
       */
      const raised: Defect[] = [];

      for (const test of routine.tests) {
        const targets = test.assetTypeId
          ? assets.filter((a) => a.assetTypeId === test.assetTypeId)
          : [null];

        for (const asset of targets) {
          const key = asset ? `${test.id}:${asset.id}` : test.id;
          const a = draft.value[key];
          if (!a) continue;

          // A check that could not be carried out is still part of the record.
          // It is written with its reason so the gap is visible and defensible
          // later, but it does not touch lastServicedAt — nothing was serviced.
          if (a.verdict === 'not-tested') {
            if (!a.reason) continue;
            if (asset) {
              await addAssetEvent({
                assetId: asset.id,
                kind: 'not-tested',
                occurredAt: now,
                technician: prefs.technicianName || undefined,
                summary: `${test.label} — not tested: ${a.reason}`,
                detail: a.comment,
                measurements: {},
              });
            }
            gaps++;
            continue;
          }

          if (asset) {
            await addAssetEvent({
              assetId: asset.id,
              kind: a.verdict === 'fail' ? 'failed' : a.verdict === 'pass' ? 'passed' : 'tested',
              occurredAt: now,
              technician: prefs.technicianName || undefined,
              summary: `${test.label} — ${a.verdict === 'fail' ? 'failed' : a.verdict === 'pass' ? 'passed' : 'not applicable'}`,
              detail: a.comment,
              measurements: a.measurement && test.measurementKey ? { [test.measurementKey]: a.measurement } : {},
            });
            await updateAsset(asset.id, {
              lastServicedAt: now,
              lastResult: a.verdict === 'fail' ? 'fail' : 'pass',
            });
            recorded++;
          }
          if (a.verdict === 'fail') failed++;
          else if (a.verdict === 'pass') passed++;

          // A failed check raises its coded defect, so nothing depends on the
          // technician remembering to write one afterwards.
          if (a.verdict === 'fail' && test.defectCode) {
            const code = defectByCode(test.defectCode);
            if (code) {
              raised.push(await createDefect({
                siteId: site.id,
                pointId: asset?.id,
                // The office's job on the row, where the site has exactly one
                // open. It is what carries the defect out of this phone, and what
                // every later screen reads to answer "where did this one go?".
                jobId: officeJob,
                location: asset
                  ? [asset.level, asset.room, asset.name || assetTypeById(asset.assetTypeId)?.label].filter(Boolean).join(' ')
                  : site.name,
                description: [code.reportWording, a.comment?.trim()].filter(Boolean).join(' '),
                severity: code.severity === 'critical' ? 'critical' : 'non-critical',
                // The library rates every code; keeping the grade is what lets
                // the worst of the non-critical work sort to the top.
                priority: code.severity === 'critical' ? undefined : code.severity,
                status: 'open',
                photos: [],
                notes: `${code.code} · raised from ${routine.label}, ${test.label}`,
                // The code it was raised from, kept as a field rather than only
                // in the note, so the quote and the parts list can find it. The
                // library's rating stands in for the AS 1851 class until the
                // notice screen asks the question properly.
                defectCode: code.code,
                as1851Class: code.severity === 'critical' ? 'critical' : 'non-critical',
              }));
              defectsRaised++;
            }
          }
        }
      }

      // Recorded even when every check was a pass: the run itself is what the
      // schedule counts, and a routine carried out but not recorded is one the
      // app will keep reporting as due.
      await recordRoutineRun({
        siteId: site.id,
        routineId: routine.id,
        routineLabel: routine.label,
        frequency: routine.frequency,
        system: routine.system,
        completedAt: now,
        technician: prefs.technicianName || undefined,
        checksPassed: passed,
        checksFailed: failed,
        checksNotTested: gaps,
        defectsRaised,
      });

      /*
       * Each defect to the office, after the run is safely recorded.
       *
       * Queued, never posted: a plant room in a basement is where most of these
       * are raised, and the queue survives the app closing and goes up the moment
       * there is signal. One note per defect rather than one per run, because a
       * paragraph listing three failures is not three pieces of work a scheduler
       * can book, quote or invoice.
       *
       * This is in addition to the run's own record on the send screen, not
       * instead of it — that screen carries the service record, the coverage gaps
       * and the statutory critical defect notices, and it lets the technician pick
       * any job rather than only an unambiguous one. What it does not do is go
       * without somebody remembering to open it, which is why a defect raised here
       * is told now. The consequence is stated in the summary below so nobody is
       * surprised by it: a critical defect gets this note now and its written
       * notice later, and the two are not the same document.
       */
      let notesQueued = 0;
      let notesAlready = 0;
      let noteFailure: string | undefined;
      if (officeJob) {
        for (const defect of raised) {
          try {
            const note = await queueDefectNote(defect, officeJob, {
              siteName: site.name,
              technician: prefs.technicianName || undefined,
              foundDuring: routine.label,
              // The instant the routine was carried out, and the same one for
              // every defect in the run. A critical defect's statutory clocks run
              // from the maintenance, and the instant sits in the note's key — so
              // one instant for the whole run is also what stops a defect
              // re-composed later stating a different deadline and posting twice.
              maintenanceAt: now,
            });
            if (note.queued) notesQueued++; else notesAlready++;
          } catch (e) {
            noteFailure ??= describeActionFailure(e, 'queue the defect notes to the office');
          }
        }
      }
      const notesFailed = raised.length - notesQueued - notesAlready;

      await draft.discard();
      showAlert(
        'Routine recorded',
        [
          `${recorded} asset result${recorded === 1 ? '' : 's'} written to history.`,
          defectsRaised ? `${defectsRaised} defect${defectsRaised === 1 ? '' : 's'} raised automatically.` : null,
          notesQueued
            ? `${notesQueued} of them queued as ${notesQueued === 1 ? 'a note' : 'notes'} on job ${officeJob}, `
              + 'going up with the next send. A critical defect still needs its written notice, which goes with the '
              + 'run\'s record on the Send screen.'
            : null,
          notesAlready
            ? `${notesAlready} ${notesAlready === 1 ? 'was' : 'were'} already on job ${officeJob} word for word, so `
              + `${notesAlready === 1 ? 'it was' : 'they were'} not sent twice.`
            : null,
          // Counted rather than assumed: a defect that failed to queue and one
          // raised with no job are different states and a technician needs the
          // difference. Both say the office has not got it.
          officeJob && notesFailed
            ? `${notesFailed} could not be queued, so the office has not been told about `
              + `${notesFailed === 1 ? 'it' : 'them'}. ${noteFailure ?? ''} Ring them through.`
            : null,
          !officeJob && raised.length
            ? `The office has not been told about ${raised.length === 1 ? 'it' : 'them'}: `
              + `${jobsHere?.failed
                ? 'this site\'s jobs could not be read on this phone'
                : jobsHere?.open.length
                  ? `the office has ${jobsHere.open.length} jobs open at this site and the app will not guess which `
                    + 'one this run belongs to'
                  : 'the office has no open job at this site'}`
              + '. Send the run from the Send screen and pick the job there, or ring the failures through.'
            : null,
          gaps ? `${gaps} check${gaps === 1 ? '' : 's'} recorded as not tested, with the reason against the asset.` : null,
          progress.total - progress.done - gaps > 0
            ? `${progress.total - progress.done - gaps} check${progress.total - progress.done - gaps === 1 ? '' : 's'} left blank — these show as a coverage gap, not a pass.`
            : null,
        ].filter(Boolean).join('\n\n'),
      );
      router.back();
    } catch (e) {
      showAlert('Could not record', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  /**
   * The gate in front of the record.
   *
   * Recording a run is what the schedule counts, so a run with nothing on it
   * would stamp the routine as done and push its next due date out on the
   * strength of a screen nobody touched. And a run with checks left blank is
   * legitimate — a locked riser is a locked riser — but the number of blanks
   * is put in front of the technician before it becomes the record.
   */
  const finish = () => {
    if (!routine || !site || nothingAnswered) return;
    if (blank > 0) {
      showAlert(
        `${blank} check${blank === 1 ? ' has' : 's have'} no answer`,
        `${blank === 1 ? 'It' : 'They'} will be recorded as a coverage gap, not as a pass. Record the routine anyway?`,
        [
          { text: 'Go back', style: 'cancel' },
          { text: 'Record', onPress: () => void record() },
        ],
      );
      return;
    }
    void record();
  };

  /*
   * A routine is recorded against a site, and `record()` returned silently when
   * there was not one — so opened from search rather than from a site, this
   * screen let a whole annual be answered and then did nothing at all when
   * "Record this routine" was pressed. Nothing was saved and nothing was said.
   */
  if (!siteId) return <ContextGate kind="site" what="a service routine run against its assets" title="Run a routine" backTo="/routine/run" />;

  if (!routine) {
    return (
      <>
        <Stack.Screen options={{ title: 'Run a routine' }} />
        <Screen>
          <Txt tone="muted" size="sm" style={{ lineHeight: 20 }}>
            Pick the routine you are carrying out. The app finds the assets it applies to and records the results against
            each one.
          </Txt>
          {SERVICE_ROUTINES.map((r) => (
            <Card key={r.id} onPress={() => setRoutine(r)}>
              <Rowed align="flex-start">
                <View style={{ flex: 1 }}>
                  <Txt weight="700">{r.label}</Txt>
                  <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{r.description}</Txt>
                </View>
                <Chip label={FREQUENCY_LABEL[r.frequency]} />
              </Rowed>
            </Card>
          ))}
        </Screen>
      </>
    );
  }

  const header = (
    <View style={{ gap: t.space(3) }}>
      <Card>
        <Rowed style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Txt weight="700">{site?.name ?? 'Site'}</Txt>
            <Txt size="sm" tone="muted">{SYSTEM_LABELS[routine.system]} · {FREQUENCY_LABEL[routine.frequency]}</Txt>
          </View>
          <Chip
            label={`${progress.done}/${progress.total}`}
            tone={progress.failed ? 'fail' : progress.done === progress.total && progress.total > 0 ? 'pass' : 'default'}
          />
        </Rowed>
        <View style={{ height: 8, borderRadius: 4, backgroundColor: t.color.surfaceAlt, marginTop: t.space(2), overflow: 'hidden' }}>
          <View
            style={{
              width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
              height: '100%',
              backgroundColor: progress.failed ? t.color.warn : t.color.pass,
            }}
          />
        </View>
      </Card>

      {draft.recovered ? (
        <Banner tone="info" title="Picked up where you left off" body="Answers from your last session were still here." />
      ) : null}

      {/*
        * Where this run's failures will go, said before the walk rather than
        * after it. There is no picker here on purpose — see officeJob — so the
        * one thing this card owes the technician is the truth about what the app
        * can and cannot do with a defect, while there is still time to do
        * something about it.
        */}
      {jobsHere ? (
        <Card>
          <Label>Defects to the office</Label>
          {jobsHere.failed ? (
            <Txt size="sm" tone="warn" style={{ marginTop: 4, lineHeight: 19 }}>
              {jobsHere.failed} Until they can be read, a failure here records on the phone and goes no further. Send
              the run from the Send screen afterwards and pick the job there.
            </Txt>
          ) : officeJob ? (
            <Txt size="sm" style={{ marginTop: 4, lineHeight: 19 }}>
              Each failure raises its coded defect and is queued as its own note on job {officeJob} — the only job the
              office has open at this site. A critical defect still needs its written notice, which goes with the run’s
              record on the Send screen.
            </Txt>
          ) : jobsHere.open.length ? (
            <Txt size="sm" tone="warn" style={{ marginTop: 4, lineHeight: 19 }}>
              The office has {jobsHere.open.length} jobs open at this site, and filing a fault against the wrong one
              makes it somebody else’s work — so nothing is chosen here. Failures still raise their defects on the
              phone. Send the run from the Send screen afterwards and pick the job there.
            </Txt>
          ) : (
            <Txt size="sm" tone="warn" style={{ marginTop: 4, lineHeight: 19 }}>
              The office has no open job at this site, so there is nowhere in Simpro for a defect raised here to go.
              Failures still record on the phone and on the site’s defect list — ring them through, or ask the office to
              raise a job.
            </Txt>
          )}
        </Card>
      ) : null}

      {systemChecks.length ? (
        <>
          <H2>System checks</H2>
          {systemChecks.map((test) => (
            <CheckCard
              key={test.id}
              test={test}
              answer={draft.value[test.id]}
              onAnswer={(patch) => answer(test.id, patch)}
            />
          ))}
        </>
      ) : null}

      {assetChecks.length ? (
        <>
          <H2>Assets</H2>
          {!applicable.length ? (
            <EmptyState
          icon="format-list-checks"
              title="No assets for this system yet"
              body="Add them to the site's register first, or import a device list. System checks above can still be recorded."
            />
          ) : (
            <>
              <Rowed style={{ justifyContent: 'space-between' }}>
                <Txt size="sm" tone="muted">{answeredCount} of {applicable.length} answered</Txt>
                <Chip
                  label={answeredCount === applicable.length ? 'All answered' : `${applicable.length - answeredCount} to go`}
                  tone={answeredCount === applicable.length ? 'pass' : 'default'}
                />
              </Rowed>
              <Field
                label="Find an asset"
                value={search}
                onChangeText={setSearch}
                placeholder="Name, level, room, serial or type"
                autoCapitalize="none"
              />
              <Txt tone="faint" size="sm">Tap an asset to record its checks; tap it again to close it.</Txt>
            </>
          )}
        </>
      ) : null}
    </View>
  );

  const footer = (
    <View style={{ gap: t.space(3), marginTop: t.space(2) }}>
      <Button title="Record this routine" onPress={finish} loading={saving} disabled={nothingAnswered} />
      <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
        {nothingAnswered
          ? 'Answer at least one check first. A run recorded with nothing on it would still count as the routine done, and push its next due date out.'
          : officeJob
            ? `Failures raise their coded defect automatically, and each one is queued as a note on job ${officeJob}. Anything left untested is reported as a coverage gap, never as a pass.`
            : 'Failures raise their coded defect automatically, on this phone only — no job here for them to go on. Anything left untested is reported as a coverage gap, never as a pass.'}
      </Txt>
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: routine.label }} />
      <Screen scroll={false} padded={false}>
        <FlatList
          data={shownAssets}
          keyExtractor={(a) => a.id}
          // The rows read the draft and the selection, neither of which is a
          // prop of the list, so it has to be told when they change.
          extraData={{ answers: draft.value, activeAsset }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: t.space(4), gap: t.space(3), paddingBottom: t.space(12) }}
          initialNumToRender={12}
          maxToRenderPerBatch={16}
          windowSize={9}
          ListHeaderComponent={header}
          ListFooterComponent={footer}
          ListEmptyComponent={
            applicable.length ? (
              <Txt tone="faint" size="sm" style={{ textAlign: 'center' }}>Nothing matches “{search.trim()}”.</Txt>
            ) : null
          }
          renderItem={({ item }) => {
            const active = activeAsset === item.id;
            return (
              <View style={{ gap: t.space(3) }}>
                <AssetRow
                  asset={item}
                  answered={answered(item)}
                  active={active}
                  onPress={() => setActiveAsset(active ? undefined : item.id)}
                />
                {active ? (
                  <View style={{ gap: t.space(3), paddingLeft: t.space(3) }}>
                    {assetChecks
                      .filter((c) => c.assetTypeId === item.assetTypeId)
                      .map((test) => (
                        <CheckCard
                          key={`${test.id}:${item.id}`}
                          test={test}
                          answer={draft.value[`${test.id}:${item.id}`]}
                          onAnswer={(patch) => answer(`${test.id}:${item.id}`, patch)}
                        />
                      ))}
                  </View>
                ) : null}
              </View>
            );
          }}
        />
      </Screen>
    </>
  );
}

/** One asset in the list: what it is, where it is, and whether it is done. */
function AssetRow({
  asset, answered, active, onPress,
}: {
  asset: AssetRecord;
  answered: boolean;
  active: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  const type = assetTypeById(asset.assetTypeId);
  const title = asset.name || type?.label || 'Asset';
  const detail = [asset.name ? type?.label : undefined, asset.level, asset.room].filter(Boolean).join(' · ');
  return (
    <Card onPress={onPress} style={active ? { borderWidth: 1, borderColor: t.color.accent } : undefined}>
      <Rowed gap={2.5}>
        <MaterialCommunityIcons
          name={answered ? 'check-circle' : 'checkbox-blank-circle-outline'}
          size={22}
          color={answered ? t.color.pass : t.color.textFaint}
        />
        <View style={{ flex: 1 }}>
          <Txt weight="600" numberOfLines={1}>{title}</Txt>
          {detail ? <Txt size="xs" tone="muted" numberOfLines={1}>{detail}</Txt> : null}
        </View>
        <MaterialCommunityIcons name={active ? 'chevron-up' : 'chevron-down'} size={20} color={t.color.textFaint} />
      </Rowed>
    </Card>
  );
}

function CheckCard({
  test, answer, onAnswer,
}: {
  test: TestDef;
  answer: Answer | undefined;
  onAnswer: (patch: Partial<Answer>) => void;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const verdict = answer?.verdict ?? 'not-tested';

  const set = (v: Verdict) => {
    void Haptics.impactAsync(v === 'fail' ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light);
    onAnswer({ verdict: v });
  };

  return (
    <Card>
      <Pressable onPress={() => setOpen((v) => !v)}>
        <Rowed align="flex-start" gap={2}>
          <View style={{ flex: 1 }}>
            <Label>{test.section}</Label>
            <Txt weight="600" style={{ marginTop: 3, lineHeight: 20 }}>{test.label}</Txt>
          </View>
          <MaterialCommunityIcons name={open ? 'chevron-up' : 'information-outline'} size={18} color={t.color.textFaint} />
        </Rowed>
      </Pressable>

      {open ? (
        <View style={{ marginTop: t.space(2), gap: 4 }}>
          {test.whatToDo ? <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>Do: {test.whatToDo}</Txt> : null}
          {test.whatToLookFor ? <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>Look for: {test.whatToLookFor}</Txt> : null}
          {test.passCriteria ? <Txt size="sm" tone="pass" style={{ lineHeight: 19 }}>Pass: {test.passCriteria}</Txt> : null}
          {test.failCriteria ? <Txt size="sm" tone="fail" style={{ lineHeight: 19 }}>Fail: {test.failCriteria}</Txt> : null}
          <Rowed gap={2} wrap style={{ marginTop: 4 }}>
            <Chip label={SOURCE_LABEL[test.sourceKind]} tone={test.sourceKind === 'internal' ? 'warn' : 'default'} />
            {test.defectCode ? <Chip label={test.defectCode} /> : null}
          </Rowed>
          {test.verify ? (
            <Txt size="xs" tone="warn" style={{ lineHeight: 17 }}>
              The actual figure or interval must come from the current standard or the manufacturer's documentation.
            </Txt>
          ) : null}
        </View>
      ) : null}

      <Rowed gap={2} style={{ marginTop: t.space(2.5) }}>
        <Verdict label="Pass" active={verdict === 'pass'} tone="pass" onPress={() => set('pass')} />
        <Verdict label="Fail" active={verdict === 'fail'} tone="fail" onPress={() => set('fail')} />
        <Verdict label="N/A" active={verdict === 'na'} tone="warn" onPress={() => set('na')} />
      </Rowed>

      {test.measurementKey ? (
        <View style={{ marginTop: t.space(2.5) }}>
          <Field
            label={test.measurementKey}
            value={answer?.measurement ?? ''}
            onChangeText={(v) => onAnswer({ measurement: v })}
            keyboardType="decimal-pad"
            suffix={test.measurementUnit}
          />
        </View>
      ) : null}

      {verdict === 'fail' ? (
        <View style={{ marginTop: t.space(2.5) }}>
          <Field
            label="What failed"
            value={answer?.comment ?? ''}
            onChangeText={(v) => onAnswer({ comment: v })}
            multiline
            hint={test.defectCode ? `Raises ${test.defectCode} when recorded` : undefined}
          />
        </View>
      ) : null}

      {verdict === 'not-tested' ? (
        <View style={{ marginTop: t.space(2.5) }}>
          <Label>Could not test? Say why</Label>
          <Rowed gap={2} wrap style={{ marginTop: t.space(1.5) }}>
            {NOT_TESTED_REASONS.map((r) => (
              <Chip
                key={r}
                label={r}
                selected={answer?.reason === r}
                onPress={() => onAnswer({ reason: answer?.reason === r ? undefined : r })}
              />
            ))}
          </Rowed>
        </View>
      ) : null}
    </Card>
  );
}

function Verdict({ label, active, tone, onPress }: { label: string; active: boolean; tone: 'pass' | 'fail' | 'warn'; onPress: () => void }) {
  const t = useTheme();
  const colour = { pass: t.color.pass, fail: t.color.fail, warn: t.color.warn }[tone];
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1, minHeight: 44, borderRadius: t.radius.md,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: active ? colour : t.color.surfaceAlt,
        borderWidth: 1, borderColor: active ? colour : t.color.border,
      }}
    >
      <Txt size="sm" weight="700" style={{ color: active ? t.color.onAccent : t.color.textMuted }}>{label}</Txt>
    </Pressable>
  );
}
