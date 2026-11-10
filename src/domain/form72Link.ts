import type { Form72 } from '@/domain/form72';

/**
 * A completed Form 72, carried into the hydrant flow tool and onto the job.
 *
 * The form is the statutory record of a hydrant test; the hydrant tool is
 * where the same numbers get turned into "did the supply make its duty".
 * Until now they were typed twice, and the second typing is where the two
 * disagree. So a finished form fills the tool: static and residual pressure,
 * the flow the residual was read at, the required duty from Part E, the
 * rise to the highest hydrant. Everything is read out of the form's own
 * parts and each figure says which part it came from.
 *
 * The same form has to reach the office. It attaches to the Simpro job the
 * test was done under, as the PDF the occupier was handed, so the job holds
 * the evidence without anybody emailing it to themselves. Which job is the
 * one thing the app cannot always know, and where it cannot it asks rather
 * than guessing: a Form 72 on the wrong job is a statutory document filed
 * against the wrong work.
 */

export const FORM72_INBOX = 'lachlan@safeqld.com.au';

export interface HydrantInputs {
  /** kPa, from Part D's static reading or Part E's. */
  staticKpa?: number;
  /** kPa at the flowing hydrant, from the Part D row used or Part E's residual. */
  residualKpa?: number;
  /** L/min the residual was read at. */
  flowLpm?: number;
  /** The duty from Part E, where the form has one. */
  requiredLps?: number;
  requiredKpa?: number;
  /** Metres from the booster to the highest hydrant, Part E. */
  riseM?: number;
  /** Which hydrant the reading is from, for the label. */
  hydrantRef?: string;
  /** Where each figure came from, one line per figure. */
  sources: string[];
}

const LPM_PER_LPS = 60;

function num(v: number | undefined): number | undefined {
  return v !== undefined && Number.isFinite(v) && v > 0 ? v : undefined;
}

/**
 * The hydrant tool's inputs, read out of a form.
 *
 * Part D wins for the flowing reading — it is the hydrant test proper — and
 * the first row with a single-hydrant pressure is taken, because that is
 * the reading the residual-at-flow comparison is defined on. Part E fills
 * what Part D does not hold: the duty and the rise. Nothing is derived from
 * nothing: a form with neither part filled gives an empty set and says so.
 */
export function hydrantInputsFrom(form: Pick<Form72, 'flowTest' | 'booster'>): HydrantInputs {
  const out: HydrantInputs = { sources: [] };
  const flow = form.flowTest;
  const booster = form.booster;

  // Only a metered row carries a flow in litres per second. A nozzle row gives
  // a bore and a pitot reading, and the litres it passed depend on that reading
  // — so it is left for the hydrant tool's own nozzle maths rather than guessed
  // at here.
  const row = flow.rows.find((r) => num(r.hydrant1Kpa) !== undefined && num(r.rateLps) !== undefined);
  const rowRateLps = row ? num(row.rateLps) : undefined;
  if (row && rowRateLps !== undefined) {
    out.flowLpm = rowRateLps * LPM_PER_LPS;
    out.residualKpa = row.hydrant1Kpa;
    out.sources.push(`Part D: ${rowRateLps} L/s duty gave ${row.hydrant1Kpa} kPa at one hydrant${row.devices ? ` (${row.devices})` : ''}.`);
    if (flow.hydrantLocations.length) out.hydrantRef = flow.hydrantLocations[0];
  }

  const staticD = num(flow.staticPressureKpa);
  const staticE = num(booster.staticPressureKpa);
  if (staticD !== undefined) {
    out.staticKpa = staticD;
    out.sources.push(`Part D: static pressure ${staticD} kPa.`);
  } else if (staticE !== undefined) {
    out.staticKpa = staticE;
    out.sources.push(`Part E: static pressure ${staticE} kPa.`);
  }

  if (out.residualKpa === undefined && num(booster.hydrantResidualKpa) !== undefined) {
    out.residualKpa = booster.hydrantResidualKpa;
    out.sources.push(`Part E: ${booster.hydrantResidualKpa} kPa residual at the hydrant being proved.`);
    if (num(booster.requiredLps) !== undefined && out.flowLpm === undefined) {
      out.flowLpm = booster.requiredLps! * LPM_PER_LPS;
      out.sources.push(`Part E: read at the required ${booster.requiredLps} L/s, since Part D gave no row.`);
    }
  }

  if (num(booster.requiredLps) !== undefined) {
    out.requiredLps = booster.requiredLps;
    out.sources.push(`Part E: required ${booster.requiredLps} L/s${num(booster.requiredKpa) !== undefined ? ` at ${booster.requiredKpa} kPa` : ''}.`);
  }
  if (num(booster.requiredKpa) !== undefined) out.requiredKpa = booster.requiredKpa;
  if (num(booster.highestHydrantAboveBoosterM) !== undefined) {
    out.riseM = booster.highestHydrantAboveBoosterM;
    out.sources.push(`Part E: highest hydrant ${booster.highestHydrantAboveBoosterM} m above the booster.`);
  }

  return out;
}

