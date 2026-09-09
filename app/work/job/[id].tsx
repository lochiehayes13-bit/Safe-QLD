import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { loadPrefs } from '@/app-prefs';
import { newId, nowIso } from '@/db';
import { distinctJobStatuses, enqueueSync, setJobStatus, listKnowledge, type KnowledgeNote } from '@/db/opsRepo';
import { getCustomer, getJobFull, type AttachmentRecord, type CustomerRecord, type JobFull } from '@/db/mirrorRepo';
import { listVendorOrdersForJob, searchCatalogItems, type CatalogItemRecord, type VendorOrderRecord } from '@/db/moreRepo';
import { getSite, listDefects } from '@/db/repo';
import { assetCountsBySystem } from '@/db/assetRepo';
import { listRoutineRuns } from '@/db/routineRunRepo';
import { JOB_RECORDS_PRIVACY_NOTE, draftJobBrief, type JobBrief } from '@/ai/jobBrief';
import { draftOfficeNote } from '@/ai/officeNote';
import { hasKey } from '@/ai/client';
import type { Defect, Site } from '@/domain/types';
import type { SimproCostCenter, SimproItem, SimproSection } from '@/simpro/mirrorResources';
import {
  attachmentIcon, contactActions, discountLabel, formatFileSize, formatQty, invoiceState, itemHeading, itemPrice, jobDates,
  jobStatusWord, localStateWord, qldClock, relativeQldTime, sectionLineCount, sellTotalLine, stageLabel, statusSwatch, taskState,
  technicianLine,
} from '@/domain/jobPresentation';
import { qldIsoDay, qldMoment } from '@/domain/qldTime';
import {
  JOB_MATERIAL_KIND, JOB_SIGNOFF_KIND, JOB_STATUS_KIND, materialContentKey, materialLine, officeStatusFor, signOffNote,
  signatureFilename, statusChoices, statusContentKey, statusPayload, type JobMaterialPayload, type StatusChoice,
} from '@/domain/jobActions';
import { attachmentContentKey, attachmentFilename, mimeTypeForPhoto } from '@/domain/outboundWork';
import { CAPTURE_QUALITY, PHOTO_DIR, photoPath } from '@/domain/photoStore';
import { keepPhoto } from '@/export/photoFiles';
import { shrinkForStorage } from '@/export/photoResize';
import { formatCents } from '@/domain/rates';
import { formatAuDate } from '@/export/sheets';
import { simproConfigFromPrefs } from '@/simpro/config';
import { queueJobAttachment, queueJobNote, syncJobDetail } from '@/simpro/sync';
import { flushSoon } from '@/simpro/flushSoon';
import { readUserSession } from '@/simpro/userSession';
import { describeOpenOutcome, openAttachment } from '@/services/simproAttachments';
import { useTheme } from '@/theme';
import { animateNextLayout } from '@/components/motion';
import { Banner, Button, Card, Chip, Field, H2, Label, Rowed, Screen, SearchBox, Segmented, StatTile, StatusPill, Txt } from '@/components/ui';
import { RecordGate } from '@/components/RecordGate';
import { SignaturePad } from '@/components/SignaturePad';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { showAlert } from '@/components/alert';

/**
 * Job detail — the office's record, and the site briefing under it.
 *
 * This screen used to show a heading and a blank. Everything the office
 * holds on a job is here now: who it is for, who is booked, what the
 * sections and lines are, the files, the activity feed, the tasks and the
 * invoices — read from the phone, so it works in a basement, and refreshed
 * from Simpro in the background when the screen opens with signal.
 *
 * Under that is what the phone knows and the office does not: what is
 * already broken here, what the last person found, how many assets there
 * are. That is the difference between arriving informed and arriving cold.
 *
 * Money on this screen is the sell side only. The mirror never held a cost
 * or a margin, so there is nothing here that could show one.
 *
 * Under "Do" is what Simpro Mobile lets a person do from the job and this
 * card could not: move the office's status, write a note, add the parts
 * used, attach a photograph, and have the customer sign it off. Each is a
 * queue row (see @/domain/jobActions) so it goes when there is signal and
 * shows here as queued until the next detail sync brings the office's copy
 * back. Every one opens as a sheet over the card rather than a screen of
 * its own, because the card is the context and a technician with a glove
 * on wants one tap back to it.
 */

/** Which sheet is open over the card. */
type Sheet = 'status' | 'note' | 'materials' | 'signoff' | null;

type Refresh =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'done'; partial: string[] }
  | { state: 'failed'; error: string };

