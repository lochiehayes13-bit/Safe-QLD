import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  ISSUED_REFUSAL, getForm72, issueForm72, linkForm72Job, recentTestDevices, recordForm72Attached,
  recordForm72DefectIds, recordOccupierCopy, updateForm72,
  type Form72Patch, type RememberedDevice, type StoredForm72,
} from '@/db/form72Repo';
import { listJobPage, type JobPick } from '@/db/opsRepo';
import { queueJobAttachment } from '@/simpro/sync';
import {
  FORM72_INBOX, form72AttachmentName, form72AttachmentSubject, form72EmailBody,
  occupierCopyBody, occupierCopyRecipient, occupierCopySubject, rankJobsForForm,
} from '@/domain/form72Link';
import type { Site } from '@/domain/types';
import { qldClock, qldIsoDay, qldMoment, typedClock, typedDay } from '@/domain/qldTime';
import { attachmentContentKey } from '@/domain/outboundWork';
import { describeActionFailure } from '@/domain/loadFailure';
import { router } from 'expo-router';
import {
  CALIBRATED_FLOW_DEVICE_KINDS, CALIBRATION_MONTHS, FLOW_DEVICE_LABEL,
  PART_RESULT_LABEL, SYSTEM_TYPE_LABEL, TEST_INTERVAL_LABEL,
  PART_G_PRINTED_TEST_POINTS,
  deviceCalibration, dutyToCarry, elevationHeadKpa, flowRowDevices, flowRowKey, flowRowLongLabel,
  flowKindsAfterAnswer, flowRowRead, flowRowUntouched, form72DefectForRegister,
  hydrantSlotCount, partDLines, setHydrantLocation,
  provedDuty, provedDutyDisagrees,
  intervalsTested, maintenanceTestFromAxes, overloadCheck, overloadRun, resolveFrictionalLoss,
  toggleMaintenanceAxes,
  sprinklerTestPointLines, sprinklerTestPointUntouched, systemTypesTested, unraisedDefects,
  validateForm72,
  unTickedAnsweredKinds,
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
import {
  guideSteps, nextGuideStep, outstandingParts, recordAnswered, type GuidePart,
} from '@/domain/form72Guide';
import { DEVICE_PRESETS, offerableDevices, unusedDevicePresets } from '@/domain/form72Devices';
import {
  deviceKindKey, getDeviceKinds, setDeviceKind, type DeviceKindAnswer,
} from '@/db/deviceKindRepo';
import { shareFile, writePdf } from '@/export/files';
import { sendMail } from '@/export/mail';
import { notSharedNotice } from '@/export/shareOutcome';
import { formatAuDate } from '@/export/sheets';
import { queryAssets } from '@/db/assetRepo';
import { createDefect, getSite } from '@/db/repo';
import { applyForm72Prefill, form72FromAssets, REGISTER_FILLS_PARTS } from '@/domain/formsFromAssets';
import { loadPrefs } from '@/app-prefs';
import { nowIso } from '@/db';
import { useTheme } from '@/theme';
import { SignaturePad } from '@/components/SignaturePad';
import {
  Banner, Button, Card, Chip, Divider, Field, H2, Label, Rowed, Screen, Segmented, Txt,
} from '@/components/ui';
import { RecordGate } from '@/components/RecordGate';
import { describeLoadFailure } from '@/domain/loadFailure';
import { JobPicker } from '@/components/JobPicker';
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

/*
 * The same union the guide keys its parts by, aliased rather than written out
 * again. Two copies of this list would be two things to keep in step, and the
 * one that fell behind would be the one deciding what the technician is shown.
 */
type PartKey = GuidePart;

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

/** Reads a typed number without turning an empty box into a zero. */
const num = (s: string): number | undefined => {
  const v = s.trim();
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const str = (n: number | undefined): string => (n === undefined ? '' : String(n));

/**
 * A stored form as its PDF, from one place.
 *
 * Four paths produce this document — Produce PDF, Email to the office, the
 * attachment queued onto the Simpro job, and the occupier's copy — and three
 * of them built the call by hand and left `status` and `issuedAt` off it.
 * form72Html treats a caller that does not say as a draft, deliberately, so
 * those three rendered every issued form as a draft: the "Check before issue"
 * cautions printed as advice about a decision already taken, the
 * "Issued dd/mm/yyyy, and held unaltered since" line was missing, and the
 * clean-draft caution never appeared on an actual draft. The attachment is the
 * one that runs automatically on issue, so the copy filed against the Simpro
 * job disagreed with the copy in the occupier's hand.
 *
 * Worse, it reached backwards. A rule added to validateForm72 after a form was
 * issued stamps that form's reprint "DRAFT — NOT FOR ISSUE" — which is exactly
 * what happened the morning the Part C date reader learned to read a slashed
 * date: a stale certificate that used to be an unreadable-date caution became
 * an out-of-calibration blocker, and every reprint of a form issued before
 * that came out stamped.
 *
 * So the record decides, in one expression, and a test fails any call that
 * builds its own.
 */
function renderForm72(form: StoredForm72, companyName: string): string {
  return form72Html({
    form,
    systemLabel: form.systemLabel,
    companyName,
    generatedAt: nowIso(),
    status: form.status,
    issuedAt: form.issuedAt,
    overload: form.overload,
  });
}

export default function Form72Screen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [form, setForm] = useState<StoredForm72 | null>(null);
  // Loaded-and-absent is not the same as still loading. See RecordGate.
  const [missing, setMissing] = useState(false);
  // And a read that threw is neither. See RecordGate.
  const [failed, setFailed] = useState<string | null>(null);
  const [part, setPart] = useState<PartKey>('A');
  /*
   * One part at a time, or the lot.
   *
   * A part at a time is the default and the reason is in this file's own
   * comment: a nine-part form scrolled as one column is how somebody ends up in
   * Part G having silently skipped Part D. But a technician working down a
   * finished test wants to work down it, not tap between nine screens, and the
   * strip above still marks which parts are answered either way.
   */
  const [whole, setWhole] = useState(false);
  /*
   * The site record, for the one thing the form does not hold: the occupier's
   * email. Loaded beside the form rather than on demand, because the card that
   * needs it is the first thing an issued form shows.
   */
  const [site, setSite] = useState<Site | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [busy, setBusy] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [pickingJob, setPickingJob] = useState(false);
  const [siteJobs, setSiteJobs] = useState<JobPick[]>([]);
  const [typedJob, setTypedJob] = useState('');

  /*
   * What has been answered about the meters on this form.
   *
   * Filled by the same read that loads the form, because the read that ticks
   * Part C's boxes and the read that shows whose answer each tick is have to
   * be one read. `remember` keeps an answer the technician has just given, so
   * Part C shows it with their name on without going back to the table.
   */
  const [deviceKinds, setDeviceKinds] = useState<{
    answers: ReadonlyMap<string, DeviceKindAnswer>; failed: boolean;
  }>({ answers: new Map(), failed: false });
  const remember = useCallback((answer: DeviceKindAnswer) => {
    setDeviceKinds((prev) => ({
      answers: new Map(prev.answers).set(answer.serialNumber, answer),
      failed: false,
    }));
  }, []);
  const kinds = useMemo<DeviceKinds>(
    () => ({ answers: deviceKinds.answers, failed: deviceKinds.failed, remember }),
    [deviceKinds.answers, deviceKinds.failed, remember],
  );

  const load = useCallback(async () => {
    if (!id) return;
    setFailed(null);
    try {
      const [f, prefs] = await Promise.all([getForm72(id), loadPrefs()]);
      setForm(f);
      setMissing(!f);
      setCompanyName(prefs.companyName);
      /*
       * The site, for its contact email. A failure here costs the offer to
       * email the occupier and nothing else — the form is already loaded, and
       * refusing to open a signed document because a contact lookup failed
       * would be the wrong trade.
       */
      if (f?.siteId) {
        try {
          setSite(await getSite(f.siteId));
        } catch {
          setSite(null);
        }
      }
      /*
       * Part C's Orifice / Mechanical / Electro magnetic ticks, from what
       * somebody already answered for the meters on this form.
       *
       * Read here, with the form, for two reasons. It is part of preparing the
       * form rather than something a render should notice and correct; and the
       * read that ticks the boxes and the read that shows whose answer each
       * tick is have to be one read, or they will disagree.
       *
       * The carry-forward only ever adds, and only on a draft: ticking a box
       * on a form already issued would change a signed document.
       *
       * And only on a form that has none of these boxes ticked yet. It ran on
       * every open, so a technician who unticked a carried-forward kind —
       * because the meter was swapped, or the remembered answer is wrong —
       * found it ticked again the next time they opened the form, with nothing
       * on screen saying why. A tick nobody tapped appearing on the
       * department's own form is the fault taken out of Part A's two
       * questions; it has no more business here.
       */
      if (f) {
        try {
          const answers = await getDeviceKinds(f.devices.map((d) => d.serialNumber));
          setDeviceKinds({ answers, failed: false });
          const untouched = f.status !== 'issued' && f.flowDeviceKinds.length === 0;
          const add = untouched ? unTickedAnsweredKinds(
            f.devices, f.flowDeviceKinds,
            new Map([...answers].map(([serial, a]) => [serial, a.kind])),
          ) : [];
          if (add.length) {
            const flowDeviceKinds = [...f.flowDeviceKinds, ...add];
            await updateForm72(f.id, { flowDeviceKinds });
            setForm({ ...f, flowDeviceKinds });
          }
        } catch {
          // A table that cannot be read leaves the boxes to the technician,
          // which is where they were. Part C says so rather than reporting it
          // as nobody having answered, and the form still opens.
          setDeviceKinds({ answers: new Map(), failed: true });
        }
      }
    } catch (e) {
      setFailed(describeLoadFailure(e, 'this Form 72'));
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  /*
   * Going to a part, from anywhere that offers to.
   *
   * The issue lists and the Next button handed setPart straight through while
   * the part strip cleared Whole form mode as well — so in Whole form mode a
   * technician tapped an outstanding item, the chevron invited it, the row
   * responded, and nothing moved, because all ten parts were still rendered.
   * The point of making those lines pressable was lost in one of the two
   * modes. One function now, so it cannot be half-done again.
   */
  const goToPart = useCallback((p: PartKey) => {
    setPart(p);
    setWhole(false);
  }, []);

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
      const html = renderForm72(target, companyName);
      const file = await writePdf(form72AttachmentName(target).replace(/\.pdf$/i, ''), html);
      if (file.printed) {
        /*
         * The browser could not write the file, so there is nothing to queue.
         * It used to say "do this from a phone" — to a technician on an
         * iPhone, which is a phone, and which has no build but this one.
         */
        if (!quiet) {
          showAlert(
            'Not attached',
            'This browser could not build the PDF file, so nothing was queued onto the job. Produce PDF still '
            + 'prints it; attach the saved copy to the job in Simpro, or try again on a different browser.',
          );
        }
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
      const html = renderForm72(form, companyName);
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
      } else if (outcome === 'offered') {
        // The share sheet is on the screen with the form on it and the inbox
        // named under the title. Anything said here would sit on top of it.
      } else if (outcome === 'handed-over') {
        /*
         * A composer with no attachment, on a browser with no share sheet.
         * Said plainly, because a Form 72 that reaches the office without the
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

  /**
   * The occupier's copy, sent.
   *
   * MP 6.1 A4(b) obliges it within ten business days of the work. The app
   * counted those days, printed the deadline on the form and asked afterwards
   * whether the copy had been handed over — and had no way to send one, so the
   * whole obligation was measured and not served.
   *
   * It asks first, with the address on screen. This is a statutory document
   * going to a third party, and one sent to the wrong address cannot be taken
   * back. And copyGivenAt is stamped only on a confirmed send: a draft handed
   * to somebody's mail app has not reached an occupier, and recording it as if
   * it had would turn the date the app tracks into a fiction.
   */
  const emailOccupier = useCallback(async () => {
    if (!form) return;
    const to = occupierCopyRecipient(form, site);
    if (!to.email) {
      showAlert('No address for the occupier', to.reason ?? '');
      return;
    }
    showAlert(
      'Send the occupier their copy?',
      `The Form 72 goes to ${to.email}${to.source === 'site' ? ", from the site's contact details" : ''}.`
      + ` That is the copy MP 6.1 requires within ${OCCUPIER_COPY_BUSINESS_DAYS} business days, and it `
      + 'cannot be unsent.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send it',
          onPress: async () => {
            setAttaching(true);
            try {
              const html = renderForm72(form, companyName);
              const file = await writePdf(form72AttachmentName(form).replace(/\.pdf$/i, ''), html);
              const outcome = await sendMail({
                to: to.email!,
                subject: occupierCopySubject(form),
                body: occupierCopyBody(form, companyName),
              }, [file]);

              if (outcome === 'sent') {
                const at = nowIso();
                await recordOccupierCopy(form.id, at);
                setForm({ ...form, copyGivenAt: at });
                showAlert('Sent, and recorded', `Their copy went to ${to.email}, and the form now says so.`);
              } else if (outcome === 'offered') {
                // The share sheet is up with the form on it and the occupier's
                // address named. The card underneath already asks for "They
                // have their copy" once it has gone.
              } else if (outcome === 'handed-over') {
                showAlert(
                  'Draft opened — send it, then record it',
                  `An email to ${to.email} is open${file.printed ? '' : ` and ${file.name} has downloaded`}.`
                  + ' Attach the form if it is not already on it and send it. This app cannot tell'
                  + ' whether it went, so tap "They have their copy" afterwards.',
                );
              } else if (outcome === 'no-mail-app') {
                showAlert(
                  'No mail app set up',
                  'This phone has no email account configured. Use Produce PDF and send it from '
                  + 'wherever you can, then record that they have it.',
                );
              } else {
                showAlert('Not sent', 'The email was not sent, so nothing has been recorded.');
              }
            } catch (e) {
              showAlert('Could not send it', describeActionFailure(e, "emailing the occupier's copy"));
            } finally {
              setAttaching(false);
            }
          },
        },
      ],
    );
  }, [form, site, companyName]);

  /**
   * The site's jobs, ranked, as the list the picker starts from.
   *
   * The ranking is the useful part and it stays: open work first and newest
   * first, which is the job a Form 72 belongs to nearly every time. What it
   * lacked was anything behind it — fifty rows read, eight drawn, no search,
   * and "No Simpro jobs for this site on the phone" said about a building
   * whose jobs were simply further down the list.
   *
   * Opened once the read has come back, so a read that threw does not leave an
   * empty picker on screen stating something it never established.
   */
  const openJobPicker = useCallback(async () => {
    if (!form) return;
    try {
      const page = await listJobPage({ filter: 'all', today: qldIsoDay(nowIso()) ?? '', siteId: form.siteId, limit: 50 });
      const ranked = rankJobsForForm(page.rows
        .filter((j) => j.externalId)
        .map((j) => ({
          externalId: j.externalId!, title: j.title, status: j.status, statusName: j.statusName,
          scheduledFor: j.scheduledFor, completedAt: j.completedAt,
        })));
      // The ranking decides the order; the row the search read decides the
      // fields, so the picker draws a job the same way wherever it came from.
      const byId = new Map(page.rows.map((j) => [j.externalId, j]));
      setSiteJobs(ranked.flatMap((j) => {
        const row = byId.get(j.externalId);
        return row
          ? [{
            externalId: row.externalId, siteName: row.siteName, siteId: row.siteId,
            status: row.status, customerName: row.customerName, title: row.title,
          }]
          : [];
      }));
      setPickingJob(true);
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
      const html = renderForm72(form, companyName);
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
            {/*
              * The shared picker, which this screen was the fourth copy of.
              * The site's ranked jobs are what it starts from and its own
              * search runs over every job the phone holds.
              */}
            <JobPicker
              heading="Which job is this test under?"
              suggested={siteJobs}
              suggestedLabel="This site’s jobs, the likeliest first"
              emptyWhenNoneSuggested="No job on this phone is filed under this site. Search for it by number, or type the number below."
              emptyWhenNothingOnDevice="No jobs on this phone yet. Type the number below, or connect Simpro in Settings and sync."
              onPick={(job) => { void linkJob({ externalId: job.externalId!, title: job.title }); }}
              onClose={() => setPickingJob(false)}
            />
            {/*
              * And the number typed in, which the search cannot replace. The
              * office raises a job while a technician is on the roof and reads
              * the number down the phone; it is not on this device and will
              * not be until the next sync, and the form still has to say which
              * job it was done under.
              */}
            <Rowed gap={2} align="flex-start">
              <View style={{ flex: 1 }}>
                <Field
                  label="Or a job number this phone does not hold yet"
                  value={typedJob}
                  onChangeText={setTypedJob}
                  keyboardType="numeric"
                  placeholder="41900"
                  hint="For a job the office raised just now. It links by number and the title arrives with the next sync."
                />
              </View>
            </Rowed>
            <Rowed gap={2}>
              <Chip label="Link this number" onPress={() => { if (/^\d+$/.test(typedJob.trim())) void linkJob({ externalId: typedJob.trim() }); }} />
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

      {locked ? (
        <OccupierCopyCard
          form={form}
          site={site}
          busy={attaching}
          onPress={onCopyGiven}
          onEmail={() => { void emailOccupier(); }}
        />
      ) : null}

      {!locked && blockers.length ? (
        <Outstanding
          tone="warn"
          title={`${blockers.length} thing${blockers.length === 1 ? '' : 's'} still to do before this can be issued`}
          issues={blockers}
          onGo={goToPart}
        />
      ) : null}

      {!locked && !blockers.length ? (
        <Banner tone="pass" title="Ready to issue" body="Nothing blocking is outstanding." />
      ) : null}

      {cautions.length ? (
        <Outstanding
          tone="fail"
          title="Worth a look before you sign"
          issues={cautions}
          onGo={goToPart}
        />
      ) : null}

      <Segmented
        value={whole ? 'whole' : 'part'}
        onChange={(v) => setWhole(v === 'whole')}
        options={[
          { value: 'part' as const, label: 'One part' },
          { value: 'whole' as const, label: 'Whole form' },
        ]}
      />

      <PartStrip
        form={form}
        issues={issues}
        value={part}
        onChange={goToPart}
      />

      {/*
        * On every part the register fills, not only on Part A.
        *
        * The system label is a Part A field and that is where this button was
        * first wanted, so that is where it stayed — while the register also
        * fills Part D's hydrant locations, Part E's booster and pump comments
        * and Part G's sprinkler test points. A technician on Part D with an
        * empty hydrant list had to go back to Part A, press a button about the
        * register, and come forward again, with nothing on Part D to suggest
        * it. REGISTER_FILLS_PARTS is held to covering exactly what the prefill
        * writes.
        */}
      {!locked && (whole || REGISTER_FILLS_PARTS.includes(part)) ? (
        <Button
          title="Fill the lists from the site's register"
          variant="secondary"
          onPress={() => void onFillFromRegister()}
          loading={filling}
          icon={<MaterialCommunityIcons name="database-import-outline" size={18} color={t.color.text} />}
        />
      ) : null}

      {whole
        ? PARTS.map((p) => (
          <View key={p.key} style={{ gap: t.space(3) }}>
            <Divider />
            <PartBody part={p.key} form={form} locked={!!locked} patch={patch} reload={() => { void load(); }} kinds={kinds} />
          </View>
        ))
        : <PartBody part={part} form={form} locked={!!locked} patch={patch} reload={() => { void load(); }} kinds={kinds} />}

      {!whole && !locked ? (
        <NextPart form={form} part={part} onGo={goToPart} />
      ) : null}

      {!locked ? <WhatIsLeft form={form} onGo={goToPart} /> : null}

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
 * Next, and where it goes.
 *
 * The owner asked for a click-through rather than ten chips and a judgement
 * about which of them matter. This is the click: one button, which names the
 * part it is about to open and says in a line why that part is next.
 *
 * It names the destination because a button that says only "Next" asks the
 * technician to trust it, and the first time it sends them somewhere they did
 * not expect they stop using it. Naming the part makes it checkable at a
 * glance, and the strip is still there to override it.
 *
 * It warns and carries on. A part left unanswered is not a reason to refuse to
 * move — the department's form allows a part to be left blank, the page prints
 * what was left, and a technician who is about to do Part D before Part B
 * knows something this screen does not.
 */
function NextPart({ form, part, onGo }: {
  form: StoredForm72;
  part: PartKey;
  onGo: (p: PartKey) => void;
}) {
  const t = useTheme();
  const next = nextGuideStep(form, part);
  const here = guideSteps(form).find((s) => s.part === part);
  /*
   * "Done" is about this part only, and the list below is about the form. A
   * single message covering both would have to be vague about which.
   */
  const leaving = here && !here.answered && here.applies !== 'optional'
    && here.applies !== 'not-this-system';

  if (!next) {
    return leaving ? (
      <Txt size="sm" tone="muted">
        {`Nothing after Part ${part} is waiting — but nothing has been put on this part yet.`}
      </Txt>
    ) : null;
  }

  const label = next.part === 'Attachment' ? 'the attachment page' : `Part ${next.part}`;
  const meta = PARTS.find((p) => p.key === next.part);
  return (
    <View style={{ gap: 6 }}>
      {leaving ? (
        <Txt size="xs" style={{ color: t.color.warn }}>
          {`Nothing has been put on Part ${part} yet. It prints as not applicable if it stays that `
            + 'way, which is a legitimate answer — so this will not stop you.'}
        </Txt>
      ) : null}
      <Button
        title={`Next: ${label}${meta ? ` — ${meta.title}` : ''}`}
        onPress={() => onGo(next.part)}
        icon={<MaterialCommunityIcons name="arrow-right" size={18} color={t.color.onAccent} />}
      />
      <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>{next.why}</Txt>
    </View>
  );
}

/**
 * What is still waiting on this form.
 *
 * Not the same thing as the validation's list above it. That one names what
 * would stop the form being issued or is worth knowing about what has been
 * filled in; this names the parts that apply to this test and have nothing on
 * them at all — which is the one thing a technician cannot see today, because
 * a part nobody opened prints N/A exactly like a part somebody marked N/A on
 * purpose.
 *
 * It names the parts this test needs and no others. On an annual hydrant test
 * that is seven, not ten: Parts F and G are a sprinkler system's, and listing
 * them would train somebody to ignore the list.
 */
function WhatIsLeft({ form, onGo }: {
  form: StoredForm72;
  onGo: (p: PartKey) => void;
}) {
  const t = useTheme();
  const left = outstandingParts(form);
  if (!left.length) {
    return (
      <Txt size="sm" tone="muted">
        Every part this test needs has something on it.
      </Txt>
    );
  }

  return (
    <Card style={{ borderLeftWidth: 3, borderLeftColor: t.color.textFaint }}>
      <Txt weight="700">
        {`${left.length} part${left.length === 1 ? '' : 's'} with nothing on ${
          left.length === 1 ? 'it' : 'them'} yet`}
      </Txt>
      <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
        Each of these prints as not applicable if it stays empty, which reads on the page exactly
        like a part you marked not applicable on purpose. Answer it — N/A included — and it leaves
        this list.
      </Txt>
      {left.map((step) => {
        const meta = PARTS.find((p) => p.key === step.part);
        return (
          <Pressable
            key={step.part}
            onPress={() => onGo(step.part)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${step.part === 'Attachment' ? 'the attachment page' : `Part ${step.part}`}`}
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Rowed gap={2} align="flex-start">
              <Txt size="sm" weight="700" style={{ minWidth: 44 }}>
                {step.part === 'Attachment' ? '+' : `Part ${step.part}`}
              </Txt>
              <View style={{ flex: 1 }}>
                <Txt size="sm">{meta?.title ?? step.part}</Txt>
                <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>{step.why}</Txt>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={18} color={t.color.textFaint} />
            </Rowed>
          </Pressable>
        );
      })}
    </Card>
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
  /*
   * Answered, and ruled in or out, from the guide rather than from a second
   * copy of the same judgement. The strip used to decide this itself, which
   * meant two answers to "has this part been dealt with" — and the one here,
   * being the one a technician actually looks at, was the one that would drift.
   */
  const steps = guideSteps(form);
  const stepFor = (key: PartKey) => steps.find((st) => st.part === key);

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space(1.5) }}>
      {PARTS.map((p) => {
        const blocked = issues.some((i) => i.part === p.key && i.blocking);
        const on = value === p.key;
        const step = stepFor(p.key);
        /*
         * Three weights, for three different things. Bold is a part with an
         * answer on it; faint is a part this test does not need — the one
         * state Part A's own answer rules out — and normal is a part that
         * applies and is still waiting. The strip said "answered or not" and
         * so put two parts of empty sprinkler boxes in front of a technician
         * doing a hydrant test with the same prominence as Part D.
         *
         * Faint, never hidden. A technician who disagrees with Part A, or who
         * took a reading anyway, has to be able to get there.
         */
        const aside = step?.applies === 'not-this-system';
        const answered = !!step?.answered;
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
            <Txt
              size="sm"
              style={{
                color: on ? t.color.onAccent
                  : answered ? t.color.text
                    : aside ? t.color.textFaint : t.color.textMuted,
              }}
            >
              {p.title}
            </Txt>
            {aside && !on && !answered ? (
              <Txt size="xs" style={{ color: t.color.textFaint }}>· n/a</Txt>
            ) : null}
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
  part, form, locked, patch, reload, kinds,
}: {
  part: PartKey;
  form: StoredForm72;
  locked: boolean;
  patch: (p: Form72Patch) => void;
  /**
   * Re-reads the form from storage.
   *
   * Only the attachment needs it. Raising a defect onto the register writes the
   * row ids through a path that bypasses `patch` — because `patch` refuses an
   * issued form — so the screen's copy is behind the database until it reads
   * again.
   */
  reload: () => void;
  kinds: DeviceKinds;
}) {
  const meta = PARTS.find((p) => p.key === part)!;

  /*
   * Anything written from inside a part is somebody answering that part.
   *
   * Recorded here, in the one place every part's writes pass through, rather
   * than in ten components that would each have to remember. It is what lets
   * the outstanding list below tell a part marked N/A on purpose from a part
   * nobody opened — the stored result is 'na' for both, and a list that kept
   * naming parts the technician had already dealt with is a list they would
   * stop reading.
   */
  const answer = (p: Form72Patch) => patch({ ...p, ...recordAnswered(form, part) });

  return (
    <View style={{ gap: 12 }}>
      <View>
        <H2>{part === 'Attachment' ? meta.title : `Part ${part} — ${meta.title}`}</H2>
        <Txt size="sm" tone="muted">{meta.blurb}</Txt>
      </View>
      {part === 'A' ? <PartA form={form} locked={locked} patch={answer} /> : null}
      {part === 'B' ? <PartB form={form} locked={locked} patch={answer} /> : null}
      {part === 'C' ? <PartC form={form} locked={locked} patch={answer} kinds={kinds} /> : null}
      {part === 'D' ? <PartD form={form} locked={locked} patch={answer} /> : null}
      {part === 'E' ? <PartE form={form} locked={locked} patch={answer} /> : null}
      {part === 'F' ? <PartF form={form} locked={locked} patch={answer} /> : null}
      {part === 'G' ? <PartG form={form} locked={locked} patch={answer} /> : null}
      {part === 'H' ? <PartH form={form} locked={locked} patch={answer} /> : null}
      {part === 'I' ? <PartI form={form} locked={locked} patch={answer} /> : null}
      {part === 'Attachment' ? (
        <PartAttachment form={form} locked={locked} patch={answer} onRaised={reload} />
      ) : null}
    </View>
  );
}

type PartProps = {
  form: StoredForm72;
  locked: boolean;
  patch: (p: Form72Patch) => void;
};

/**
 * The readings of a part the technician has marked not applicable.
 *
 * Folded away, because they are not being filled in. Part E alone is thirteen
 * number pads, and on the commonest form this company raises — a hydrant test —
 * Parts F and G are both N/A and both were a screen of empty boxes to scroll
 * past on the way to Part H.
 *
 * It is not the hiding this file's own comment warns about. That warning is
 * about a field whose absence would be read as N/A; here the technician has
 * said N/A, and the printed page prints N/A in every one of these boxes. And
 * nothing becomes unreachable: the fold opens, so a reading taken before the
 * part was marked N/A can still be found and the mistake corrected.
 */
function WhenApplicable({
  result, children,
}: {
  result: PartResult | 'refer-to-report';
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (result !== 'na') return <>{children}</>;
  return (
    <>
      <Card>
        <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
          Marked not applicable, so its readings are folded away. The form prints N/A in every one
          of them.
        </Txt>
        <Chip
          label={open ? 'Hide the readings again' : 'Show the readings anyway'}
          onPress={() => setOpen(!open)}
        />
      </Card>
      {open ? children : null}
    </>
  );
}

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

/** The three the department prints: "65/100/150 mm face". */
const GAUGE_FACE_SIZES = ['65 mm', '100 mm', '150 mm'];

/** What a hydrant test gauge is nearly always graduated in. */
const GAUGE_INCREMENTS_KPA = [10, 20, 50, 100];

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
  const ticked = TEST_KINDS.filter((k) => m[k.key]);

  /*
   * The half-answer the stored form cannot hold.
   *
   * These two questions are a product: the six cells are system × interval,
   * and maintenanceTestFromAxes ticks only the cells both axes name. So one
   * axis chosen and the other not is, correctly, a grid with nothing ticked —
   * and that is right for the document, because a five-yearly that printed as
   * an annual because the app answered the second question first is the fault
   * the one-tap-one-question rule exists to prevent.
   *
   * What it is not right for is the screen. The axes were derived from the
   * stored grid on every render, so tapping "Fire hydrant" wrote six falses,
   * came back as no system chosen, and un-lit the chip the technician had just
   * pressed. Tapping "Annual" next did the same. Neither axis could ever be
   * set, so Part A could not be answered at all — and validateForm72 blocks
   * issuing a form with nothing ticked, so no Form 72 could be issued through
   * this screen.
   *
   * The half-answer therefore lives here until its partner arrives. Nothing
   * about what is written changes: a single axis still stores an all-false
   * grid, the form still says it is not answered, and the printed page still
   * says so in red. The chip simply stays lit so the person can finish.
   */
  const [pending, setPending] = useState<{ types: SystemType[]; intervals: TestInterval[] } | null>(null);
  const types = pending?.types ?? systemTypesTested(m);
  const intervals = pending?.intervals ?? intervalsTested(m);

  const fromAxes = maintenanceTestFromAxes(systemTypesTested(m), intervalsTested(m));
  const expressible = TEST_KINDS.every((k) => fromAxes[k.key] === m[k.key]);

  // The transition lives in the domain, where it can be argued with and where
  // a test can run the two taps end to end. Once both questions are answered
  // the grid holds the whole of it, so the half-answer is dropped and the
  // stored form is the one source again.
  const tap = (t: { axis: 'type'; value: SystemType } | { axis: 'interval'; value: TestInterval }) => {
    const next = toggleMaintenanceAxes({ types, intervals }, t);
    setPending(next.pending ? next.shown : null);
    patch({ maintenanceTest: next.grid });
  };

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
              onPress={locked ? undefined : () => tap({ axis: 'type', value: type })}
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
              onPress={locked ? undefined : () => tap({ axis: 'interval', value: interval })}
            />
          );
        })}
      </View>

      {/*
        * What the two questions amount to, and which of them is still waiting.
        *
        * It used to fill the other question in: tapping "Fire hydrant" with no
        * interval chosen ticked Annual as well, and tapping "5 year" with no
        * system chosen ticked fire hydrant. Both lit up a chip the technician
        * had not tapped, on the one part of the form that says what the
        * document is a record of — so a five-yearly could print as an annual
        * because the app answered first and the technician never saw it
        * happen. One tap answers one question now, and a question with no
        * answer says so.
        */}
      <Txt size="sm" tone="muted">
        {ticked.length
          ? `Prints as ${ticked.map((k) => k.label).join(', ')}.`
          : !types.length && !intervals.length
            ? 'No box is ticked yet. The form does not say which test this was.'
            : !types.length
              ? 'Nothing is ticked yet — pick the system as well, and the two together tick the box.'
              : 'Nothing is ticked yet — pick the interval as well, and the two together tick the box.'}
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
        hint="Ours, not one of the department's Part A fields — it prints across the top beside the company name. Without it, two forms for this site on the same day are indistinguishable."
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
          <TypedField
            label="Test date"
            value={form.testDate}
            read={typedDay}
            show={formatAuDate}
            placeholder="3/7/2026"
            hint="Type the digits — 03072026"
            locked={locked}
            onChange={(v) => patch({ testDate: v })}
          />
        </View>
        <View style={{ flex: 1 }}>
          <TypedField
            label="Time"
            value={form.testTime}
            read={typedClock}
            show={(v) => v}
            placeholder="09:30"
            hint="0930"
            locked={locked}
            onChange={(v) => patch({ testTime: v })}
            quick={{ label: 'Now', value: () => qldClock(nowIso()) }}
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
    <View style={{ gap: 12 }}>
      <Card>
        <Txt size="sm" tone="muted">{PART_B_NOTE}</Txt>
        <ResultPicker value={h.result} onChange={(v) => set({ result: v })} locked={locked} />
      </Card>
      <WhenApplicable result={h.result}>
        <Card>
          {/* The department's own labels, so the screen and the page agree. */}
          <NumField label="Boost pressure" suffix="kPa" value={h.boostPressureKpa} onChange={(v) => set({ boostPressureKpa: v })} locked={locked} />
          <NumField label="Test pressure" suffix="kPa" value={h.testPressureKpa} onChange={(v) => set({ testPressureKpa: v })} locked={locked} />
          <NumField label="Duration of test" suffix="mins" value={h.durationMinutes} onChange={(v) => set({ durationMinutes: v })} locked={locked} />
          <NumField label="End of test pressure" suffix="kPa" value={h.endPressureKpa} onChange={(v) => set({ endPressureKpa: v })} locked={locked} />
          {/*
            * The pressure drop, and the box below it, are different
            * quantities in different units.
            *
            * This banner read "Dropped 150 kPa over the hold" and the very
            * next control was the department's "Loss (if any)" in litres per
            * minute — and validateForm72 makes a pass with a drop blocking
            * precisely while that box is empty, so the app showed somebody a
            * kilopascal figure and then told them to fill the box underneath
            * it. One keystroke put a pressure into a flow box on a form a
            * licensee signs, and the page printed "150 L/min" with nothing a
            * reader could use to tell. So the banner says what the figure is
            * not, and the box says what it wants.
            */}
          {loss !== undefined ? (
            <Banner
              tone={loss > 0 ? 'warn' : 'pass'}
              title={loss > 0 ? `Dropped ${loss} kPa over the hold` : 'Held pressure'}
              body={loss > 0
                ? 'That is the pressure difference, worked out from the two boxes above. It is not '
                  + 'the figure the next box wants — that one is a leak rate in litres per minute, '
                  + 'measured, and most hydrostatic tests have none to record.'
                : undefined}
            />
          ) : null}
          <NumField
            label="Loss (if any)"
            suffix="L/min"
            value={h.lossLpm}
            onChange={(v) => set({ lossLpm: v })}
            locked={locked}
            hint="A measured leak rate, not the kPa drop above. Leave it empty if nothing leaked."
          />
          <Field
            label="Comments"
            value={h.comments ?? ''}
            onChangeText={(v) => set({ comments: v })}
            multiline
            hint="Your line breaks are kept on the printed form."
            editable={!locked}
          />
        </Card>
      </WhenApplicable>
    </View>
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
/**
 * Adds or removes one name from a comma-separated list, keeping the rest.
 *
 * Written over the stored string rather than over a parsed list, because the
 * string is what the form prints and a technician may have written something
 * in it that no device matches. Round-tripping through a list of known devices
 * would silently drop that.
 */
function toggleNamed(value: string, name: string): string {
  const parts = value.split(',').map((x) => x.trim()).filter(Boolean);
  const at = parts.findIndex((x) => x.toLowerCase() === name.toLowerCase());
  if (at >= 0) parts.splice(at, 1);
  else parts.push(name);
  return parts.join(', ');
}

/**
 * A date or a time typed on a phone, stored only once it is a date or a time.
 *
 * Both of these were plain text boxes holding the stored string, which asked a
 * technician standing at a booster to type "2026-10-02" — eleven characters in
 * a format nobody in Australia writes, two of them hyphens from the symbol
 * layer, on a document whose retention and notice clocks run from that date.
 * The placeholder was the format.
 *
 * Now the keypad is numeric and eight digits typed straight through are the
 * order we write them in. What was typed stays on screen whether or not it
 * resolves yet, and the line underneath echoes the date it understood back in
 * full — because the one thing worse than a fiddly date box is one that
 * silently understood something else. Nothing is stored until it resolves, so
 * a half-typed date never becomes a stored one.
 */
function TypedField({
  label, value, placeholder, hint, read, show, locked, onChange, quick,
}: {
  label: string;
  /** The stored value, which is what this field is about. */
  value: string | undefined;
  placeholder: string;
  hint?: string;
  /** What the typed text means, or nothing if it is not there yet. */
  read: (text: string) => string | undefined;
  /** The stored value as a person reads it. */
  show: (stored: string) => string;
  locked: boolean;
  onChange: (stored: string | undefined) => void;
  /**
   * A one-tap answer, where the phone knows one.
   *
   * Offered rather than prefilled, and the difference matters on this form.
   * The time of test is the time the test was done, not the time the form was
   * opened — a technician who raises the form in the van at eight and tests at
   * two would sign a document saying eight o'clock, and a prefilled box reads
   * exactly like a box somebody checked. One tap, taken when it is pressed and
   * not when the screen drew, so the chip cannot offer a stale minute.
   */
  quick?: { label: string; value: () => string | undefined };
}) {
  const t = useTheme();
  /*
   * The box holds what was typed; the form holds what it resolved to. They are
   * different things while somebody is part way through, and a box that
   * reverted to the stored value on every keystroke could not be typed into.
   */
  const [text, setText] = useState(() => (value ? show(value) : ''));
  const resolved = read(text);
  const typing = text.trim() !== '' && resolved === undefined;

  return (
    <View style={{ gap: 4 }}>
      <Field
        label={label}
        value={text}
        keyboardType="numeric"
        placeholder={placeholder}
        hint={hint}
        editable={!locked}
        onChangeText={(v) => {
          setText(v);
          const next = read(v);
          // Clearing the box clears the stored value; a half-typed one leaves
          // whatever was stored alone rather than wiping it mid-keystroke.
          if (!v.trim()) onChange(undefined);
          else if (next !== undefined) onChange(next);
        }}
      />
      {typing ? (
        <Txt size="xs" style={{ color: t.color.textFaint }}>
          {`Not a ${label.toLowerCase()} yet — nothing is stored until it is.`}
        </Txt>
      ) : resolved && show(resolved) !== text.trim() ? (
        // What it understood, where that is not character for character what
        // was typed. Two digits of a year are the case this exists for.
        <Txt size="xs" style={{ color: t.color.textFaint }}>{`Read as ${show(resolved)}`}</Txt>
      ) : null}
      {!locked && quick ? (
        <Rowed gap={2} wrap>
          <Chip
            label={quick.label}
            onPress={() => {
              const next = quick.value();
              if (!next) return;
              setText(show(next));
              onChange(next);
            }}
          />
        </Rowed>
      ) : null}
    </View>
  );
}

/**
 * The column the next device occupies, in the department's own words.
 *
 * Picked as the first of the department's four names nobody is using, not from
 * the count of devices on the form. From the count, removing the first of two
 * left the survivor called "Device/gauge 2" while sitting in the first column,
 * and adding a meter back handed out "Device/gauge 2" a second time — two
 * devices with one name, on a form where Part D cites its devices by that name
 * and flowRowDevices resolves a citation to whichever it finds first.
 *
 * It does not renumber what is already there. A row in Part D citing
 * "Device/gauge 2" means the instrument that was called that when the reading
 * was taken, and renaming a column underneath a reading would quietly
 * reattribute it.
 */
function deviceSlotName(held: readonly TestDevice[]): string {
  const taken = new Set(held.map((d) => d.slot.trim()).filter(Boolean));
  const free = DEPARTMENT_DEVICE_SLOTS.find((name) => !taken.has(name));
  if (free) return free;
  // Past the department's four columns. The page lists these under the note
  // that says to put extra devices in the Notes section.
  let n = DEPARTMENT_DEVICE_SLOTS.length + 1;
  while (taken.has(`Device/gauge ${n}`)) n += 1;
  return `Device/gauge ${n}`;
}

/**
 * What the screen knows about the meters on this form, and how to add to it.
 *
 * One read, done where the form is read, used both to tick Part C's boxes and
 * to show whose answer each tick is. `failed` is a third state and not an
 * empty map: a table that could not be read is not the same as nobody having
 * answered, and telling a technician to answer again and then failing to store
 * it is the worst of the three outcomes.
 */
interface DeviceKinds {
  answers: ReadonlyMap<string, DeviceKindAnswer>;
  failed: boolean;
  /** Keeps an answer just given, so the screen shows it without re-reading. */
  remember: (answer: DeviceKindAnswer) => void;
}

/**
 * Part C's Orifice / Mechanical / Electro magnetic question, asked once per
 * meter instead of once per form.
 *
 * It is a fact about the instrument, not about the test: the same meter is the
 * same kind of meter on every form it ever appears on. Asked per form, it was
 * a hundred chances to answer it differently on documents a licensee signs —
 * and it was asked in the one place that disappeared the moment both of our
 * meters were on the form, which is a question nobody is ever going to answer.
 *
 * So it lives here, beside the three boxes it fills in, for as long as any
 * flow meter on the form has no answer on file. One tap answers it, the answer
 * is stored against the serial number, and every later form with that meter
 * fills itself in.
 *
 * A carried-forward answer is shown as somebody's answer, with their name and
 * the date — never as a tick that simply appeared. The app will not decide
 * this box: our own certificates do not name the measuring element, and the
 * manufacturer's service document names only "mechanical parts" and an
 * "electronic metering module", so the papers support more than one of the
 * three and settle none. A tick the app inferred prints identically to one a
 * technician made knowingly.
 */
function FlowDeviceKindQuestion({ form, locked, patch, kinds }: PartProps & {
  /**
   * What has been answered for these serials, read once by the screen that
   * loaded the form. Passed in rather than fetched here, so the read that
   * ticks the boxes and the read that shows who ticked them are one read —
   * two would be two routes to one fact, and two routes drift.
   */
  kinds: DeviceKinds;
}) {
  const t = useTheme();
  /** The flow meters on this form, which are the only devices this asks about. */
  const meters = form.devices.filter((d) => d.kind === 'flow-meter' && d.serialNumber.trim());

  const answer = async (serialNumber: string, kind: FlowDeviceKind) => {
    /*
     * What this meter was answered before, read before anything is written.
     *
     * `kinds.remember` below replaces it in state, and reading it afterwards
     * would depend on this closure holding the stale map — true today and the
     * kind of thing that quietly stops being true.
     */
    const key = deviceKindKey(serialNumber);
    const was = kinds.answers.get(key)?.kind;
    const others = meters
      .filter((m) => deviceKindKey(m.serialNumber) !== key)
      .map((m) => kinds.answers.get(deviceKindKey(m.serialNumber))?.kind)
      .filter((k): k is FlowDeviceKind => !!k);
    try {
      const stored = await setDeviceKind({
        serialNumber,
        kind,
        // Who is answering. The licensee is the name this form already has on
        // it and the person who signs Part I; a stored claim with nobody
        // attached to it is indistinguishable from a guess.
        answeredBy: form.licenseeName?.trim() || undefined,
      });
      if (stored) kinds.remember(stored);
    } catch (e) {
      showAlert('Not remembered', e instanceof Error ? e.message
        : 'The tick is on this form, but the next form will ask again.');
    }
    /*
     * The tick goes on the form either way. Failing to remember the answer for
     * next time is a nuisance; failing to record it on the form in front of
     * the technician would lose the answer they just gave.
     *
     * And the old one comes off, which it did not before: this only ever
     * added, so tapping Mechanical, seeing it was wrong and tapping Electro
     * magnetic left both boxes ticked against one meter — on a page the
     * licensee signs, under a caption promising the opposite. flowKindsAfterAnswer
     * holds the rule, including what it must not take off.
     */
    patch({
      flowDeviceKinds: flowKindsAfterAnswer({
        ticked: form.flowDeviceKinds, was, now: kind, others,
      }),
    });
  };

  if (!meters.length) return null;
  const { answers, failed } = kinds;

  return (
    <>
      {failed ? (
        <Txt size="xs" tone="faint">
          Could not read what was answered for these meters before. Tick the boxes above by hand.
        </Txt>
      ) : null}
      {meters.map((d) => {
        const held = answers.get(deviceKindKey(d.serialNumber));
        const preset = DEVICE_PRESETS.find(
          (pr) => pr.device.serialNumber.toUpperCase() === deviceKindKey(d.serialNumber),
        );
        return (
          <View key={d.serialNumber} style={{ gap: 6, marginTop: 4 }}>
            <Rowed>
              <Txt size="sm" weight="700" style={{ flex: 1 }}>
                {d.serialNumber}
                {held ? ` — ${FLOW_DEVICE_LABEL[held.kind]}` : ' — which kind of meter?'}
              </Txt>
            </Rowed>
            {held ? (
              <Txt size="xs" tone="faint">
                Answered{held.answeredBy ? ` by ${held.answeredBy}` : ''} on{' '}
                {formatAuDate(qldIsoDay(held.answeredAt))}
                {held.basis ? ` · ${held.basis}` : ''}. Every form with this meter uses it.
              </Txt>
            ) : (
              <Txt size="xs" tone="faint">
                {preset?.flowDeviceKindNote
                  ?? 'Answer it once and every later form with this serial fills it in.'}
              </Txt>
            )}
            {!locked ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {(['orifice', 'mechanical', 'electromagnetic'] as FlowDeviceKind[]).map((k) => (
                  <Chip
                    key={k}
                    label={FLOW_DEVICE_LABEL[k]}
                    selected={held?.kind === k}
                    tone={held?.kind === k ? 'accent' : 'default'}
                    onPress={() => { void answer(d.serialNumber, k); }}
                  />
                ))}
              </View>
            ) : null}
            {held && !locked ? (
              <Txt size="xs" style={{ color: t.color.textFaint }}>
                Tap another to correct it — a meter does not change what it is, so a different
                answer replaces this one rather than sitting beside it.
              </Txt>
            ) : null}
          </View>
        );
      })}
    </>
  );
}

function PartC({ form, locked, patch, kinds }: PartProps & { kinds: DeviceKinds }) {
  const devices = form.devices;
  const unused = unusedDevicePresets(devices);
  const setDevice = (i: number, p: Partial<TestDevice>) => patch({
    devices: devices.map((d, n) => (n === i ? { ...d, ...p } : d)),
  });

  /*
   * The gauges this phone has recorded before.
   *
   * Part C is nine fields per instrument, and the company's two flow meters
   * are chips because they are transcribed from their certificates. The
   * pressure gauge never is: a technician's own, or a borrowed one, typed out
   * in full at a booster on every single form. What is wanted is not a
   * catalogue somebody maintains but what this technician typed last time, so
   * it is read back off the forms already here.
   */
  const [remembered, setRemembered] = useState<RememberedDevice[]>([]);
  useEffect(() => {
    let cancelled = false;
    // A failure is silent on purpose: this is a convenience beside a field
    // that still works, and an alert about it would be the loudest thing on a
    // part whose actual job is a calibration date.
    void recentTestDevices().then((r) => { if (!cancelled) setRemembered(r); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const offerable = offerableDevices(remembered, devices);


  return (
    <View style={{ gap: 12 }}>
      <Card>
        <Txt size="sm" tone="muted">{PART_C_NOTE}</Txt>
        <Divider />
        <Label>Flow measuring device</Label>
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
        {!form.flowDeviceKinds.length ? (
          <Txt size="sm" tone="muted">
            Nothing ticked yet, and the form prints that as not answered.
          </Txt>
        ) : null}

        {/*
          * The question, beside the boxes it answers.
          *
          * It used to sit under the "our test equipment" chips, which vanish
          * the moment both of our meters are on the form — so on the commonest
          * Part C this company fills in, the one place that asked this
          * question was gone before anybody could answer it.
          */}
        <FlowDeviceKindQuestion form={form} locked={locked} patch={patch} kinds={kinds} />

        {/*
          * The two "Calibrated: __/__/__" dates the department prints on this
          * same line, beside the note that Part C is not required for orifice
          * testing. Those are the flow device's own calibration, not the
          * gauges' below, and the app had nowhere to put a date the paper asks
          * for twice. Only offered for a ticked kind: an orifice plate is a
          * hole of a known size and has nothing to calibrate.
          */}
        {CALIBRATED_FLOW_DEVICE_KINDS.filter((k) => form.flowDeviceKinds.includes(k)).map((k) => (
          <TypedField
            key={k}
            label={`${FLOW_DEVICE_LABEL[k]} calibrated`}
            value={form.flowDeviceCalibrated?.[k]}
            read={typedDay}
            show={formatAuDate}
            placeholder="18/7/2026"
            hint="Type the digits — 18072026"
            locked={locked}
            onChange={(v) => patch({
              flowDeviceCalibrated: { ...form.flowDeviceCalibrated, [k]: v },
            })}
          />
        ))}
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
              {/* A heading for a device with no stored slot: the department's
                  name for the column it is sitting in, which is a different
                  question from what to call the next one added. */}
              <Txt weight="700">
                {d.slot || DEPARTMENT_DEVICE_SLOTS[i] || `Device/gauge ${i + 1}`}
              </Txt>
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
          {/*
            * Gauge or flow meter, which decides how two of the department's
            * rows read.
            *
            * The field existed, the renderer relied on it, and the screen
            * never showed it — every device added by hand went on as a gauge
            * with no way to say otherwise. So a borrowed inline meter printed
            * red "Not recorded" against "65/100/150 mm face" and "Increments
            * (kPa)": measurements somebody failed to take, for a dial the
            * instrument does not have. That is the same red-where-nothing-is-
            * wrong that teaches a reader to skip the red that matters.
            */}
          <Segmented
            value={d.kind ?? 'gauge'}
            onChange={(v) => setDevice(i, { kind: v })}
            options={[
              { value: 'gauge' as const, label: 'Pressure gauge' },
              { value: 'flow-meter' as const, label: 'Flow meter' },
            ]}
          />
          {(d.kind ?? 'gauge') === 'flow-meter' ? (
            <Txt size="xs" tone="faint">
              The dial size and kPa increment rows print as not applicable — a meter has neither.
            </Txt>
          ) : null}
          {/*
            * The same digits-and-echo box Part A's test date uses.
            *
            * This was a plain text field with an ISO placeholder: eleven
            * characters, two symbol-layer hyphens, in a format nobody here
            * writes — on the one device that is never a preset, so it is typed
            * by hand on every hydrant form. And the consequence was worse than
            * the typing: an AU-typed date read as UNREADABLE, which is a
            * caution, where the same date read properly is OUT OF
            * CALIBRATION, which is a blocker. A form could be issued with
            * every pressure on it read by a gauge two years stale.
            */}
          <TypedField
            label="Calibrated"
            value={d.dateCalibrated}
            read={typedDay}
            show={formatAuDate}
            placeholder="15/1/2026"
            hint="Type the digits — 15012026"
            locked={locked}
            onChange={(v) => setDevice(i, { dateCalibrated: v })}
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
                Only for a device whose certificate says so — our inline meters do, absent fault or
                damage, and unless an authority has stipulated recertification. On a pressure gauge
                this is wrong, and the form prints which basis each device was accepted on.
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
          {/*
            * "65/100/150 mm face" is what the department prints, and it is a
            * choice of three, not a sentence. Typed, it came out as "100mm",
            * "100 mm", "100" and "4 inch" on four forms for the same gauge.
            * Anything genuinely else is still typeable — the row below only
            * appears once nothing on the list is picked, so the common case is
            * one tap and the uncommon one is not shut out.
            */}
          <View style={{ gap: 6 }}>
            <Label>Gauge face</Label>
            <Rowed gap={2} wrap>
              {GAUGE_FACE_SIZES.map((size) => (
                <Chip
                  key={size}
                  label={size}
                  selected={d.faceSize === size}
                  tone={d.faceSize === size ? 'accent' : 'default'}
                  onPress={locked ? undefined : () => setDevice(i, {
                    faceSize: d.faceSize === size ? undefined : size,
                  })}
                />
              ))}
            </Rowed>
            {d.faceSize && !GAUGE_FACE_SIZES.includes(d.faceSize) ? (
              <Field
                label="Face size, as written"
                value={d.faceSize}
                onChangeText={(v) => setDevice(i, { faceSize: v })}
                editable={!locked}
              />
            ) : !d.faceSize && !locked ? (
              <Field
                label="Something else"
                value=""
                onChangeText={(v) => setDevice(i, { faceSize: v })}
                placeholder="A face that is none of the three"
                editable
              />
            ) : null}
          </View>

          {/*
            * The dial's increments. Four values cover nearly every gauge on a
            * hydrant, and the rest is typed.
            */}
          <View style={{ gap: 6 }}>
            <Label>Increments</Label>
            <Rowed gap={2} wrap>
              {GAUGE_INCREMENTS_KPA.map((inc) => (
                <Chip
                  key={inc}
                  label={`${inc} kPa`}
                  selected={d.incrementsKpa === inc}
                  tone={d.incrementsKpa === inc ? 'accent' : 'default'}
                  onPress={locked ? undefined : () => setDevice(i, {
                    incrementsKpa: d.incrementsKpa === inc ? undefined : inc,
                  })}
                />
              ))}
            </Rowed>
            {d.incrementsKpa === undefined || !GAUGE_INCREMENTS_KPA.includes(d.incrementsKpa) ? (
              <NumField
                label="Increments, if not one of those"
                suffix="kPa"
                value={d.incrementsKpa}
                onChange={(v) => setDevice(i, { incrementsKpa: v })}
                locked={locked}
              />
            ) : null}
          </View>
          {/*
            * Three states, as the department's tickbox has: ticked, not
            * ticked, and nobody answered. The chip read "Analogue" whenever
            * the field was unset, which asserts something about the gauge that
            * nobody had said — and the page prints that assertion.
            */}
          <TriState
            label="Digital reader"
            value={d.digitalReader}
            onChange={(v) => setDevice(i, { digitalReader: v })}
            locked={locked}
          />
        </Card>
        );
      })}

      {/*
        * How many of the department's four columns this fills.
        *
        * Part C on the paper is a four-column table — Device/gauge 1 to 4 —
        * and the page prints all four whatever is on the form. The screen
        * showed nothing at all until a chip was tapped, so a technician had no
        * way to know the table existed, how many columns it had, or that
        * leaving one empty prints six rows of red "Not recorded" against it.
        * Part D's eight rows and Part G's two test points already lay the
        * department's table over what is stored; this says the same thing in a
        * line, because four empty device cards would be worse than the problem.
        */}
      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
        {devices.length === 0
          ? 'The form prints a four-column equipment table. With nothing on it, every row of all '
            + 'four columns prints as not recorded.'
          : `${devices.length} of the department's four columns filled. The other ${
            DEPARTMENT_DEVICE_SLOTS.length - devices.length} print${
            DEPARTMENT_DEVICE_SLOTS.length - devices.length === 1 ? 's' : ''} as not used, which is `
            + 'an answer — a column you meant to fill is not.'}
      </Txt>

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
                        devices: [...devices, { slot: deviceSlotName(devices), ...preset.device }],
                        /*
                         * A measuring element the certificate names goes on with
                         * the device. One it does not name stays the
                         * technician's, which is what the note under these chips
                         * says — and the field was declared, documented as doing
                         * exactly this, and read by nothing.
                         *
                         * Both keys in one patch rather than two calls: patch is
                         * built from this render's form, so a second call would
                         * be computed off the form as it was before the device
                         * went on and would drop it.
                         */
                        ...(preset.flowDeviceKind
                          && !form.flowDeviceKinds.includes(preset.flowDeviceKind)
                          ? { flowDeviceKinds: [...form.flowDeviceKinds, preset.flowDeviceKind] }
                          : {}),
                      })}
                    />
                    <Txt size="xs" tone="faint">{preset.detail}</Txt>
                  </View>
                ))}
              </View>
              {unused.some((p) => p.flowDeviceKindNote) ? (
                <Txt size="xs" tone="faint">
                  The Orifice / Mechanical / Electro magnetic tick is asked above, once per meter.
                </Txt>
              ) : null}
            </>
          ) : (
            <Txt size="sm" tone="muted">
              Both of our meters are on this form. Anything else you used goes on by hand.
            </Txt>
          )}

          {/*
            * And the gauge, which is never a preset.
            *
            * Nine fields, retyped at a booster on every form, for an
            * instrument that has not changed since the last one. Offered with
            * the date it was last used on, so a technician can see at a glance
            * whether its certificate has moved since — and offered rather than
            * filled, because what comes back is a calibration date and the
            * only person who can say whether it still holds is the one holding
            * the certificate. deviceCalibration judges it either way.
            */}
          {offerable.length ? (
            <>
              <Label>Used before on this phone</Label>
              <Txt size="sm" tone="muted">
                Adds it with everything that was recorded last time. Check the calibration date
                against the certificate in your hand — a serviced gauge has a new one.
              </Txt>
              <View style={{ gap: 8 }}>
                {offerable.map((r) => (
                  <View key={r.device.serialNumber} style={{ gap: 2 }}>
                    <Chip
                      label={`+ ${r.device.serialNumber}`}
                      onPress={() => patch({
                        devices: [...devices, { slot: deviceSlotName(devices), ...r.device }],
                      })}
                    />
                    <Txt size="xs" tone="faint">
                      {[
                        r.device.kind === 'flow-meter' ? 'Flow meter' : 'Pressure gauge',
                        r.device.dateCalibrated ? `calibrated ${formatAuDate(r.device.dateCalibrated)}` : 'no calibration date',
                        r.lastUsed ? `last used ${formatAuDate(r.lastUsed)}` : undefined,
                      ].filter(Boolean).join(' · ')}
                    </Txt>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          <Button
            title="Add a device by hand"
            variant="secondary"
            onPress={() => patch({
              devices: [...devices, { slot: deviceSlotName(devices), serialNumber: '', kind: 'gauge' }],
            })}
          />
        </Card>
      ) : null}
    </View>
  );
}

/**
 * What is outstanding, and a way straight to it.
 *
 * These were two banners of text. Each line named the part it was about and
 * none of them could be pressed, so a technician reading "Part C — the gauge
 * was last calibrated 19 months before the test" had to find Part C on the
 * strip themselves. On a nine-part form with a list of six that is how a form
 * gets issued with one of them still outstanding.
 *
 * A line whose part is not one of the nine — the attachment's own, which
 * validateForm72 files under H because that is the part it contradicts — still
 * prints, it just does not offer a jump it cannot make.
 */
function Outstanding({
  tone, title, issues, onGo,
}: {
  tone: 'warn' | 'fail';
  title: string;
  issues: FormIssue[];
  onGo: (p: PartKey) => void;
}) {
  const t = useTheme();
  const colour = tone === 'warn' ? t.color.warn : t.color.fail;
  const known = (part: string): PartKey | undefined =>
    PARTS.find((p) => p.key === part)?.key;

  return (
    <Card style={{ borderLeftWidth: 3, borderLeftColor: colour }}>
      <Txt weight="700">{title}</Txt>
      {issues.map((issue, i) => {
        const key = known(issue.part);
        const body = (
          <Rowed gap={2} align="flex-start">
            <Txt size="sm" weight="700" style={{ color: colour, minWidth: 44 }}>
              {`Part ${issue.part}`}
            </Txt>
            <Txt size="sm" tone="muted" style={{ flex: 1, lineHeight: 19 }}>{issue.message}</Txt>
            {key ? (
              <MaterialCommunityIcons name="chevron-right" size={18} color={t.color.textFaint} />
            ) : null}
          </Rowed>
        );
        return key ? (
          <Pressable
            key={`${issue.part}-${i}`}
            onPress={() => onGo(key)}
            accessibilityRole="button"
            accessibilityLabel={`Go to Part ${issue.part}`}
            // The 44dp floor: these are pressed with gloves on.
            style={{ minHeight: 44, justifyContent: 'center', paddingVertical: 4 }}
          >
            {body}
          </Pressable>
        ) : (
          <View key={`${issue.part}-${i}`} style={{ paddingVertical: 4 }}>{body}</View>
        );
      })}
    </Card>
  );
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
  const t = useTheme();
  const f = form.flowTest;
  const set = (p: Partial<typeof f>) => patch({ flowTest: { ...f, ...p } });
  // What the table proves, and whether the pair typed under it says otherwise.
  const proved = provedDuty(f);
  const provedGap = provedDutyDisagrees(f);

  // The eight printed lines, laid over whatever this form has stored. A line
  // the form holds keeps its readings and its index; a line it does not is
  // shown empty and only becomes a stored row once something is typed into it.
  // Laid out in the domain, so this and the printed page claim the same stored
  // row for each of the department's lines — see partDLines for what went
  // wrong when they disagreed.
  const lines = partDLines(f.rows);

  /*
   * Which untouched rows the technician has opened by hand.
   *
   * Held here rather than per row so it survives a row being stored — the
   * first keystroke moves a row from untouched to in use, and a state inside
   * the row would be lost at exactly the wrong moment. A row never closes once
   * opened: closing one somebody opened on purpose, because they had not typed
   * into it yet, is the app arguing with them.
   */
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const inUseCount = lines.filter((l) => l.printed && !flowRowUntouched(l.row)).length;

  /*
   * How many hydrant boxes are on screen, which only ever goes up.
   *
   * The count was `max(four printed, however many the form holds)`, and
   * setHydrantLocation drops trailing empties — because four stored blanks and
   * no stored blanks say the same thing. Put together, clearing the last box
   * deleted the box. A technician retyping hydrant 6 at a large site cleared
   * it and watched it vanish mid-keystroke, with nowhere to type the new name;
   * and where hydrant 5 was already blank, clearing 6 popped both and two
   * boxes went at once.
   *
   * Seeded from the form, because this part is only drawn once the form is
   * loaded, and never lowered while the screen is open. Storage still drops
   * the trailing blanks — that is right, and it is not the same question as
   * how many boxes to draw.
   */
  const [slots, setSlots] = useState(() => hydrantSlotCount({ held: f.hydrantLocations.length }));
  const hydrantSlots = hydrantSlotCount({ held: f.hydrantLocations.length, shown: slots });

  const setLine = (
    line: { row: FlowRow; index?: number },
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
        {Array.from({ length: hydrantSlots }, (_, i) => i + 1).map((n) => (
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
        {/*
          * And a way to record a fifth.
          *
          * The department prints four, and the only hydrants that could ever
          * be typed in were the four printed plus however many the register
          * happened to prefill — so a technician at a site the register does
          * not cover, who ran five, had nowhere to put the fifth. The page
          * already lists anything past the fourth under the table rather than
          * dropping it, so there was a place for it on the document and no way
          * to get it there.
          */}
        {!locked ? (
          <Button
            title={hydrantSlots < PART_D_LOCATION_SLOTS + 1 ? 'Another hydrant' : `Hydrant ${hydrantSlots + 1}`}
            variant="ghost"
            compact
            onPress={() => setSlots(hydrantSlots + 1)}
            icon={<MaterialCommunityIcons name="plus" size={16} color={t.color.accentText} />}
          />
        ) : null}
        {/*
          * Three states, as the form has.
          *
          * The printed Yes/No pair can be left unticked, and the page already
          * printed "Not answered" for that — but the screen was a two-state
          * chip, so once it had been tapped there was no way back to
          * unanswered. A technician who tapped it by accident had to live with
          * an answer on a signed document.
          */}
        <TriState
          label="On-site pump set installed"
          value={f.onSitePumpSet}
          onChange={(v) => set({ onSitePumpSet: v })}
          locked={locked}
        />
      </Card>

      {/*
        * Eight rows, three of them usually in use.
        *
        * The department's table prints three nozzle bores and five metered
        * rates whatever the job did, so all eight have to be here and all
        * eight have to stay answerable — a row nobody can reach is a reading
        * nobody can take. But a typical annual hydrant test runs three of
        * them, and eight full cards made the other five a scroll between the
        * technician and the next one they wanted.
        *
        * So a row in use opens itself and a row nobody has touched is one line
        * high, saying what it will print, opening on a tap. Nothing is hidden
        * and nothing is decided: the fold follows what is on the row, never
        * what the app guesses the job was. It is the shape the timesheet
        * already uses for a weekend.
        */}
      <Txt size="sm" tone="muted">
        {inUseCount
          ? `${inUseCount} of the department's eight rows in use. The rest print as not run — tap one to read it.`
          : 'The department prints eight rows. Tap the one you ran — the rest print as not run, which is not a fault.'}
      </Txt>

      {lines.map((line) => {
        const r = line.row;
        const untouched = flowRowUntouched(r);
        const rowKey = line.printed ? flowRowKey(r) : `extra-${line.index}`;
        /*
         * In use, so open: anything on the row at all, and any row that is not
         * one of the department's eight — an extra row only exists because
         * somebody put a reading on it.
         */
        const inUse = !untouched || !line.printed;
        if (!inUse && !opened.has(rowKey)) {
          return (
            <Pressable
              key={rowKey}
              onPress={() => setOpened((prev) => new Set(prev).add(rowKey))}
              accessibilityRole="button"
              accessibilityLabel={`Open ${flowRowLongLabel(r)} — nothing read yet`}
              style={{
                minHeight: 44,
                justifyContent: 'center',
                paddingHorizontal: t.space(4),
                borderRadius: t.radius.md,
                backgroundColor: t.color.surfaceAlt,
              }}
            >
              <Rowed gap={2}>
                <Txt weight="700" tone="muted" style={{ flex: 1 }}>{flowRowLongLabel(r)}</Txt>
                <Txt size="xs" tone="faint">Not run</Txt>
                <MaterialCommunityIcons name="chevron-down" size={18} color={t.color.textFaint} />
              </Rowed>
            </Pressable>
          );
        }
        return (
          /*
           * Keyed by which row of the department's table it is, not by whether
           * it has been stored yet.
           *
           * The key used to flip from flowRowKey(r) to `row-${index}` the
           * moment the row was appended to f.rows — which is what the first
           * keystroke in any of its four pressure boxes does. React saw a key
           * that had not existed, unmounted the whole card and mounted a new
           * one: new TextInputs, the keyboard dropped, focus gone, and the one
           * digit that had been typed replaced by NumField's reset from the
           * stored value. On the hottest control on the document, every form.
           *
           * flowRowKey is the same before and after storage for all eight
           * printed rows, because `stored` is keyed by it. An extra row — one
           * on a form from outside this screen, which the filter above has
           * already excluded from colliding with the eight — is keyed by its
           * position, and always has one.
           */
          <Card key={line.printed ? flowRowKey(r) : `extra-${line.index}`}>
            <Rowed>
              <Txt weight="700" style={{ flex: 1 }}>{flowRowLongLabel(r)}</Txt>
              {!line.printed ? <Chip label="Not on the printed table" tone="warn" /> : null}
              {untouched ? <Chip label="Nothing read" tone="muted" /> : null}
              {/*
                * A row with a meter named on it and no reading is a gap, not a
                * row nobody ran — and naming the meter is what makes it one.
                *
                * flowRowUntouched counts the device string, so tapping a meter
                * chip down the column before taking any readings turned the
                * page's quiet "Not run" into red "Not recorded" for every row
                * reached. The only feedback was the "Nothing read" chip
                * disappearing. The behaviour is right; it was invisible.
                */}
              {!untouched && !flowRowRead(r) ? (
                <Chip label="Prints as not recorded" tone="warn" />
              ) : null}
              {!line.printed && !locked && line.index !== undefined ? (
                <RemoveButton
                  what="flow row"
                  onRemove={() => set({ rows: f.rows.filter((_, n) => n !== line.index) })}
                />
              ) : null}
            </Rowed>
            {/*
              * The column is headed "Device/gauge no. (Part C)" — a
              * cross-reference, not a description — so the equipment on this
              * form is offered as taps. Typed free, a row could cite "DG1" on
              * a form whose Part C lists SQF-001, and nothing noticed that the
              * reference pointed at nothing.
              *
              * The box stays, because a technician who used something not on
              * the list has to be able to say so, and Part D cautions when a
              * name is not one of Part C's.
              */}
            <View style={{ gap: 6 }}>
              <Label>Device/gauge used (Part C)</Label>
              {form.devices.some((d) => d.serialNumber.trim()) ? (
                <Rowed gap={2} wrap>
                  {form.devices.filter((d) => d.serialNumber.trim()).map((d) => {
                    const name = d.serialNumber.trim();
                    const on = flowRowDevices(r, form.devices).known.includes(d);
                    return (
                      <Chip
                        key={`${d.slot}-${name}`}
                        label={name}
                        selected={on}
                        tone={on ? 'accent' : 'default'}
                        onPress={locked ? undefined : () => setLine(line, {
                          devices: toggleNamed(r.devices, name),
                        })}
                      />
                    );
                  })}
                </Rowed>
              ) : (
                <Txt size="sm" tone="muted">
                  Nothing in Part C to pick from yet. Add your equipment there and it appears here.
                </Txt>
              )}
              <Field
                label=""
                value={r.devices}
                onChangeText={(v) => setLine(line, { devices: v })}
                placeholder="Or type it"
                editable={!locked}
              />
            </View>
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
          * The table above already holds this. It was typed again underneath,
          * so a technician who ran 10 L/s and read 350 kPa at three hydrants
          * entered both twice and the pair could end up disagreeing with the
          * readings on a signed form. Offered on a chip with its working, and
          * never written without the tap — see provedDuty, which reads it off
          * the metered rows rather than calculating anything.
          */}
        {!locked && proved && (f.achievedLps !== proved.lps || f.achievedKpa !== proved.kpa) ? (
          <Chip
            label={`Take ${proved.lps} L/s at ${proved.kpa} kPa from ${proved.from}`}
            onPress={() => set({ achievedLps: proved.lps, achievedKpa: proved.kpa })}
          />
        ) : null}
        {provedGap ? (
          <Banner
            tone="warn"
            title={`The table shows ${provedGap.lps} L/s at ${provedGap.kpa} kPa`}
            body={`Read off ${provedGap.from}. What is typed here is what prints, so if the table is `
              + 'right this pair is not — and if this pair is right, say why in the comment.'}
          />
        ) : null}
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
  const carry = dutyToCarry(form);
  const head = b.highestHydrantAboveBoosterM !== undefined
    ? elevationHeadKpa(b.highestHydrantAboveBoosterM)
    : undefined;
  const friction = resolveFrictionalLoss(b);
  const gaps = frictionalLossGaps(b);
  /*
   * Half a run is not a run, here as in the database and on the printed page.
   * The two boxes below fill each other with a zero so the pair always has one
   * shape, which meant a flow typed before its pressure answered the check as
   * 0 kPa — "not achieved, short by 455 kPa", a pump failure nobody entered.
   */
  const run = overloadRun(form.overload);
  const halfRun = form.overload !== undefined && run === undefined
    && (!!form.overload.flowLps || !!form.overload.pressureKpa);
  const check = b.requiredLps !== undefined && b.requiredKpa !== undefined
    ? overloadCheck(b.requiredLps, b.requiredKpa, run)
    : undefined;

  return (
    <View style={{ gap: 12 }}>
      <Card>
        <Txt size="sm" tone="muted">{PART_E_NOTE}</Txt>
        <ResultPicker value={b.result} onChange={(v) => set({ result: v })} locked={locked} />
      </Card>

      {/*
        * Thirteen number pads, folded away on a part the technician has marked
        * not applicable. On a towns-main hydrant test with no booster that is
        * the whole of Part E, and it was a screen of empty boxes to scroll
        * past.
        */}
      <WhenApplicable result={b.result}>
      <Card>
        {/*
          * Part D's locations, offered rather than retyped.
          *
          * Both parts have a hydrant-locations field on the department's form
          * and they are genuinely separate answers — the hydrants run off the
          * booster are often not the ones in the flow table — so this copies
          * rather than shares. One tap each, and the two parts stop
          * disagreeing about the name of the same hydrant.
          */}
        <Field label="Hydrant locations" value={b.hydrantLocations ?? ''} onChangeText={(v) => set({ hydrantLocations: v })} editable={!locked} />
        {!locked && form.flowTest.hydrantLocations.some((x) => x.trim()) ? (
          <Rowed gap={2} wrap>
            {form.flowTest.hydrantLocations.filter((x) => x.trim()).map((place) => {
              const already = (b.hydrantLocations ?? '')
                .split(',').map((x) => x.trim().toLowerCase())
                .includes(place.trim().toLowerCase());
              return (
                <Chip
                  key={place}
                  label={already ? place : `+ ${place}`}
                  selected={already}
                  tone={already ? 'accent' : 'default'}
                  onPress={() => set({ hydrantLocations: toggleNamed(b.hydrantLocations ?? '', place.trim()) })}
                />
              );
            })}
          </Rowed>
        ) : null}
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
        {/*
          * Part D's requirement, offered rather than retyped — the same idiom
          * as the hydrant locations above, and for the same reason. On most
          * systems it is one design figure written into two parts, and it was
          * typed twice. Not shared: Part E's requirement is at the booster and
          * Part D's at the hydrant, and a system can be specified differently
          * at each, so the tap is the technician saying they are the same here.
          */}
        {!locked && carry ? (
          <Chip
            label={`Same as Part D — ${carry.lps} L/s at ${carry.kpa} kPa`}
            onPress={() => set({ requiredLps: carry.lps, requiredKpa: carry.kpa })}
          />
        ) : null}
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
        {halfRun ? (
          <Banner
            tone="warn"
            title="Both boxes, or neither"
            body="A run needs the flow and the residual together. One on its own is not kept and
              does not print — a pump that made nothing is a Part E comment and a fail, not a zero
              in a box nobody can tell from an empty one."
          />
        ) : null}
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
      </WhenApplicable>
    </View>
  );
}

function PartF({ form, locked, patch }: PartProps) {
  const s = form.sprinklerHydrostatic;
  const set = (p: Partial<SprinklerHydrostatic>) => patch({ sprinklerHydrostatic: { ...s, ...p } });
  return (
    <View style={{ gap: 12 }}>
      <Card>
        <Txt size="sm" tone="muted">{PART_F_NOTE}</Txt>
        <ResultPicker value={s.result} onChange={(v) => set({ result: v })} locked={locked} />
      </Card>
      <WhenApplicable result={s.result}>
        <Card>
          <NumField label="Pressure" suffix="kPa" value={s.pressureKpa} onChange={(v) => set({ pressureKpa: v })} locked={locked} />
          <NumField label="Time held" suffix="mins" value={s.timeHeldMinutes} onChange={(v) => set({ timeHeldMinutes: v })} locked={locked} />
          <Field label="Comments" value={s.comments ?? ''} onChangeText={(v) => set({ comments: v })} multiline editable={!locked} />
        </Card>
      </WhenApplicable>
    </View>
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

  /*
   * The department's two printed test points, always on screen.
   *
   * The list used to be built from what was stored and started at none, so an
   * untouched Part G showed nothing while the printed page showed two empty
   * test points — the same mismatch Part D's flow table had. A line only
   * becomes a stored test point once something is typed into it.
   */
  const lines = sprinklerTestPointLines(g);

  /*
   * Writes one line by its slot, filling any slot before it with a blank.
   *
   * Test point 2 filled before test point 1 has to stay test point 2: the form
   * numbers them and Part G's figures are read against the point they name. An
   * append would have made it test point 1 and quietly renamed the test.
   */
  const setLine = (slot: number, p: Partial<SprinklerTestPoint>) => set({
    testPoints: Array.from(
      { length: Math.max(g.testPoints.length, slot + 1) },
      (_, n) => g.testPoints[n] ?? { location: '' },
    ).map((x, n) => (n === slot ? { ...x, ...p } : x)),
  });

  return (
    <View style={{ gap: 12 }}>
      <Card>
        <Txt size="sm" tone="muted">{PART_G_NOTE}</Txt>
        <ResultPicker value={g.result} onChange={(v) => set({ result: v })} locked={locked} />
      </Card>

      <WhenApplicable result={g.result}>
      <Card>
        <Field
          label="System specifications (block plan)"
          value={g.systemSpec ?? ''}
          onChangeText={(v) => set({ systemSpec: v })}
          editable={!locked}
        />
        <NumField
          label="Running test — installation gauge pressure"
          suffix="kPa"
          value={g.runningTestGaugeKpa}
          onChange={(v) => set({ runningTestGaugeKpa: v })}
          locked={locked}
        />
      </Card>

      {lines.map((line, slot) => {
        const p = line.point;
        const flow = testPointOutcome(p.requiredFlowLpm, p.resultFlowLpm);
        const press = testPointOutcome(p.requiredPressureKpa, p.resultPressureKpa);
        const untouched = sprinklerTestPointUntouched(p);
        return (
          <Card key={slot}>
            <Rowed>
              <Txt weight="700" style={{ flex: 1 }}>{p.location || `Test point ${slot + 1}`}</Txt>
              {!line.printed ? <Chip label="Beyond the printed form" tone="warn" /> : null}
              {untouched ? <Chip label="Not used" tone="muted" /> : null}
              {!locked && !line.printed && line.index !== undefined ? (
                <RemoveButton
                  what="test point"
                  onRemove={() => set({ testPoints: g.testPoints.filter((_, n) => n !== line.index) })}
                />
              ) : null}
            </Rowed>
            <Field label="Location" value={p.location} onChangeText={(v) => setLine(slot, { location: v })} editable={!locked} />
            <Rowed gap={2}>
              <View style={{ flex: 1 }}>
                <NumField label="Required flow" suffix="L/min" value={p.requiredFlowLpm} onChange={(v) => setLine(slot, { requiredFlowLpm: v })} locked={locked} />
              </View>
              <View style={{ flex: 1 }}>
                <NumField label="Achieved" suffix="L/min" value={p.resultFlowLpm} onChange={(v) => setLine(slot, { resultFlowLpm: v })} locked={locked} />
              </View>
            </Rowed>
            <OutcomePicker
              label="Flow"
              value={p.flowResult}
              derived={flow}
              onChange={(v) => setLine(slot, { flowResult: v })}
              locked={locked}
            />
            <Rowed gap={2}>
              <View style={{ flex: 1 }}>
                <NumField label="Required pressure" suffix="kPa" value={p.requiredPressureKpa} onChange={(v) => setLine(slot, { requiredPressureKpa: v })} locked={locked} />
              </View>
              <View style={{ flex: 1 }}>
                <NumField label="Achieved" suffix="kPa" value={p.resultPressureKpa} onChange={(v) => setLine(slot, { resultPressureKpa: v })} locked={locked} />
              </View>
            </Rowed>
            <OutcomePicker
              label="Pressure"
              value={p.pressureResult}
              derived={press}
              onChange={(v) => setLine(slot, { pressureResult: v })}
              locked={locked}
            />
          </Card>
        );
      })}

      {!locked ? (
        <Button
          title="Add a test point"
          variant="secondary"
          onPress={() => set({
            testPoints: [
              ...Array.from(
                { length: Math.max(g.testPoints.length, PART_G_PRINTED_TEST_POINTS) },
                (_, n) => g.testPoints[n] ?? { location: '' },
              ),
              { location: '' },
            ],
          })}
        />
      ) : null}

      <Card>
        <Field label="Comments" value={g.comments ?? ''} onChangeText={(v) => set({ comments: v })} multiline editable={!locked} />
      </Card>
      </WhenApplicable>
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
function PartAttachment({ form, locked, patch, onRaised }: PartProps & { onRaised: () => void }) {
  const t = useTheme();
  const defects = form.defects;
  const setDefect = (i: number, p: Partial<FormDefect>) => patch({
    defects: defects.map((d, n) => (n === i ? { ...d, ...p } : d)),
  });
  const criticals = defects.filter((d) => d.critical).length;
  const unraised = unraisedDefects(form);
  const [raising, setRaising] = useState(false);

  /**
   * Raises every defect not yet on the register, and remembers which is which.
   *
   * The register id goes back onto the form, which is what makes a second tap
   * do nothing rather than put the same fault on the site twice — on a
   * register that drives a statutory notice, a duplicate is worse than a gap.
   *
   * The ids are written in one call after the loop rather than one at a time,
   * because a per-defect write would be computed off the form as it was before
   * the previous one landed and would drop it.
   *
   * They go through recordForm72DefectIds rather than patch, because patch
   * refuses an issued form — and an issued form is exactly where this matters:
   * issuing does not discharge the notice, so a defect on a form signed
   * yesterday still has to reach the office. Writing it through patch would
   * have created the register rows and recorded none of them, and the next tap
   * would have raised them all again.
   *
   * A failure part way through still records the ones that went, for the same
   * reason: all-or-nothing would leave rows on the register that the form knows
   * nothing about.
   */
  const raiseDefects = async () => {
    setRaising(true);
    const raised = new Map<string, string>();
    let failure: string | null = null;
    try {
      for (const defect of unraised) {
        try {
          // eslint-disable-next-line no-await-in-loop -- one at a time on purpose: a
          // failure must stop rather than raise the rest against a broken database.
          const made = await createDefect(form72DefectForRegister(form, defect));
          raised.set(defect.description, made.id);
        } catch (e) {
          failure = describeActionFailure(e, 'raising the defect');
          break;
        }
      }
      if (raised.size) {
        try {
          await recordForm72DefectIds(
            form.id,
            defects.map((d) => (d.defectId ? undefined : raised.get(d.description))),
          );
          onRaised();
        } catch (e) {
          /*
           * The register has the rows and the form could not be told. Said
           * plainly and with the count, because the next tap would raise them
           * again and the person has to know not to.
           */
          showAlert(
            'Raised, but not recorded on this form',
            `${raised.size} ${raised.size === 1 ? 'defect is' : 'defects are'} on the register. `
            + 'This form could not be updated to say so, so do not raise them again — '
            + `check the site's register. ${describeActionFailure(e, 'updating the form')}`,
          );
          return;
        }
      }
      if (failure) {
        showAlert(
          raised.size ? 'Some were raised' : 'Not raised',
          raised.size
            ? `${raised.size} went onto the register and the rest did not: ${failure}`
            : failure,
        );
      } else {
        showAlert(
          'On the register',
          `${raised.size} ${raised.size === 1 ? 'defect is' : 'defects are'} now on this site's `
          + 'register. Open it to answer the limb questions and raise the occupier notice.',
        );
      }
    } finally {
      setRaising(false);
    }
  };

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
        * Onto the defect register, once.
        *
        * A critical defect here obliges the owner or occupier to be given a
        * written notice, and the notice flow lives on the register rather than
        * on this form — so the same fault was typed twice: once where Part H's
        * answer comes from, and again where the office and the notice can see
        * it. Raising it carries over what this form knows and leaves the
        * Queensland limb judgements to the defect screen, because inventing
        * one here would be inventing the finding that obliges the notice.
        *
        * Shown on an issued form too. Issuing does not discharge the notice,
        * and a defect on a form signed yesterday still has to reach the
        * office. It is the one thing on this part an issued form can still do,
        * because raising a defect writes to the register rather than to the
        * form — the only mark it leaves here is which register row it became.
        */}
      {unraised.length ? (
        <Card>
          <Txt weight="700">
            {`${unraised.length} defect${unraised.length === 1 ? '' : 's'} not on the register yet`}
          </Txt>
          <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
            The register is where the office sees it and where the occupier&rsquo;s notice is raised
            from. This carries over the description, whether it is critical, the site and the job;
            the limb judgements and the notice are asked for there.
          </Txt>
          <Button
            title={unraised.length === 1 ? 'Raise it on the register' : `Raise all ${unraised.length}`}
            loading={raising}
            onPress={() => { void raiseDefects(); }}
          />
        </Card>
      ) : defects.some((d) => d.defectId) ? (
        <Card>
          <Rowed gap={2}>
            <MaterialCommunityIcons name="check-circle-outline" size={18} color={t.color.pass} />
            <Txt size="sm" tone="muted" style={{ flex: 1 }}>
              {`${defects.filter((d) => d.defectId).length} of these are on the defect register.`}
            </Txt>
          </Rowed>
        </Card>
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
      {/*
        * The department's question is about work already done.
        *
        * This asked "Repairs required", which is a different statement and
        * very nearly its opposite: a technician who found a fault they had not
        * fixed answered Yes, and the form printed a tick against
        * "Repairs/corrective actions taken" beside "attach details including
        * action and date taken" — claiming on a signed document that work had
        * been carried out. A fault left for somebody else is a defect, which
        * is Part H's first question and the attachment page's list, not this.
        */}
      <TriState
        label="Repairs or corrective actions taken"
        value={form.repairsRequired}
        onChange={(v) => patch({ repairsRequired: v })}
        locked={locked}
        yes="Attach the details, including the action taken and the date, to the licensee's report"
        no="No action required in relation to repairs or corrective actions at this time"
      />
      {form.repairsRequired === true ? (
        <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
          Yes means work was carried out on this visit. A fault you have left for somebody else is
          a defect — the question above, and the list on the attachment page.
        </Txt>
      ) : null}
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
function OccupierCopyCard({
  form, site, busy, onPress, onEmail,
}: {
  form: StoredForm72;
  site: Site | null;
  busy: boolean;
  onPress: () => void;
  onEmail: () => void;
}) {
  const due = occupierCopyDueBy(form.testDate);
  const keep = testerCopyKeepUntil(form.testDate);
  const to = occupierCopyRecipient(form, site);

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
      {to.email ? (
        <>
          <Button
            title={`Email it to ${to.email}`}
            loading={busy}
            onPress={onEmail}
          />
          <Txt size="xs" tone="faint">
            {to.source === 'site'
              ? "From the site's contact details. Put a different address on the attachment to use that instead."
              : 'The owner contact on this form\'s attachment.'}
          </Txt>
        </>
      ) : (
        <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{to.reason}</Txt>
      )}
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

/**
 * A numeric box that leaves an empty box empty rather than reading it as zero.
 *
 * It also says when what is in the box is not what the form holds. The box
 * keeps the characters typed, because fighting somebody's typing mid-number is
 * worse, but "12x" or "1 2 0" stores nothing — so the screen showed a reading
 * while the page printed "Not recorded". That is precisely the ambiguity this
 * document exists to remove, running the other way, and it is invisible until
 * the PDF is produced.
 */
function NumField({
  label, value, onChange, suffix, locked, hint,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  suffix?: string;
  locked: boolean;
  hint?: string;
}) {
  const [text, setText] = useState(str(value));
  useEffect(() => { setText(str(value)); }, [value]);
  const unreadable = text.trim() !== '' && num(text) === undefined;
  return (
    <Field
      label={label}
      value={text}
      onChangeText={(v) => { setText(v); onChange(num(v)); }}
      keyboardType="decimal-pad"
      suffix={suffix}
      hint={unreadable
        ? `"${text.trim()}" is not a number, so nothing is recorded here. The form will print this box as not recorded.`
        : hint}
      editable={!locked}
    />
  );
}
