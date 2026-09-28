import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { createDefect, listSitePicks, type SitePick } from '@/db/repo';
import { newId } from '@/db';
import { listJobsFor } from '@/db/mirrorRepo';
import type { JobRecord } from '@/db/opsRepo';
import { queueDefectNote } from '@/db/opsRepo';
import { CAPTURE_QUALITY } from '@/domain/photoStore';
import { jobIsOpen } from '@/domain/jobPresentation';
import { attachmentsForDefect, type PhotoOutcome } from '@/domain/outboundWork';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { shrinkForStorage } from '@/export/photoResize';
import { keepPhoto } from '@/export/photoFiles';
import { addAssetEvent } from '@/db/assetRepo';
import { photosWithSizes } from '@/simpro/attachmentFiles';
import { queueJobAttachment } from '@/simpro/sync';
import { loadPrefs } from '@/app-prefs';
import { hasKey } from '@/ai/client';
import { draftDefectWording, MAX_CANDIDATES } from '@/ai/defectWording';
import { SYSTEM_LABELS, type SystemKind } from '@/seed/assetTypes';
import {
  DEFECT_LIBRARY, SEVERITY_LABEL, defectComponents, defectsForSystem, searchDefects,
  type DefectCode, type Severity,
} from '@/seed/defectLibrary';
import { useDraft } from '@/hooks/useDraft';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Chip, Divider, Field, H2, Label, Rowed, Screen, Txt } from '@/components/ui';
import { showAlert } from '@/components/alert';
import { SitePicker } from '@/components/SitePicker';

/**
 * Defect capture.
 *
 * A technician picks system, component and defect rather than writing prose.
 * The library supplies the severity, the formal wording and the work needed to
 * clear it, so the record reads the same whoever raised it and turns into a
 * quote without anyone retyping it. Free text is still there for the specifics
 * only the person standing in front of it knows.
 */

/**
 * What the mirror said about one site's jobs, with the site it was asked about.
 *
 * The site is kept alongside the answer so the screen can tell "the office has
 * no open job here" from "nobody has asked yet". Those two look identical as an
 * empty array, and only one of them is a fact about Simpro — a technician who is
 * told the site has no job when the read is still in flight, or threw, will put
 * the phone in their pocket believing the office cannot be told. Comparing the
 * site on the answer to the site on screen is what keeps them apart without a
 * second flag being set inside the effect.
 */
interface JobsAtSite {
  siteId: string;
  /** Open jobs with an office number on them. See jobIsOpen. */
  open: JobRecord[];
  /** Why the mirror would not read, in words a technician can act on. */
  failed?: string;
}

