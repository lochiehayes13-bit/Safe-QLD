import React, { useCallback, useMemo, useState } from 'react';
import { Image, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { deleteDefect, getDefect, getSite, reopenDefect, updateDefect } from '@/db/repo';
import { attachmentsForDefect } from '@/domain/outboundWork';
import { defectMove, describeDefectReport, type DefectReportNotice, type DefectReportOccasion } from '@/domain/defectReport';
import { photosWithSizes } from '@/simpro/attachmentFiles';
import { queueJobAttachment } from '@/simpro/sync';
import { listJobPage, queueDefectNote, type JobSummary } from '@/db/opsRepo';
import { keepPhoto, photoUri } from '@/export/photoFiles';
import { shrinkForStorage } from '@/export/photoResize';
import { SEVERITY_LABEL, searchDefects, type Severity } from '@/seed/defectLibrary';
import { qldIsoDay } from '@/domain/qldTime';
import { newId, nowIso } from '@/db';
import { formatAuDate } from '@/export/sheets';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { showAlert } from '@/components/alert';
import { RecordGate } from '@/components/RecordGate';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, Field, H2, Label, Rowed, Screen, SearchBox, StatusPill, Txt,
} from '@/components/ui';
import type { Defect, Site } from '@/domain/types';

/**
 * One defect, and everything that can still be done about it.
 *
 * A defect used to be a thing you could raise and then only close. The lists
 * wrote two fields between them — rectified, and quoted — so a wrong location,
 * a description with the wrong unit in it, a grade picked in a hurry or a
 * photograph nobody took were all permanent. The one thing a technician
 * actually does with a defect after raising it is correct it, and there was no
 * screen to do it on.
 *
 * Four things happen here that could not happen anywhere.
 *
 * The wording, the location and the grade can be fixed, because they are what
 * the customer reads and what the quote is priced from.
 *
 * Photographs can be added afterwards. Half of them are taken on the way out,
 * or on the next visit, and until now they could only go on at the moment the
 * defect was raised.
 *
 * Those photographs can be put on a Simpro job at any time — not only in the
 * ten seconds after saving, and not only onto the job that happened to be
 * open. The office asking "have you got a photo of that" a week later is the
 * normal case, not the exception.
 *
 * And a critical one reaches its notice. Queensland gives the occupier a right
 * to a written notice within 24 hours, and the only way into that screen was a
 * banner on the front page that showed one defect at a time.
 */
const GRADES: Severity[] = ['critical', 'high', 'medium', 'low'];

