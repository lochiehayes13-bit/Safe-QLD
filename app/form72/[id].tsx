import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  ISSUED_REFUSAL, getForm72, issueForm72, linkForm72Job, recordForm72Attached, recordOccupierCopy, updateForm72,
  type Form72Patch, type StoredForm72,
} from '@/db/form72Repo';
import { listJobPage, type JobSummary } from '@/db/opsRepo';
import { queueJobAttachment } from '@/simpro/sync';
import {
  FORM72_INBOX, form72AttachmentName, form72AttachmentSubject, form72EmailBody, rankJobsForForm,
} from '@/domain/form72Link';
import { qldIsoDay, qldMoment } from '@/domain/qldTime';
import { attachmentContentKey } from '@/domain/outboundWork';
import { describeActionFailure } from '@/domain/loadFailure';
import { router } from 'expo-router';
import {
  CALIBRATION_MONTHS, PART_D_ROWS, PART_RESULT_LABEL, SYSTEM_TYPE_LABEL, TEST_INTERVAL_LABEL,
  deviceCalibration, elevationHeadKpa, flowRowKey, flowRowLongLabel, flowRowUntouched,
  intervalsTested, maintenanceTestFromAxes, overloadCheck, resolveFrictionalLoss,
  systemTypesTested, validateForm72,
  type BoosterTest, type FlowDeviceKind, type FlowRow, type FormDefect, type FormIssue,
  type HydrostaticTest, type PartResult, type SprinklerFlowTest, type SprinklerHydrostatic,
  type SprinklerTestPoint, type SystemType, type TestDevice, type TestInterval,
} from '@/domain/form72';
import {
  DECLARATION, FORM_SUBTITLE, FORM_TITLE, FORM_VERSION, OCCUPIER_COPY_BUSINESS_DAYS,
  PART_B_NOTE, PART_C_NOTE, PART_D_NOTE, PART_E_NOTE, PART_F_NOTE, PART_G_NOTE,
  DEPARTMENT_DEVICE_SLOTS, PART_D_LOCATION_SLOTS, TESTER_RETENTION_YEARS, form72Html,
  frictionalLossGaps,
  occupierCopyDueBy, testPointOutcome, testerCopyKeepUntil,
} from '@/export/form72';
import { unusedDevicePresets } from '@/domain/form72Devices';
import { shareFile, writePdf } from '@/export/files';
import { sendMail } from '@/export/mail';
import { notSharedNotice } from '@/export/shareOutcome';
import { formatAuDate } from '@/export/sheets';
import { queryAssets } from '@/db/assetRepo';
import { applyForm72Prefill, form72FromAssets } from '@/domain/formsFromAssets';
import { loadPrefs } from '@/app-prefs';
import { nowIso } from '@/db';
import { useTheme } from '@/theme';
import { SignaturePad } from '@/components/SignaturePad';
import {
  Banner, Button, Card, Chip, Divider, Field, H2, Label, Rowed, Screen, Segmented, Txt,
} from '@/components/ui';
import { RecordGate } from '@/components/RecordGate';
import { describeLoadFailure } from '@/domain/loadFailure';
import { showAlert } from '@/components/alert';

/**
 * Form 72 — the Queensland statutory hydrant and sprinkler form.
 *
 * The department publishes this as a nine-part A3 sheet, and filling it on a
 * phone by scrolling one enormous column is how a technician ends up in Part G
 * having silently skipped Part D. So the parts are the navigation: one part on
 * screen at a time, with the strip along the top saying which ones are answered
 * and which are still 'na'. That strip is the only progress indicator worth
 * having, because on this form "not applicable" and "not yet filled in" are
 * genuinely the same stored value and only the technician can tell them apart.
 *
 * Everything saves as it is typed. A form part-filled in a plant room with no
 * signal, on a phone that dies, must still be there — there is no draft state
 * living only in React.
 *
 * The screen does two things the paper cannot. It checks each gauge's
 * calibration date against the test date, because a gauge out of calibration
 * makes every pressure on the page unusable and nobody notices until the form
 * is challenged. And it answers the overload run — 150% of duty flow at 65% of
 * duty pressure — which the department's form has no box for at all, so a pump
 * on the way out passes the printed form while failing the only test that finds
 * it.
 *
 * Issuing is a one-way door. After that the form is a statement somebody is
 * held to, so it stops being editable and starts counting the ten business days
 * the occupier's copy is due within.
 */

type PartKey = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'Attachment';

/**
 * The parts, as the strip along the top shows them.
 *
 * `tag` is the badge — a letter for the department's nine parts, and a plus for
 * the one section that is not one of them. The attachment holds facts the
 * department's form has no box for, and it is labelled so that nobody filling
 * it in thinks they are filling in Form 72.
 */
const PARTS: { key: PartKey; tag: string; title: string; blurb: string }[] = [
  { key: 'A', tag: 'A', title: 'Details', blurb: 'Site, contractor, date and which maintenance test this covers' },
  { key: 'B', tag: 'B', title: 'Hydrostatic', blurb: 'Hydrant pipework pressure test' },
  { key: 'C', tag: 'C', title: 'Devices', blurb: 'Gauges and flow devices, and their calibration' },
  { key: 'D', tag: 'D', title: 'Flow test', blurb: 'The flow table — duty proved at each rate' },
  { key: 'E', tag: 'E', title: 'Booster', blurb: 'Pump appliance boost test' },
  { key: 'F', tag: 'F', title: 'Sprinkler hydro', blurb: 'Sprinkler pipework pressure test' },
  { key: 'G', tag: 'G', title: 'Sprinkler flow', blurb: 'Test points, required against achieved' },
  { key: 'H', tag: 'H', title: 'Result', blurb: 'Defects, repairs and the system result' },
  { key: 'I', tag: 'I', title: 'Declaration', blurb: 'Licensee, licence number and signature' },
  {
    key: 'Attachment',
    tag: '+',
    title: 'Attachment',
    blurb: "Owner, technician, building class and the defect list — added to the department's form, not part of it",
  },
];

const RESULT_OPTIONS: { value: PartResult; label: string }[] = [
  { value: 'na', label: 'N/A' },
  { value: 'pass', label: 'Pass' },
  { value: 'fail', label: 'Fail' },
];

const FLOW_DEVICE_LABEL: Record<FlowDeviceKind, string> = {
  orifice: 'Orifice plate',
  mechanical: 'Mechanical',
  electromagnetic: 'Electromagnetic',
};