export default function JobScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [full, setFull] = useState<JobFull | null>(null);
  // Loaded-and-absent is not the same as still loading. See RecordGate.
  const [missing, setMissing] = useState(false);
  // And a read that threw is neither. See RecordGate.
  const [failed, setFailed] = useState<string | null>(null);
  const [site, setSite] = useState<Site | null>(null);
  const [defects, setDefects] = useState<Defect[]>([]);
  const [assetCount, setAssetCount] = useState(0);
  const [knowledge, setKnowledge] = useState<KnowledgeNote[]>([]);
  const [refresh, setRefresh] = useState<Refresh>({ state: 'idle' });
  const [opening, setOpening] = useState<string | null>(null);
  const [showAllTimeline, setShowAllTimeline] = useState(false);
  // Set on the way into complete on this screen: the note to the office is
  // queued by the status write, and the person who pressed the button is
  // told so here, once, rather than left to find it on the outbound screen.
  const [noteQueued, setNoteQueued] = useState(false);
  // The three sentences from the job card, or why there are none. Not in the
  // draft and not kept across jobs: a brief is read once, on the way in.
  const [brief, setBrief] = useState<JobBrief | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);
  const refreshing = useRef(false);
  /** The customer's own phone and email, read from the mirror when the job names one. */
  const [customer, setCustomer] = useState<CustomerRecord | null>(null);
  /** Purchase orders raised against this job, newest first. */
  const [orders, setOrders] = useState<VendorOrderRecord[]>([]);
  /** The office's statuses, joined to their ids; see statusChoices. */
  const [statuses, setStatuses] = useState<StatusChoice[]>([]);
  const [sheet, setSheet] = useState<Sheet>(null);
  /** Which action is mid-flight, for its spinner. */
  const [acting, setActing] = useState<'photo' | 'status' | 'note' | 'signoff' | null>(null);
  /**
   * What this screen queued for the office since it opened, in a person's
   * words. The rows are on Waiting to send; this is the answer to "did the
   * button work", on the card, once.
   */
  const [queuedWords, setQueuedWords] = useState<string[]>([]);
  /**
   * Lines added here and not yet seen back from the office. Shown under
   * their cost centre as queued, and dropped one by one as a detail sync
   * brings each back as a real line — never all at once on a sync, since
   * the sync may land before the queue has gone.
   */
  const [queuedLines, setQueuedLines] = useState<JobMaterialPayload[]>([]);

  const load = useCallback(async () => {
    if (!id) return;
    setFailed(null);
    try {
      const f = await getJobFull(id);
      setFull(f);
      setMissing(!f);
      if (f?.job.siteId) {
        const [s, d, a, k] = await Promise.all([
          getSite(f.job.siteId),
          listDefects(f.job.siteId, 'open'),
          // A count, not the rows: the briefing wants a number.
          assetCountsBySystem(f.job.siteId),
          listKnowledge({ siteId: f.job.siteId }),
        ]);
        setSite(s); setDefects(d); setAssetCount(a.reduce((n, x) => n + x.count, 0)); setKnowledge(k);
      }
      if (f?.job.externalId) {
        const [c, o, st] = await Promise.all([
          f.job.customerExternalId ? getCustomer(f.job.customerExternalId) : Promise.resolve(null),
          listVendorOrdersForJob(f.job.externalId),
          distinctJobStatuses(),
        ]);
        setCustomer(c); setOrders(o); setStatuses(statusChoices(st));
        setQueuedLines((prev) => prev.filter((q) => !lineIsHeld(f.sections, q)));
      }
      return f;
    } catch (e) {
      setFailed(describeLoadFailure(e, 'this job'));
    }
  }, [id]);

  /**
   * The office's copy, read in the background.
   *
   * Never blocks the screen: what the phone holds is on screen first, and
   * the refreshed copy replaces it when it lands. The sync itself skips a
   * job read in the last quarter hour, so flicking back to this screen
   * costs nothing.
   */
  const refreshFromOffice = useCallback(async (jobId: string) => {
    if (refreshing.current) return;
    refreshing.current = true;
    setRefresh({ state: 'running' });
    try {
      const prefs = await loadPrefs();
      const outcome = await syncJobDetail(simproConfigFromPrefs(prefs), jobId);
      if (outcome.status === 'synced') {
        await load();
        setRefresh({ state: 'done', partial: outcome.partial });
      } else if (outcome.status === 'failed') {
        setRefresh({ state: 'failed', error: outcome.error });
      } else {
        setRefresh({ state: 'idle' });
      }
    } catch (e) {
      setRefresh({ state: 'failed', error: e instanceof Error ? e.message : String(e) });
    } finally {
      refreshing.current = false;
    }
  }, [load]);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    void (async () => {
      const f = await load();
      if (cancelled || !f?.job.externalId) return;
      void refreshFromOffice(f.job.id);
    })();
    return () => { cancelled = true; };
  }, [load, refreshFromOffice]));

  useEffect(() => { setShowAllTimeline(false); setNoteQueued(false); setBrief(null); setQueuedWords([]); setQueuedLines([]); setSheet(null); }, [id]);

  /**
   * Three sentences before walking in, from the job card on this phone.
   *
   * The switch is read here and again inside draftJobBrief: here so a
   * technician who has it off is shown what turning it on would send and
   * where the switch is, rather than a refusal; there so no screen can send
   * a job card by passing a flag. Everything handed over is a field of this
   * screen's own record — nothing is fetched for the purpose.
   */
  const briefMe = async (f: JobFull) => {
    const prefs = await loadPrefs();
    if (!prefs.aiShareJobRecords) {
      showAlert('Brief me is off', JOB_RECORDS_PRIVACY_NOTE, [
        { text: 'Not now', style: 'cancel' },
        { text: 'Turn on in Settings', onPress: () => router.push('/settings') },
      ]);
      return;
    }
    setBriefBusy(true);
    try {
      const j = f.job;
      // The last routine run here, where the phone has one. One row, newest
      // first, so a site with years of them costs the same as one with none.
      const lastRun = j.siteId ? (await listRoutineRuns(j.siteId, 1))[0] : undefined;
      const result = await draftJobBrief({
        jobNumber: j.externalId,
        title: j.title,
        jobType: j.jobTypeRaw ?? j.jobType,
        description: j.descriptionText,
        officeNotes: j.notesText,
        notes: f.notes.map((n) => ({ subject: n.subject, note: n.note, createdAt: n.createdAt })),
        siteNotes: site?.notes,
        openDefects: defects.map((d) => ({
          location: d.location,
          description: d.description,
          severity: d.severity === 'critical' ? 'critical' : 'non-critical',
        })),
        lastServicedAt: lastRun?.completedAt,
        lastServiceSummary: lastRun
          ? `${lastRun.routineLabel}: ${lastRun.checksPassed} passed, ${lastRun.checksFailed} failed, ${lastRun.defectsRaised} defect${lastRun.defectsRaised === 1 ? '' : 's'} raised`
          : undefined,
        scheduledFor: j.scheduledFor,
      });
      setBrief(result);
    } catch (e) {
      setBrief({ refusal: describeActionFailure(e, 'draft the brief') });
    } finally {
      setBriefBusy(false);
    }
  };

  /**
   * The phone's own status on the job, then the row read back.
   *
   * Read back rather than patched in memory, because the write stamps
   * startedAt or completedAt and queues the note to the office, and the
   * screen shows both. The name on the note is whoever is signed in to
   * Simpro on this phone, else the technician name in Settings; the job's
   * technician field is everyone the office booked, which is not who
   * pressed the button.
   */
  const setStatus = async (jobId: string, status: 'in-progress' | 'complete') => {
    const [prefs, session] = await Promise.all([loadPrefs(), readUserSession()]);
    const completedBy = session?.label?.trim() || prefs.technicianName.trim() || undefined;
    await setJobStatus(jobId, status, { completedBy });
    const f = await load();
    if (status === 'complete' && f?.job.externalId) setNoteQueued(true);
  };

  if (!full) return <RecordGate missing={missing} what="job" failed={failed} onRetry={() => { void load(); }} />;

  const { job } = full;
  const critical = defects.filter((d) => d.severity === 'critical');
  const status = jobStatusWord(job);
  // What the phone did that the office's pill does not say. The pill keeps
  // the office's word, so after Start job or Mark complete this is the only
  // thing on screen that says the button worked.
  const local = localStateWord(job);
  const localAt = job.status === 'complete' ? job.completedAt : job.status === 'in-progress' ? job.startedAt : undefined;
  const localClock = qldClock(localAt);
  const swatch = statusSwatch(job.statusColor, t.color.surface);
  const stage = stageLabel(job.stageRaw ?? job.stage);
  const isSimpro = !!job.externalId;
  // scheduledFor is Simpro's DateIssued on a mirrored job and the booked day
  // on one added by hand; the office's word is only right for the office's.
  const dates = jobDates(job).map((d) => (d.label === 'Issued' && !isSimpro ? { ...d, label: 'Scheduled' } : d));
  const sell = sellTotalLine(job.totalExTaxCents, job.totalIncTaxCents);
  const technicians = technicianLine(full.technicians, job.technician);
  const contact = full.siteContact;
  const contactWays = contactActions(contact);
  const now = nowIso();
  const today = qldIsoDay(now) ?? '';
  const timeline = showAllTimeline ? full.timeline : full.timeline.slice(0, 12);
  const customerWays = contactActions(customer ? { workPhone: customer.phone, mobile: customer.altPhone, email: customer.email } : undefined);
  const suggested = job.status === 'complete' ? officeStatusFor('complete', statuses) : officeStatusFor('in-progress', statuses);
  const said = (what: string) => setQueuedWords((prev) => [...prev, what]);

  /**
   * The office's status, moved from the phone.
   *
   * Queued, not sent, and the phone's own state moves with it where the
   * office's word means the same thing: In Progress starts the job here,
   * a Completed status finishes it and queues the work-completed note as
   * Mark complete would. Any other status is the office's alone.
   */
  const queueStatus = async (choice: StatusChoice & { id: string }) => {
    if (!job.externalId) return;
    setActing('status');
    try {
      const p = statusPayload({ jobId: job.externalId, status: choice, at: nowIso() });
      const row = await enqueueSync(JOB_STATUS_KIND, p, { contentKey: statusContentKey(p) });
      if (!row.duplicate) flushSoon();
      setSheet(null);
      said(`Status to ${choice.name}`);
      const meansStarted = !!officeStatusFor('in-progress', [choice]);
      const meansDone = !!officeStatusFor('complete', [choice]);
      if (meansDone && job.status !== 'complete') await setStatus(job.id, 'complete');
      else if (meansStarted && job.status !== 'in-progress' && job.status !== 'complete') await setStatus(job.id, 'in-progress');
    } catch (e) {
      showAlert('Could not queue that', describeActionFailure(e, 'queue the status change'));
    } finally {
      setActing(null);
    }
  };

  const queueNote = async (subject: string, note: string) => {
    if (!job.externalId) return;
    setActing('note');
    try {
      await queueJobNote({ jobId: job.externalId, subject: subject.trim() || 'Note from site', note: note.trim() });
      setSheet(null);
      said(`Note: ${subject.trim() || 'Note from site'}`);
    } catch (e) {
      showAlert('Could not queue that note', describeActionFailure(e, 'queue the note'));
    } finally {
      setActing(null);
    }
  };

  /** One line for a cost centre. Returns why it was refused, or nothing once it is queued. */
  const queueMaterial = async (input: Omit<Parameters<typeof materialLine>[0], 'jobId' | 'at'>): Promise<string | undefined> => {
    if (!job.externalId) return 'This job has no Simpro job number.';
    const check = materialLine({ ...input, jobId: job.externalId, at: nowIso() });
    if (!check.ok) return check.why;
    const row = await enqueueSync(JOB_MATERIAL_KIND, check.payload, { contentKey: materialContentKey(check.payload) });
    if (!row.duplicate) flushSoon();
    setQueuedLines((prev) => [...prev, check.payload]);
    said(`${check.payload.qty} × ${check.payload.description}`);
    return undefined;
  };

  /**
   * A photograph onto the job's attachments, the way a defect's go: kept in
   * document storage the moment it is taken, then queued by path so the
   * megabytes are read when there is signal. Named by site, job and day so
   * the office can read it off the file list.
   */
  const addPhoto = async (fromCamera: boolean) => {
    if (!job.externalId) return;
    setActing('photo');
    try {
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        showAlert('Permission needed', 'Safe QLD needs access to attach a photo to this job.');
        return;
      }
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({ quality: CAPTURE_QUALITY })
        : await ImagePicker.launchImageLibraryAsync({ quality: CAPTURE_QUALITY });
      if (result.canceled || !result.assets[0]) return;
      const takenAt = nowIso();
      const sourceUri = await shrinkForStorage(result.assets[0]!);
      // 'site' is the nearest subject the photo store names; the job is the subject id.
      const kept = keepPhoto({ id: newId(), sourceUri, subject: 'site', subjectId: job.id, takenAt });
      const filename = attachmentFilename({
        siteName: job.siteName, location: `Job ${job.externalId} ${qldClock(takenAt)?.replace(':', '') ?? ''}`.trim(), raisedAt: takenAt, path: kept.path,
      });
      const sizeBytes = kept.byteSize ?? 0;
      const key = attachmentContentKey({ jobId: job.externalId, filename, sizeBytes });
      const row = await queueJobAttachment({
        jobId: job.externalId, localUri: kept.path, filename, mimeType: mimeTypeForPhoto(kept.path),
        subject: `Photo on job ${job.externalId}, ${job.siteName}`, sizeBytes, key,
      });
      said(row.duplicate ? `Photo already queued: ${filename}` : `Photo: ${filename}`);
    } catch (e) {
      showAlert('Could not attach that photo', describeActionFailure(e, 'attach the photo'));
    } finally {
      setActing(null);
    }
  };

  /**
   * The customer's sign-off: the signature as a file on the job, a note
   * that names who signed and where the file is, and the phone's own
   * complete — which queues the work-completed note as Mark complete does.
   * The file is written to document storage beside the photographs, so it
   * survives a cache clear and is read by the same path the photographs
   * are.
   */
  const signOff = async (signedBy: string, svg: string) => {
    if (!job.externalId) return;
    setActing('signoff');
    try {
      const at = nowIso();
      const filename = signatureFilename(job.externalId, at);
      const dir = new Directory(Paths.document, PHOTO_DIR);
      if (!dir.exists) dir.create({ intermediates: true });
      const stored = filename.replace(/[^A-Za-z0-9 ._-]/g, '_');
      const file = new File(dir, stored);
      if (file.exists) file.delete();
      file.create();
      file.write(svg);
      const sizeBytes = new TextEncoder().encode(svg).length;
      const key = attachmentContentKey({ jobId: job.externalId, filename, sizeBytes });
      await queueJobAttachment({
        jobId: job.externalId, localUri: photoPath(stored), filename, mimeType: 'image/svg+xml',
        subject: `Customer signature, ${signedBy.trim()}`, sizeBytes, key,
      });
      const note = signOffNote({ externalId: job.externalId, title: job.title, siteName: job.siteName }, signedBy, at);
      const row = await enqueueSync(JOB_SIGNOFF_KIND, note, { contentKey: note.noteKey });
      if (!row.duplicate) flushSoon();
      setSheet(null);
      said(`Signed off by ${signedBy.trim()}`);
      if (job.status !== 'complete') await setStatus(job.id, 'complete');
    } catch (e) {
      showAlert('Could not sign off', describeActionFailure(e, 'sign this job off'));
    } finally {
      setActing(null);
    }
  };

  const open = async (a: AttachmentRecord) => {
    if (!job.externalId || opening) return;
    setOpening(a.id);
    try {
      const outcome = await openAttachment({ kind: 'job', localJobId: job.id, externalId: job.externalId }, a);
      const words = describeOpenOutcome(outcome);
      if (words) showAlert(words.title, words.body);
      else await load();
    } catch (e) {
      // The spinner on the row stops either way; without this the tap simply
      // stopped meaning anything, which reads as the attachment being broken.
      showAlert('Could not open that attachment', describeActionFailure(e, 'open this attachment'));
    } finally {
      setOpening(null);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: job.externalId ? `Job ${job.externalId}` : job.siteName }} />
      <Screen>
        {/* -- The office's header ------------------------------------------ */}
        <Rowed gap={2} align="flex-start">
          <View style={{ flex: 1 }}>
            <Txt size="xl" weight="700">{job.title}</Txt>
            <Rowed gap={1.5} wrap style={{ marginTop: t.space(1.5) }}>
              {swatch ? (
                <OfficePill label={status.label} fill={swatch.fill} outlined={swatch.outlined} />
              ) : (
                <StatusPill label={status.label} tone={status.tone} />
              )}
              {stage && stage !== status.label ? <Chip label={stage} /> : null}
              {local ? <Chip label={localClock ? `${local.label} ${localClock}` : local.label} tone={local.tone === 'muted' || local.tone === 'info' ? 'default' : local.tone} /> : null}
              {job.jobTypeRaw ?? job.jobType ? <Chip label={(job.jobTypeRaw ?? job.jobType)!} /> : null}
              {job.priority === 'urgent' ? <Chip label="Urgent" tone="fail" /> : null}
            </Rowed>
          </View>
        </Rowed>

        {/*
          * The brief. Only for an office job, because that is the card with
          * a description and notes on it; a job added on the phone has only
          * what the technician typed, and they have read that.
          */}
        {isSimpro ? (
          <>
            <Button
              title="Brief me"
              variant="secondary"
              loading={briefBusy}
              onPress={() => void briefMe(full)}
              icon={<MaterialCommunityIcons name="text-box-outline" size={18} color={t.color.text} />}
            />
            {brief ? (
              <Card>
                <Label>{brief.text ? 'Before you walk in' : 'No brief'}</Label>
                <Txt size="sm" style={{ lineHeight: 20, marginTop: 4 }}>{brief.text ?? brief.refusal ?? 'No brief came back.'}</Txt>
                {brief.text ? (
                  <Txt size="xs" tone="faint" style={{ marginTop: t.space(2), lineHeight: 17 }}>
                    Drafted from this job's record; check it. The card below is what the office holds.
                  </Txt>
                ) : null}
              </Card>
            ) : null}
          </>
        ) : null}

        <Card>
          <MetaRow label="Job no." value={job.externalId ? `#${job.externalId}` : 'On this phone only'} mono={!!job.externalId} />
          {job.orderNo ? <MetaRow label="Order no." value={job.orderNo} mono /> : null}
          {job.requestNo ? <MetaRow label="Request no." value={job.requestNo} mono /> : null}
          <MetaRow
            label="Customer"
            value={job.customerName ?? '—'}
            onPress={job.customerExternalId
              ? () => router.push({ pathname: '/customer/[id]', params: { id: job.customerExternalId! } })
              : undefined}
          />
          <MetaRow
            label="Site"
            value={job.siteName}
            hint={job.siteId ? undefined : 'Not matched to a site on this phone yet'}
            onPress={job.siteId ? () => router.push({ pathname: '/site/[id]', params: { id: job.siteId! } }) : undefined}
          />
          {job.address ? (
            <MetaRow
              label="Address"
              value={job.address}
              onPress={() => void Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(job.address!)}`)}
            />
          ) : null}
          {technicians ? <MetaRow label="Technicians" value={technicians} /> : null}
          {job.projectManager ? <MetaRow label="Project manager" value={job.projectManager} /> : null}
          {dates.map((d) => <MetaRow key={d.label} label={d.label} value={d.value} />)}
          {sell ? <MetaRow label="Sell" value={sell} /> : null}
          {full.customerContract?.name || full.customerContract?.contractNo ? (
            <MetaRow
              label="Contract"
              value={[full.customerContract.name, full.customerContract.contractNo].filter(Boolean).join(' · ')}
            />
          ) : null}
          {full.tags.length ? (
            <Rowed gap={1.5} wrap style={{ marginTop: t.space(2) }}>
              {full.tags.map((tag) => <Chip key={tag} label={tag} />)}
            </Rowed>
          ) : null}
        </Card>

        {contact ? (
          <Card>
            <Label>Site contact</Label>
            <Txt weight="700" style={{ marginTop: 4 }}>{contact.name || 'Unnamed contact'}</Txt>
            {contact.position ? <Txt size="sm" tone="muted">{contact.position}</Txt> : null}
            {contactWays.length ? (
              <Rowed gap={2} wrap style={{ marginTop: t.space(2) }}>
                {contactWays.map((w) => (
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
              <Txt size="sm" tone="faint" style={{ marginTop: 4 }}>The office has no number or email for them.</Txt>
            )}
          </Card>
        ) : null}

        {customer && customerWays.length ? (
          <Card>
            <Label>Customer</Label>
            <Txt weight="700" style={{ marginTop: 4 }}>{customer.name}</Txt>
            <Rowed gap={2} wrap style={{ marginTop: t.space(2) }}>
              {customerWays.map((w) => (
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
          </Card>
        ) : null}

        {job.descriptionText ? (
          <>
            <H2>Description</H2>
            <Card><Txt size="sm" style={{ lineHeight: 20 }}>{job.descriptionText}</Txt></Card>
          </>
        ) : null}

        {job.notesText ? (
          <>
            <H2>Office notes</H2>
            <Card><Txt size="sm" style={{ lineHeight: 20 }}>{job.notesText}</Txt></Card>
          </>
        ) : null}

        {/* -- Sections, cost centres, lines ------------------------------- */}
        {isSimpro ? (
          <>
            <H2>Sections</H2>
            {full.sections.length ? (
              full.sections.map((s) => <SectionCard key={s.id} section={s} queued={queuedLines} />)
            ) : (
              <NotYet
                synced={full.detailSynced}
                what="lines"
                none="The office has no sections or lines on this job."
              />
            )}
          </>
        ) : null}

        {/* -- Attachments ------------------------------------------------- */}
        {isSimpro ? (
          <>
            <H2>Attachments</H2>
            {full.attachments.length ? (
              full.attachments.map((a) => (
                <Card key={a.id} onPress={() => void open(a)}>
                  <Rowed gap={3}>
                    <MaterialCommunityIcons name={attachmentIcon(a.mimeType, a.filename)} size={26} color={t.color.accentText} />
                    <View style={{ flex: 1 }}>
                      <Txt weight="600" numberOfLines={2}>{a.filename}</Txt>
                      <Txt size="xs" tone="muted">
                        {[formatFileSize(a.sizeBytes), a.addedBy, a.dateAdded ? formatAuDate(a.dateAdded) : undefined, a.folder]
                          .filter(Boolean).join(' · ') || 'Details come with the file'}
                      </Txt>
                    </View>
                    {opening === a.id ? (
                      <Txt size="xs" tone="accent" weight="700">Fetching…</Txt>
                    ) : a.localUri ? (
                      <Chip label="On phone" tone="pass" />
                    ) : (
                      <MaterialCommunityIcons name="cloud-download-outline" size={20} color={t.color.textFaint} />
                    )}
                  </Rowed>
                </Card>
              ))
            ) : (
              <NotYet synced={full.detailSynced} what="files" none="Nothing is attached to this job." />
            )}
          </>
        ) : null}

        {/* -- Timeline ---------------------------------------------------- */}
        {isSimpro ? (
          <>
            <H2>Activity</H2>
            {full.timeline.length ? (
              <Card>
                <View style={{ gap: t.space(3) }}>
                  {timeline.map((e, i) => (
                    <View key={`${e.at ?? ''}-${i}`} style={{ flexDirection: 'row', gap: t.space(3) }}>
                      <View style={{ width: 8, alignItems: 'center', paddingTop: 6 }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: i === 0 ? t.color.accent : t.color.borderStrong }} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Txt size="sm" style={{ lineHeight: 19 }}>{e.message}</Txt>
                        <Txt size="xs" tone="faint">
                          {[e.staffName, relativeQldTime(e.at, now), e.type].filter(Boolean).join(' · ')}
                        </Txt>
                      </View>
                    </View>
                  ))}
                </View>
                {full.timeline.length > timeline.length || showAllTimeline ? (
                  // Tall enough for a glove: a tap that lands on the last
                  // row instead of a line of text expands nothing, and reads
                  // as the rest of the activity never having synced.
                  <Pressable
                    onPress={() => { animateNextLayout(); setShowAllTimeline((v) => !v); }}
                    hitSlop={6}
                    accessibilityRole="button"
                    style={{ marginTop: t.space(2), minHeight: 44, justifyContent: 'center' }}
                  >
                    <Txt size="sm" tone="accent" weight="700">
                      {showAllTimeline ? 'Show less' : `Show all ${full.timeline.length}`}
                    </Txt>
                  </Pressable>
                ) : null}
              </Card>
            ) : (
              <NotYet synced={full.detailSynced} what="activity" none="No activity has been logged on this job." />
            )}
          </>
        ) : null}

        {/* -- Tasks ------------------------------------------------------- */}
        {isSimpro && (full.tasks.length || !full.detailSynced) ? (
          <>
            <H2>Tasks</H2>
            {full.tasks.length ? (
              full.tasks.map((task) => {
                const state = taskState(task, today);
                return (
                  <Card key={task.id}>
                    <Rowed align="flex-start">
                      <View style={{ flex: 1 }}>
                        <Txt weight="600">{task.subject}</Txt>
                        {task.assignedTo || task.assignees.length ? (
                          <Txt size="sm" tone="muted">{[task.assignedTo, ...task.assignees].filter(Boolean).join(', ')}</Txt>
                        ) : null}
                      </View>
                      <StatusPill label={state.label} tone={state.tone} />
                    </Rowed>
                  </Card>
                );
              })
            ) : (
              <NotYet synced={full.detailSynced} what="tasks" none="" />
            )}
          </>
        ) : null}

        {/* -- Invoices ---------------------------------------------------- */}
        {isSimpro ? (
          <>
            <H2>Invoices</H2>
            {full.invoices.length ? (
              full.invoices.map((inv) => {
                const state = invoiceState(inv, today);
                return (
                  <Card key={inv.externalId} onPress={() => router.push({ pathname: '/invoices/[id]', params: { id: inv.externalId } })}>
                    <Rowed align="flex-start">
                      <View style={{ flex: 1 }}>
                        <Txt weight="700">Invoice {inv.externalId}</Txt>
                        <Txt size="sm" tone="muted">
                          {[inv.dateIssued ? `Issued ${formatAuDate(inv.dateIssued)}` : undefined, inv.invoiceType].filter(Boolean).join(' · ')}
                        </Txt>
                        {inv.totalIncTaxCents !== undefined ? (
                          <Txt size="sm" weight="700" style={{ marginTop: 2 }}>{formatCents(inv.totalIncTaxCents)} inc GST</Txt>
                        ) : null}
                      </View>
                      <StatusPill label={state.label} tone={state.tone} />
                    </Rowed>
                  </Card>
                );
              })
            ) : (
              <NotYet synced={full.detailSynced} what="invoices" none="Nothing has been invoiced against this job yet." />
            )}
          </>
        ) : null}

        {/* -- Purchase orders --------------------------------------------- */}
        {isSimpro && orders.length ? (
          <>
            <H2>Purchase orders</H2>
            {orders.map((o) => (
              <Card key={o.id} onPress={() => router.push({ pathname: '/orders/[id]', params: { id: o.id } })}>
                <Rowed align="flex-start">
                  <View style={{ flex: 1 }}>
                    <Txt weight="700">Order {o.id}</Txt>
                    <Txt size="sm" tone="muted">{[o.vendorName ?? 'Supplier not named', o.reference].filter(Boolean).join(' · ')}</Txt>
                    {o.dateIssued ? <Txt size="xs" tone="faint">Issued {formatAuDate(o.dateIssued)}</Txt> : null}
                  </View>
                  {o.statusName || o.stage ? <Chip label={(o.statusName ?? o.stage)!} tone={o.archived ? 'muted' : 'default'} /> : null}
                </Rowed>
              </Card>
            ))}
          </>
        ) : null}

        {/* -- The site briefing ------------------------------------------- */}
        <H2>Before you walk in</H2>
        <Rowed gap={2}>
          <StatTile label="Assets" value={assetCount} />
          <StatTile label="Open defects" value={defects.length} tone={critical.length ? 'fail' : 'default'} />
          <StatTile label="Critical" value={critical.length} tone={critical.length ? 'fail' : 'default'} />
        </Rowed>
        {!job.siteId ? (
          <Txt size="xs" tone="faint">
            This job is not matched to a site on this phone, so the counts above are empty rather than known.
          </Txt>
        ) : null}

        {knowledge.length ? (
          <Card>
            <Label>You should know about this site</Label>
            <View style={{ marginTop: t.space(2), gap: t.space(2) }}>
              {knowledge.slice(0, 4).map((k) => (
                <View key={k.id}>
                  <Rowed gap={2}>
                    <MaterialCommunityIcons
                      name={k.status === 'verified' || k.status === 'manufacturer-confirmed' ? 'check-decagram' : 'information-outline'}
                      size={15}
                      color={k.status === 'unverified' ? t.color.warn : t.color.pass}
                    />
                    <Txt size="sm" weight="600" style={{ flex: 1 }}>{k.title}</Txt>
                  </Rowed>
                  {k.body ? <Txt size="sm" tone="muted" style={{ marginLeft: 23, lineHeight: 19 }}>{k.body}</Txt> : null}
                </View>
              ))}
            </View>
          </Card>
        ) : null}

        {critical.length ? (
          <Banner
            tone="fail"
            title={`${critical.length} critical defect${critical.length === 1 ? '' : 's'} already open here`}
            body={critical.slice(0, 3).map((d) => `${d.location}: ${d.description.slice(0, 90)}`).join('\n')}
          />
        ) : null}

        {site?.notes ? (
          <Card>
            <Label>Site notes on this phone</Label>
            <Txt size="sm" style={{ lineHeight: 20, marginTop: 4 }}>{site.notes}</Txt>
          </Card>
        ) : null}

        {/* -- What to do ---------------------------------------------------- */}
        <H2>Do</H2>
        {job.status !== 'in-progress' && job.status !== 'complete' ? (
          <Button title="Start job" onPress={() => void setStatus(job.id, 'in-progress')} />
        ) : null}
        {job.status === 'in-progress' ? (
          <Button
            title="Mark complete"
            onPress={() => {
              showAlert('Complete this job?', 'Check the test sheet, defects and photos are done first — anything missing is harder to add later.', [
                { text: 'Not yet', style: 'cancel' },
                { text: 'Complete', onPress: () => void setStatus(job.id, 'complete') },
              ]);
            }}
          />
        ) : null}
        {local ? (
          <Card>
            <Rowed gap={2} align="flex-start">
              <MaterialCommunityIcons
                name={job.status === 'complete' ? 'check-circle-outline' : job.status === 'blocked' ? 'alert-circle-outline' : 'progress-clock'}
                size={20}
                color={job.status === 'complete' ? t.color.pass : job.status === 'blocked' ? t.color.fail : t.color.warn}
              />
              <View style={{ flex: 1 }}>
                <Txt weight="700" size="sm">
                  {local.label}{localAt ? ` at ${qldMoment(localAt) ?? formatAuDate(localAt)}` : ''}
                </Txt>
                {isSimpro && job.status === 'complete' ? (
                  <Txt size="xs" tone="muted" style={{ marginTop: 2, lineHeight: 17 }}>
                    {noteQueued
                      ? 'Work-completed note queued for the office. It goes with the next send, and the office moves the job on from there.'
                      : "The office's record moves on when the scheduler reads the completion note and closes the job at their end."}
                  </Txt>
                ) : isSimpro ? (
                  <Txt size="xs" tone="muted" style={{ marginTop: 2, lineHeight: 17 }}>
                    The office's status above is theirs; this is what happened on this phone.
                  </Txt>
                ) : null}
              </View>
            </Rowed>
          </Card>
        ) : null}

        {isSimpro ? (
          <>
            {queuedWords.length ? (
              <Banner
                tone="info"
                title="Queued for the office"
                body={`${queuedWords.join('\n')}\n\nGoes with the next send; Waiting to send has the rows.`}
              />
            ) : null}
            <Rowed gap={2}>
              <Button
                title="Change status"
                variant="secondary"
                style={{ flex: 1 }}
                loading={acting === 'status'}
                icon={<MaterialCommunityIcons name="swap-horizontal" size={18} color={t.color.text} />}
                onPress={() => setSheet('status')}
              />
              <Button
                title="Add note"
                variant="secondary"
                style={{ flex: 1 }}
                loading={acting === 'note'}
                icon={<MaterialCommunityIcons name="note-plus-outline" size={18} color={t.color.text} />}
                onPress={() => setSheet('note')}
              />
            </Rowed>
            <Rowed gap={2}>
              <Button
                title="Add materials"
                variant="secondary"
                style={{ flex: 1 }}
                icon={<MaterialCommunityIcons name="package-variant" size={18} color={t.color.text} />}
                onPress={() => {
                  if (!full.sections.some((s) => s.costCenters.length)) {
                    showAlert('No cost centre yet', full.detailSynced
                      ? 'The office has no cost centre on this job to put a line under. Ask them to add one, then open the job again with signal.'
                      : 'The job\'s cost centres have not been read from the office yet. Open it once with signal and try again.');
                    return;
                  }
                  setSheet('materials');
                }}
              />
              <Button
                title="Attach photo"
                variant="secondary"
                style={{ flex: 1 }}
                loading={acting === 'photo'}
                icon={<MaterialCommunityIcons name="camera-outline" size={18} color={t.color.text} />}
                onPress={() => {
                  showAlert('Attach a photo', 'Where from?', [
                    { text: 'Camera', onPress: () => void addPhoto(true) },
                    { text: 'Photo library', onPress: () => void addPhoto(false) },
                    { text: 'Cancel', style: 'cancel' },
                  ]);
                }}
              />
            </Rowed>
            <Button
              title="Sign off"
              loading={acting === 'signoff'}
              icon={<MaterialCommunityIcons name="draw-pen" size={18} color={t.color.onAccent} />}
              onPress={() => setSheet('signoff')}
            />
          </>
        ) : null}

        <Rowed gap={2}>
          <Button
            title="Raise defect"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() => router.push({ pathname: '/work/defect/new', params: { siteId: job.siteId ?? '' } })}
          />
          {job.siteId ? (
            <Button
              title="Open site"
              variant="secondary"
              style={{ flex: 1 }}
              onPress={() => router.push({ pathname: '/site/[id]', params: { id: job.siteId! } })}
            />
          ) : null}
        </Rowed>

        {job.notes ? (
          <>
            <H2>Your notes</H2>
            <Card><Txt size="sm" style={{ lineHeight: 20 }}>{job.notes}</Txt></Card>
          </>
        ) : null}

        {/* -- Provenance ------------------------------------------------- */}
        <View style={{ gap: 2 }}>
          {refresh.state === 'running' ? (
            <Txt size="xs" tone="accent">Refreshing from Simpro…</Txt>
          ) : null}
          {refresh.state === 'done' && refresh.partial.length ? (
            <Txt size="xs" tone="warn">
              Refreshed, but the office would not hand over: {refresh.partial.join('; ')}
            </Txt>
          ) : null}
          {refresh.state === 'failed' ? (
            <Txt size="xs" tone="faint">Showing what the phone holds. Could not refresh: {refresh.error}</Txt>
          ) : null}
          <Txt size="xs" tone="faint">
            {isSimpro
              ? job.detailSyncedAt
                ? `Office record as of ${qldMoment(job.detailSyncedAt) ?? job.detailSyncedAt}.`
                : 'The lines, files and activity under this job have not been read yet. They come the first time it is opened with signal.'
              : 'Added on this phone; the office does not have this job.'}
            {job.scheduledFor ? ` ${isSimpro ? 'Issued' : 'Scheduled'} ${formatAuDate(job.scheduledFor)}.` : ''}
          </Txt>
        </View>
      </Screen>

      {isSimpro ? (
        <>
          <StatusSheet
            visible={sheet === 'status'}
            onClose={() => setSheet(null)}
            choices={statuses}
            current={job.statusName}
            suggested={suggested}
            busy={acting === 'status'}
            onPick={(c) => void queueStatus(c)}
          />
          <NoteSheet visible={sheet === 'note'} onClose={() => setSheet(null)} busy={acting === 'note'} onSend={(su, n) => void queueNote(su, n)} />
          <MaterialsSheet visible={sheet === 'materials'} onClose={() => setSheet(null)} sections={full.sections} onQueue={queueMaterial} />
          <SignOffSheet
            visible={sheet === 'signoff'}
            onClose={() => setSheet(null)}
            jobLabel={`Job ${job.externalId} - ${job.siteName}`}
            defaultName={contact?.name ?? ''}
            busy={acting === 'signoff'}
            onSign={(name, svg) => void signOff(name, svg)}
          />
        </>
      ) : null}
    </>
  );
}

/**
 * Whether a line queued here has come back from the office as a real line:
 * the same part, or the same words, with the same count, under the same
 * cost centre. Once it has, the queued copy would show the line twice.
 */
function lineIsHeld(sections: readonly SimproSection[], q: JobMaterialPayload): boolean {
  for (const s of sections) {
    if (s.id !== q.sectionId) continue;
    for (const c of s.costCenters) {
      if (c.id !== q.costCenterId) continue;
      return c.items.some((it) => it.qty === q.qty && (
        q.kind === 'catalog' ? it.kind === 'catalog' && it.catalogId === q.catalogId
          : it.kind === 'oneOff' && it.description.trim().toLowerCase() === q.description.trim().toLowerCase()
      ));
    }
  }
  return false;
}

/** A sheet over the card: a title, a close, and a scrolling body that keeps the keyboard's taps. */
function Sheet({ title, visible, onClose, children }: { title: string; visible: boolean; onClose: () => void; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: t.color.bg }}>
        <Rowed gap={2} style={{ padding: t.space(4), paddingBottom: t.space(2) }}>
          <Txt size="xl" weight="800" style={{ flex: 1 }}>{title}</Txt>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <MaterialCommunityIcons name="close" size={26} color={t.color.textMuted} />
          </Pressable>
        </Rowed>
        <ScrollView contentContainerStyle={{ padding: t.space(4), paddingTop: 0, gap: t.space(3), paddingBottom: t.space(10) }} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

/**
 * The office's statuses to pick from.
 *
 * The one the job wears is marked, the one the phone's own state suggests
 * is first, and a status the phone has seen on a job but has no id for is
 * shown greyed with the reason: the office uses it, and the phone cannot
 * send it until the pinned list in jobActions is read again.
 */
function StatusSheet({ visible, onClose, choices, current, suggested, busy, onPick }: {
  visible: boolean; onClose: () => void; choices: StatusChoice[]; current: string | undefined;
  suggested: StatusChoice | undefined; busy: boolean; onPick: (c: StatusChoice & { id: string }) => void;
}) {
  const t = useTheme();
  const ordered = suggested ? [suggested, ...choices.filter((c) => c !== suggested)] : choices;
  const currentKey = (current ?? '').trim().toLowerCase();
  return (
    <Sheet title="Change status" visible={visible} onClose={onClose}>
      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
        The office's status on this job. Queued and sent with the next send; the office sees it move.
      </Txt>
      {ordered.length ? ordered.map((c) => {
        const isCurrent = c.name.trim().toLowerCase() === currentKey;
        const sendable = !!c.id;
        const sw = statusSwatch(c.color, t.color.surface);
        return (
          <Pressable
            key={c.id ?? c.name}
            disabled={!sendable || busy || isCurrent}
            onPress={() => { if (c.id) onPick({ ...c, id: c.id }); }}
            style={({ pressed }) => ({
              padding: t.space(3.5), borderRadius: t.radius.lg, borderWidth: 1,
              borderColor: isCurrent ? t.color.accent : t.color.border,
              backgroundColor: pressed ? t.color.surfaceAlt : t.color.surface, opacity: sendable ? 1 : 0.55,
            })}
          >
            <Rowed gap={3}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: sw?.fill ?? t.color.borderStrong }} />
              <View style={{ flex: 1 }}>
                <Txt weight="700">{c.name}</Txt>
                <Txt size="xs" tone="faint">
                  {isCurrent ? 'The job is at this status now'
                    : !sendable ? 'The office uses this, but the phone has no id for it yet'
                      : c === suggested ? 'Likely next, from what this phone did'
                        : c.seen ? `${c.seen} job${c.seen === 1 ? '' : 's'} on this phone wear it` : 'No job on this phone wears it'}
                </Txt>
              </View>
              {sendable && !isCurrent ? <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} /> : null}
            </Rowed>
          </Pressable>
        );
      }) : (
        <Txt size="sm" tone="faint">No statuses are known yet. They come with the job sync.</Txt>
      )}
    </Sheet>
  );
}

/**
 * The note to the office, with the model offered as a tidier.
 *
 * Write it up sends the words in the box and nothing else — no job, no
 * customer, no site — and puts what comes back in the box for the
 * technician to read before it goes. Their own words are kept underneath
 * until they are happy, because the draft is a suggestion and the note is
 * theirs. Without a key the button is not offered and the box works as it
 * always did.
 */
function NoteSheet({ visible, onClose, busy, onSend }: { visible: boolean; onClose: () => void; busy: boolean; onSend: (subject: string, note: string) => void }) {
  const t = useTheme();
  const [subject, setSubject] = useState('');
  const [note, setNote] = useState('');
  const [aiOn, setAiOn] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [mine, setMine] = useState<string | null>(null);

  useEffect(() => { void hasKey().then(setAiOn).catch(() => setAiOn(false)); }, []);

  const writeUp = async () => {
    const rough = note.trim();
    setAiBusy(true);
    setAiNote(null);
    try {
      const draft = await draftOfficeNote(rough);
      if (draft.note) {
        setMine(rough);
        setNote(draft.note);
        if (draft.subject && !subject.trim()) setSubject(draft.subject);
        setAiNote('Written up from your words. Read it before you send it.');
      } else {
        setAiNote(draft.refusal ?? 'Nothing came back. Your own words still stand.');
      }
    } catch (e) {
      setAiNote(describeActionFailure(e, 'write the note up'));
    } finally {
      setAiBusy(false);
    }
  };

  const send = () => {
    if (!note.trim()) { showAlert('Nothing to send', 'Write the note first.'); return; }
    onSend(subject, note);
    setSubject(''); setNote(''); setMine(null); setAiNote(null);
  };

  return (
    <Sheet title="Add note" visible={visible} onClose={onClose}>
      <Field label="Subject" value={subject} onChangeText={setSubject} placeholder="What it is about" autoCapitalize="sentences" />
      <Field label="Note" value={note} onChangeText={setNote} placeholder="What you found, what you did, what is still to do" multiline />
      {aiOn ? (
        <Rowed gap={2} align="flex-start">
          <Txt size="xs" tone="faint" style={{ flex: 1, lineHeight: 17 }}>
            Write it up tidies your words for the office. It sends what is in the box and nothing else — not the job,
            the customer or the site — and never adds a number you did not write.
          </Txt>
          <Button
            title="Write it up"
            variant="secondary"
            compact
            disabled={note.trim().split(/\s+/).filter(Boolean).length < 3}
            loading={aiBusy}
            onPress={() => void writeUp()}
            icon={<MaterialCommunityIcons name="auto-fix" size={16} color={t.color.text} />}
          />
        </Rowed>
      ) : null}
      {aiNote ? <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{aiNote}</Txt> : null}
      {mine ? (
        <Card style={{ gap: t.space(1) }}>
          <Txt size="xs" tone="faint">What you wrote, if you want it back</Txt>
          <Txt size="sm" style={{ lineHeight: 19 }}>{mine}</Txt>
          <Chip label="Put mine back" onPress={() => { setNote(mine); setMine(null); setAiNote(null); }} />
        </Card>
      ) : null}
      <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
        Goes on the job's notes in Simpro, under your name, with the next send.
      </Txt>
      <Button title="Queue note" loading={busy} onPress={send} />
    </Sheet>
  );
}

/** A cost centre a line can go under, flattened from the sections with the section named where there are several. */
interface CostCenterPick { sectionId: string; costCenterId: string; label: string }

function costCenterPicks(sections: readonly SimproSection[]): CostCenterPick[] {
  const out: CostCenterPick[] = [];
  for (const s of sections) {
    for (const c of s.costCenters) {
      const name = c.name || c.setupCostCenterName || 'Cost centre';
      out.push({ sectionId: s.id, costCenterId: c.id, label: sections.length > 1 ? `${s.name || 'Section'} · ${name}` : name });
    }
  }
  return out;
}

/**
 * Materials used, onto a cost centre.
 *
 * Two tabs: a part from the office's own catalogue (the catalog_item
 * mirror, not the app's supplier catalogue, because only an office item has
 * the id the POST takes), or a one-off in words. The cost centre is picked
 * only where the job has more than one; with one there is nothing to ask.
 * The sheet stays open after a line is queued, since parts come in lists.
 */
function MaterialsSheet({ visible, onClose, sections, onQueue }: {
  visible: boolean; onClose: () => void; sections: SimproSection[];
  onQueue: (input: { sectionId: string; costCenterId: string; kind: 'catalog' | 'oneOff'; catalogId?: string; description: string; qty: string }) => Promise<string | undefined>;
}) {
  const t = useTheme();
  const picks = costCenterPicks(sections);
  const [tab, setTab] = useState<'catalog' | 'oneOff'>('catalog');
  const [where, setWhere] = useState<CostCenterPick | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CatalogItemRecord[]>([]);
  const [searchFailed, setSearchFailed] = useState<string | null>(null);
  const [picked, setPicked] = useState<CatalogItemRecord | null>(null);
  const [description, setDescription] = useState('');
  const [qty, setQty] = useState('1');
  const [why, setWhy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string[]>([]);
  const target = where ?? (picks.length === 1 ? picks[0]! : null);

  useEffect(() => {
    let cancelled = false;
    const term = query.trim();
    if (term.length < 2) { setResults([]); setSearchFailed(null); return; }
    void searchCatalogItems(term, { limit: 30 })
      .then((rows) => { if (!cancelled) { setResults(rows); setSearchFailed(null); } })
      .catch((e: unknown) => { if (!cancelled) setSearchFailed(describeLoadFailure(e, 'the catalogue')); });
    return () => { cancelled = true; };
  }, [query]);

  const add = async () => {
    if (!target) { setWhy('Pick the cost centre the line goes under.'); return; }
    setAdding(true);
    setWhy(null);
    try {
      const refused = await onQueue({
        sectionId: target.sectionId, costCenterId: target.costCenterId, kind: tab,
        catalogId: tab === 'catalog' ? picked?.id : undefined,
        description: tab === 'catalog' ? (picked ? [picked.partNo, picked.name].filter(Boolean).join(' ') : '') : description,
        qty,
      });
      if (refused) { setWhy(refused); return; }
      setAdded((prev) => [...prev, `${qty} × ${tab === 'catalog' ? (picked?.name ?? '') : description.trim()}`]);
      setPicked(null); setDescription(''); setQty('1'); setQuery('');
    } catch (e) {
      setWhy(describeActionFailure(e, 'queue the line'));
    } finally {
      setAdding(false);
    }
  };

  return (
    <Sheet title="Add materials" visible={visible} onClose={onClose}>
      {picks.length > 1 ? (
        <View style={{ gap: t.space(1.5) }}>
          <Label>Cost centre</Label>
          <Rowed gap={1.5} wrap>
            {picks.map((p) => (
              <Chip key={`${p.sectionId}-${p.costCenterId}`} label={p.label} selected={target?.costCenterId === p.costCenterId} onPress={() => setWhere(p)} />
            ))}
          </Rowed>
        </View>
      ) : target ? (
        <Txt size="sm" tone="muted">Under {target.label}.</Txt>
      ) : null}
      <Segmented
        options={[{ value: 'catalog', label: 'Office catalogue' }, { value: 'oneOff', label: 'One-off' }]}
        value={tab}
        onChange={(v) => { setTab(v); setWhy(null); }}
      />
      {tab === 'catalog' ? (
        <>
          {picked ? (
            <Card>
              <Rowed gap={2}>
                <View style={{ flex: 1 }}>
                  <Txt weight="700">{picked.name}</Txt>
                  <Txt size="xs" tone="muted">{[picked.partNo, picked.groupName].filter(Boolean).join(' · ')}</Txt>
                </View>
                <Button title="Change" variant="ghost" compact onPress={() => setPicked(null)} />
              </Rowed>
            </Card>
          ) : (
            <>
              <SearchBox value={query} onChange={setQuery} placeholder="Part number or name in the office catalogue" />
              {searchFailed ? <Txt size="sm" tone="fail">{searchFailed}</Txt> : null}
              {results.map((r) => (
                <Pressable
                  key={r.id}
                  onPress={() => { setPicked(r); setResults([]); }}
                  style={({ pressed }) => ({ padding: t.space(3), borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.color.border, backgroundColor: pressed ? t.color.surfaceAlt : t.color.surface })}
                >
                  <Txt weight="600" numberOfLines={2}>{r.name}</Txt>
                  <Txt size="xs" tone="muted">{[r.partNo, r.manufacturer, r.groupName].filter(Boolean).join(' · ')}</Txt>
                </Pressable>
              ))}
              {query.trim().length >= 2 && !results.length && !searchFailed ? (
                <Txt size="sm" tone="faint">Nothing in the office catalogue matches. Try the part number, or add it as a one-off.</Txt>
              ) : null}
            </>
          )}
        </>
      ) : (
        <Field label="What it is" value={description} onChangeText={setDescription} placeholder="Conduit, 20 mm, 3 m length" autoCapitalize="sentences" />
      )}
      <Field label="Quantity" value={qty} onChangeText={setQty} keyboardType="decimal-pad" />
      {why ? <Txt size="sm" tone="fail">{why}</Txt> : null}
      <Button title="Add line" loading={adding} disabled={tab === 'catalog' ? !picked : !description.trim()} onPress={() => void add()} />
      {added.length ? (
        <Card>
          <Label>Queued this visit</Label>
          {added.map((a, i) => <Txt key={`${a}-${i}`} size="sm" style={{ marginTop: 4 }}>{a}</Txt>)}
          <Txt size="xs" tone="faint" style={{ marginTop: t.space(2), lineHeight: 17 }}>
            Sell prices come from the office's price book once the lines land; the card shows them after the next refresh.
          </Txt>
        </Card>
      ) : null}
    </Sheet>
  );
}

/**
 * The customer signs. The name is asked for because the office reads the
 * note, not the file, and a signature with no name beside it is a squiggle.
 * The site contact's name is offered as the default: on most jobs that is
 * who signs.
 */
function SignOffSheet({ visible, onClose, jobLabel, defaultName, busy, onSign }: {
  visible: boolean; onClose: () => void; jobLabel: string; defaultName: string; busy: boolean; onSign: (name: string, svg: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [svg, setSvg] = useState<string | undefined>(undefined);
  const [, setDataUri] = useState<string | undefined>(undefined);
  const complete = () => {
    if (!name.trim()) { showAlert('Who is signing?', 'Put the customer\'s name above the signature.'); return; }
    if (!svg) { showAlert('No signature yet', 'Ask the customer to sign in the box.'); return; }
    showAlert('Complete and sign?', 'This marks the job complete on this phone, queues the signature as a file on the job and a note naming who signed. Check the test sheet, defects and photos are done first.', [
      { text: 'Not yet', style: 'cancel' },
      { text: 'Complete and sign', onPress: () => onSign(name, svg) },
    ]);
  };
  return (
    <Sheet title="Sign off" visible={visible} onClose={onClose}>
      <Txt size="sm" tone="muted">{jobLabel}</Txt>
      <Field label="Signed by" value={name} onChangeText={setName} placeholder="Customer's name" autoCapitalize="words" />
      <SignaturePad label="Customer signature" onChange={setDataUri} onSvg={setSvg} />
      <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
        The signature goes onto the job's attachments as a file, with a note saying who signed and when.
      </Txt>
      <Button title="Complete and sign" loading={busy} onPress={complete} />
    </Sheet>
  );
}

/**
 * The office's status, in the office's colour.
 *
 * The colour is a dot and a border only. The label stays in the theme's own
 * text colour, because a status written in the office's pale yellow on a
 * dark card is unreadable in sun, and a dot the card would swallow gets a
 * ring — see statusSwatch.
 */
function OfficePill({ label, fill, outlined }: { label: string; fill: string; outlined: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: t.space(2.5), paddingVertical: t.space(1.5),
        borderRadius: t.radius.pill, backgroundColor: t.color.surfaceAlt,
        borderWidth: 1, borderColor: outlined ? t.color.borderStrong : fill,
      }}
    >
      <View
        style={{
          width: 10, height: 10, borderRadius: 5, backgroundColor: fill,
          borderWidth: outlined ? StyleSheet.hairlineWidth : 0, borderColor: t.color.textMuted,
        }}
      />
      <Txt size="xs" weight="800">{label}</Txt>
    </View>
  );
}

function MetaRow({ label, value, hint, mono, onPress }: { label: string; value: string; hint?: string; mono?: boolean; onPress?: () => void }) {
  const t = useTheme();
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.space(3), minHeight: onPress ? 44 : undefined, paddingVertical: 4 }}>
      <Txt size="xs" tone="muted" weight="700" style={{ width: 96, textTransform: 'uppercase', letterSpacing: 0.6, paddingTop: 3 }}>{label}</Txt>
      <View style={{ flex: 1 }}>
        <Txt size="sm" weight={onPress ? '700' : '500'} tone={onPress ? 'accent' : 'default'} mono={mono}>{value}</Txt>
        {hint ? <Txt size="xs" tone="faint">{hint}</Txt> : null}
      </View>
      {onPress ? <MaterialCommunityIcons name="chevron-right" size={18} color={t.color.textFaint} style={{ paddingTop: 2 }} /> : null}
    </View>
  );
  return onPress ? <Pressable onPress={onPress} hitSlop={4}>{body}</Pressable> : body;
}

/**
 * Why a family is empty. "Not read yet" and "the office has none" look the
 * same on a card and mean opposite things to somebody deciding whether to
 * drive back for the site plan.
 */
function NotYet({ synced, what, none }: { synced: boolean; what: string; none: string }) {
  if (!synced) {
    return (
      <Txt size="sm" tone="faint" style={{ lineHeight: 19 }}>
        The {what} have not been read from the office yet — they come the first time this job is opened with signal.
      </Txt>
    );
  }
  return none ? <Txt size="sm" tone="faint">{none}</Txt> : null;
}

/** A section, collapsed to its name and a count until it is tapped. */
function SectionCard({ section, queued }: { section: SimproSection; queued: JobMaterialPayload[] }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const lines = sectionLineCount(section) + queued.filter((q) => q.sectionId === section.id).length;
  const total = section.costCenters.reduce((n, c) => n + (c.totalExTaxCents ?? 0), 0);
  const anyTotal = section.costCenters.some((c) => c.totalExTaxCents !== undefined);
  return (
    <Card onPress={() => { animateNextLayout(); setOpen((v) => !v); }}>
      <Rowed gap={2} align="flex-start">
        <View style={{ flex: 1 }}>
          <Txt weight="700">{section.name || 'Unnamed section'}</Txt>
          <Txt size="sm" tone="muted">
            {section.costCenters.length} cost centre{section.costCenters.length === 1 ? '' : 's'} · {lines} line{lines === 1 ? '' : 's'}
            {anyTotal ? ` · ${formatCents(total)} ex GST` : ''}
          </Txt>
          {section.description && open ? (
            <Txt size="sm" tone="muted" style={{ marginTop: 4, lineHeight: 19 }}>{section.description}</Txt>
          ) : null}
        </View>
        <MaterialCommunityIcons name={open ? 'chevron-up' : 'chevron-down'} size={22} color={t.color.textFaint} />
      </Rowed>
      {open ? (
        <View style={{ marginTop: t.space(3), gap: t.space(3) }}>
          {section.costCenters.map((c) => (
            <CostCenterBlock key={c.id} costCenter={c} queued={queued.filter((q) => q.sectionId === section.id && q.costCenterId === c.id)} />
          ))}
        </View>
      ) : null}
    </Card>
  );
}

function CostCenterBlock({ costCenter: c, queued }: { costCenter: SimproCostCenter; queued: JobMaterialPayload[] }) {
  const t = useTheme();
  const total = sellTotalLine(c.totalExTaxCents, c.totalIncTaxCents);
  return (
    <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.color.border, paddingTop: t.space(3), gap: t.space(2) }}>
      <Rowed gap={2} align="flex-start">
        <View style={{ flex: 1 }}>
          <Txt weight="700" size="sm">{c.name || c.setupCostCenterName || 'Cost centre'}</Txt>
          {total ? <Txt size="xs" tone="muted">{total}</Txt> : null}
        </View>
        {c.percentComplete !== undefined ? <Chip label={`${Math.round(c.percentComplete)}%`} tone={c.percentComplete >= 100 ? 'pass' : 'default'} /> : null}
      </Rowed>
      {c.items.length ? c.items.map((it) => <ItemRow key={`${it.kind}-${it.id}`} item={it} />) : !queued.length ? (
        <Txt size="xs" tone="faint">No lines under this cost centre.</Txt>
      ) : null}
      {queued.map((q) => (
        // Added on this phone and not yet seen back: no price, since the
        // office's price book sets it, and a chip so nobody reads it as sent.
        <View key={materialContentKey(q)} style={{ flexDirection: 'row', gap: t.space(2), alignItems: 'flex-start' }}>
          <Txt size="sm" weight="700" mono style={{ minWidth: 52, textAlign: 'right' }}>{q.qty}</Txt>
          <View style={{ flex: 1 }}>
            <Txt size="sm">{q.description}</Txt>
            <Txt size="xs" tone="faint">{q.kind === 'oneOff' ? 'One-off' : 'Office catalogue'}</Txt>
          </View>
          <Chip label="Queued" tone="accent" />
        </View>
      ))}
    </View>
  );
}

function ItemRow({ item }: { item: SimproItem }) {
  const t = useTheme();
  const price = itemPrice(item);
  return (
    <View style={{ flexDirection: 'row', gap: t.space(2), alignItems: 'flex-start' }}>
      <Txt size="sm" weight="700" mono style={{ minWidth: 52, textAlign: 'right' }}>{formatQty(item)}</Txt>
      <View style={{ flex: 1 }}>
        <Txt size="sm">{itemHeading(item)}</Txt>
        <Txt size="xs" tone="faint">
          {[item.partNo && item.partNo !== item.description ? item.partNo : undefined, price.unit, item.billableStatus, discountLabel(item)]
            .filter(Boolean).join(' · ')}
        </Txt>
      </View>
      {price.line ? <Txt size="sm" weight="700">{price.line}</Txt> : null}
    </View>
  );
}
