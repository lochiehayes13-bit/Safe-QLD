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

  const row = flow.rows.find((r) => num(r.hydrant1Kpa) !== undefined && num(r.rateLps) !== undefined);
  if (row) {
    out.flowLpm = row.rateLps * LPM_PER_LPS;
    out.residualKpa = row.hydrant1Kpa;
    out.sources.push(`Part D: ${row.rateLps} L/s duty gave ${row.hydrant1Kpa} kPa at one hydrant${row.devices ? ` (${row.devices})` : ''}.`);
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

export function form72EmailBody(form: Pick<Form72, 'siteName' | 'testDate' | 'licenseeName'> & { systemLabel?: string }, jobNo?: string): string {
  return [
    `Form 72 for ${form.siteName}${form.systemLabel ? ` (${form.systemLabel})` : ''}${form.testDate ? `, tested ${form.testDate}` : ''}.`,
    jobNo ? `Simpro job ${jobNo}.` : 'Not yet linked to a Simpro job.',
    form.licenseeName ? `Licensee: ${form.licenseeName}.` : '',
    '',
    'Sent from the Safe QLD app.',
  ].filter((l, i, all) => l !== '' || i === all.length - 2).join('\n');
}
