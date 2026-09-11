import React, { useCallback, useMemo, useState } from 'react';
import { Image, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { deleteDefect, getDefect, getSite, updateDefect } from '@/db/repo';
import { attachmentsForDefect } from '@/domain/outboundWork';
import { photosWithSizes } from '@/simpro/attachmentFiles';
import { queueJobAttachment } from '@/simpro/sync';
import { listJobPage, type JobSummary } from '@/db/opsRepo';
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
  const [pickingJob, setPickingJob] = useState(false);
  const [jobQuery, setJobQuery] = useState('');
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
        const stored = keepPhoto({
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

  const openJobPicker = async () => {
    if (!defect) return;
    setPickingJob(true);
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
    setPickingJob(false);
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

  const remove = () => {
    if (!defect) return;
    showAlert(
      'Delete this defect?',
      defect.status === 'rectified'
        ? 'It is already rectified, so deleting it removes the record that it was ever found or fixed.'
        : 'Only do this for one raised in error. A defect that was real and is not fixed should be left open.',
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
            onPress={() => { void openJobPicker(); }}
            style={{ marginTop: t.space(2) }}
          />
          {!defect.photos.length ? (
            <Txt size="sm" tone="muted" style={{ marginTop: t.space(1) }}>Nothing to send yet.</Txt>
          ) : null}
          {pickingJob ? (
            <View style={{ marginTop: t.space(2) }}>
              <SearchBox value={jobQuery} onChange={setJobQuery} placeholder="Job number or title" />
              {jobMatches.slice(0, 20).map((j) => (
                <Card key={j.id} onPress={() => { void attachPhotos(j); }}>
                  <Txt weight="600">{j.externalId ? `Job ${j.externalId}` : j.title}</Txt>
                  <Txt size="sm" tone="muted">{j.title}</Txt>
                </Card>
              ))}
              <Button title="Close" variant="ghost" onPress={() => setPickingJob(false)} />
            </View>
          ) : null}
        </Card>

        <H2>Where it stands</H2>
        <Rowed gap={2} wrap>
          <Chip
            label="Open"
            selected={defect.status === 'open'}
            onPress={() => patch({ status: 'open', rectifiedAt: undefined })}
          />
          <Chip label="Quoted" selected={defect.status === 'quoted'} onPress={() => patch({ status: 'quoted' })} />
          <Chip
            label="Rectified"
            selected={defect.status === 'rectified'}
            onPress={() => patch({ status: 'rectified', rectifiedAt: nowIso() })}
          />
        </Rowed>
        {defect.rectifiedAt ? (
          <Txt size="sm" tone="muted">
            Rectified {formatAuDate(qldIsoDay(defect.rectifiedAt) ?? defect.rectifiedAt)}.
          </Txt>
        ) : null}

        <Divider />
        <Button title="Delete this defect" variant="ghost" onPress={remove} />
      </Screen>
    </>
  );
}
