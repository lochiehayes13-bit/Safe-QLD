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

export type RequestKind = 'information' | 'leave';

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

export interface LeaveRequest {
  technicianName: string;
  /** 'annual' | 'sick' | 'rdo' | 'unpaid' | 'other' — free-form to survive award changes. */
  leaveType: string;
  /** ISO dates. */
  fromDate: string;
  toDate: string;
  reason: string;
}

function auDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
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
    return 'Set your name in Settings first, so the office knows who is asking.';
  }
  if (r.question.trim().length < 10) {
    return 'Write the question out. A one-word request takes longer to answer than to ask properly.';
  }
  return null;
}

// ------------------------------------------------------------------- leave

export function leaveSubject(r: LeaveRequest): string {
  const who = r.technicianName.trim() || 'Unnamed technician';
  const span = r.fromDate === r.toDate
    ? auDate(r.fromDate)
    : `${auDate(r.fromDate)} to ${auDate(r.toDate)}`;
  return `Leave request — ${who} — ${span}`;
}

export function leaveBody(r: LeaveRequest): string {
  const lines: string[] = [];
  lines.push(`${r.technicianName.trim() || 'Unnamed technician'} is requesting leave.`);
  lines.push('');
  lines.push(`Type: ${r.leaveType.trim() || 'Not stated'}`);
  lines.push(`From: ${auDate(r.fromDate)}`);
  lines.push(`To: ${auDate(r.toDate)}`);
  lines.push(`Working days: ${workingDays(r.fromDate, r.toDate)}`);
  if (r.reason.trim()) {
    lines.push('');
    lines.push(r.reason.trim());
  }
  lines.push('');
  lines.push('Sent from Safe QLD. This is a request, not an approval.');
  return lines.join('\n');
}

/**
 * Weekdays in the range, inclusive.
 *
 * Weekends only — public holidays are not counted, because the app has no
 * holiday calendar and a number that is wrong three times a year is worse than
 * one the office checks. It is a working-day count for the roster, not a
 * deduction from anybody's balance.
 */
export function workingDays(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 0;
  let days = 0;
  for (let t = from; t <= to; t += 86_400_000) {
    const day = new Date(t).getUTCDay();
    if (day !== 0 && day !== 6) days++;
  }
  return days;
}

export function leaveNotReady(r: LeaveRequest): string | null {
  if (!r.technicianName.trim()) {
    return 'Set your name in Settings first, so the office knows whose leave this is.';
  }
  if (!r.fromDate || !r.toDate) {
    return 'Pick both dates.';
  }
  if (Date.parse(r.toDate) < Date.parse(r.fromDate)) {
    return 'The last day is before the first day.';
  }
  if (!r.leaveType.trim()) {
    return 'Say what kind of leave this is.';
  }
  return null;
}