export default function DefectScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [defect, setDefect] = useState<Defect | null>(null);
  // Loaded-and-absent is not the same as still loading. See RecordGate.
  const [missing, setMissing] = useState(false);
  // And a read that threw is neither.
  const [failed, setFailed] = useState<string | null>(null);
  const [site, setSite] = useState<Site | null>(null);
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  /*
   * Which picker is open, because there are now two things a job is picked for
   * on this screen and they are not the same act. 'photos' puts the attachments
   * on whatever job the office asked about, which can be any job at all;
   * 'job' sets the job this defect belongs to, which is the one thing every note
   * about it goes to. One piece of state rather than two booleans so both cannot
   * be open at once over the same list of jobs.
   */
  const [picking, setPicking] = useState<'photos' | 'job' | null>(null);
  const [jobQuery, setJobQuery] = useState('');
  /** What happened the last time this screen tried to tell the office something. */
  const [report, setReport] = useState<DefectReportNotice | null>(null);
  const [wordingQuery, setWordingQuery] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setFailed(null);
    try {
      const found = await getDefect(id);
      setDefect(found);
      setMissing(!found);
      setSite(found ? await getSite(found.siteId) : null);
    } catch (e) {
      setFailed(describeLoadFailure(e, 'this defect'));
    }
  }, [id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  /** Writes land immediately, and a write that fails says so. */
  const patch = (changes: Partial<Defect>) => {
    if (!defect) return;
    setDefect({ ...defect, ...changes });
    void updateDefect(defect.id, changes).catch((e: unknown) => {
      showAlert('Not saved', describeActionFailure(e, 'saving the defect'));
      void load();
    });
  };

  const grade: Severity = defect?.severity === 'critical' ? 'critical' : (defect?.priority ?? 'medium');

  const setGrade = (next: Severity) => {
    if (!defect) return;
    patch({
      severity: next === 'critical' ? 'critical' : 'non-critical',
      priority: next === 'critical' ? undefined : next,
    });
  };

  const addPhoto = async (fromCamera: boolean) => {
    if (!defect) return;
    setBusy(true);
    try {
      const picked = fromCamera
        ? await ImagePicker.launchCameraAsync({ quality: 0.6 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.6, allowsMultipleSelection: true });
      if (picked.canceled) return;

      const kept: string[] = [];
      for (const asset of picked.assets) {
        const sourceUri = await shrinkForStorage(asset);
        const stored = await keepPhoto({
          id: newId(),
          sourceUri,
          subject: 'defect',
          subjectId: defect.id,
          takenAt: nowIso(),
        });
        kept.push(stored.path);
      }
      if (kept.length) patch({ photos: [...defect.photos, ...kept] });
    } catch (e) {
      showAlert('Photo not added', describeActionFailure(e, 'adding the photo'));
    } finally {
      setBusy(false);
    }
  };

  const removePhoto = (stored: string) => {
    if (!defect) return;
    showAlert('Take this photo off the defect?', 'The file stays on the phone; the defect stops carrying it.', [
      { text: 'Keep it' },
      { text: 'Take it off', style: 'destructive', onPress: () => patch({ photos: defect.photos.filter((p) => p !== stored) }) },
    ]);
  };

  const openJobPicker = async (mode: 'photos' | 'job') => {
    if (!defect) return;
    setPicking(mode);
    try {
      const page = await listJobPage({ filter: 'all', today: qldIsoDay(nowIso()) ?? '', siteId: defect.siteId, limit: 50 });
      setJobs(page.rows);
    } catch (e) {
      showAlert('Could not read the jobs', describeActionFailure(e, 'reading the jobs'));
    }
  };

  /**
   * The photographs onto a job, any day after the fact.
   *
   * The raise screen could do this only in the moment, only for the job it had
   * open, and only if there were photos at the time. The office asking for one
   * a week later is the normal case.
   */
  const attachPhotos = async (job: JobSummary) => {
    if (!defect || !job.externalId) return;
    setPicking(null);
    setBusy(true);
    try {
      const plan = attachmentsForDefect(
        { id: defect.id, location: defect.location, raisedAt: defect.raisedAt, photos: photosWithSizes(defect.photos) },
        { jobId: job.externalId, siteName: site?.name ?? '' },
      );
      let queued = 0;
      let duplicate = 0;
      for (const item of plan.items) {
        const row = await queueJobAttachment(item.payload);
        if (row.duplicate) duplicate += 1; else queued += 1;
      }
      const plural = (n: number) => `${n} photo${n === 1 ? '' : 's'}`;
      showAlert(
        queued ? 'Photos queued for the office' : 'Nothing new to send',
        [
          queued ? `${plural(queued)} queued for job ${job.externalId}. They go up with the next send.` : undefined,
          duplicate ? `${plural(duplicate)} already queued or on the job, so not sent twice.` : undefined,
          plan.missing ? `${plural(plan.missing)} could not be found on this phone and stay with the defect only.` : undefined,
        ].filter(Boolean).join('\n'),
      );
    } catch (e) {
      showAlert('Not queued', describeActionFailure(e, 'queueing the photos'));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Puts the defect's current state onto the Simpro job it belongs to.
   *
   * Nothing on this screen reached the office before. A defect could be reworded,
   * regraded, photographed, marked rectified and reopened, and Simpro still held
   * the one note written the day it was raised -- so the office read a fault as
   * outstanding weeks after it was fixed, and the only thing that ever corrected
   * that was somebody ringing up. The job comes off the defect's own row rather
   * than out of the picker below, because the picker below is for photographs
   * onto any job the office asks about, which is a different question.
   *
   * The row is read back rather than composed from what is on screen. The note is
   * what the office reads, so it is built from what is stored -- and this screen
   * in particular writes on every keystroke, so the copy in state is ahead of the
   * row as often as it is level with it.
   *
   * Nobody's name goes on it. The note's only person line reads "Raised by", and
   * whoever is holding the phone today is often not who found it -- a name there
   * would be a false statement in a record the occupier statement reads back.
   */
  const reportToOffice = async (occasion: DefectReportOccasion) => {
    if (!defect) return;
    try {
      const fresh = await getDefect(defect.id);
      // Deleted underneath us, from another handset or the button at the bottom
      // of this screen. Nothing to report and nothing broken.
      if (!fresh) return;
      // The site name sits outside both halves of the note's key, so handing it
      // over saves the queue a read and cannot fork one defect into two notes.
      const { queued } = await queueDefectNote(fresh, undefined, { siteName: site?.name });
      // Trimmed to nothing counts as no job: a row holding "   " would otherwise
      // print as "Job    " and read as though the office had been told.
      setReport(describeDefectReport({ occasion, jobId: fresh.jobId?.trim() || undefined, queued }));
    } catch (e) {
      setReport({
        tone: 'warn',
        title: 'The office has not been told',
        body: describeActionFailure(e, 'queueing the note for the office'),
      });
    }
  };

  /**
   * A status chip, written and then reported.
   *
   * Separate from `patch` and deliberately so. `patch` is what the description,
   * the location and the notes fields go through, and those fire once per
   * keystroke -- reporting from there would put one note on the Simpro job for
   * every letter typed, and because the wording sits in the identity half of the
   * note's key while the status sits in the content half, not one of those notes
   * would be recognised as a duplicate of the one before it. A status change is
   * a single deliberate tap, so that is what gets reported. `defectMove` returns
   * nothing where the chip tapped is the one the defect is already on, which is
   * the other half of the same guard.
   */
  const moveStatus = (next: Defect['status']) => {
    if (!defect) return;
    const d = defect;
    const move = defectMove(d.status, next);
    setReport(null);
    /*
     * One instant, read once. The optimistic state below and the row written a
     * few lines down have to agree: two `nowIso()` calls are two different
     * moments a second apart, and the rectification date is what the occupier
     * statement and the critical defect notice print.
     */
    const at = nowIso();
    // Optimistic, the same way `patch` is, so the chip moves under the finger
    // rather than after a round trip to SQLite.
    setDefect(next === 'rectified'
      ? { ...d, status: 'rectified', rectifiedAt: at }
      : { ...d, status: next, ...(next === 'open' ? { rectifiedAt: undefined } : {}) });
    void (async () => {
      try {
        if (next === 'open') {
          // Its own statement because `updateDefect` skips a field set to
          // undefined and so cannot take a date off a row. Going back to Open
          // through `patch` left the rectification date on the defect, which is
          // what the occupier statement and the critical defect notice print --
          // an open defect carrying the day it was fixed.
          await reopenDefect(d.id);
        } else {
          await updateDefect(d.id, next === 'rectified' ? { status: 'rectified', rectifiedAt: at } : { status: next });
        }
      } catch (e) {
        showAlert('Not saved', describeActionFailure(e, 'saving the defect'));
        void load();
        return;
      }
      const fresh = await getDefect(d.id).catch(() => null);
      if (fresh) setDefect(fresh);
      if (move) await reportToOffice(move);
    })();
  };

  /**
   * Gives a defect the job it belongs to.
   *
   * Every defect raised before the app started recording a job has nothing in
   * this column, and without a job there is nowhere on the office's side to put a
   * note -- they work in jobs, not sites. Those defects would otherwise be
   * permanently unreportable, which is the same silence this whole change exists
   * to end, so there has to be a way to link one after the fact and this is it.
   *
   * Linking is itself the occasion for a note. It is the first moment anything
   * about this defect can reach Simpro, so the whole defect goes up as it now
   * stands rather than waiting for its next status change -- which for a defect
   * that was fixed last month is a change that is never coming.
   */
  const linkJob = async (job: JobSummary) => {
    if (!defect) return;
    setPicking(null);
    if (!job.externalId) {
      showAlert(
        'That job is not in Simpro yet',
        'This job only exists on this phone, so a note about the defect has nowhere to go. Pick one that has a '
          + 'job number, or sync first and try again.',
      );
      return;
    }
    setReport(null);
    setBusy(true);
    try {
      await updateDefect(defect.id, { jobId: job.externalId });
      const fresh = await getDefect(defect.id);
      if (fresh) setDefect(fresh);
      await reportToOffice('job linked');
    } catch (e) {
      showAlert('Not saved', describeActionFailure(e, 'setting the job on this defect'));
      void load();
    } finally {
      setBusy(false);
    }
  };

  /**
   * Deletes the defect from this phone, and only from this phone.
   *
   * Nothing is retracted at the other end, and that is a limit rather than an
   * oversight. `postJobNote` only ever POSTs: there is nothing in the Simpro
   * client that can amend or delete a note once it is on a job, and no existing
   * code in this app establishes how a correction to something already sent
   * should be worded -- an appended "disregard the note above" is a decision
   * about what the office and possibly the customer reads, not a mechanical one.
   * So where a defect has already been reported, deleting it here leaves that
   * note on the job. The wording below says as much, and the right fix is a
   * retraction note somebody in the office has agreed the words for.
   */
  const remove = () => {
    if (!defect) return;
    showAlert(
      'Delete this defect?',
      [
        defect.status === 'rectified'
          ? 'It is already rectified, so deleting it removes the record that it was ever found or fixed.'
          : 'Only do this for one raised in error. A defect that was real and is not fixed should be left open.',
        // Only where there is actually a note out there to be left behind.
        defect.jobId?.trim()
          ? `Anything already sent to job ${defect.jobId.trim()} stays on that job. Deleting it here does not take `
            + 'it back off, so ring the office if they need to know it was raised in error.'
          : undefined,
      ].filter(Boolean).join('\n\n'),
      [
        { text: 'Keep it' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteDefect(defect.id);
                router.back();
              } catch (e) {
                showAlert('Not deleted', describeActionFailure(e, 'deleting the defect'));
              }
            })();
          },
        },
      ],
    );
  };

  const wordingOptions = useMemo(
    () => (wordingQuery.trim() ? searchDefects(wordingQuery).slice(0, 8) : []),
    [wordingQuery],
  );

  const jobMatches = jobQuery.trim()
    ? jobs.filter((j) => `${j.externalId ?? ''} ${j.title}`.toLowerCase().includes(jobQuery.trim().toLowerCase()))
    : jobs;

  /*
   * The same list of jobs, for whichever of the two questions is being asked.
   * Written once because a second copy of it would be the one that drifts: the
   * search box, the cap at twenty and the way a job with no Simpro number reads
   * all have to match, or picking a job for photographs and picking a job for the
   * defect become two subtly different screens doing the same thing.
   */
  const jobPicker = (onPick: (job: JobSummary) => void) => (
    <View style={{ marginTop: t.space(2) }}>
      <SearchBox value={jobQuery} onChange={setJobQuery} placeholder="Job number or title" />
      {jobMatches.slice(0, 20).map((j) => (
        <Card key={j.id} onPress={() => onPick(j)}>
          <Txt weight="600">{j.externalId ? `Job ${j.externalId}` : j.title}</Txt>
          <Txt size="sm" tone="muted">{j.title}</Txt>
        </Card>
      ))}
      {!jobMatches.length ? (
        <Txt size="sm" tone="muted" style={{ marginTop: t.space(1), lineHeight: 19 }}>
          No jobs for this site on this phone. Sync, or ask the office to raise one.
        </Txt>
      ) : null}
      <Button title="Close" variant="ghost" onPress={() => setPicking(null)} />
    </View>
  );

  if (!defect) {
    return (
      <>
        <Stack.Screen options={{ title: 'Defect' }} />
        <RecordGate
          missing={missing}
          what="defect"
          why="It may have been deleted, or the link came from another device."
          failed={failed}
          onRetry={() => { void load(); }}
        />
      </>
    );
  }

  const critical = defect.severity === 'critical';

  return (
    <>
      <Stack.Screen options={{ title: critical ? 'Critical defect' : 'Defect' }} />
      <Screen>
        <Card>
          <Rowed align="flex-start">
            <View style={{ flex: 1 }}>
              <Txt weight="700" size="lg">{site?.name ?? 'Site not on this phone'}</Txt>
              <Txt size="sm" tone="muted">
                Raised {formatAuDate(qldIsoDay(defect.raisedAt) ?? defect.raisedAt)}
                {defect.defectCode ? ` · ${defect.defectCode}` : ''}
              </Txt>
            </View>
            <View style={{ alignItems: 'flex-end', gap: t.space(1) }}>
              <StatusPill
                label={defect.status === 'rectified' ? 'Rectified' : defect.status === 'quoted' ? 'Quoted' : 'Open'}
                tone={defect.status === 'rectified' ? 'pass' : defect.status === 'quoted' ? 'info' : 'warn'}
              />
              <Chip label={SEVERITY_LABEL[grade]} tone={critical ? 'fail' : grade === 'high' ? 'warn' : 'default'} />
            </View>
          </Rowed>
        </Card>

        {critical && !defect.noticeIssuedAt ? (
          <Banner
            tone="fail"
            title="The occupier is owed a written notice"
            body="Queensland gives them one within 24 hours of the maintenance. Open the notice, fill it and hand it over."
          />
        ) : null}
        {critical ? (
          <Button
            title={defect.noticeIssuedAt ? 'The critical defect notice' : 'Write the critical defect notice'}
            variant={defect.noticeIssuedAt ? 'secondary' : 'primary'}
            onPress={() => router.push({ pathname: '/work/notice/[id]', params: { id: defect.id } })}
          />
        ) : null}

        <H2>What is wrong</H2>
        <Field
          label="Description"
          value={defect.description}
          onChangeText={(v) => patch({ description: v })}
          multiline
        />
        <Field label="Where" value={defect.location} onChangeText={(v) => patch({ location: v })} />
        <Field
          label="Notes"
          value={defect.notes ?? ''}
          onChangeText={(v) => patch({ notes: v })}
          multiline
          hint="Anything the next person needs that is not the fault itself"
        />

        <Card>
          <Label>Reword it from the library</Label>
          <Txt size="sm" tone="muted" style={{ marginTop: t.space(1), lineHeight: 19 }}>
            The library’s wording is what the customer’s report prints and what the office quotes from.
          </Txt>
          <SearchBox value={wordingQuery} onChange={setWordingQuery} placeholder="battery, obstruction, tamper" />
          {wordingOptions.map((c) => (
            <Card key={c.code} onPress={() => { patch({ description: c.reportWording, defectCode: c.code }); setWordingQuery(''); }}>
              <Txt size="sm" weight="600">{c.code} · {SEVERITY_LABEL[c.severity]}</Txt>
              <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{c.reportWording}</Txt>
            </Card>
          ))}
        </Card>

        <H2>How bad</H2>
        <Rowed gap={2} wrap>
          {GRADES.map((g) => (
            <Chip key={g} label={SEVERITY_LABEL[g]} selected={grade === g} onPress={() => setGrade(g)} />
          ))}
        </Rowed>
        <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
          Critical is the statutory word: it starts the occupier’s notice and the 24 hour clock. The other three are
          how the work is prioritised, and the worst of them sorts first on every list.
        </Txt>

        <H2>Photographs</H2>
        {defect.photos.length === 0 ? (
          <Txt size="sm" tone="muted">None on this defect.</Txt>
        ) : (
          <Rowed gap={2} wrap>
            {defect.photos.map((p) => (
              <View key={p}>
                <Image
                  source={{ uri: photoUri(p) }}
                  style={{ width: 96, height: 96, borderRadius: t.radius.sm, backgroundColor: t.color.surfaceAlt }}
                />
                <Chip label="Remove" onPress={() => removePhoto(p)} />
              </View>
            ))}
          </Rowed>
        )}
        <Rowed gap={2}>
          <Button title="Take one" style={{ flex: 1 }} variant="secondary" loading={busy} onPress={() => { void addPhoto(true); }} />
          <Button title="From the roll" style={{ flex: 1 }} variant="secondary" loading={busy} onPress={() => { void addPhoto(false); }} />
        </Rowed>

        <Card>
          <Label>Photos onto a Simpro job</Label>
          <Txt size="sm" tone="muted" style={{ marginTop: t.space(1), lineHeight: 19 }}>
            Any job, any day — not just the one that was open when it was raised.
          </Txt>
          <Button
            title="Pick the job"
            variant="secondary"
            disabled={!defect.photos.length}
            onPress={() => { void openJobPicker('photos'); }}
            style={{ marginTop: t.space(2) }}
          />
          {!defect.photos.length ? (
            <Txt size="sm" tone="muted" style={{ marginTop: t.space(1) }}>Nothing to send yet.</Txt>
          ) : null}
          {picking === 'photos' ? jobPicker((j) => { void attachPhotos(j); }) : null}
        </Card>

        <H2>The job it belongs to</H2>
        <Card>
          <Label>Where the office reads about this defect</Label>
          {defect.jobId?.trim() ? (
            <Txt size="sm" style={{ marginTop: t.space(1), lineHeight: 19 }}>
              Job {defect.jobId.trim()}. Every change recorded here goes onto that job as a note, and the office
              reads it there.
            </Txt>
          ) : (
            <Txt size="sm" tone="muted" style={{ marginTop: t.space(1), lineHeight: 19 }}>
              No job yet. The office works in jobs rather than sites, so nothing about this defect can reach them
              until one is set — a defect raised before the app started recording the job always looks like this.
              Set it and the whole defect goes up as it now stands.
            </Txt>
          )}
          <Button
            title={defect.jobId?.trim() ? 'Change the job' : 'Set the job'}
            variant={defect.jobId?.trim() ? 'ghost' : 'primary'}
            loading={busy}
            onPress={() => { void openJobPicker('job'); }}
            style={{ marginTop: t.space(2) }}
          />
          {picking === 'job' ? jobPicker((j) => { void linkJob(j); }) : null}
        </Card>

        <H2>Where it stands</H2>
        <Rowed gap={2} wrap>
          <Chip label="Open" selected={defect.status === 'open'} onPress={() => moveStatus('open')} />
          <Chip label="Quoted" selected={defect.status === 'quoted'} onPress={() => moveStatus('quoted')} />
          <Chip label="Rectified" selected={defect.status === 'rectified'} onPress={() => moveStatus('rectified')} />
        </Rowed>
        {defect.rectifiedAt ? (
          <Txt size="sm" tone="muted">
            Rectified {formatAuDate(qldIsoDay(defect.rectifiedAt) ?? defect.rectifiedAt)}.
          </Txt>
        ) : null}
        {report ? <Banner tone={report.tone} title={report.title} body={report.body} /> : null}

        <Divider />
        <Button title="Delete this defect" variant="ghost" onPress={remove} />
      </Screen>
    </>
  );
}
