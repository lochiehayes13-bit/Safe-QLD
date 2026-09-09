import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { addAssetEvent, queryAssets, updateAsset, type AssetRecord } from '@/db/assetRepo';
import { createDefect, getSite } from '@/db/repo';
import { listJobPage, type JobSummary } from '@/db/opsRepo';
import { getDb, inTransaction, newId, nowIso } from '@/db';
import { queueAssetTest } from '@/simpro/assetTestQueue';
import { queueJobNote } from '@/simpro/sync';
import { explainRefusal, type AssetTestRefusal } from '@/domain/assetTestDecision';
import {
  NOT_TESTED_REASONS, applyVerdictToAll, assetTestFor, buildServiceNote, candidateDefects, clearSelection,
  clearVerdict, decidedCount, defectFor, describeOutcome, eventFor, failIsComplete, finalWording, isSelected,
  levelKey, levelsOf, selectAll, selectSystem, serviceNoteSubject, summarise, systemOf, systemsOf, toggleSelected,
  withoutWritten, type Batch, type BulkSelection, type FailDetail, type RecordOutcome, type Verdict,
} from '@/domain/bulkTest';
import { draftDefectWording, MAX_CANDIDATES } from '@/ai/defectWording';
import { hasKey } from '@/ai/client';
import { SEVERITY_LABEL, defectByCode, type Severity } from '@/seed/defectLibrary';
import { SYSTEM_LABELS, assetTypeById, type SystemKind } from '@/seed/assetTypes';
import type { Site } from '@/domain/types';
import { loadPrefs } from '@/app-prefs';
import { qldIsoDay } from '@/domain/qldTime';
import { CAPTURE_QUALITY } from '@/domain/photoStore';
import { shrinkForStorage } from '@/export/photoResize';
import { keepPhoto } from '@/export/photoFiles';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { useDraft } from '@/hooks/useDraft';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, EmptyState, Field, Label, Rowed, Screen, SearchBox, StatusPill, Txt,
} from '@/components/ui';
import { ContextGate } from '@/components/ContextGate';
import { contextId } from '@/domain/screenContext';
import { showAlert } from '@/components/alert';

/**
 * Walking a site and testing its assets in bulk.
 *
 * A routine run asks every check on every asset. This asks one question per
 * asset — passed, failed, or could not be tested — and lets it be answered
 * for many at once, because that is the shape of most visits: a level of
 * extinguishers that all pass, three that do not, two behind a locked door.
 *
 * On the phone it writes what a routine run writes, through the same
 * repositories: an event on each asset's timeline, the last-serviced stamp,
 * and a coded defect per failure, so the record reads the same whichever
 * screen made it. Beyond that it does two things a routine run does not:
 * each result goes on the Simpro asset-test queue, where the office allows
 * it — this is the first screen that files a test against the office's own
 * asset — and one note on the job lists what was found.
 *
 * A failure is written up properly without typing a paragraph on a ladder.
 * The observation is a few words (the keyboard's microphone will take them),
 * the library offers the codes that fit, and with a key set the model turns
 * the observation into the record's register — picking from those codes
 * only, and checked before it is shown. With no key the library wording and
 * the technician's own words are the record, as they always were.
 */

/** What the draft holds: the assets in hand, every verdict so far, the job the note goes to, and a half-written failure. */
interface WalkDraft {
  selection: BulkSelection;
  batch: Batch;
  jobId: string | null;
  fail: FailDetail;
}

const BLANK_FAIL: FailDetail = { observation: '', severity: 'high', photos: [] };