/** Whether a form holds anything the tool can use. */
export function hasHydrantInputs(inputs: HydrantInputs): boolean {
  return [inputs.staticKpa, inputs.residualKpa, inputs.flowLpm, inputs.requiredLps, inputs.riseM].some((v) => v !== undefined);
}

/** A job the office holds, as much of it as choosing needs. */
export interface JobChoice {
  externalId: string;
  title: string;
  status?: string;
  statusName?: string;
  scheduledFor?: string;
  completedAt?: string;
  updatedAt?: string;
}

/**
 * Which of a site's jobs the form most likely belongs to.
 *
 * Open work first, newest first; then finished work newest first. The first
 * is offered as the suggestion, and only where there is exactly one open
 * job is it linked without asking — two open jobs is a question, and a
 * question is cheaper than a statutory form on the wrong one.
 */
export function rankJobsForForm(jobs: readonly JobChoice[]): JobChoice[] {
  const open = jobs.filter((j) => j.status !== 'complete');
  const done = jobs.filter((j) => j.status === 'complete');
  const newest = (a: JobChoice, b: JobChoice) => (b.scheduledFor ?? b.updatedAt ?? '').localeCompare(a.scheduledFor ?? a.updatedAt ?? '');
  return [...open.sort(newest), ...done.sort((a, b) => (b.completedAt ?? b.updatedAt ?? '').localeCompare(a.completedAt ?? a.updatedAt ?? ''))];
}

export function autoLinkJob(jobs: readonly JobChoice[]): JobChoice | undefined {
  const open = jobs.filter((j) => j.status !== 'complete');
  return open.length === 1 ? open[0] : undefined;
}

/** The PDF's name on the job: the site, the system and the test date, no path characters. */
export function form72AttachmentName(form: Pick<Form72, 'siteName' | 'testDate'> & { systemLabel?: string }): string {
  const parts = ['Form 72', form.siteName, form.systemLabel ?? '', form.testDate ?? ''].filter((p) => p && p.trim());
  return `${parts.join(' - ').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()}.pdf`;
}

export function form72AttachmentSubject(form: Pick<Form72, 'siteName' | 'testDate'> & { systemLabel?: string }): string {
  return `Form 72 — ${form.siteName}${form.systemLabel ? `, ${form.systemLabel}` : ''}${form.testDate ? `, tested ${form.testDate}` : ''}`;
}

/**
 * Where the occupier's copy goes, and whose address it is.
 *
 * MP 6.1 acceptable solution A4(b) obliges the licensee to give the occupier a
 * copy within ten business days of the work. The app already counts those days,
 * prints the deadline on the form and asks afterwards whether the copy was
 * handed over — and had no way to send one. The whole obligation was measured
 * and not served.
 *
 * Three places an address can come from, in this order, and the reason for the
 * order is who the obligation runs to:
 *
 *  1. The owner contact typed onto this form's attachment. It is the most
 *     recent thing anybody wrote down about who to tell, and it was typed by
 *     the person standing on the site on the day.
 *  2. The site's own contact email, as the office holds it.
 *  3. Nothing, which is said plainly rather than defaulted to the office — a
 *     copy sent to ourselves is not a copy given to an occupier, and the app
 *     recording it as one would make the deadline it tracks a fiction.
 *
 * The owner contact is a free-text field that often holds a phone number, so
 * it only counts where it looks like an address.
 */
