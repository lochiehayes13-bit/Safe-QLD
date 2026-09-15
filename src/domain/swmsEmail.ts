import { RISK_LABEL, type MergedSwms, type SwmsRecord } from './swms';

/**
 * The safe work method statement, in the office's inbox.
 *
 * A statement that only exists on the phone of the person who signed it is a
 * statement nobody can produce when it is asked for — and it gets asked for
 * after something has gone wrong, by an inspector, months later. So when a
 * crew finishes one it goes to the office, as a PDF, with a body somebody can
 * read at a glance without opening the attachment.
 *
 * There are two inboxes because there are two halves of the company, and the
 * person who does the work is the one who knows which half it is. A statement
 * in the wrong inbox is not filed, it is lost, so the address is shown in full
 * beside the choice rather than hidden behind the word "Projects".
 *
 * Kept pure and away from the mail composer, the same as the timesheet's, so
 * the wording and the refusals can be tested directly.
 */

export type SwmsInbox = 'projects' | 'service';

export const SWMS_PROJECTS_INBOX = 'projects@safeqld.com.au';
export const SWMS_SERVICE_INBOX = 'service@safeqld.com.au';

export const SWMS_INBOX_ADDRESS: Record<SwmsInbox, string> = {
  projects: SWMS_PROJECTS_INBOX,
  service: SWMS_SERVICE_INBOX,
};

/** Shaped for the Segmented control. The address itself goes under it, in full. */
export const SWMS_INBOX_OPTIONS: { value: SwmsInbox; label: string }[] = [
  { value: 'service', label: 'Service' },
  { value: 'projects', label: 'Projects' },
];

/** Service is the larger share of the work, so it is where an unset device sends. */
export const DEFAULT_SWMS_INBOX: SwmsInbox = 'service';

/** Reads a stored preference back, tolerating anything an older or newer build wrote. */
export function swmsInboxFrom(saved: string | undefined): SwmsInbox {
  return saved === 'projects' ? 'projects' : DEFAULT_SWMS_INBOX;
}

/** Formats an ISO date as the office writes it. */
function auDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

/**
 * The subject.
 *
 * Rigid, because these land in one inbox from a dozen technicians and a
 * subject that sorts and searches consistently is worth more than one that
 * reads nicely. The job number first where there is one — it is what the
 * office files by — then the site, then the day.
 *
 * An unsigned statement says so, in capitals, at the front. A draft that
 * reaches the office looking like a signed document is the one way this email
 * could mislead somebody, and the subject is the part people read.
 */
export function swmsSubject(record: SwmsRecord): string {
  const parts: string[] = [];
  if (record.status !== 'signed') parts.push('DRAFT — ');
  parts.push('SWMS');
  if (record.jobExternalId?.trim()) parts.push(` — job ${record.jobExternalId.trim()}`);
  const where = record.siteName?.trim();
  if (where) parts.push(` — ${where}`);
  parts.push(` — ${auDate(record.date)}`);
  return parts.join('');
}

export interface SwmsEmailOptions {
  /** False where the PDF could not be attached, so the body says what is missing. */
  attached?: boolean;
  /** The company name on the letterhead, for the sign-off. */
  companyName?: string;
}

/**
 * The body.
 *
 * What the office needs to know without opening the PDF: whose it is, what
 * work it covers, which statements were used, whether any of it is high-risk
 * construction work, and whether it is actually signed. The detail is in the
 * attachment; this is the part that decides whether anybody opens it.
 *
 * Risk is stated in words rather than a matrix score. A number out of
 * twenty-five means nothing to a person reading their email, and the two
 * systems in use in this trade do not agree on the number anyway.
 */