/** The words a technician might type to find an asset. */
function searchText(a: AssetRecord): string {
  return [a.name, a.code, a.level, a.room, a.locationNote, a.serial, assetTypeById(a.assetTypeId)?.label]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export default function BulkTestScreen() {
  const t = useTheme();
  // `contextId` rather than the raw parameter: several screens push
  // `siteId: siteId ?? ''`, so "no site" arrives here as an empty string.
  const siteId = contextId(useLocalSearchParams<{ siteId?: string }>().siteId);
  const [site, setSite] = useState<Site | null>(null);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  // "No assets here" is a statement about the register. A read that threw
  // must not make it on the strength of an empty list.
  const [failed, setFailed] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [jobsFailed, setJobsFailed] = useState<string | null>(null);
  const [system, setSystem] = useState<SystemKind | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sheet, setSheet] = useState<'fail' | 'not-tested' | null>(null);
  const [aiOn, setAiOn] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<RecordOutcome | null>(null);

  const draft = useDraft<WalkDraft>(`bulk-test:${siteId ?? 'x'}`, {
    selection: [], batch: {}, jobId: null, fail: BLANK_FAIL,
  });
  const d = draft.value;

  const load = useCallback(async () => {
    // Without a site there is nothing to read. The flag is cleared rather
    // than left set: a loader that returns without clearing it is how this
    // family of screens used to hang.
    if (!siteId) { setLoading(false); return; }
    setLoading(true);
    setFailed(null);
    try {
      const [s, a] = await Promise.all([getSite(siteId), queryAssets({ siteId, limit: 5000 })]);
      setSite(s);
      setAssets(a);
    } catch (e) {
      setAssets([]);
      setFailed(describeLoadFailure(e, "this site's asset register"));
    } finally {
      setLoading(false);
    }
    // The office's open jobs here, for the note. Read after the register so
    // the mirror never holds up the walk, and with its own failure line so a
    // mirror that will not read still leaves the walk usable.
    try {
      const page = await listJobPage({ filter: 'open', today: qldIsoDay(nowIso()) ?? '', siteId, limit: 20 });
      setJobs(page.rows.filter((j) => j.externalId));
      setJobsFailed(null);
    } catch (e) {
      setJobs([]);
      setJobsFailed(describeLoadFailure(e, "the office's jobs at this site"));
    }
  }, [siteId]);

  useEffect(() => { void load(); void hasKey().then(setAiOn); }, [load]);

  const systems = useMemo(() => systemsOf(assets), [assets]);
  const levels = useMemo(() => levelsOf(assets), [assets]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assets.filter((a) =>
      (!system || systemOf(a) === system)
      && (!level || levelKey(a.level) === levelKey(level))
      && (!q || searchText(a).includes(q)));
  }, [assets, system, level, search]);

  const selectedAssets = useMemo(() => assets.filter((a) => isSelected(d.selection, a.id)), [assets, d.selection]);
  const summary = useMemo(() => summarise(d.batch, assets), [d.batch, assets]);
  const decided = decidedCount(d.batch);

  /*
   * The asset type the failure sheet writes for. A selection is usually one
   * type — a level of extinguishers — and where it is not, the commonest
   * type in it decides which codes are offered. The observation still
   * applies to every asset selected; only the list of codes is narrowed.
   */
  const sheetType = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of selectedAssets) counts.set(a.assetTypeId, (counts.get(a.assetTypeId) ?? 0) + 1);
    return [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
  }, [selectedAssets]);
  const sheetSystem = sheetType ? assetTypeById(sheetType)?.system : undefined;
  const candidates = useMemo(
    () => (sheetType ? candidateDefects(sheetType, d.fail.observation, MAX_CANDIDATES) : []),
    [sheetType, d.fail.observation],
  );

  const setSelection = (fn: (s: BulkSelection) => BulkSelection) =>
    draft.setValue((p) => ({ ...p, selection: fn(p.selection) }));
  const setFail = (patch: Partial<FailDetail>) =>
    draft.setValue((p) => ({ ...p, fail: { ...p.fail, ...patch } }));

  /** Records one verdict against everything selected and empties the selection for the next group. */
  const apply = (verdict: Verdict) => {
    draft.setValue((p) => ({
      ...p,
      batch: applyVerdictToAll(p.batch, p.selection, verdict),
      selection: clearSelection(),
      fail: verdict.kind === 'fail' ? BLANK_FAIL : p.fail,
    }));
    setSheet(null);
    setAiNote(null);
  };

  const writeUp = async () => {
    if (!sheetType || !sheetSystem) return;
    setAiBusy(true);
    setAiNote(null);
    try {
      // The technician's own pick goes first so the model keeps it, and the
      // ranking fills the rest of the list. A pick is theirs: the model may
      // word it, and may say a neighbour fits better, but it does not move
      // the code or the severity off what was chosen on the ladder.
      const picked = d.fail.defectCode ? defectByCode(d.fail.defectCode) : undefined;
      const offered = [picked, ...candidates.filter((c) => c.code !== picked?.code)]
        .filter((c): c is NonNullable<typeof c> => Boolean(c))
        .slice(0, MAX_CANDIDATES);
      const result = await draftDefectWording({
        assetTypeLabel: assetTypeById(sheetType)?.label ?? 'Asset',
        system: sheetSystem,
        observation: d.fail.observation,
        candidates: offered,
      });
      if (result.wording) {
        if (picked) {
          setFail({ wording: result.wording });
          setAiNote(result.code && result.code !== picked.code
            ? `Drafted, but under ${result.code} rather than ${picked.code}. Read it before you apply it; the code stays as you picked it.`
            : `Drafted under ${picked.code}. Read it before you apply it — it is your record.`);
        } else {
          setFail({ wording: result.wording, defectCode: result.code, severity: result.severity ?? d.fail.severity });
          setAiNote(`Drafted under ${result.code}. Read it before you apply it — it is your record.`);
        }
      } else {
        setAiNote(result.refusal ?? 'No wording came back.');
      }
    } catch (e) {
      setAiNote(describeActionFailure(e, 'draft the wording'));
    } finally {
      setAiBusy(false);
    }
  };

  const addPhoto = async (fromCamera: boolean) => {
    try {
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        showAlert('Permission needed', 'Safe QLD needs access to attach a photo to this defect.');
        return;
      }
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({ quality: CAPTURE_QUALITY })
        : await ImagePicker.launchImageLibraryAsync({ quality: CAPTURE_QUALITY });
      if (result.canceled || !result.assets[0]) return;
      // Shrunk and copied out of the cache now, the same as a single defect:
      // the picker's URI is the operating system's to clear, and a defect
      // photograph is evidence.
      const sourceUri = await shrinkForStorage(result.assets[0]!);
      const kept = keepPhoto({
        id: newId(),
        sourceUri,
        subject: 'defect',
        // The defects do not exist yet; their photographs are filed on save.
        subjectId: 'pending',
        takenAt: new Date().toISOString(),
      });
      draft.setValue((p) => ({ ...p, fail: { ...p.fail, photos: [...p.fail.photos, kept.path] } }));
    } catch (e) {
      showAlert('Could not keep that photo', describeActionFailure(e, 'save the photo to this device'));
    }
  };

  /**
   * Writes the batch.
   *
   * In register order, one asset at a time. On the phone each asset gets
   * what a routine run would give it — the event, the last-serviced stamp,
   * the defect — as one transaction, so a write that stops part-way leaves
   * an asset either fully on record or not at all. Then, unlike a routine
   * run, the result goes on the Simpro asset-test queue, which decides per
   * asset whether it may go back and says why not; the reasons are tallied
   * and said once, because three hundred "writing is switched off" alerts
   * is a screen nobody reads.
   *
   * Every asset written is struck from the draft before anything else is
   * attempted, so when the write does stop the alert can say exactly how
   * many are on record and Record again writes only the rest.
   */
  const record = async () => {
    if (!site) return;
    setSaving(true);
    const written: string[] = [];
    const attempted = assets.filter((a) => d.batch[a.id]).length;
    try {
      const prefs = await loadPrefs();
      const db = await getDb();
      const now = nowIso();
      const technician = prefs.technicianName || undefined;
      const jobId = d.jobId && jobs.some((j) => j.externalId === d.jobId) ? d.jobId : null;
      const out: RecordOutcome = { passed: 0, failed: 0, notTested: 0, defectsRaised: 0, queued: 0, refused: {} };

      for (const asset of assets) {
        const v = d.batch[asset.id];
        if (!v) continue;
        const ev = eventFor(v);
        await inTransaction(db, async () => {
          await addAssetEvent({
            assetId: asset.id,
            kind: ev.kind,
            occurredAt: now,
            technician,
            jobId: jobId ?? undefined,
            summary: ev.summary,
            detail: ev.detail,
            photos: ev.photos,
            measurements: {},
          });
          // A not-tested asset keeps its last-serviced date: nothing was serviced.
          if (v.kind !== 'not-tested') {
            await updateAsset(asset.id, { lastServicedAt: now, lastResult: v.kind });
          }
          if (v.kind === 'fail') {
            const def = defectFor(asset, v.fail);
            await createDefect({
              siteId: site.id,
              pointId: asset.id,
              location: def.location,
              description: def.description,
              severity: def.severity,
              status: 'open',
              photos: def.photos,
              notes: def.notes,
              // The code and the class on the row itself, not only in the
              // note: the notice screen and the report read them from there.
              defectCode: def.defectCode,
              as1851Class: def.severity,
            });
          }
        });
        // On record from here: the event and the defect are the things a
        // second press must not double. A result that misses the queue
        // below is one line for the office, not a second defect.
        written.push(asset.id);
        if (v.kind === 'pass') out.passed++;
        else if (v.kind === 'not-tested') out.notTested++;
        else { out.failed++; out.defectsRaised++; }

        const decision = await queueAssetTest(assetTestFor(asset, v, now), prefs.simproWriteAssetTests);
        if (decision.send) out.queued++;
        else out.refused[decision.reason] = (out.refused[decision.reason] ?? 0) + 1;
      }

      // One note for the whole walk, after the assets are safely written: a
      // queue that cannot be written must not take the results with it, and
      // a note that could not be queued is not a result that was not
      // written — the results are on record, so the draft still closes and
      // the summary says the note is the one thing that did not go.
      if (jobId) {
        try {
          await queueJobNote({
            jobId,
            subject: serviceNoteSubject(d.batch, assets),
            note: buildServiceNote(d.batch, assets, site, technician, now),
          });
          out.noteJobId = jobId;
        } catch (e) {
          out.noteError = describeActionFailure(e, 'queue the note to the office');
        }
      }

      await draft.discard();
      setOutcome(out);
    } catch (e) {
      // What is on record leaves the draft, so Record again cannot write it
      // twice; what is not stays, and the alert says which is which.
      const left = withoutWritten(d.batch, written);
      draft.setValue((p) => ({ ...p, batch: withoutWritten(p.batch, written) }));
      const remaining = decidedCount(left);
      showAlert(
        'Could not record',
        `${describeActionFailure(e, 'record these results')} ${written.length} of ${attempted} result${attempted === 1 ? '' : 's'} `
        + `written; ${remaining} ${remaining === 1 ? 'is' : 'are'} still here to record again.`,
      );
    } finally {
      setSaving(false);
    }
  };

  /*
   * A walk is recorded against a site. Opened from search rather than from a
   * site this screen would list nobody's assets and record nothing, so it
   * says which site it needs instead.
   */
  if (!siteId) return <ContextGate kind="site" what="a site's assets tested in bulk" title="Bulk test" />;

  if (outcome) {
    const refusals = Object.entries(outcome.refused) as [AssetTestRefusal, number][];
    return (
      <>
        <Stack.Screen options={{ title: 'Bulk test' }} />
        <Screen>
          <Card variant="raised">
            <Label>{site?.name ?? 'Site'}</Label>
            <Txt size="lg" weight="800" style={{ marginTop: 4, lineHeight: 26 }}>{describeOutcome(outcome)}</Txt>
            {refusals.length ? (
              <View style={{ marginTop: t.space(3), gap: 6 }}>
                <Label>Not sent to Simpro</Label>
                {refusals.map(([reason, n]) => (
                  <Txt key={reason} size="sm" tone="muted" style={{ lineHeight: 19 }}>
                    {n} result{n === 1 ? '' : 's'}: {explainRefusal(reason)}
                  </Txt>
                ))}
              </View>
            ) : null}
          </Card>
          <Rowed gap={2}>
            <Button title="Test more here" variant="secondary" style={{ flex: 1 }} onPress={() => { setOutcome(null); void load(); }} />
            <Button title="Done" style={{ flex: 1 }} onPress={() => router.back()} />
          </Rowed>
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
            <Txt size="sm" tone="muted">
              {loading ? 'Reading the register' : `${assets.length} asset${assets.length === 1 ? '' : 's'} · ${decided} decided`}
            </Txt>
          </View>
          <Chip
            label={`${summary.passed} · ${summary.failed} · ${summary.notTested}`}
            tone={summary.failed ? 'fail' : summary.passed ? 'pass' : 'default'}
          />
        </Rowed>
        <Txt size="xs" tone="faint" style={{ marginTop: 4 }}>passed · failed · not tested</Txt>
      </Card>

      {failed ? <Banner tone="fail" title="The register could not be read" body={failed} /> : null}
      {draft.recovered ? (
        <Banner tone="info" title="Picked up where you left off" body="Verdicts from your last session were still here." />
      ) : null}

      {/*
        * Which job the note goes on. Nothing is chosen where the office has
        * more than one open job here, because a note on the wrong job files
        * the visit against somebody else's work. Optional: the walk records
        * without one.
        */}
      {jobs.length || jobsFailed ? (
        <Card>
          <Label>Note the office's job</Label>
          {jobsFailed ? (
            <Txt size="sm" tone="muted" style={{ marginTop: 4 }}>{jobsFailed}</Txt>
          ) : (
            <>
              <Txt size="xs" tone="faint" style={{ marginTop: 4, lineHeight: 17 }}>
                One note listing what passed, failed and was not tested is queued on the job you pick.
              </Txt>
              <Rowed gap={2} wrap style={{ marginTop: t.space(2) }}>
                {jobs.map((j) => (
                  <Chip
                    key={j.id}
                    label={`Job #${j.externalId}${j.title ? ` · ${j.title}` : ''}`}
                    selected={d.jobId === j.externalId}
                    onPress={() => draft.setValue((p) => ({ ...p, jobId: p.jobId === j.externalId ? null : j.externalId! }))}
                  />
                ))}
                <Chip label="No note" selected={d.jobId === null} onPress={() => draft.setValue((p) => ({ ...p, jobId: null }))} />
              </Rowed>
            </>
          )}
        </Card>
      ) : null}

      {systems.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
          <Chip label="All systems" selected={system === null} onPress={() => setSystem(null)} />
          {systems.map((s) => (
            <Chip key={s} label={SYSTEM_LABELS[s]} selected={system === s} onPress={() => setSystem(system === s ? null : s)} />
          ))}
        </ScrollView>
      ) : null}
      {levels.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
          <Chip label="All levels" selected={level === null} onPress={() => setLevel(null)} />
          {levels.map((l) => (
            <Chip key={l} label={l} selected={level !== null && levelKey(level) === levelKey(l)} onPress={() => setLevel(level !== null && levelKey(level) === levelKey(l) ? null : l)} />
          ))}
        </ScrollView>
      ) : null}
      <SearchBox value={search} onChange={setSearch} placeholder="Name, level, room, serial or type" />

      <Rowed gap={2} wrap>
        <Txt size="sm" tone="muted" style={{ flex: 1 }}>{d.selection.length} selected</Txt>
        <Button title={`Select ${shown.length === assets.length ? 'all' : 'shown'}`} variant="secondary" compact onPress={() => setSelection((s) => selectAll(s, shown))} />
        {system ? (
          <Button title={`All ${SYSTEM_LABELS[system].toLowerCase()}`} variant="secondary" compact onPress={() => setSelection((s) => selectSystem(s, assets, system))} />
        ) : null}
        <Button title="Clear" variant="ghost" compact onPress={() => setSelection(clearSelection)} />
      </Rowed>
    </View>
  );

  const canFail = failIsComplete(d.fail);

  return (
    <>
      <Stack.Screen options={{ title: 'Bulk test' }} />
      <Screen scroll={false} padded={false}>
        <FlatList
          data={shown}
          keyExtractor={(a) => a.id}
          // The rows read the draft, which is not a prop of the list.
          extraData={d}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: t.space(4), gap: t.space(2), paddingBottom: t.space(6) }}
          initialNumToRender={14}
          maxToRenderPerBatch={20}
          windowSize={9}
          ListHeaderComponent={header}
          ListEmptyComponent={
            loading ? null : assets.length ? (
              <Txt tone="faint" size="sm" style={{ textAlign: 'center', marginTop: t.space(4) }}>Nothing matches.</Txt>
            ) : failed ? null : (
              <EmptyState
                title="No assets on this site's register"
                body="Add them, import a device list, or sync from Simpro first. There is nothing to test until the register has something on it."
              />
            )
          }
          renderItem={({ item }) => (
            <AssetRow
              asset={item}
              selected={isSelected(d.selection, item.id)}
              verdict={d.batch[item.id]}
              onPress={() => setSelection((s) => toggleSelected(s, item.id))}
              onClearVerdict={() => draft.setValue((p) => ({ ...p, batch: clearVerdict(p.batch, item.id) }))}
            />
          )}
        />

        {/* The action bar stays put under the list, so a verdict is one reach away however far down the walk is. */}
        <View style={{ padding: t.space(3), gap: t.space(2), borderTopWidth: 1, borderTopColor: t.color.border, backgroundColor: t.color.surface }}>
          <Rowed gap={2}>
            <Button title="Pass" style={{ flex: 1 }} disabled={!d.selection.length} onPress={() => apply({ kind: 'pass' })} />
            <Button title="Fail" variant="danger" style={{ flex: 1 }} disabled={!d.selection.length} onPress={() => setSheet('fail')} />
            <Button title="Not tested" variant="secondary" style={{ flex: 1 }} disabled={!d.selection.length} onPress={() => setSheet('not-tested')} />
          </Rowed>
          <Button
            title={decided ? `Record ${decided} result${decided === 1 ? '' : 's'}` : 'Record results'}
            variant="secondary"
            disabled={!decided || !site}
            loading={saving}
            onPress={() => void record()}
          />
        </View>
      </Screen>

      <Modal visible={sheet === 'fail'} animationType="slide" onRequestClose={() => setSheet(null)} presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: t.color.bg }}>
          <Rowed gap={2} style={{ padding: t.space(4), paddingBottom: t.space(2) }}>
            <Txt size="xl" weight="800" style={{ flex: 1 }}>Fail {d.selection.length} asset{d.selection.length === 1 ? '' : 's'}</Txt>
            <Pressable onPress={() => setSheet(null)} hitSlop={10}><MaterialCommunityIcons name="close" size={26} color={t.color.textMuted} /></Pressable>
          </Rowed>
          <ScrollView contentContainerStyle={{ padding: t.space(4), gap: t.space(3), paddingBottom: t.space(12) }} keyboardShouldPersistTaps="handled">
            <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
              {sheetType ? `Codes offered for ${assetTypeById(sheetType)?.label ?? 'this type'}.` : 'Nothing selected.'}
              {' '}The same observation, code, wording and photos go on every asset selected; each still gets its own defect.
            </Txt>
            <Field
              label="What you found"
              value={d.fail.observation}
              onChangeText={(v) => setFail({ observation: v })}
              multiline
              placeholder="e.g. hose perished at the nozzle, pin seal broken"
              hint="A few words is enough. The microphone on the keyboard will take them."
            />

            <Label>Library code</Label>
            {candidates.length ? (
              <View style={{ gap: t.space(1.5) }}>
                {candidates.map((c) => (
                  <Pressable
                    key={c.code}
                    onPress={() => setFail({ defectCode: d.fail.defectCode === c.code ? undefined : c.code, severity: c.severity })}
                    style={{
                      padding: t.space(2.5), borderRadius: t.radius.md, borderWidth: 1,
                      borderColor: d.fail.defectCode === c.code ? t.color.accent : t.color.border,
                      backgroundColor: d.fail.defectCode === c.code ? t.color.accentBg : t.color.surface,
                    }}
                  >
                    <Rowed gap={2}>
                      <Txt weight="600" style={{ flex: 1 }}>{c.defect}</Txt>
                      <Chip label={c.code} />
                    </Rowed>
                    <Txt size="xs" tone="faint" style={{ marginTop: 4 }} numberOfLines={2}>{c.reportWording}</Txt>
                  </Pressable>
                ))}
              </View>
            ) : (
              <Txt size="sm" tone="faint">No library code covers this type. The observation goes on the record as written.</Txt>
            )}

            <Card>
              <Rowed gap={2} align="flex-start">
                <View style={{ flex: 1 }}>
                  <Label>AI write it up</Label>
                  <Txt size="xs" tone="faint" style={{ marginTop: 4, lineHeight: 17 }}>
                    {!aiOn
                      ? 'No API key is set, so the library wording and your words are the record. A key goes in Settings.'
                      : !sheetSystem
                        ? 'This asset type belongs to no system the library covers, so there is nothing for it to choose from.'
                        : 'Sends only the asset type, the system, what you wrote and the codes above. Never the site, the customer, a serial or a job number. Checked before it is shown.'}
                  </Txt>
                </View>
                <Button
                  title="Write it up"
                  variant="secondary"
                  compact
                  disabled={!aiOn || !sheetSystem || d.fail.observation.trim().length < 4}
                  loading={aiBusy}
                  onPress={() => void writeUp()}
                  icon={<MaterialCommunityIcons name="auto-fix" size={16} color={t.color.text} />}
                />
              </Rowed>
              {aiNote ? <Txt size="sm" tone="muted" style={{ marginTop: t.space(2), lineHeight: 19 }}>{aiNote}</Txt> : null}
            </Card>

            <Field
              label="Wording on the record"
              value={d.fail.wording ?? ''}
              onChangeText={(v) => setFail({ wording: v })}
              multiline
              placeholder={finalWording(d.fail)}
              hint={d.fail.wording?.trim() ? undefined : 'Left blank, the record reads as the placeholder above.'}
            />

            <Label>Severity</Label>
            <Rowed gap={2} wrap>
              {(['critical', 'high', 'medium', 'low'] as Severity[]).map((s) => (
                <Chip key={s} label={SEVERITY_LABEL[s]} selected={d.fail.severity === s} onPress={() => setFail({ severity: s })} />
              ))}
            </Rowed>
            <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
              Critical goes on the record as critical; the rest as non-critical, the same as a routine run.
            </Txt>

            <Label>Photos</Label>
            <Rowed gap={2}>
              <Button title="Camera" variant="secondary" style={{ flex: 1 }} onPress={() => void addPhoto(true)} icon={<MaterialCommunityIcons name="camera-outline" size={16} color={t.color.text} />} />
              <Button title="Library" variant="secondary" style={{ flex: 1 }} onPress={() => void addPhoto(false)} />
            </Rowed>
            {d.fail.photos.length ? (
              <Rowed gap={2}>
                <Txt size="sm" tone="pass" style={{ flex: 1 }}>{d.fail.photos.length} photo{d.fail.photos.length === 1 ? '' : 's'} attached to each defect</Txt>
                <Button title="Remove" variant="ghost" compact onPress={() => setFail({ photos: [] })} />
              </Rowed>
            ) : null}

            <Button
              title={`Apply to ${d.selection.length} asset${d.selection.length === 1 ? '' : 's'}`}
              disabled={!canFail || !d.selection.length}
              onPress={() => apply({ kind: 'fail', fail: { ...d.fail, observation: d.fail.observation.trim() } })}
            />
            {!canFail ? <Txt size="xs" tone="faint">Say what you found or pick a code first.</Txt> : null}
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={sheet === 'not-tested'} animationType="slide" onRequestClose={() => setSheet(null)} presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: t.color.bg }}>
          <Rowed gap={2} style={{ padding: t.space(4), paddingBottom: t.space(2) }}>
            <Txt size="xl" weight="800" style={{ flex: 1 }}>Could not test {d.selection.length}</Txt>
            <Pressable onPress={() => setSheet(null)} hitSlop={10}><MaterialCommunityIcons name="close" size={26} color={t.color.textMuted} /></Pressable>
          </Rowed>
          <ScrollView contentContainerStyle={{ padding: t.space(4), gap: t.space(2) }}>
            <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
              Recorded as a coverage gap with the reason against each asset — never as a pass, never as a defect. The last-serviced date is left alone.
            </Txt>
            {NOT_TESTED_REASONS.map((r) => (
              <Card key={r} onPress={() => apply({ kind: 'not-tested', reason: r })}>
                <Rowed gap={2}>
                  <MaterialCommunityIcons name="help-circle-outline" size={20} color={t.color.warn} />
                  <Txt weight="600" style={{ flex: 1 }}>{r}</Txt>
                </Rowed>
              </Card>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

/** One asset in the list: whether it is in hand, what it is, where it is, and what has been decided. */
function AssetRow({
  asset, selected, verdict, onPress, onClearVerdict,
}: {
  asset: AssetRecord;
  selected: boolean;
  verdict: Verdict | undefined;
  onPress: () => void;
  onClearVerdict: () => void;
}) {
  const t = useTheme();
  const type = assetTypeById(asset.assetTypeId);
  const title = asset.name || type?.label || 'Asset';
  const detail = [asset.name ? type?.label : undefined, asset.level, asset.room, asset.code].filter(Boolean).join(' · ');
  return (
    <Card onPress={onPress} style={selected ? { borderWidth: 1, borderColor: t.color.accent } : undefined}>
      <Rowed gap={2.5}>
        <MaterialCommunityIcons
          name={selected ? 'checkbox-marked' : 'checkbox-blank-outline'}
          size={24}
          color={selected ? t.color.accent : t.color.textFaint}
        />
        <View style={{ flex: 1 }}>
          <Txt weight="600" numberOfLines={1}>{title}</Txt>
          {detail ? <Txt size="xs" tone="muted" numberOfLines={1}>{detail}</Txt> : null}
        </View>
        {verdict ? (
          <Pressable onPress={onClearVerdict} hitSlop={8}>
            <StatusPill
              label={verdict.kind === 'pass' ? 'Pass' : verdict.kind === 'fail' ? `Fail${verdict.fail.defectCode ? ` ${verdict.fail.defectCode}` : ''}` : 'Not tested'}
              tone={verdict.kind === 'pass' ? 'pass' : verdict.kind === 'fail' ? 'fail' : 'warn'}
            />
          </Pressable>
        ) : null}
      </Rowed>
    </Card>
  );
}