export interface OccupierCopyRecipient {
  email?: string;
  /** Where the address came from, for the line the screen shows before sending. */
  source?: 'form' | 'site';
  /** Why there is no address. Present exactly when email is absent. */
  reason?: string;
}

/**
 * Deliberately strict rather than clever.
 *
 * It has to reject a phone number typed into the owner contact box, and the
 * cost of a false positive is a statutory document sent to an address that
 * does not exist — or worse, to one that does and is not theirs.
 */
const LOOKS_LIKE_EMAIL = /^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$/;

export function occupierCopyRecipient(
  form: Pick<Form72, 'ownerContact'>,
  site?: { contactEmail?: string } | null,
): OccupierCopyRecipient {
  const typed = form.ownerContact?.trim();
  if (typed && LOOKS_LIKE_EMAIL.test(typed)) return { email: typed, source: 'form' };

  const onSite = site?.contactEmail?.trim();
  if (onSite && LOOKS_LIKE_EMAIL.test(onSite)) return { email: onSite, source: 'site' };

  return {
    reason: typed
      ? `The owner contact on this form ("${typed}") is not an email address, and the site record `
        + 'holds none. Type one on the attachment, or hand the copy over another way and record it.'
      : 'Neither this form nor the site record holds an email address for the occupier. Type one on '
        + 'the attachment, or hand the copy over another way and record it.',
  };
}

/** The subject on the occupier's own copy, which is not the office's. */
export function occupierCopySubject(
  form: Pick<Form72, 'siteName' | 'testDate'> & { systemLabel?: string },
): string {
  return `Your Form 72 — ${form.siteName}${form.systemLabel ? `, ${form.systemLabel}` : ''}${
    form.testDate ? `, tested ${form.testDate}` : ''}`;
}

/**
 * The body of the occupier's copy.
 *
 * Written for the building owner or occupier rather than for the office: it
 * says what the attachment is, which obligation it discharges, and — where the
 * form records a critical defect — that a separate notice is coming, because
 * that is the one thing in the envelope they have to act on.
 */
export function occupierCopyBody(
  form: Pick<Form72, 'siteName' | 'testDate' | 'licenseeName' | 'criticalDefectsIdentified'>
  & { systemLabel?: string },
  companyName: string,
): string {
  return [
    `Attached is the Form 72 for ${form.siteName}${form.systemLabel ? ` (${form.systemLabel})` : ''}${
      form.testDate ? `, tested ${form.testDate}` : ''}.`,
    '',
    'This is the record of periodic testing and maintenance of the water-based fire safety '
    + 'installations at the above address, required under the Queensland Development Code '
    + 'Mandatory Part 6.1. Please keep it with the building\'s fire safety records.',
    form.criticalDefectsIdentified
      ? '\nThe form records that critical defects were identified. A critical defect notice will '
        + 'follow separately; it is a different document from this one and it needs your attention.'
      : '',
    form.licenseeName ? `\nTested and signed by ${form.licenseeName}.` : '',
    `\n${companyName}`,
  ].filter((line, i, all) => line !== '' || i === 1 || i === all.length - 1).join('\n');
}

export function form72EmailBody(form: Pick<Form72, 'siteName' | 'testDate' | 'licenseeName'> & { systemLabel?: string }, jobNo?: string): string {
  return [
    `Form 72 for ${form.siteName}${form.systemLabel ? ` (${form.systemLabel})` : ''}${form.testDate ? `, tested ${form.testDate}` : ''}.`,
    jobNo ? `Simpro job ${jobNo}.` : 'Not yet linked to a Simpro job.',
    form.licenseeName ? `Licensee: ${form.licenseeName}.` : '',
    '',
    'Sent from the Safe QLD app.',
  ].filter((l, i, all) => l !== '' || i === all.length - 2).join('\n');
}