export default function NewDefectScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ siteId?: string; assetId?: string; location?: string }>();

  const [search, setSearch] = useState('');
  const [system, setSystem] = useState<SystemKind | null>(null);
  const [component, setComponent] = useState<string | null>(null);
  const [sites, setSites] = useState<SitePick[]>([]);
  const [saving, setSaving] = useState(false);
  /**
   * The office's open jobs at the chosen site, and which of them this defect
   * belongs to.
   *
   * This used to be "where the photographs go", and that is the whole reason a
   * defect raised here could never reach Simpro: the card offering the jobs was
   * rendered only when there was at least one photograph, so a defect written up
   * without one had no path to a job even in principle. A broken seal on an
   * extinguisher — the commonest defect there is, and one nobody photographs —
   * existed on the phone and nowhere else, and the only way the office heard
   * about it was somebody remembering to ring them. The job is the defect's own
   * now: it goes on the row, it carries the note, and the photographs follow it
   * rather than the other way round.
   *
   * Nothing is chosen by default where there is more than one open job, because
   * filing a fault against somebody else's attendance is worse than filing it
   * against none — but the card says that out loud rather than leaving an
   * untouched chip row to be read as "done".
   */
  const [jobsAtSite, setJobsAtSite] = useState<JobsAtSite | null>(null);
  /**
   * What the technician actually tapped, and at which site.
   *
   * Only their own choice is stored: null inside it means "keep it on the phone",
   * which is a decision and not the same as never having looked. Everything else
   * — including the default where the site has exactly one open job — is worked
   * out below from the jobs that were read, so the effect that reads them never
   * has to write a default and a site changed halfway through cannot leave the
   * previous site's job number sitting selected.
   */
  const [jobPick, setJobPick] = useState<{ siteId: string; jobId: string | null } | null>(null);
  /*
   * The model's offer to write the specifics up in the record's register.
   * Optional and small: with no key the button says why, and nothing else
   * on the screen changes. It sends the type's system, the picked code and
   * what was typed — never the site, the location or the customer.
   */
  const [aiOn, setAiOn] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);

  /**
   * Everything the user actually typed lives in a draft, so a lock screen, a
   * phone call or a low-memory kill costs nothing. Keyed by asset or site so
   * two half-written defects never overwrite each other.
   */
  const draft = useDraft(`defect:new:${params.assetId ?? params.siteId ?? 'unassigned'}`, {
    code: null as string | null,
    location: params.location ?? '',
    extra: '',
    /**
     * The sentence that goes on the record, kept apart from `extra` so the
     * model's draft never replaces what the technician typed. Blank, the
     * record is the library wording with the specifics after it, as ever.
     */
    wording: '',
    photos: [] as string[],
    severity: null as Severity | null,
    siteId: params.siteId as string | undefined,
  });
  const d = draft.value;
  const selected = d.code ? (DEFECT_LIBRARY.find((x) => x.code === d.code) ?? null) : null;

  const setLocation = (v: string) => draft.setValue((p) => ({ ...p, location: v }));
  const setExtra = (v: string) => draft.setValue((p) => ({ ...p, extra: v }));
  const setWording = (v: string) => draft.setValue((p) => ({ ...p, wording: v }));
  const setSeverity = (v: Severity) => draft.setValue((p) => ({ ...p, severity: v }));
  const setSiteId = (v: string | undefined) => draft.setValue((p) => ({ ...p, siteId: v }));
  const setPhotos = (fn: (prev: string[]) => string[]) =>
    draft.setValue((p) => ({ ...p, photos: fn(p.photos) }));
  const setSelected = (v: DefectCode | null) =>
    draft.setValue((p) => ({ ...p, code: v?.code ?? null }));

  const location = d.location;
  const extra = d.extra;
  // A draft saved before this field existed has no wording; that is blank, not lost.
  const wording = d.wording ?? '';
  const photos = d.photos;
  const severity = d.severity;
  const siteId = d.siteId;

  React.useEffect(() => {
    void listSitePicks().then((list) => {
      setSites(list);
      if (!siteId && list.length === 1) setSiteId(list[0]!.id);
    });
    // Only runs once the draft has loaded, so a recovered site choice wins.
  }, [siteId, draft.ready]);

  React.useEffect(() => { void hasKey().then(setAiOn); }, []);

  const writeUp = async () => {
    if (!selected) return;
    setAiBusy(true);
    setAiNote(null);
    try {
      // The picked code goes first so the model keeps it; the rest of its
      // component fills the candidate list, in case the specifics say the
      // technician picked a neighbour.
      const siblings = defectsForSystem(selected.system)
        .filter((c) => c.code !== selected.code && c.component === selected.component)
        .slice(0, MAX_CANDIDATES - 1);
      const result = await draftDefectWording({
        assetTypeLabel: selected.component,
        system: selected.system,
        observation: extra,
        candidates: [selected, ...siblings],
      });
      if (result.wording) {
        // Into its own field, beside what was typed rather than over it:
        // the observation is still the note, and still on the timeline.
        setWording(result.wording);
        setAiNote(result.code && result.code !== selected.code
          ? `Drafted, but under ${result.code} rather than ${selected.code}. Read it before you save; the code stays as you picked it and your words stay in the note.`
          : 'Drafted from what you wrote. Read it before you save — it is your record. Your words stay in the note.');
      } else {
        setAiNote(result.refusal ?? 'No wording came back.');
      }
    } catch (e) {
      setAiNote(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  };

  React.useEffect(() => {
    if (!siteId) return;
    let cancelled = false;
    const forSite = siteId;
    void listJobsFor({ siteId: forSite, limit: 50 })
      .then((rows) => {
        if (cancelled) return;
        setJobsAtSite({ siteId: forSite, open: rows.filter((j) => j.externalId && jobIsOpen(j)) });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // A mirror that would not read used to throw into nothing here, and the
        // screen then offered no jobs at all — which on screen is
        // indistinguishable from a site the office has no work at. Said out loud
        // instead, and the defect still saves: a read that failed is no reason to
        // lose the write-up.
        setJobsAtSite({ siteId: forSite, open: [], failed: describeLoadFailure(e, "the office's jobs at this site") });
      });
    return () => { cancelled = true; };
  }, [siteId]);

  /*
   * Only the answer for the site currently chosen counts. Change site and the
   * previous site's jobs are not this site's jobs, so they read as "not asked
   * yet" until the read for the new one lands.
   */
  const jobsHere = jobsAtSite && jobsAtSite.siteId === siteId ? jobsAtSite : null;
  const officeJobs = jobsHere?.open ?? [];
  const jobsFailed = jobsHere?.failed;
  const chosenJob = jobPick && jobPick.siteId === siteId ? jobPick : null;
  /**
   * The job this defect is filed against, or null for nowhere.
   *
   * One open job at the site is not a guess, it is the only answer there is, so
   * it is the default. Two or more and the default is nothing, because picking
   * for them would file the fault against somebody else's attendance — the card
   * below says so rather than leaving it to be noticed. A choice already made
   * wins, and is checked against the jobs read for this site so a number that
   * belongs to a job at another building can never be the answer.
   */
  const jobId: string | null = chosenJob
    ? (chosenJob.jobId && officeJobs.some((j) => j.externalId === chosenJob.jobId) ? chosenJob.jobId : null)
    : (officeJobs.length === 1 ? officeJobs[0]!.externalId! : null);

  const systems = useMemo(
    () => [...new Set(DEFECT_LIBRARY.map((d) => d.system))],
    [],
  );

  const searchResults = useMemo(() => (search.trim().length >= 2 ? searchDefects(search).slice(0, 25) : []), [search]);
  const components = useMemo(() => (system ? defectComponents(system) : []), [system]);
  const defects = useMemo(
    () => (system && component ? defectsForSystem(system).filter((d) => d.component === component) : []),
    [system, component],
  );

  const pick = (code: DefectCode) => {
    draft.setValue((p) => ({ ...p, code: code.code, severity: code.severity }));
    setSystem(code.system);
    setComponent(code.component);
    setSearch('');
  };

  const addPhoto = async (fromCamera: boolean) => {
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
    // Down to MAX_DIMENSION before it is kept. The picker's quality setting is
    // compression only, so without this a photograph is stored at whatever the
    // camera shot — a couple of megabytes each, on a handset already holding
    // every site offline.
    const sourceUri = await shrinkForStorage(result.assets[0]!);

    // Copy it out of the cache now rather than at save. The picker hands back a
    // URI the operating system may clear at any point, and a defect photograph
    // is evidence on a statutory notice — losing it produces no error, just a
    // record that quietly stops pointing at anything.
    try {
      const kept = keepPhoto({
        id: newId(),
        sourceUri,
        subject: 'defect',
        // The defect does not exist yet; its photographs are filed against it
        // on save, when it has an id.
        subjectId: 'pending',
        takenAt: new Date().toISOString(),
      });
      setPhotos((prev) => [...prev, kept.path]);
    } catch (e) {
      showAlert(
        'Could not keep that photo',
        `The photo was taken but could not be saved to this device, so it has not been attached. ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  };

  const save = async () => {
    if (!selected) return;
    if (!siteId) {
      showAlert('Which site?', 'Pick the site this defect belongs to.');
      return;
    }
    if (selected.photoRequired && !photos.length) {
      showAlert('Photo required', 'This defect type needs a photo as evidence. Add one before saving.');
      return;
    }

    setSaving(true);
    try {
      // The drafted (or hand-written) wording is the record where there is
      // one; otherwise the library wording with the specifics after it. The
      // observation goes in the note either way, so nothing typed is lost
      // to a better-worded sentence.
      const own = wording.trim();
      const observation = extra.trim();
      const description = own || [selected.reportWording, observation].filter(Boolean).join(' ');
      const technicianNote = observation ? `Technician note: ${observation}` : undefined;
      const grade = severity ?? selected.severity;
      const critical = grade === 'critical';
      /*
       * Re-checked against the jobs actually read for this site rather than
       * trusted from the chip that was tapped. The site can be changed after a
       * job is picked, and a job number belonging to the previous site would
       * otherwise go onto the row and into the note — a fault reported against a
       * building it is not in.
       */
      const job = jobId && officeJobs.some((j) => j.externalId === jobId) ? jobId : null;
      const defect = await createDefect({
        siteId,
        pointId: params.assetId,
        // The job on the row, not only in the note. The defect list, the notice
        // screen and the send screen all read the row, and a job that lived only
        // in a note nobody can query is a job this defect does not have.
        jobId: job ?? undefined,
        location: location.trim() || 'Location not recorded',
        description,
        severity: critical ? 'critical' : 'non-critical',
        // The grade the technician picked, kept. Critical is carried by
        // `severity` because the statutory tests hang off that word; High,
        // Medium and Low used to land identically and vanish.
        priority: critical ? undefined : grade,
        status: 'open',
        photos,
        // The library code and the AS 1851 class go on the record itself, not
        // only into the notes: the notice screen and the outbound report read
        // them from the row, and a row without them reads as non-critical.
        defectCode: selected.code,
        as1851Class: critical ? 'critical' : 'non-critical',
        notes: [selected.code, technicianNote].filter(Boolean).join('\n\n'),
      });

      // The asset timeline is what makes recurring failures visible later.
      // The observation rides with it where the wording replaced it in the
      // description, because "what the technician saw" is the useful half.
      if (params.assetId) {
        await addAssetEvent({
          assetId: params.assetId,
          kind: 'defect-raised',
          occurredAt: defect.raisedAt,
          summary: `${selected.defect} (${selected.code})`,
          detail: [description, own ? technicianNote : undefined].filter(Boolean).join('\n'),
          photos,
        });
      }

      await draft.discard();

      /*
       * Now the office's copy, and everything below happens after the defect is
       * safely on the phone: a queue that cannot be written must not take the
       * write-up with it.
       *
       * Photographs first, then the note, and that order is deliberate. The note
       * states how many photographs are going to the job and under what name, and
       * it can only state that truthfully once the queue has answered — a note
       * composed first would promise attachments that turned out to be duplicates
       * or missing files.
       *
       * Nothing is posted from here. Every item is queued, so a plant room in a
       * basement costs a wait rather than the defect: the queue survives the app
       * closing and goes up the moment there is signal.
       */
      const siteName = sites.find((s) => s.id === siteId)?.name ?? '';
      const plural = (n: number) => `${n} photo${n === 1 ? '' : 's'}`;
      const noteLines: string[] = [];
      const photoLines: string[] = [];
      let photoOutcome: PhotoOutcome | undefined;
      let title = 'Saved on the phone only';

      if (job && defect.photos.length) {
        // The plan declines a photograph whose file has gone and the queue
        // declines one it already holds, and both are said out loud rather than
        // counted as sent.
        try {
          const plan = attachmentsForDefect(
            { id: defect.id, location: defect.location, raisedAt: defect.raisedAt, photos: photosWithSizes(defect.photos) },
            { jobId: job, siteName },
          );
          let queued = 0;
          let duplicate = 0;
          for (const item of plan.items) {
            const row = await queueJobAttachment(item.payload);
            if (row.duplicate) duplicate++; else queued++;
          }
          // Handed to the note so its photograph line is the queue's own
          // reckoning and not a second count of the same files.
          photoOutcome = { going: queued, alreadyOnJob: duplicate, filename: plan.items[0]?.payload.filename };
          if (queued) photoLines.push(`${plural(queued)} queued for job #${job}. They go up with the next send.`);
          if (duplicate) photoLines.push(`${plural(duplicate)} already queued or on the job, so not sent twice.`);
          if (plan.missing) {
            photoLines.push(`${plural(plan.missing)} could not be found on this device and stay with the defect only.`);
          }
        } catch (e) {
          photoLines.push(describeActionFailure(e, `queue the photos for job #${job}`));
        }
      }

      if (job) {
        try {
          // Read here rather than before the save, so a settings file that will
          // not open costs the note its "Raised by" line and not the defect.
          const prefs = await loadPrefs();
          const note = await queueDefectNote(defect, job, {
            siteName,
            technician: prefs.technicianName || undefined,
            photos: photoOutcome,
          });
          title = note.queued ? 'The office has been told' : 'The office already has this';
          noteLines.push(note.queued
            ? `A note goes on job #${job} saying what failed, where it is, and what its class requires. `
              + 'It is queued now and sent as soon as this phone has signal.'
            : `Job #${job} already has this defect, word for word, so a second note was not queued.`);
        } catch (e) {
          // The one outcome that must never be quiet. The defect is on the phone
          // either way, but a technician who is not told the note failed drives
          // off believing the office is dealing with it.
          title = 'Saved, but the office was not told';
          noteLines.push(`${describeActionFailure(e, `queue the note for job #${job}`)}\n\n`
            + 'The defect is on the phone and on the job. Ring the office about this one.');
        }
      } else if (jobsFailed) {
        noteLines.push(`The defect is saved on this phone. The office's jobs here could not be read, so it has not `
          + `been sent to anybody: ${jobsFailed}`);
      } else if (!officeJobs.length) {
        noteLines.push('The defect is saved on this phone. The office has no open job at this site, so there is '
          + 'nowhere in Simpro to put it. Ring it through, or ask the office to raise a job here.');
      } else {
        noteLines.push('The defect is saved on this phone. No job was picked, so nothing about it has gone to the '
          + 'office.');
      }

      await new Promise<void>((resolve) => {
        showAlert(title, [...noteLines, ...photoLines].join('\n\n'), [{ text: 'OK', onPress: () => resolve() }]);
      });

      router.back();
    } catch (e) {
      showAlert('Could not save', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Raise defect' }} />
      <Screen>
        {draft.recovered ? (
          <Banner
            tone="info"
            title="Picked up where you left off"
            body="This defect was still being written when the app last closed. Nothing was lost."
          />
        ) : null}

        {!selected ? (
          <>
            <Field
              label="Search the defect library"
              value={search}
              onChangeText={setSearch}
              placeholder="e.g. failed discharge, contaminated, wedged open"
              autoCapitalize="none"
            />

            {searchResults.length ? (
              <>
                <Label>{searchResults.length} match{searchResults.length === 1 ? '' : 'es'}</Label>
                {searchResults.map((d) => <DefectRow key={d.code} defect={d} onPress={() => pick(d)} />)}
              </>
            ) : (
              <>
                <H2>System</H2>
                <Rowed gap={2} wrap>
                  {systems.map((s) => (
                    <Chip
                      key={s}
                      label={SYSTEM_LABELS[s]}
                      selected={system === s}
                      onPress={() => { setSystem(s); setComponent(null); }}
                    />
                  ))}
                </Rowed>

                {system ? (
                  <>
                    <H2>Component</H2>
                    <Rowed gap={2} wrap>
                      {components.map((c) => (
                        <Chip key={c} label={c} selected={component === c} onPress={() => setComponent(c)} />
                      ))}
                    </Rowed>
                  </>
                ) : null}

                {defects.length ? (
                  <>
                    <H2>Defect</H2>
                    {defects.map((d) => <DefectRow key={d.code} defect={d} onPress={() => pick(d)} />)}
                  </>
                ) : null}
              </>
            )}
          </>
        ) : (
          <>
            <Card>
              <Rowed style={{ justifyContent: 'space-between' }}>
                <Label>{selected.code}</Label>
                <Pressable onPress={() => setSelected(null)} hitSlop={8}>
                  <Txt size="sm" tone="accent" weight="700">Change</Txt>
                </Pressable>
              </Rowed>
              <Txt size="lg" weight="700" style={{ marginTop: 4 }}>{selected.defect}</Txt>
              <Txt size="sm" tone="muted">{SYSTEM_LABELS[selected.system]} · {selected.component}</Txt>
              <Divider />
              <Label>Report wording</Label>
              <Txt size="sm" style={{ lineHeight: 20, marginTop: 4 }}>{selected.reportWording}</Txt>
              {selected.clientWording ? (
                <>
                  <View style={{ height: t.space(2) }} />
                  <Label>Client wording</Label>
                  <Txt size="sm" tone="muted" style={{ lineHeight: 20, marginTop: 4 }}>{selected.clientWording}</Txt>
                </>
              ) : null}
              {selected.rectification ? (
                <>
                  <View style={{ height: t.space(2) }} />
                  <Label>Rectification</Label>
                  <Txt size="sm" tone="muted" style={{ lineHeight: 20, marginTop: 4 }}>{selected.rectification}</Txt>
                </>
              ) : null}
            </Card>

            {selected.quoteItems?.length ? (
              <Card>
                <Label>Quote lines this generates</Label>
                <View style={{ marginTop: t.space(2), gap: 6 }}>
                  {selected.quoteItems.map((q, i) => (
                    <Rowed key={i} style={{ justifyContent: 'space-between' }}>
                      <Txt size="sm" style={{ flex: 1 }}>{q.description}</Txt>
                      <Txt size="sm" tone="muted">{q.qtyPerDefect} {q.unit}</Txt>
                    </Rowed>
                  ))}
                </View>
              </Card>
            ) : null}

            <H2>Severity</H2>
            <Rowed gap={2}>
              {(['critical', 'high', 'medium', 'low'] as Severity[]).map((s) => (
                <Chip key={s} label={SEVERITY_LABEL[s]} selected={severity === s} onPress={() => setSeverity(s)} />
              ))}
            </Rowed>
            {severity !== selected.severity ? (
              <Banner
                tone="info"
                title="Severity changed from the library default"
                body={`The library rates this ${SEVERITY_LABEL[selected.severity].toLowerCase()}. Your reason for changing it should go in the note below.`}
              />
            ) : null}

            {sites.length > 1 ? (
              <SitePicker sites={sites} value={siteId} onChange={setSiteId} />
            ) : null}

            <Field label="Location" value={location} onChangeText={setLocation} placeholder="Level 3, east corridor, near stair 2" />
            <Field
              label="Anything specific to this one"
              value={extra}
              onChangeText={setExtra}
              multiline
              placeholder="Only what the standard wording does not already say"
            />
            <Rowed gap={2} align="flex-start">
              <Txt size="xs" tone="faint" style={{ flex: 1, lineHeight: 17 }}>
                {aiOn
                  ? 'Write it up puts what you typed into the record\'s register. It sends the code, the system and your words — never the site or the location.'
                  : 'No API key is set, so the wording above is the record. A key goes in Settings.'}
              </Txt>
              <Button
                title="Write it up"
                variant="secondary"
                compact
                disabled={!aiOn || extra.trim().length < 4}
                loading={aiBusy}
                onPress={() => void writeUp()}
                icon={<MaterialCommunityIcons name="auto-fix" size={16} color={t.color.text} />}
              />
            </Rowed>
            {aiNote ? <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{aiNote}</Txt> : null}
            <Field
              label="Wording on the record"
              value={wording}
              onChangeText={setWording}
              multiline
              placeholder={[selected.reportWording, extra.trim()].filter(Boolean).join(' ')}
              hint={wording.trim() ? 'What you typed above still goes in the note.' : 'Left blank, the record reads as the placeholder above.'}
            />

            <H2>Photos{selected.photoRequired ? ' — required' : ''}</H2>
            <Rowed gap={2}>
              <Button title="Camera" variant="secondary" style={{ flex: 1 }} onPress={() => void addPhoto(true)} icon={<MaterialCommunityIcons name="camera-outline" size={16} color={t.color.text} />} />
              <Button title="Library" variant="secondary" style={{ flex: 1 }} onPress={() => void addPhoto(false)} />
            </Rowed>
            {photos.length ? (
              <Txt size="sm" tone="pass">{photos.length} photo{photos.length === 1 ? '' : 's'} attached</Txt>
            ) : selected.photoRequired ? (
              <Txt size="sm" tone="warn">This defect type needs photographic evidence.</Txt>
            ) : null}

            {/*
              * Which job this defect belongs to — shown whenever a site is
              * chosen, photograph or no photograph. It sat behind
              * `photos.length && officeJobs.length` until now, which meant the
              * only defect that could reach the office was one somebody had
              * taken a picture of, and every state where it cannot reach the
              * office was silent. Each of those states says so here in words,
              * because a technician must never walk away believing the office
              * was told when it was not.
              */}
            {siteId ? (
              <Card>
                <Label>Send to the office</Label>
                {jobsFailed ? (
                  <Txt size="sm" tone="warn" style={{ marginTop: 4, lineHeight: 20 }}>
                    {jobsFailed}{' '}The defect still saves on this phone; it just cannot be put on a job until the
                    office&apos;s work here can be read.
                  </Txt>
                ) : !jobsHere ? (
                  <Txt size="sm" tone="muted" style={{ marginTop: 4, lineHeight: 20 }}>
                    Reading the office&apos;s open jobs at this site.
                  </Txt>
                ) : (
                  <>
                    <Txt size="sm" style={{ marginTop: 4, lineHeight: 20 }}>
                      {jobId
                        ? `This defect goes on job #${jobId}: one note saying what failed, where it is and what its `
                          + `class requires${photos.length ? `, and ${photos.length === 1 ? 'the photo' : `all ${photos.length} photos`} onto the same job` : ''}. `
                          + 'Queued when you save and sent as soon as there is signal.'
                        : !officeJobs.length
                          ? 'The office has no open job at this site, so there is nowhere in Simpro to put this '
                            + 'defect. It saves on the phone either way — ring it through, or ask the office to raise '
                            + 'a job here.'
                          : officeJobs.length === 1
                            ? 'Nothing goes to the office. The defect stays on this phone only.'
                            : `The office has ${officeJobs.length} open jobs here, and picking the wrong one files `
                              + 'this fault against somebody else\'s work. Pick the job this defect belongs to, or '
                              + 'nothing about it reaches the office.'}
                    </Txt>
                    {officeJobs.length ? (
                      <Rowed gap={2} wrap style={{ marginTop: t.space(2) }}>
                        {officeJobs.map((j) => (
                          <Chip
                            key={j.id}
                            label={`Job #${j.externalId}${j.title ? ` · ${j.title}` : ''}`}
                            selected={jobId === j.externalId}
                            onPress={() => setJobPick({ siteId, jobId: jobId === j.externalId ? null : j.externalId! })}
                          />
                        ))}
                        <Chip
                          label="Keep on the phone"
                          selected={jobId === null}
                          onPress={() => setJobPick({ siteId, jobId: null })}
                        />
                      </Rowed>
                    ) : null}
                  </>
                )}
              </Card>
            ) : null}

            <Button title="Save defect" onPress={save} loading={saving} />
          </>
        )}
      </Screen>
    </>
  );
}

function DefectRow({ defect, onPress }: { defect: DefectCode; onPress: () => void }) {
  const t = useTheme();
  const tone = defect.severity === 'critical' ? 'fail' : defect.severity === 'high' ? 'warn' : 'default';
  return (
    <Card onPress={onPress}>
      <Rowed gap={2} align="flex-start">
        <View style={{ flex: 1 }}>
          <Txt weight="600">{defect.defect}</Txt>
          <Txt size="sm" tone="muted">{SYSTEM_LABELS[defect.system]} · {defect.component}</Txt>
        </View>
        <Chip label={SEVERITY_LABEL[defect.severity]} tone={tone === 'fail' ? 'fail' : tone === 'warn' ? 'warn' : 'default'} />
      </Rowed>
      <Txt size="xs" tone="faint" style={{ marginTop: 6 }} numberOfLines={2}>{defect.reportWording}</Txt>
    </Card>
  );
}