/** Reads a typed number without turning an empty box into a zero. */
const num = (s: string): number | undefined => {
  const v = s.trim();
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const str = (n: number | undefined): string => (n === undefined ? '' : String(n));

export default function Form72Screen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [form, setForm] = useState<StoredForm72 | null>(null);
  // Loaded-and-absent is not the same as still loading. See RecordGate.
  const [missing, setMissing] = useState(false);
  // And a read that threw is neither. See RecordGate.
  const [failed, setFailed] = useState<string | null>(null);
  const [part, setPart] = useState<PartKey>('A');
  const [companyName, setCompanyName] = useState('');
  const [busy, setBusy] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [pickingJob, setPickingJob] = useState(false);
  const [siteJobs, setSiteJobs] = useState<JobSummary[]>([]);
  const [typedJob, setTypedJob] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setFailed(null);
    try {
      const [f, prefs] = await Promise.all([getForm72(id), loadPrefs()]);
      setForm(f);
      setMissing(!f);
      setCompanyName(prefs.companyName);
    } catch (e) {
      setFailed(describeLoadFailure(e, 'this Form 72'));
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const locked = form?.status === 'issued';

  /*
   * Writes land immediately rather than on a save button. The patch is the
   * changed field only, so two parts edited in quick succession cannot
   * overwrite each other with a stale copy of the other's JSON.
   */
  const pending = useRef<Promise<void>>(Promise.resolve());
  const patch = useCallback((p: Form72Patch) => {
    if (!id || locked) return;
    setForm((prev) => (prev ? { ...prev, ...p } as StoredForm72 : prev));
    pending.current = pending.current
      .then(() => updateForm72(id, p))
      .catch((e: unknown) => {
        showAlert('Not saved', e instanceof Error ? e.message : 'That change did not save.');
      });
  }, [id, locked]);

  const issues = useMemo(() => (form ? validateForm72(form) : []), [form]);
  const blockers = issues.filter((i) => i.blocking);
  const cautions = issues.filter((i) => !i.blocking);

  /**
   * Puts the PDF on the Simpro job's attachments.
   *
   * Queued, not sent: the phone may have no signal in the pump room, and the
   * queue carries it. The form remembers that it went, because "the office
   * has it" and "I think I sent it" are different states and only one of
   * them lets a technician stop worrying.
   */
  const attachToJob = useCallback(async (target: StoredForm72, quiet = false): Promise<boolean> => {
    if (!target.jobExternalId) return false;
    setAttaching(true);
    try {
      const html = form72Html({ form: target, systemLabel: target.systemLabel, companyName, generatedAt: nowIso(), overload: target.overload });
      const file = await writePdf(form72AttachmentName(target).replace(/\.pdf$/i, ''), html);
      if (file.printed) {
        if (!quiet) showAlert('Printed, not attached', 'On the web the PDF is printed rather than written, so it cannot be queued onto the job from here. Do this from a phone.');
        return false;
      }
      const filename = form72AttachmentName(target);
      const row = await queueJobAttachment({
        jobId: target.jobExternalId,
        localUri: file.uri,
        filename,
        mimeType: 'application/pdf',
        subject: form72AttachmentSubject(target),
        sizeBytes: file.size,
        key: attachmentContentKey({ jobId: target.jobExternalId, filename, sizeBytes: file.size }),
      });
      const at = nowIso();
      await recordForm72Attached(target.id, at);
      setForm((prev) => (prev && prev.id === target.id ? { ...prev, attachedAt: at } : prev));
      if (!quiet) {
        showAlert(
          row.duplicate ? 'Already queued' : 'Queued for the job',
          `The PDF is on Waiting to send for job ${target.jobExternalId}. It goes up with the next sync and shows on the job's attachments in Simpro.`,
        );
      }
      return true;
    } catch (e) {
      showAlert('Not attached', describeActionFailure(e, 'attaching the form to the job'));
      return false;
    } finally {
      setAttaching(false);
    }
  }, [companyName]);

  const emailForm = useCallback(async () => {
    if (!form) return;
    setAttaching(true);
    try {
      const html = form72Html({ form, systemLabel: form.systemLabel, companyName, generatedAt: nowIso(), overload: form.overload });
      const file = await writePdf(form72AttachmentName(form).replace(/\.pdf$/i, ''), html);

      const outcome = await sendMail({
        to: FORM72_INBOX,
        subject: form72AttachmentSubject(form),
        body: form72EmailBody(form, form.jobExternalId),
      }, [file]);

      if (outcome === 'no-mail-app') {
        showAlert('No mail app set up', `This phone has no email account configured. The form goes to ${FORM72_INBOX}; use Produce PDF and send it from wherever you can.`);
      } else if (outcome === 'sent') {
        showAlert('Sent', `On its way to ${FORM72_INBOX}.`);
      } else if (outcome === 'handed-over') {
        /*
         * A browser prints a PDF rather than writing one, so there is no file
         * to hand over — the person saves it from the print dialogue. Said
         * plainly, because a Form 72 that reaches the Commissioner without the
         * form attached is a notification that did not happen.
         */
        showAlert(
          'Draft opened — attach the form',
          file.printed
            ? `An email to ${FORM72_INBOX} is open. Use Produce PDF, save it from the print dialogue, and attach it before sending.`
            : `An email to ${FORM72_INBOX} is open and ${file.name} has downloaded. Attach it before sending.`,
        );
      } else {
        showAlert('Not sent', 'The email was not sent.');
      }
    } catch (e) {
      showAlert('Could not email it', describeActionFailure(e, 'emailing the form'));
    } finally {
      setAttaching(false);
    }
  }, [form, companyName]);

  const openJobPicker = useCallback(async () => {
    if (!form) return;
    setPickingJob(true);
    try {
      const page = await listJobPage({ filter: 'all', today: qldIsoDay(nowIso()) ?? '', siteId: form.siteId, limit: 50 });
      setSiteJobs(page.rows.filter((j) => j.externalId));
    } catch (e) {
      setSiteJobs([]);
      showAlert('Could not list the jobs', describeActionFailure(e, 'reading the site\'s jobs'));
    }
  }, [form]);

  const linkJob = useCallback(async (job: { externalId: string; title?: string } | null) => {
    if (!form) return;
    try {
      await linkForm72Job(form.id, job);
      setForm({ ...form, jobExternalId: job?.externalId.trim() || undefined, jobTitle: job?.title || undefined, attachedAt: undefined });
      setPickingJob(false);
      setTypedJob('');
    } catch (e) {
      showAlert('Not linked', describeActionFailure(e, 'linking the job'));
    }
  }, [form]);

  const onIssue = useCallback(() => {
    if (!form) return;
    if (blockers.length) {
      showAlert(
        'Not ready to issue',
        blockers.map((b) => `• Part ${b.part} — ${b.message}`).join('\n\n'),
      );
      return;
    }
    showAlert(
      'Issue this Form 72?',
      'Once issued it cannot be edited — a correction needs a new form. The occupier’s copy is '
      + `then due within ${OCCUPIER_COPY_BUSINESS_DAYS} business days, and you keep yours for `
      + `${TESTER_RETENTION_YEARS} years.`,
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Issue',
          style: 'destructive',
          onPress: async () => {
            try {
              const issued = await issueForm72(form.id);
              setForm(issued);
              // The issued document is what the office files. Where the job
              // is known it goes now, without another tap; where it is not,
              // the Simpro card below says so and stays red until it does.
              if (issued.jobExternalId) {
                const went = await attachToJob(issued, true);
                if (went) showAlert('Issued and queued for the job', `The PDF is on Waiting to send for job ${issued.jobExternalId}.`);
              }
            } catch (e) {
              showAlert('Cannot issue', e instanceof Error ? e.message : String(e));
            }
          },
        },
      ],
    );
  }, [form, blockers]);

  /*
   * The register's lists, laid onto the form's blanks.
   *
   * A new form gets this when it is started; the button is for a form
   * started before the site was synced, or one whose lists were cleared. It
   * fills blanks only — a hydrant somebody typed stays — and says what the
   * register did and did not hold, because a list left empty by "nothing in
   * the register" and one left empty by "not done yet" look the same on the
   * page.
   */
  const [filling, setFilling] = useState(false);
  const onFillFromRegister = useCallback(async () => {
    if (!form || locked) return;
    setFilling(true);
    try {
      const assets = await queryAssets({ siteId: form.siteId, limit: 5000 });
      const prefill = form72FromAssets(assets);
      const change = applyForm72Prefill(form, prefill);
      if (Object.keys(change).length) patch(change);
      showAlert(
        Object.keys(change).length ? 'Filled from the register' : 'Nothing to fill',
        [
          prefill.filled.length ? `Register holds: ${prefill.filled.join('; ')}.` : 'The register holds no water-based equipment for this site.',
          Object.keys(change).length ? '' : 'Every list the register could fill already has something in it, so nothing was changed.',
          `Not recorded: ${prefill.notRecorded.join('; ')}.`,
        ].filter(Boolean).join('\n\n'),
      );
    } catch (e) {
      showAlert('Could not read the register', e instanceof Error ? e.message : String(e));
    } finally {
      setFilling(false);
    }
  }, [form, locked, patch]);

  const onPdf = useCallback(async () => {
    if (!form) return;
    setBusy(true);
    try {
      const html = form72Html({
        form,
        systemLabel: form.systemLabel,
        companyName,
        generatedAt: nowIso(),
        overload: form.overload,
      });
      const file = await writePdf(`Form 72 ${form.siteName}`, html);
      const shared = await shareFile(file, 'Form 72');
      if (!shared) {
        const notice = notSharedNotice(file.name, 'form');
        showAlert(notice.title, notice.body);
      }
    } catch (e) {
      showAlert('Could not produce the form', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [form, companyName]);

  const onCopyGiven = useCallback(() => {
    if (!form) return;
    showAlert(
      'Occupier has their copy?',
      'This records the date they were given it, which is the fact the ten business days actually '
      + 'runs against. Producing the PDF is not the same event as handing it over.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'They have it',
          onPress: async () => {
            const at = nowIso();
            try {
              await recordOccupierCopy(form.id, at);
              setForm({ ...form, copyGivenAt: at });
            } catch (e) {
              showAlert('Not recorded', e instanceof Error ? e.message : String(e));
            }
          },
        },
      ],
    );
  }, [form]);

  if (!form) return <RecordGate missing={missing} what="Form 72" failed={failed} onRetry={() => { void load(); }} />;

  return (
    <Screen>
      <Stack.Screen options={{ title: `Form 72 — ${form.siteName}` }} />

      <Card>
        <Rowed>
          <View style={{ flex: 1 }}>
            <Txt size="lg" weight="700">{FORM_TITLE}</Txt>
            <Txt size="sm" tone="muted">{FORM_SUBTITLE} · {FORM_VERSION}</Txt>
          </View>
          <Chip
            label={form.status === 'issued' ? 'Issued' : 'Draft'}
            tone={form.status === 'issued' ? 'pass' : 'warn'}
          />
        </Rowed>
        {form.systemLabel ? <Txt size="sm" tone="muted">{form.systemLabel}</Txt> : null}
      </Card>

      <Card>
        <Rowed style={{ justifyContent: 'space-between' }} align="flex-start">
          <View style={{ flex: 1 }}>
            <Label>Simpro job</Label>
            {form.jobExternalId ? (
              <Txt weight="700" style={{ marginTop: 4 }}>Job {form.jobExternalId}{form.jobTitle ? ` — ${form.jobTitle}` : ''}</Txt>
            ) : (
              <Txt weight="700" tone="warn" style={{ marginTop: 4 }}>Not linked to a job yet</Txt>
            )}
            <Txt size="sm" tone="muted" style={{ marginTop: 2 }}>
              {form.attachedAt
                ? `PDF queued for the job ${qldMoment(form.attachedAt) ?? ''}.`
                : form.jobExternalId
                  ? (locked ? 'Issued but not yet on the job.' : 'The PDF goes onto this job the moment the form is issued.')
                  : 'The office files this form against the job the test was done under. Name it and the PDF attaches itself on issue.'}
            </Txt>
          </View>
          <Chip label={form.attachedAt ? 'On the job' : form.jobExternalId ? 'Linked' : 'No job'} tone={form.attachedAt ? 'pass' : form.jobExternalId ? 'default' : 'warn'} />
        </Rowed>

        {pickingJob ? (
          <View style={{ marginTop: t.space(3), gap: t.space(2) }}>
            {rankJobsForForm(siteJobs.map((j) => ({
              externalId: j.externalId!, title: j.title, status: j.status, statusName: j.statusName, scheduledFor: j.scheduledFor, completedAt: j.completedAt,
            }))).slice(0, 8).map((j) => (
              <Pressable key={j.externalId} onPress={() => { void linkJob({ externalId: j.externalId, title: j.title }); }} accessibilityRole="button">
                <Txt weight="700">Job {j.externalId} — {j.title}</Txt>
                <Txt size="sm" tone="muted">{j.statusName ?? j.status}{j.scheduledFor ? ` · ${formatAuDate(j.scheduledFor)}` : ''}</Txt>
              </Pressable>
            ))}
            {siteJobs.length === 0 ? <Txt size="sm" tone="muted">No Simpro jobs for this site on the phone. Type the number.</Txt> : null}
            <Rowed gap={2} align="flex-start">
              <View style={{ flex: 1 }}>
                <Field label="Or the job number" value={typedJob} onChangeText={setTypedJob} keyboardType="numeric" placeholder="41900" />
              </View>
            </Rowed>
            <Rowed gap={2}>
              <Chip label="Link this number" onPress={() => { if (/^\d+$/.test(typedJob.trim())) void linkJob({ externalId: typedJob.trim() }); }} />
              <Chip label="Cancel" onPress={() => setPickingJob(false)} />
            </Rowed>
          </View>
        ) : (
          <Rowed gap={2} wrap style={{ marginTop: t.space(3) }}>
            <Chip label={form.jobExternalId ? 'Change job' : 'Link to a job'} onPress={() => { void openJobPicker(); }} />
            {form.jobExternalId ? (
              <Chip label={form.attachedAt ? 'Queue the PDF again' : 'Attach PDF to job'} onPress={() => { void attachToJob(form); }} />
            ) : null}
            <Chip label={`Email to ${FORM72_INBOX.split('@')[0]}`} onPress={() => { void emailForm(); }} />
            <Chip label="Open in hydrant flow tool" onPress={() => router.push({ pathname: '/tools/hydrant', params: { form72: form.id } })} />
          </Rowed>
        )}
        {attaching ? <Txt size="xs" tone="faint" style={{ marginTop: t.space(1.5) }}>Working…</Txt> : null}
      </Card>

      {locked ? (
        <Banner tone="info" title="Issued — no longer editable" body={ISSUED_REFUSAL} />
      ) : null}

      {locked ? <OccupierCopyCard form={form} onPress={onCopyGiven} /> : null}

      {!locked && blockers.length ? (
        <Banner
          tone="warn"
          title={`${blockers.length} thing${blockers.length === 1 ? '' : 's'} still to do before this can be issued`}
          body={blockers.map((b) => `Part ${b.part} — ${b.message}`).join('\n')}
        />
      ) : null}

      {!locked && !blockers.length ? (
        <Banner tone="pass" title="Ready to issue" body="Nothing blocking is outstanding." />
      ) : null}

      {cautions.length ? (
        <Banner
          tone="fail"
          title="Worth a look before you sign"
          body={cautions.map((c) => `Part ${c.part} — ${c.message}`).join('\n')}
        />
      ) : null}

      <PartStrip form={form} issues={issues} value={part} onChange={setPart} />

      {!locked && part === 'A' ? (
        <Button
          title="Fill the lists from the site's register"
          variant="secondary"
          onPress={() => void onFillFromRegister()}
          loading={filling}
          icon={<MaterialCommunityIcons name="database-import-outline" size={18} color={t.color.text} />}
        />
      ) : null}

      <PartBody
        part={part}
        form={form}
        locked={!!locked}
        patch={patch}
      />

      <Divider />

      <Rowed gap={2}>
        <Button
          title="Produce PDF"
          onPress={onPdf}
          loading={busy}
          variant="secondary"
          style={{ flex: 1 }}
          icon={<MaterialCommunityIcons name="file-pdf-box" size={18} color={t.color.text} />}
        />
        {!locked ? (
          <Button
            title="Issue"
            onPress={onIssue}
            disabled={blockers.length > 0}
            style={{ flex: 1 }}
          />
        ) : null}
      </Rowed>

      <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
        {DECLARATION}
      </Txt>
    </Screen>
  );
}