/**
 * What the queue says became of the PDF, or what the form knew before the
 * queue row was remembered.
 *
 * `undefined` for the row means nobody has read it (or the form predates
 * v39 and has none); `null` means the row is gone — a failed row can be
 * deleted from Waiting to send, and a deleted row is a file that did not go.
 */
export type JobCopyRow =
  | { status: 'pending' | 'sending' | 'sent' | 'failed' | 'unknown'; lastError?: string }
  | null
  | undefined;

export interface JobCopyState {
  /** The sentence under the job on the Simpro card. */
  line: string;
  chip: { label: string; tone: 'pass' | 'warn' | 'fail' | 'default' };
  /** Whether "Queue the PDF again" is the right offer, as against a first "Attach". */
  again: boolean;
}

/**
 * The Simpro card's one sentence about the PDF, decided away from the screen.
 *
 * The card used to say "On the job" from the moment the PDF was queued, and
 * never again looked: an upload abandoned because the file had gone from the
 * cache, refused by the server, or lost without a reply still read as filed.
 * The office rang; the technician looked at a green chip. So the sentence is
 * read off the queue row the form remembers, state by state, and a row that
 * has vanished is said to have vanished rather than assumed to have gone.
 */
export function jobCopyState(input: {
  jobExternalId?: string;
  issued: boolean;
  attachedAt?: string;
  /** The queued-at moment, already worded for the reader ("2:14 pm"). */
  queuedAt?: string;
  /** Whether the form remembers which row it queued (forms since v39 do). */
  hasRow: boolean;
  row: JobCopyRow;
}): JobCopyState {
  const job = input.jobExternalId?.trim();
  if (!job) {
    return {
      line: 'The office files this form against the job the test was done under. Name it and the PDF '
        + `goes onto it ${input.issued ? 'straight away' : 'the moment the form is issued'}.`,
      chip: { label: 'No job', tone: 'warn' },
      again: false,
    };
  }
  if (!input.attachedAt) {
    return input.issued
      ? { line: 'Issued, and not yet on the job. Attach the PDF to put it there.', chip: { label: 'Not on the job', tone: 'warn' }, again: false }
      : { line: 'The PDF goes onto this job the moment the form is issued.', chip: { label: 'Linked', tone: 'default' }, again: false };
  }
  const when = input.queuedAt ? ` ${input.queuedAt}` : '';
  if (!input.hasRow || input.row === undefined) {
    // Queued before the form remembered its row, or the row not read yet:
    // what was always said, which is true as far as it goes.
    return { line: `PDF queued for the job${when}.`, chip: { label: 'Queued', tone: 'pass' }, again: true };
  }
  if (input.row === null) {
    return {
      line: `The PDF was queued${when}, but its entry on Waiting to send is gone, so it did not go. Queue it again.`,
      chip: { label: 'Not sent', tone: 'fail' },
      again: true,
    };
  }
  // The queue's own reasons end in a full stop; the sentence supplies its own.
  const why = input.row.lastError?.trim().replace(/\.$/, '');
  switch (input.row.status) {
    case 'pending':
      return { line: `PDF waiting to send to job ${job}, queued${when}. It goes up with the next sync.`, chip: { label: 'Waiting to send', tone: 'warn' }, again: true };
    case 'sending':
      return { line: `PDF going up to job ${job} now.`, chip: { label: 'Sending', tone: 'warn' }, again: true };
    case 'sent':
      return { line: `PDF on job ${job}'s attachments in Simpro, queued${when}.`, chip: { label: 'On the job', tone: 'pass' }, again: true };
    case 'failed':
      return {
        line: `The PDF did not reach job ${job}${why ? `: ${why}` : ''}. Queue it again.`,
        chip: { label: 'Not sent', tone: 'fail' },
        again: true,
      };
    default:
      return {
        line: `The PDF may or may not have reached job ${job}${why ? ` (${why})` : ''}. Check the job's `
          + 'attachments in Simpro before queueing it again.',
        chip: { label: 'Unconfirmed', tone: 'warn' },
        again: true,
      };
  }
}
