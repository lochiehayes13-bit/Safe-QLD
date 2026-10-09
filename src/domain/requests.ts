/**
 * The things a technician needs to ask the office for.
 *
 * All of these are currently a phone call from a roof, or a text message that
 * nobody can find again. Putting them in the app does two things: it makes the
 * ask reach a monitored inbox rather than one person's phone, and it puts the
 * job number and the site in the subject line, so the answer can be filed
 * against the work it belongs to.
 *
 * Pure — the wording and the validation live here, and the mail composer is the
 * caller's problem.
 */

import { contextId } from './screenContext';

export interface InformationRequest {
  technicianName: string;
  /** Simpro job number, where the question is about a job. */
  jobNumber: string;
  siteName: string;
  /** What they need to know. */
  question: string;
  /** Set when the answer decides whether work continues right now. */
  blocking: boolean;
}

// ------------------------------------------------------------- information

export function informationSubject(r: InformationRequest): string {
  const where = [r.jobNumber.trim(), r.siteName.trim()].filter(Boolean).join(' · ');
  const urgency = r.blocking ? 'HELD UP' : 'RFI';
  return `${urgency} — ${where || 'No job given'} — ${r.technicianName.trim() || 'Unnamed technician'}`;
}

export function informationBody(r: InformationRequest): string {
  const lines: string[] = [];
  if (r.blocking) {
    // First line, in the preview pane, before anything else. Someone is standing
    // still on site while this sits unread.
    lines.push('WORK IS STOPPED WAITING ON THIS ANSWER.');
    lines.push('');
  }
  lines.push(`From: ${r.technicianName.trim() || 'Unnamed technician'}`);
  if (r.jobNumber.trim()) lines.push(`Job: ${r.jobNumber.trim()}`);
  if (r.siteName.trim()) lines.push(`Site: ${r.siteName.trim()}`);
  lines.push('');
  lines.push(r.question.trim());
  lines.push('');
  lines.push('Sent from Safe QLD on site.');
  return lines.join('\n');
}

export function informationNotReady(r: InformationRequest): string | null {
  if (!r.technicianName.trim()) {
    return 'Set your name in Settings first.';
  }
  if (r.question.trim().length < 10) {
    return 'Write the question out in full.';
  }
  return null;
}

// --------------------------------------------------------------------- job

/** The job and site a question is about. */
export interface RequestJob {
  jobNumber: string;
  siteName: string;
}

/**
 * The job and site a question starts with, from the route that opened it.
 *
 * The job screen passes both. expo-router can hand back an array or nothing
 * for either, and both read as text here.
 */
export function requestJobFromRoute(params: { job?: string | string[]; site?: string | string[] }): RequestJob {
  return { jobNumber: contextId(params.job) ?? '', siteName: contextId(params.site) ?? '' };
}

/**
 * The job and site once a job has been picked, or found on the phone.
 *
 * The job's own site replaces a typed one, since the job is the record. A job
 * with no site name keeps whatever was typed.
 */
export function withPickedJob(current: RequestJob, job: { externalId?: string; siteName?: string }): RequestJob {
  return {
    jobNumber: job.externalId?.trim() || current.jobNumber,
    siteName: job.siteName?.trim() || current.siteName,
  };
}