/**
 * The part strip.
 *
 * A part with a blocker is marked; a part left at 'na' is dimmed rather than
 * flagged, because "not applicable" is a legitimate and common answer on this
 * form and colouring it as a problem trains people to ignore the colour.
 */
function PartStrip({
  form, issues, value, onChange,
}: {
  form: StoredForm72;
  issues: FormIssue[];
  value: PartKey;
  onChange: (p: PartKey) => void;
}) {
  const t = useTheme();
  const answered: Record<PartKey, boolean> = {
    A: !!form.testDate && !!form.contractor.trim(),
    B: form.hydrostatic.result !== 'na',
    C: form.devices.length > 0,
    D: form.flowTest.result !== 'na',
    E: form.booster.result !== 'na',
    F: form.sprinklerHydrostatic.result !== 'na',
    G: form.sprinklerFlow.result !== 'na',
    H: form.systemResult !== 'na' || form.criticalDefectsIdentified !== undefined,
    I: !!form.licenceNumber.trim() && !!form.signature,
    // Not a part of the department's form, so nothing on it can be outstanding
    // — it reads as answered once anything has been put on it.
    Attachment: !!form.owner?.trim() || !!form.technician?.trim() || form.defects.length > 0,
  };

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space(1.5) }}>
      {PARTS.map((p) => {
        const blocked = issues.some((i) => i.part === p.key && i.blocking);
        const on = value === p.key;
        return (
          <Pressable
            key={p.key}
            onPress={() => onChange(p.key)}
            style={{
              // The 44dp floor: these are pressed with gloves on.
              minHeight: 44,
              paddingVertical: t.space(1.5),
              paddingHorizontal: t.space(2.5),
              borderRadius: t.radius.md,
              backgroundColor: on ? t.color.accent : t.color.surfaceAlt,
              borderWidth: 1,
              borderColor: blocked && !on ? t.color.warn : 'transparent',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <Txt
              size="sm"
              weight="700"
              style={{ color: on ? t.color.onAccent : t.color.text }}
            >
              {p.tag}
            </Txt>
            <Txt size="sm" style={{ color: on ? t.color.onAccent : answered[p.key] ? t.color.text : t.color.textFaint }}>
              {p.title}
            </Txt>
            {blocked ? (
              <MaterialCommunityIcons
                name="alert-circle"
                size={13}
                color={on ? t.color.onAccent : t.color.warn}
              />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function PartBody({
  part, form, locked, patch,
}: {
  part: PartKey;
  form: StoredForm72;
  locked: boolean;
  patch: (p: Form72Patch) => void;
}) {
  const meta = PARTS.find((p) => p.key === part)!;
  return (
    <View style={{ gap: 12 }}>
      <View>
        <H2>{part === 'Attachment' ? meta.title : `Part ${part} — ${meta.title}`}</H2>
        <Txt size="sm" tone="muted">{meta.blurb}</Txt>
      </View>
      {part === 'A' ? <PartA form={form} locked={locked} patch={patch} /> : null}
      {part === 'B' ? <PartB form={form} locked={locked} patch={patch} /> : null}
      {part === 'C' ? <PartC form={form} locked={locked} patch={patch} /> : null}
      {part === 'D' ? <PartD form={form} locked={locked} patch={patch} /> : null}
      {part === 'E' ? <PartE form={form} locked={locked} patch={patch} /> : null}
      {part === 'F' ? <PartF form={form} locked={locked} patch={patch} /> : null}
      {part === 'G' ? <PartG form={form} locked={locked} patch={patch} /> : null}
      {part === 'H' ? <PartH form={form} locked={locked} patch={patch} /> : null}
      {part === 'I' ? <PartI form={form} locked={locked} patch={patch} /> : null}
      {part === 'Attachment' ? <PartAttachment form={form} locked={locked} patch={patch} /> : null}
    </View>
  );
}

type PartProps = {
  form: StoredForm72;
  locked: boolean;
  patch: (p: Form72Patch) => void;
};

/** A part's na/pass/fail selector, which every part but A and C carries. */
function ResultPicker({
  value, onChange, locked,
}: {
  value: PartResult;
  onChange: (v: PartResult) => void;
  locked: boolean;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Label>Result</Label>
      {locked ? (
        <Chip label={PART_RESULT_LABEL[value]} tone={value === 'pass' ? 'pass' : value === 'fail' ? 'fail' : 'muted'} />
      ) : (
        <Segmented options={RESULT_OPTIONS} value={value} onChange={onChange} />
      )}
    </View>
  );
}

const TEST_KINDS: { key: keyof StoredForm72['maintenanceTest']; label: string }[] = [
  { key: 'hydrantAnnual', label: 'Hydrant — annual' },
  { key: 'hydrantFiveYear', label: 'Hydrant — 5 yearly' },
  { key: 'sprinklerAnnual', label: 'Sprinkler — annual' },
  { key: 'sprinklerFiveYear', label: 'Sprinkler — 5 yearly' },
  { key: 'combinedAnnual', label: 'Combined — annual' },
  { key: 'combinedFiveYear', label: 'Combined — 5 yearly' },
];

const SYSTEM_TYPES: SystemType[] = ['hydrant', 'sprinkler', 'combined'];
const INTERVALS: TestInterval[] = ['annual', 'fiveYear'];

/**
 * Part A's maintenance grid, asked as the two questions it really is.
 *
 * The department prints six cells; nobody thinks in six cells. They think
 * "combined system, annual test", which is one tap on each row here, and the
 * grid underneath is ticked from the pair.
 *
 * The six cells stay reachable, because the two axes cannot express every grid.
 * A form signed last year may have "hydrant annual" and "sprinkler 5 yearly"
 * ticked — two cells that no pair of axes picks out without also ticking the
 * other two — and a control that silently rewrote it would change what a signed
 * document says it covered. So where the stored grid is one the axes cannot
 * express, the axes step aside and the cells are edited directly.
 */
function MaintenanceGrid({ form, locked, patch }: PartProps) {
  const m = form.maintenanceTest;
  const types = systemTypesTested(m);
  const intervals = intervalsTested(m);
  const ticked = TEST_KINDS.filter((k) => m[k.key]);

  const fromAxes = maintenanceTestFromAxes(types, intervals);
  const expressible = TEST_KINDS.every((k) => fromAxes[k.key] === m[k.key]);

  const toggle = (nextTypes: SystemType[], nextIntervals: TestInterval[]) => patch({
    maintenanceTest: maintenanceTestFromAxes(nextTypes, nextIntervals),
  });

  if (!expressible) {
    return (
      <>
        <Label>Maintenance test carried out</Label>
        <Banner
          tone="info"
          title="Ticked cell by cell"
          body={'This form has a combination of boxes the two questions below cannot express, so the '
            + 'six cells are shown as they were ticked rather than being rewritten.'}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {TEST_KINDS.map((k) => (
            <Chip
              key={k.key}
              label={k.label}
              selected={m[k.key]}
              tone={m[k.key] ? 'accent' : 'default'}
              onPress={locked ? undefined : () => patch({
                maintenanceTest: { ...m, [k.key]: !m[k.key] },
              })}
            />
          ))}
        </View>
      </>
    );
  }

  return (
    <>
      <Label>System tested</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {SYSTEM_TYPES.map((type) => {
          const on = types.includes(type);
          return (
            <Chip
              key={type}
              label={SYSTEM_TYPE_LABEL[type]}
              selected={on}
              tone={on ? 'accent' : 'default'}
              onPress={locked ? undefined : () => toggle(
                on ? types.filter((x) => x !== type) : [...types, type],
                intervals.length ? intervals : ['annual'],
              )}
            />
          );
        })}
      </View>

      <Label>Test interval</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {INTERVALS.map((interval) => {
          const on = intervals.includes(interval);
          return (
            <Chip
              key={interval}
              label={TEST_INTERVAL_LABEL[interval]}
              selected={on}
              tone={on ? 'accent' : 'default'}
              onPress={locked ? undefined : () => toggle(
                types.length ? types : ['hydrant'],
                on ? intervals.filter((x) => x !== interval) : [...intervals, interval],
              )}
            />
          );
        })}
      </View>

      <Txt size="sm" tone="muted">
        {ticked.length
          ? `Prints as ${ticked.map((k) => k.label).join(', ')}.`
          : 'No box is ticked yet. The form does not say which test this was.'}
      </Txt>
    </>
  );
}

function PartA({ form, locked, patch }: PartProps) {
  return (
    <Card>
      <Field
        label="Site"
        value={form.siteName}
        onChangeText={(v) => patch({ siteName: v })}
        editable={!locked}
      />
      <Field
        label="Address"
        value={form.siteAddress ?? ''}
        onChangeText={(v) => patch({ siteAddress: v })}
        editable={!locked}
      />
      <Field
        label="System"
        value={form.systemLabel}
        onChangeText={(v) => patch({ systemLabel: v })}
        placeholder="Towns Main System"
        hint="The descriptor in the form's top right corner. Without it, two forms for this site on the same day are indistinguishable."
        editable={!locked}
      />
      <Field
        label="Contractor"
        value={form.contractor}
        onChangeText={(v) => patch({ contractor: v })}
        editable={!locked}
      />
      <Rowed gap={2}>
        <View style={{ flex: 2 }}>
          <Field
            label="Test date"
            value={form.testDate ?? ''}
            onChangeText={(v) => patch({ testDate: v })}
            placeholder="2026-07-03"
            hint="Prints as d/m/yyyy"
            editable={!locked}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="Time"
            value={form.testTime ?? ''}
            onChangeText={(v) => patch({ testTime: v })}
            placeholder="09:30"
            editable={!locked}
          />
        </View>
      </Rowed>

      <Divider />
      <MaintenanceGrid form={form} locked={locked} patch={patch} />
    </Card>
  );
}

function PartB({ form, locked, patch }: PartProps) {
  const h = form.hydrostatic;
  const set = (p: Partial<HydrostaticTest>) => patch({ hydrostatic: { ...h, ...p } });
  const loss = h.testPressureKpa !== undefined && h.endPressureKpa !== undefined
    ? h.testPressureKpa - h.endPressureKpa
    : undefined;

  return (
    <Card>
      <Txt size="sm" tone="muted">{PART_B_NOTE}</Txt>
      <ResultPicker value={h.result} onChange={(v) => set({ result: v })} locked={locked} />
      <NumField label="Boost pressure" suffix="kPa" value={h.boostPressureKpa} onChange={(v) => set({ boostPressureKpa: v })} locked={locked} />
      <NumField label="Test pressure" suffix="kPa" value={h.testPressureKpa} onChange={(v) => set({ testPressureKpa: v })} locked={locked} />
      <NumField label="Held for" suffix="min" value={h.durationMinutes} onChange={(v) => set({ durationMinutes: v })} locked={locked} />
      <NumField label="Pressure at end" suffix="kPa" value={h.endPressureKpa} onChange={(v) => set({ endPressureKpa: v })} locked={locked} />
      {loss !== undefined ? (
        <Banner
          tone={loss > 0 ? 'warn' : 'pass'}
          title={loss > 0 ? `Dropped ${loss} kPa over the hold` : 'Held pressure'}
        />
      ) : null}
      <NumField label="Loss" suffix="L/min" value={h.lossLpm} onChange={(v) => set({ lossLpm: v })} locked={locked} />
      <Field
        label="Comments"
        value={h.comments ?? ''}
        onChangeText={(v) => set({ comments: v })}
        multiline
        hint="Your line breaks are kept on the printed form."
        editable={!locked}
      />
    </Card>
  );
}

/**
 * Part C — the devices.
 *
 * The calibration check is the reason this part is worth filling in on a phone
 * rather than on paper. A gauge out of calibration makes every pressure on the
 * page unusable, and it is the one thing a person reading the printed form
 * cannot check, because the paper does not carry the test date beside it.
 */
/** The column the next device occupies, in the department's own words. */
function deviceSlotName(index: number): string {
  return DEPARTMENT_DEVICE_SLOTS[index] ?? `Device/gauge ${index + 1}`;
}

function PartC({ form, locked, patch }: PartProps) {
  const devices = form.devices;
  const unused = unusedDevicePresets(devices);
  const setDevice = (i: number, p: Partial<TestDevice>) => patch({
    devices: devices.map((d, n) => (n === i ? { ...d, ...p } : d)),
  });


  return (
    <View style={{ gap: 12 }}>
      <Card>
        <Txt size="sm" tone="muted">{PART_C_NOTE}</Txt>
        <Divider />
        <Label>Flow device type</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(['orifice', 'mechanical', 'electromagnetic'] as FlowDeviceKind[]).map((k) => (
            <Chip
              key={k}
              label={FLOW_DEVICE_LABEL[k]}
              selected={form.flowDeviceKinds.includes(k)}
              tone={form.flowDeviceKinds.includes(k) ? 'accent' : 'default'}
              onPress={locked ? undefined : () => patch({
                flowDeviceKinds: form.flowDeviceKinds.includes(k)
                  ? form.flowDeviceKinds.filter((x) => x !== k)
                  : [...form.flowDeviceKinds, k],
              })}
            />
          ))}
        </View>
      </Card>

      {devices.map((d, i) => {
        /*
         * The same judgement the validation makes, not a second one. When the
         * screen had its own it answered a narrower question: it flagged a
         * gauge past twelve months and said nothing at all about one with no
         * calibration date, which is the same unusable reading with less
         * evidence behind it.
         */
        const cal = deviceCalibration(d, form.testDate);
        return (
        <Card key={`${d.slot}-${i}`}>
          <Rowed>
            <View style={{ flex: 1 }}>
              <Txt weight="700">{d.slot || deviceSlotName(i)}</Txt>
              {d.model ? <Txt size="xs" tone="faint">{d.model}</Txt> : null}
            </View>
            {cal.issue ? (
              <Chip
                label={cal.state === 'out-of-calibration' ? 'Out of calibration'
                  : cal.state === 'no-date' ? 'No calibration date'
                    : cal.state === 'calibrated-after-test' ? 'Date conflict' : 'Unreadable date'}
                tone={cal.issue.blocking ? 'fail' : 'warn'}
              />
            ) : null}
            {!locked ? (
              <RemoveButton what="device" onRemove={() => patch({ devices: devices.filter((_, n) => n !== i) })} />
            ) : null}
          </Rowed>
          <Field label="Serial number" value={d.serialNumber} onChangeText={(v) => setDevice(i, { serialNumber: v })} editable={!locked} />
          <Field
            label="Calibrated"
            value={d.dateCalibrated ?? ''}
            onChangeText={(v) => setDevice(i, { dateCalibrated: v })}
            placeholder="2026-01-15"
            editable={!locked}
          />
          {cal.issue ? (
            <Banner
              tone={cal.issue.blocking ? 'fail' : 'warn'}
              title={cal.state === 'out-of-calibration'
                ? `Calibrated ${formatAuDate(d.dateCalibrated)}, more than ${CALIBRATION_MONTHS} months before this test`
                : 'This gauge cannot be relied on'}
              body={cal.issue.message}
            />
          ) : null}
          <Field label="Certificate" value={d.calibrationCertificate ?? ''} onChangeText={(v) => setDevice(i, { calibrationCertificate: v })} editable={!locked} />
          {/*
            * Which basis the date was accepted on.
            *
            * A pressure gauge is good for twelve months and then it is not,
            * whatever anybody says. Our two flow meters are not gauges: the
            * manufacturer certifies them for the device's service life, and on
            * the twelve-month rule they would block every form raised a year
            * after their certificate date — refused for a reason the
            * certificate contradicts. So it is a per-device claim, it clears
            * only the staleness check, and it prints on the form so a reader
            * can judge it.
            */}
          <View style={{ gap: 6 }}>
            <Label>Calibration basis</Label>
            {locked ? (
              <Chip label={d.calibrationBasis === 'service-life' ? 'Certified for service life' : `${CALIBRATION_MONTHS} month interval`} />
            ) : (
              <Segmented
                options={[
                  { value: 'interval' as const, label: `${CALIBRATION_MONTHS} months` },
                  { value: 'service-life' as const, label: 'Service life' },
                ]}
                value={d.calibrationBasis ?? 'interval'}
                onChange={(v) => setDevice(i, { calibrationBasis: v })}
              />
            )}
            {d.calibrationBasis === 'service-life' ? (
              <Txt size="xs" tone="faint">
                Only for a device whose certificate says so — our inline meters do. On a pressure
                gauge this is wrong, and the form prints which basis each device was accepted on.
              </Txt>
            ) : null}
          </View>
          <Field
            label="Correction factor"
            value={d.correctionFactor ?? ''}
            onChangeText={(v) => setDevice(i, { correctionFactor: v })}
            placeholder="+5 kPa"
            hint="Part C's note says this must be a kPa figure or a percentage. Every pressure read with this gauge carries it."
            editable={!locked}
          />
          <Rowed gap={2}>
            <View style={{ flex: 1 }}>
              <Field label="Face size" value={d.faceSize ?? ''} onChangeText={(v) => setDevice(i, { faceSize: v })} placeholder="100 mm" editable={!locked} />
            </View>
            <View style={{ flex: 1 }}>
              <NumField label="Increments" suffix="kPa" value={d.incrementsKpa} onChange={(v) => setDevice(i, { incrementsKpa: v })} locked={locked} />
            </View>
          </Rowed>
          <Chip
            label={d.digitalReader ? 'Digital reader' : 'Analogue'}
            onPress={locked ? undefined : () => setDevice(i, { digitalReader: !d.digitalReader })}
          />
        </Card>
        );
      })}

      {!locked ? (
        <Card>
          {/*
            * The company's own meters, in one tap.
            *
            * Part C is the same two instruments on nearly every hydrant form
            * this company raises, and it was typed again every time: a serial
            * number, a date, a certificate reference and a correction factor.
            * A serial number mistyped reads exactly like a serial number, and
            * the form it is on is signed. What a chip adds is still editable —
            * a serviced meter has a new certificate date before this app does.
            */}
          {unused.length ? (
            <>
              <Label>Our test equipment</Label>
              <Txt size="sm" tone="muted">
                Adds the meter with its serial number, certificate and correction factor already
                filled in. Check them against the certificate in your hand.
              </Txt>
              <View style={{ gap: 8 }}>
                {unused.map((preset) => (
                  <View key={preset.id} style={{ gap: 2 }}>
                    <Chip
                      label={`+ ${preset.label}`}
                      onPress={() => patch({
                        devices: [...devices, { slot: deviceSlotName(devices.length), ...preset.device }],
                      })}
                    />
                    <Txt size="xs" tone="faint">{preset.detail}</Txt>
                  </View>
                ))}
              </View>
              {unused.some((p) => p.flowDeviceKindNote) ? (
                <Txt size="xs" tone="faint">
                  {unused.find((p) => p.flowDeviceKindNote)!.flowDeviceKindNote}
                </Txt>
              ) : null}
            </>
          ) : (
            <Txt size="sm" tone="muted">
              Both of our meters are on this form. Anything else you used goes on by hand.
            </Txt>
          )}
          <Button
            title="Add a device by hand"
            variant="secondary"
            onPress={() => patch({
              devices: [...devices, { slot: deviceSlotName(devices.length), serialNumber: '' }],
            })}
          />
        </Card>
      ) : null}
    </View>
  );
}

/**
 * Writes one numbered hydrant location without disturbing the others.
 *
 * The array is positional — index 0 is hydrant 1, and the flow table's columns
 * refer to those positions — so a cleared middle slot has to stay a hole rather
 * than closing up and renumbering the hydrants under the readings. Trailing
 * empties are dropped, because an array of four blanks and an array of none say
 * the same thing and only one of them is worth storing.
 */
function setHydrantLocation(locations: string[], n: number, value: string): string[] {
  const next = [...locations];
  while (next.length < n) next.push('');
  next[n - 1] = value;
  while (next.length && !next[next.length - 1]?.trim()) next.pop();
  return next;
}

/**
 * Part D — the flow table.
 *
 * The department prints eight lines: three nozzle bores and five metered
 * duties, each read at one, two, three and four hydrants running. All eight are
 * always on screen, because the table is the same eight lines on every form and
 * a technician working down it needs to see the one they have not filled in.
 * That is the opposite of the old behaviour, which started with no lines and
 * offered chips to add the five metered rates — a table that looked complete
 * with three of its eight lines missing.
 *
 * A line nobody touched is marked, not hidden. On paper the blank is ambiguous;
 * here it says plainly that nothing was read at that rate, which is an answer.
 *
 * A row at some rate the department does not print is still legitimate — it is
 * what the block plan asked for — and is kept, marked, below the eight.
 */
function PartD({ form, locked, patch }: PartProps) {
  const f = form.flowTest;
  const set = (p: Partial<typeof f>) => patch({ flowTest: { ...f, ...p } });

  // The eight printed lines, laid over whatever this form has stored. A line
  // the form holds keeps its readings and its index; a line it does not is
  // shown empty and only becomes a stored row once something is typed into it.
  const stored = new Map(f.rows.map((r, i) => [flowRowKey(r), i]));
  const lines: { row: FlowRow; index: number | undefined; printed: boolean }[] = [
    ...PART_D_ROWS.map((template) => {
      const index = stored.get(flowRowKey(template));
      const held = index === undefined ? undefined : f.rows[index];
      return { row: held ?? template, index, printed: true };
    }),
    ...f.rows
      .map((row, index) => ({ row, index, printed: false }))
      .filter(({ row }) => !PART_D_ROWS.some((t) => flowRowKey(t) === flowRowKey(row))),
  ];

  const setLine = (
    line: { row: FlowRow; index: number | undefined },
    p: Partial<FlowRow>,
  ) => set({
    rows: line.index === undefined
      ? [...f.rows, { ...line.row, ...p }]
      : f.rows.map((r, n) => (n === line.index ? { ...r, ...p } : r)),
  });

  return (
    <View style={{ gap: 12 }}>
      <Card>
        <Txt size="sm" tone="muted">{PART_D_NOTE}</Txt>
        <View style={{ gap: 6 }}>
          <Label>Result</Label>
          {locked ? (
            <Chip label={f.result === 'refer-to-report' ? 'Refer to report' : PART_RESULT_LABEL[f.result]} />
          ) : (
            <Segmented
              options={[...RESULT_OPTIONS, { value: 'refer-to-report' as const, label: 'Refer' }]}
              value={f.result}
              onChange={(v) => set({ result: v })}
            />
          )}
        </View>
        <NumField label="Static pressure" suffix="kPa" value={f.staticPressureKpa} onChange={(v) => set({ staticPressureKpa: v })} locked={locked} />
        <Field label="Pressure zone" value={f.pressureZone ?? ''} onChangeText={(v) => set({ pressureZone: v })} editable={!locked} />
        <Divider />
        <Label>System requirement</Label>
        <Txt size="sm" tone="muted">
          What the system has to deliver. Without it the table below is a column of pressures and
          whoever reads the form has to know the design to say whether it passed.
        </Txt>
        <Rowed gap={2}>
          <View style={{ flex: 1 }}>
            <NumField label="Required flow" suffix="L/s" value={f.requiredLps} onChange={(v) => set({ requiredLps: v })} locked={locked} />
          </View>
          <View style={{ flex: 1 }}>
            <NumField label="Required pressure" suffix="kPa" value={f.requiredKpa} onChange={(v) => set({ requiredKpa: v })} locked={locked} />
          </View>
        </Rowed>
        {/*
          * Four named slots, not a comma-separated list. The printed form has
          * four location fields and the table's columns refer to them by
          * number — "Hydrants 1, 2 & 3" means these three — so which hydrant is
          * which is load-bearing, and a list typed into one box puts that
          * ordering at the mercy of a stray comma.
          */}
        <Label>Hydrants tested</Label>
        <Txt size="sm" tone="muted">
          Numbered to match the table below: hydrant 1 is the one the single-hydrant readings were
          taken at. Filled from the register where it holds hydrants — clear any not used today.
        </Txt>
        {/*
          * Four slots, and more where the form already holds more. The
          * register prefills every hydrant on the site, which at a large one
          * is seven or eight — showing only four would make the rest
          * invisible on the phone while they are still stored, and invisible
          * is how a location nobody meant to keep ends up on a signed form.
          */}
        {Array.from(
          { length: Math.max(PART_D_LOCATION_SLOTS, f.hydrantLocations.length) },
          (_, i) => i + 1,
        ).map((n) => (
          <Field
            key={n}
            label={n <= PART_D_LOCATION_SLOTS ? `Hydrant ${n}` : `Hydrant ${n} — beyond the printed form`}
            value={f.hydrantLocations[n - 1] ?? ''}
            onChangeText={(v) => set({ hydrantLocations: setHydrantLocation(f.hydrantLocations, n, v) })}
            placeholder={n === 1 ? 'Booster' : n === 2 ? 'Level 3 east' : ''}
            hint={n > PART_D_LOCATION_SLOTS
              ? "The department prints four. This one is listed under the table instead of being dropped — clear it if it was not used in this test."
              : undefined}
            editable={!locked}
          />
        ))}
        <Chip
          label={f.onSitePumpSet ? 'On-site pump set' : 'No on-site pump set'}
          tone={f.onSitePumpSet ? 'accent' : 'default'}
          onPress={locked ? undefined : () => set({ onSitePumpSet: !f.onSitePumpSet })}
        />
      </Card>

      {lines.map((line) => {
        const r = line.row;
        const untouched = flowRowUntouched(r);
        return (
          <Card key={flowRowKey(r)}>
            <Rowed>
              <Txt weight="700" style={{ flex: 1 }}>{flowRowLongLabel(r)}</Txt>
              {!line.printed ? <Chip label="Not on the printed table" tone="warn" /> : null}
              {untouched ? <Chip label="Nothing read" tone="muted" /> : null}
              {!line.printed && !locked && line.index !== undefined ? (
                <RemoveButton
                  what="flow row"
                  onRemove={() => set({ rows: f.rows.filter((_, n) => n !== line.index) })}
                />
              ) : null}
            </Rowed>
            <Field label="Devices used" value={r.devices} onChangeText={(v) => setLine(line, { devices: v })} editable={!locked} />
            <Rowed gap={2}>
              <View style={{ flex: 1 }}>
                <NumField label="1 hydrant" suffix="kPa" value={r.hydrant1Kpa} onChange={(v) => setLine(line, { hydrant1Kpa: v })} locked={locked} />
              </View>
              <View style={{ flex: 1 }}>
                <NumField label="1 & 2" suffix="kPa" value={r.hydrants12Kpa} onChange={(v) => setLine(line, { hydrants12Kpa: v })} locked={locked} />
              </View>
            </Rowed>
            <Rowed gap={2}>
              <View style={{ flex: 1 }}>
                <NumField label="1, 2 & 3" suffix="kPa" value={r.hydrants123Kpa} onChange={(v) => setLine(line, { hydrants123Kpa: v })} locked={locked} />
              </View>
              <View style={{ flex: 1 }}>
                <NumField label="1, 2, 3 & 4" suffix="kPa" value={r.hydrants1234Kpa} onChange={(v) => setLine(line, { hydrants1234Kpa: v })} locked={locked} />
              </View>
            </Rowed>
          </Card>
        );
      })}

      <Card>
        <Label>System achieved</Label>
        <Txt size="sm" tone="muted">
          The pair the form asks for, opposite the requirement above. Two numbers rather than a
          sentence, because two numbers can be compared with what was required and a sentence
          cannot.
        </Txt>
        <Rowed gap={2}>
          <View style={{ flex: 1 }}>
            <NumField label="Achieved flow" suffix="L/s" value={f.achievedLps} onChange={(v) => set({ achievedLps: v })} locked={locked} />
          </View>
          <View style={{ flex: 1 }}>
            <NumField label="Achieved pressure" suffix="kPa" value={f.achievedKpa} onChange={(v) => set({ achievedKpa: v })} locked={locked} />
          </View>
        </Rowed>
        {/*
          * Kept, and shown only where a form already holds one. Forms signed
          * before the pair existed said it in a sentence, and their printed
          * page has to keep saying what it said.
          */}
        {f.systemAchieved?.trim() ? (
          <Field
            label="System achieved (as written)"
            value={f.systemAchieved}
            onChangeText={(v) => set({ systemAchieved: v })}
            hint="Recorded as a sentence before this form asked for the two figures. It still prints."
            editable={!locked}
          />
        ) : null}
        <Field label="Comment" value={f.comment ?? ''} onChangeText={(v) => set({ comment: v })} multiline editable={!locked} />
      </Card>
    </View>
  );
}

/**
 * Part E — the booster, and the overload run the department's form omits.
 *
 * A pump tested only at its rated duty has not been tested: one on the way out
 * still makes its number at the easy end of the curve. The run that finds it is
 * 150% of duty flow at 65% of duty pressure, and this is the only place in the
 * app that asks for it.
 */
function PartE({ form, locked, patch }: PartProps) {
  const b = form.booster;
  const set = (p: Partial<BoosterTest>) => patch({ booster: { ...b, ...p } });
  const head = b.highestHydrantAboveBoosterM !== undefined
    ? elevationHeadKpa(b.highestHydrantAboveBoosterM)
    : undefined;
  const friction = resolveFrictionalLoss(b);
  const gaps = frictionalLossGaps(b);
  const check = b.requiredLps !== undefined && b.requiredKpa !== undefined
    ? overloadCheck(b.requiredLps, b.requiredKpa, form.overload)
    : undefined;

  return (
    <View style={{ gap: 12 }}>
      <Card>
        <Txt size="sm" tone="muted">{PART_E_NOTE}</Txt>
        <ResultPicker value={b.result} onChange={(v) => set({ result: v })} locked={locked} />
        <Field label="Hydrants tested" value={b.hydrantLocations ?? ''} onChangeText={(v) => set({ hydrantLocations: v })} editable={!locked} />
        <NumField
          label="Highest hydrant above booster"
          suffix="m"
          value={b.highestHydrantAboveBoosterM}
          onChange={(v) => set({ highestHydrantAboveBoosterM: v })}
          locked={locked}
        />
        {head !== undefined ? (
          <Banner tone="info" title={`Elevation head ${head} kPa`} body="Static lift to the highest hydrant, before any friction." />
        ) : null}
        <NumField label="Required flow" suffix="L/s" value={b.requiredLps} onChange={(v) => set({ requiredLps: v })} locked={locked} />
        <NumField label="Required pressure" suffix="kPa" value={b.requiredKpa} onChange={(v) => set({ requiredKpa: v })} locked={locked} />
      </Card>

      <Card>
        <Label>Measured</Label>
        <NumField label="Static pressure" suffix="kPa" value={b.staticPressureKpa} onChange={(v) => set({ staticPressureKpa: v })} locked={locked} />
        <NumField label="Pump inlet" suffix="kPa" value={b.pumpInletKpa} onChange={(v) => set({ pumpInletKpa: v })} locked={locked} />
        <NumField label="Pump discharge" suffix="kPa" value={b.pumpDischargeKpa} onChange={(v) => set({ pumpDischargeKpa: v })} locked={locked} />
        <NumField label="Boost pressure" suffix="kPa" value={b.boostPressureKpa} onChange={(v) => set({ boostPressureKpa: v })} locked={locked} />
        <NumField label="Residual at the hydrant" suffix="kPa" value={b.hydrantResidualKpa} onChange={(v) => set({ hydrantResidualKpa: v })} locked={locked} />
        {friction.source === 'calculated' ? (
          <Banner tone="info" title={`Frictional loss ${friction.kpa} kPa`} body="Discharge at the pump less what arrived at the hydrant." />
        ) : gaps.length ? (
          <Banner tone="warn" title="Frictional loss cannot be worked out here" body={gaps.join('\n')} />
        ) : null}
        {/*
          * The form's box says "calculated frictional loss", and two things can
          * fill it: this subtraction, or a figure the technician worked out at
          * the booster. Both are kept. The calculated one prints where it
          * exists, because the page can show its working — and where they
          * disagree by more than rounding the form says so instead of quietly
          * replacing one with the other.
          */}
        <NumField
          label="Frictional loss, as worked out on site"
          suffix="kPa"
          value={b.statedFrictionalLossKpa}
          onChange={(v) => set({ statedFrictionalLossKpa: v })}
          locked={locked}
        />
        {friction.disagreesWithKpa !== undefined ? (
          <Banner
            tone="fail"
            title={`Two figures: ${friction.kpa} kPa from the readings, ${friction.disagreesWithKpa} kPa entered`}
            body={'The readings above are what prints, because the form can show the subtraction. More '
              + 'than a kilopascal apart is not rounding — one of the two is wrong, and you are the '
              + 'one who can say which.'}
          />
        ) : friction.source === 'stated' ? (
          <Banner
            tone="warn"
            title={`Frictional loss ${friction.kpa} kPa, as entered`}
            body={'Nothing here can check it — the readings it would be worked out from are not on this '
              + 'form. It prints marked as stated rather than calculated.'}
          />
        ) : null}
      </Card>

      <Card>
        <Rowed>
          <View style={{ flex: 1 }}>
            <Txt weight="700">Overload run</Txt>
            <Txt size="sm" tone="muted">150% of duty flow at 65% of duty pressure</Txt>
          </View>
        </Rowed>
        <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
          The department&rsquo;s form has no box for this. A pump on the way out still makes its
          rated duty at the easy end of the curve, so the duty alone proves very little.
        </Txt>
        <Rowed gap={2}>
          <View style={{ flex: 1 }}>
            <NumField
              label="Achieved flow"
              suffix="L/s"
              value={form.overload?.flowLps}
              onChange={(v) => patch({
                overload: v === undefined && form.overload?.pressureKpa === undefined
                  ? undefined
                  : { flowLps: v ?? 0, pressureKpa: form.overload?.pressureKpa ?? 0 },
              })}
              locked={locked}
            />
          </View>
          <View style={{ flex: 1 }}>
            <NumField
              label="Residual"
              suffix="kPa"
              value={form.overload?.pressureKpa}
              onChange={(v) => patch({
                overload: v === undefined && form.overload?.flowLps === undefined
                  ? undefined
                  : { flowLps: form.overload?.flowLps ?? 0, pressureKpa: v ?? 0 },
              })}
              locked={locked}
            />
          </View>
        </Rowed>
        {check ? (
          <Banner
            tone={check.achieved === true ? 'pass' : check.achieved === false ? 'fail' : 'info'}
            title={`Needs ${check.requiredFlowLps} L/s at ${check.requiredPressureKpa} kPa`}
            body={check.note}
          />
        ) : (
          <Banner
            tone="info"
            title="Enter the required flow and pressure above"
            body="Without the duty there is nothing to work the overload requirement out from."
          />
        )}
      </Card>

      <Card>
        <Field label="Comments" value={b.comments ?? ''} onChangeText={(v) => set({ comments: v })} multiline editable={!locked} />
      </Card>
    </View>
  );
}

function PartF({ form, locked, patch }: PartProps) {
  const s = form.sprinklerHydrostatic;
  const set = (p: Partial<SprinklerHydrostatic>) => patch({ sprinklerHydrostatic: { ...s, ...p } });
  return (
    <Card>
      <Txt size="sm" tone="muted">{PART_F_NOTE}</Txt>
      <ResultPicker value={s.result} onChange={(v) => set({ result: v })} locked={locked} />
      <NumField label="Test pressure" suffix="kPa" value={s.pressureKpa} onChange={(v) => set({ pressureKpa: v })} locked={locked} />
      <NumField label="Held for" suffix="min" value={s.timeHeldMinutes} onChange={(v) => set({ timeHeldMinutes: v })} locked={locked} />
      <Field label="Comments" value={s.comments ?? ''} onChangeText={(v) => set({ comments: v })} multiline editable={!locked} />
    </Card>
  );
}

/**
 * Part G — the sprinkler test points.
 *
 * Required against achieved, point by point. The comparison is worked out here
 * rather than left to whoever reads the form, because a point that made its
 * flow but not its pressure is easy to miss in a table of four columns.
 *
 * The department prints a Pass and a Fail box on each of the two lines, and the
 * technician ticks them. That tick is not the same claim as the subtraction:
 * 540 L/min required and 538 achieved is a fail by arithmetic and may well be a
 * pass inside the standard's tolerance, and only the licensee can say which. So
 * the tick is what prints, the arithmetic is shown beside it, and a
 * disagreement between them is put on the page rather than resolved here.
 */
function PartG({ form, locked, patch }: PartProps) {
  const g = form.sprinklerFlow;
  const set = (p: Partial<SprinklerFlowTest>) => patch({ sprinklerFlow: { ...g, ...p } });
  const setPoint = (i: number, p: Partial<SprinklerTestPoint>) => set({
    testPoints: g.testPoints.map((x, n) => (n === i ? { ...x, ...p } : x)),
  });

  return (
    <View style={{ gap: 12 }}>
      <Card>
        <Txt size="sm" tone="muted">{PART_G_NOTE}</Txt>
        <ResultPicker value={g.result} onChange={(v) => set({ result: v })} locked={locked} />
        <Field label="System specification" value={g.systemSpec ?? ''} onChangeText={(v) => set({ systemSpec: v })} editable={!locked} />
        <NumField label="Running test gauge" suffix="kPa" value={g.runningTestGaugeKpa} onChange={(v) => set({ runningTestGaugeKpa: v })} locked={locked} />
      </Card>

      {g.testPoints.map((p, i) => {
        const flow = testPointOutcome(p.requiredFlowLpm, p.resultFlowLpm);
        const press = testPointOutcome(p.requiredPressureKpa, p.resultPressureKpa);
        return (
          <Card key={i}>
            <Rowed>
              <Txt weight="700" style={{ flex: 1 }}>{p.location || `Test point ${i + 1}`}</Txt>
              {!locked ? (
                <RemoveButton what="test point" onRemove={() => set({ testPoints: g.testPoints.filter((_, n) => n !== i) })} />
              ) : null}
            </Rowed>
            <Field label="Location" value={p.location} onChangeText={(v) => setPoint(i, { location: v })} editable={!locked} />
            <Rowed gap={2}>
              <View style={{ flex: 1 }}>
                <NumField label="Required flow" suffix="L/min" value={p.requiredFlowLpm} onChange={(v) => setPoint(i, { requiredFlowLpm: v })} locked={locked} />
              </View>
              <View style={{ flex: 1 }}>
                <NumField label="Achieved" suffix="L/min" value={p.resultFlowLpm} onChange={(v) => setPoint(i, { resultFlowLpm: v })} locked={locked} />
              </View>
            </Rowed>
            <OutcomePicker
              label="Flow"
              value={p.flowResult}
              derived={flow}
              onChange={(v) => setPoint(i, { flowResult: v })}
              locked={locked}
            />
            <Rowed gap={2}>
              <View style={{ flex: 1 }}>
                <NumField label="Required pressure" suffix="kPa" value={p.requiredPressureKpa} onChange={(v) => setPoint(i, { requiredPressureKpa: v })} locked={locked} />
              </View>
              <View style={{ flex: 1 }}>
                <NumField label="Achieved" suffix="kPa" value={p.resultPressureKpa} onChange={(v) => setPoint(i, { resultPressureKpa: v })} locked={locked} />
              </View>
            </Rowed>
            <OutcomePicker
              label="Pressure"
              value={p.pressureResult}
              derived={press}
              onChange={(v) => setPoint(i, { pressureResult: v })}
              locked={locked}
            />
          </Card>
        );
      })}

      {!locked ? (
        <Button
          title="Add a test point"
          variant="secondary"
          onPress={() => set({ testPoints: [...g.testPoints, { location: '' }] })}
        />
      ) : null}

      <Card>
        <Field label="Comments" value={g.comments ?? ''} onChangeText={(v) => set({ comments: v })} multiline editable={!locked} />
      </Card>
    </View>
  );
}

/**
 * One of Part G's Pass / Fail pairs, with the arithmetic beside it.
 *
 * Three states, not two: nobody has ticked yet is the state every new line
 * starts in, and it is not a pass. Where the two figures above give an answer
 * it is shown as a suggestion the technician can take or overrule — and once
 * they overrule it, the disagreement is said out loud here and printed on the
 * form, because a licensee signing a Pass against a reading that subtracts to a
 * Fail should be doing it on purpose.
 */
function OutcomePicker({
  label, value, derived, onChange, locked,
}: {
  label: string;
  value: 'pass' | 'fail' | undefined;
  derived: 'pass' | 'fail' | undefined;
  onChange: (v: 'pass' | 'fail' | undefined) => void;
  locked: boolean;
}) {
  const shown = value ?? 'unanswered';
  const conflict = value !== undefined && derived !== undefined && value !== derived;

  return (
    <View style={{ gap: 6 }}>
      <Label>{`${label} result`}</Label>
      {locked ? (
        <Chip
          label={value === undefined ? 'Not ticked' : value === 'pass' ? 'Pass' : 'Fail'}
          tone={value === 'pass' ? 'pass' : value === 'fail' ? 'fail' : 'muted'}
        />
      ) : (
        <Segmented
          options={[
            { value: 'unanswered' as const, label: 'Not ticked' },
            { value: 'pass' as const, label: 'Pass' },
            { value: 'fail' as const, label: 'Fail' },
          ]}
          value={shown}
          onChange={(v) => onChange(v === 'unanswered' ? undefined : v)}
        />
      )}
      {conflict ? (
        <Banner
          tone="warn"
          title={`Ticked ${value === 'pass' ? 'Pass' : 'Fail'}; the figures read ${derived === 'pass' ? 'Pass' : 'Fail'}`}
          body={'Your tick is what prints, and the form says both. If the reading is inside the '
            + "standard's tolerance that is worth a word in the comments, because the next person to "
            + 'read this will do the same subtraction.'}
        />
      ) : value === undefined && derived !== undefined ? (
        <Txt size="sm" tone="muted">
          {`The figures above read ${derived === 'pass' ? 'Pass' : 'Fail'}. Nothing is ticked yet, so that is what prints, marked as taken from the figures.`}
        </Txt>
      ) : null}
    </View>
  );
}

/**
 * The attachment — everything the department's form has no box for.
 *
 * Not Part J. Form 72 has nine parts and this is not one of them, which is why
 * it carries its own heading here and prints on its own page after Part I. The
 * distinction matters to whoever reads the document: a line added inside Part A
 * would be indistinguishable from the department's own.
 *
 * The defect list is the one piece of it that is load-bearing. Part H asks
 * whether critical defects were identified and then sends the details to "the
 * Licensee's report" — a separate document that routinely does not travel with
 * the form. Kept here, the list is bound to the form that records the defects,
 * and Part H's answer can be checked against the defects actually found.
 */
function PartAttachment({ form, locked, patch }: PartProps) {
  const defects = form.defects;
  const setDefect = (i: number, p: Partial<FormDefect>) => patch({
    defects: defects.map((d, n) => (n === i ? { ...d, ...p } : d)),
  });
  const criticals = defects.filter((d) => d.critical).length;

  return (
    <View style={{ gap: 12 }}>
      <Card>
        <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
          None of this is on Form 72. It prints on its own page after Part I, headed so that nobody
          mistakes it for the department&rsquo;s form.
        </Txt>
        <Field
          label="Building owner"
          value={form.owner ?? ''}
          onChangeText={(v) => patch({ owner: v })}
          hint="A critical defect notice has to go to somebody. The form never says who."
          editable={!locked}
        />
        <Field
          label="Owner contact"
          value={form.ownerContact ?? ''}
          onChangeText={(v) => patch({ ownerContact: v })}
          placeholder="Phone or email"
          editable={!locked}
        />
        <Field
          label="Building classification"
          value={form.buildingClassification ?? ''}
          onChangeText={(v) => patch({ buildingClassification: v })}
          placeholder="Class 5"
          hint="Which parts of AS 2419.1 and AS 2118.1 the system was ever meant to meet — so what a pass means."
          editable={!locked}
        />
      </Card>

      <Card>
        <Field
          label="Technician who did the work"
          value={form.technician ?? ''}
          onChangeText={(v) => patch({ technician: v })}
          hint="The licensee signs Part I. That says who takes responsibility, not who climbed the roof."
          editable={!locked}
        />
        <Field
          label="Qualification held"
          value={form.qualification ?? ''}
          onChangeText={(v) => patch({ qualification: v })}
          editable={!locked}
        />
      </Card>

      {defects.map((d, i) => (
        <Card key={i}>
          <Rowed>
            <Txt weight="700" style={{ flex: 1 }}>{`Defect ${i + 1}`}</Txt>
            {d.critical ? <Chip label="Critical" tone="fail" /> : null}
            {!locked ? (
              <RemoveButton
                what="defect"
                onRemove={() => patch({ defects: defects.filter((_, n) => n !== i) })}
              />
            ) : null}
          </Rowed>
          <Field
            label="What was found"
            value={d.description}
            onChangeText={(v) => setDefect(i, { description: v })}
            multiline
            editable={!locked}
          />
          <Chip
            label={d.critical ? 'Critical defect' : 'Not critical'}
            selected={d.critical}
            tone={d.critical ? 'fail' : 'default'}
            onPress={locked ? undefined : () => setDefect(i, { critical: !d.critical })}
          />
        </Card>
      ))}

      {!locked ? (
        <Button
          title="Add a defect"
          variant="secondary"
          onPress={() => patch({ defects: [...defects, { description: '', critical: false }] })}
        />
      ) : null}

      {/*
        * The same stored value as Part H's System Notes, reachable from here.
        *
        * A second notes column was the obvious thing and the wrong one: two
        * free-text boxes invite one thought to be split across both, and
        * neither then reads complete. So this is the department's own box, put
        * where somebody working down a defect list will want it, and it prints
        * once — in Part H, where the department put it.
        */}
      <Card>
        <Field
          label="Notes — defects, notifications, rectification"
          value={form.systemNotes ?? ''}
          onChangeText={(v) => patch({ systemNotes: v })}
          multiline
          hint="The same notes as Part H. Prints there, inside the department's form, rather than on this page."
          editable={!locked}
        />
      </Card>

      {criticals && form.criticalDefectsIdentified !== true ? (
        <Banner
          tone="fail"
          title={`${criticals} critical defect${criticals === 1 ? '' : 's'} listed, and Part H does not say so`}
          body={'Part H is the question an inspector reads. Answer it Yes there, or take the critical '
            + 'flag off here — the form cannot be issued while the two contradict each other.'}
        />
      ) : null}
    </View>
  );
}

/**
 * Part H — the result.
 *
 * The two questions have three states on the printed form: Yes, No, and nobody
 * ticked either. The third is kept as a third state rather than defaulted,
 * because "unanswered" defaulting to "no critical defects" is the answer that
 * decides whether an occupier is given a statutory notice.
 */
function PartH({ form, locked, patch }: PartProps) {
  return (
    <Card>
      <TriState
        label="Critical defects identified"
        value={form.criticalDefectsIdentified}
        onChange={(v) => patch({ criticalDefectsIdentified: v })}
        locked={locked}
        yes="Give the owner or occupier a critical defect notice"
        no="No action required in relation to critical defects at this time"
      />
      {form.criticalDefectsIdentified ? (
        <Banner
          tone="fail"
          title="A critical defect starts its own clock"
          body="The occupier has to be told in writing, and the notice is a separate document from this form."
        />
      ) : null}
      <TriState
        label="Repairs required"
        value={form.repairsRequired}
        onChange={(v) => patch({ repairsRequired: v })}
        locked={locked}
        yes="Attach the details, including the action taken and the date, to the licensee's report"
        no="No action required in relation to repairs or corrective actions at this time"
      />
      <Divider />
      <ResultPicker value={form.systemResult} onChange={(v) => patch({ systemResult: v })} locked={locked} />
      <Field
        label="Notes"
        value={form.systemNotes ?? ''}
        onChangeText={(v) => patch({ systemNotes: v })}
        multiline
        editable={!locked}
      />
    </Card>
  );
}

function PartI({ form, locked, patch }: PartProps) {
  return (
    <View style={{ gap: 12 }}>
      <Card>
        <Field label="Licensee" value={form.licenseeName} onChangeText={(v) => patch({ licenseeName: v })} editable={!locked} />
        <Field
          label="QBCC / PIC licence number"
          value={form.licenceNumber}
          onChangeText={(v) => patch({ licenceNumber: v })}
          hint="The form is a statement by a licensed person and is not valid without it."
          editable={!locked}
        />
        <Field label="Report number" value={form.licenseeReportNumber ?? ''} onChangeText={(v) => patch({ licenseeReportNumber: v })} editable={!locked} />
      </Card>

      <Card>
        <Label>Signature</Label>
        {locked ? (
          <Txt size="sm" tone="muted">Signed and issued {formatAuDate(form.issuedAt)}.</Txt>
        ) : (
          <SignaturePad
            label="Sign here"
            value={form.signature}
            onChange={(v) => patch({ signature: v ?? '' })}
          />
        )}
      </Card>

      <Card>
        <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{DECLARATION}</Txt>
      </Card>
    </View>
  );
}

/**
 * One of Part H's two questions, with the sentence each answer commits to.
 *
 * The department prints those sentences beside the boxes, and they are the
 * reason the question is on the form: ticking Yes to a critical defect is
 * undertaking to give somebody a notice. A bare Yes/No on a phone hides that,
 * and the person tapping it is the one the undertaking falls on.
 */
function TriState({
  label, value, onChange, locked, yes, no,
}: {
  label: string;
  value: boolean | undefined;
  onChange: (v: boolean | undefined) => void;
  locked: boolean;
  yes?: string;
  no?: string;
}) {
  const shown = value === undefined ? 'unanswered' : value ? 'yes' : 'no';
  const consequence = value === true ? yes : value === false ? no : undefined;
  return (
    <View style={{ gap: 6 }}>
      <Label>{label}</Label>
      {locked ? (
        <Chip
          label={shown === 'unanswered' ? 'Not answered' : shown === 'yes' ? 'Yes' : 'No'}
          tone={shown === 'yes' ? 'fail' : shown === 'no' ? 'pass' : 'muted'}
        />
      ) : (
        <Segmented
          options={[
            { value: 'unanswered' as const, label: 'Not answered' },
            { value: 'no' as const, label: 'No' },
            { value: 'yes' as const, label: 'Yes' },
          ]}
          value={shown}
          onChange={(v) => onChange(v === 'unanswered' ? undefined : v === 'yes')}
        />
      )}
      {consequence ? <Txt size="sm" tone="muted">{consequence}</Txt> : null}
    </View>
  );
}

/**
 * The occupier's copy, and the deadline it runs against.
 *
 * Producing the PDF is not the same event as handing it over, so the app asks
 * separately and counts from the answer.
 */
function OccupierCopyCard({ form, onPress }: { form: StoredForm72; onPress: () => void }) {
  const due = occupierCopyDueBy(form.testDate);
  const keep = testerCopyKeepUntil(form.testDate);

  if (form.copyGivenAt) {
    return (
      <Card>
        <Rowed gap={2}>
          <MaterialCommunityIcons name="check-circle-outline" size={20} color="#2E9E5B" />
          <View style={{ flex: 1 }}>
            <Txt weight="600">Occupier has their copy</Txt>
            <Txt size="sm" tone="muted">
              Given {formatAuDate(form.copyGivenAt)}
              {keep ? ` · keep yours until ${formatAuDate(keep)}` : ''}
            </Txt>
          </View>
        </Rowed>
      </Card>
    );
  }

  return (
    <Card>
      <Txt weight="600">The occupier still needs their copy</Txt>
      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
        {OCCUPIER_COPY_BUSINESS_DAYS} business days from the work
        {due ? `, so by ${formatAuDate(due)}` : ''}. You keep yours for {TESTER_RETENTION_YEARS} years
        {keep ? `, until ${formatAuDate(keep)}` : ''}.
      </Txt>
      <Button title="They have their copy" variant="secondary" onPress={onPress} />
    </Card>
  );
}

/**
 * The bin beside a row.
 *
 * It asks first. The form saves as it is typed, so a row taken out is gone
 * from the record the moment the icon is touched — and a 20dp icon beside a
 * text box is exactly what a gloved thumb reaching for the box lands on.
 */
function RemoveButton({ what, onRemove }: { what: string; onRemove: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => showAlert(`Remove this ${what}?`, 'The form saves as you go, so it cannot be put back.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: onRemove },
      ])}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={`Remove this ${what}`}
      style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
    >
      <MaterialCommunityIcons name="trash-can-outline" size={20} color={t.color.textFaint} />
    </Pressable>
  );
}

/** A numeric box that leaves an empty box empty rather than reading it as zero. */
function NumField({
  label, value, onChange, suffix, locked,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  suffix?: string;
  locked: boolean;
}) {
  const [text, setText] = useState(str(value));
  useEffect(() => { setText(str(value)); }, [value]);
  return (
    <Field
      label={label}
      value={text}
      onChangeText={(v) => { setText(v); onChange(num(v)); }}
      keyboardType="decimal-pad"
      suffix={suffix}
      editable={!locked}
    />
  );
}