export function swmsBody(
  record: SwmsRecord,
  merged: MergedSwms,
  options: SwmsEmailOptions = {},
): string {
  const lines: string[] = [];

  const who = record.workers.map((w) => w.name.trim()).filter(Boolean);
  lines.push(record.title.trim() || 'Safe work method statement');
  lines.push('');

  lines.push(`Date  ${auDate(record.date)}`);
  if (record.jobExternalId?.trim()) {
    lines.push(`Job  ${record.jobExternalId.trim()}${record.jobTitle?.trim() ? ` · ${record.jobTitle.trim()}` : ''}`);
  } else {
    // Said out loud rather than left off: a statement with no job on it cannot
    // be filed against the work, and the office should not have to guess.
    lines.push('Job  not linked to a Simpro job');
  }
  if (record.siteName?.trim()) lines.push(`Site  ${record.siteName.trim()}`);
  if (record.supervisor?.trim()) {
    lines.push(`Supervisor  ${record.supervisor.trim()}${record.supervisorPhone?.trim() ? ` · ${record.supervisorPhone.trim()}` : ''}`);
  }
  lines.push('');

  const works = record.notes?.trim();
  if (works) {
    lines.push('The work');
    lines.push(`    ${works}`);
    lines.push('');
  }

  lines.push(`Statements used (${merged.templates.length})`);
  for (const t of merged.templates) lines.push(`    ${t.title}`);
  lines.push('');

  if (merged.highRisk) {
    lines.push('HIGH-RISK CONSTRUCTION WORK');
    for (const h of merged.hrcw) lines.push(`    ${h.clause} — ${h.text}`);
    lines.push('');
  }

  if (merged.residualRisk) {
    lines.push(`Worst risk after controls  ${RISK_LABEL[merged.residualRisk]}`);
  }
  if (record.addedHazards.length) {
    lines.push(`Hazards the crew added on site  ${record.addedHazards.length}`);
    for (const h of record.addedHazards) {
      const risk = h.risk ? ` (${RISK_LABEL[h.risk]})` : '';
      lines.push(`    ${h.hazard.trim()}${risk}`);
      if (h.control.trim()) lines.push(`        ${h.control.trim()}`);
    }
  }
  lines.push('');

  if (record.status === 'signed') {
    lines.push(`Signed  ${who.length ? who.join(', ') : 'nobody named'}`);
    lines.push(`    ${merged.steps.length} steps, all read on site.`);
  } else {
    // The whole reason the subject shouts DRAFT. Repeated here because the
    // body is what gets forwarded.
    lines.push('NOT SIGNED. This is a draft and nobody has accepted it.');
    const unread = merged.steps.filter((s) => !record.ticked.includes(s.key)).length;
    if (unread) lines.push(`    ${unread} of ${merged.steps.length} steps have not been read.`);
    if (!who.length) lines.push('    No worker has signed it.');
  }

  if (merged.notCleared.length) {
    lines.push('');
    lines.push('Statements no reviewer has cleared for signature:');
    for (const n of merged.notCleared) lines.push(`    ${n.title} — ${n.reason}`);
  }

  lines.push('');
  if (options.attached === false) {
    // Never silently. A body that reads as complete, with no PDF on it, is how
    // a statement gets filed as received when nothing was received.
    lines.push('The PDF could not be attached from this device. The full statement is on the phone —');
    lines.push('open it in the app and use Share to send it.');
  } else {
    lines.push('The full statement is attached as a PDF.');
  }
  lines.push('');
  lines.push(`Sent from ${options.companyName?.trim() || 'Safe QLD'} on the technician's phone.`);

  return lines.join('\n');
}

/**
 * Why this statement is not worth emailing, or null when it is.
 *
 * Checked before the composer opens rather than after. An email with nothing
 * in it costs the office a read and tells them nothing, and the two refusals
 * below are both cases where the crew has more to do rather than a fault.
 */
export function swmsNotReady(record: SwmsRecord, merged: MergedSwms): string | null {
  if (!merged.templates.length) {
    return 'No statements have been chosen yet, so there is nothing to send.';
  }
  if (!record.jobExternalId?.trim() && !record.siteName?.trim()) {
    return 'This statement has no job and no site on it, so the office cannot file it against anything.';
  }
  return null;
}
