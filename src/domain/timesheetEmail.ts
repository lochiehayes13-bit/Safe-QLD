import { dayName, entryHours, timesheetTotals, type Timesheet } from './timesheet';

/**
 * The timesheet email the office receives.
 *
 * Kept pure and away from the mail composer so the wording and the arithmetic
 * can be tested directly. What gets sent is a summary a person reads in the
 * body, with the full sheet attached as a file — payroll works from the
 * attachment, but the body has to be enough to see at a glance whether a week
 * looks right without opening anything.
 *
 * The subject is deliberately rigid. These land in one inbox from a dozen
 * technicians every week, and a subject that sorts and searches consistently is
 * worth more than one that reads nicely.
 */

/** Where completed timesheets go. */
export const TIMESHEET_INBOX = 'accounts@safeqld.com.au';

/** Formats an ISO date as the office writes it. */
function auDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

/** One decimal, but only when there is a fraction to show. */
function hours(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '');
}

export function timesheetSubject(sheet: Timesheet): string {
  const who = sheet.employeeName.trim() || 'Unnamed technician';
  return `Timesheet — ${who} — week starting ${auDate(sheet.weekStarting)}`;
}

/**
 * The body.
 *
 * Day rows first, because that is what gets queried, then the totals. Leave and
 * public holiday are only mentioned when there are any — a column of zeroes on
 * every timesheet trains people to skip the whole block.
 */
export function timesheetBody(sheet: Timesheet): string {
  const t = timesheetTotals(sheet);
  const lines: string[] = [];

  const who = sheet.employeeName.trim() || 'Unnamed technician';
  lines.push(`Timesheet for ${who}`);
  lines.push(`Week starting ${auDate(sheet.weekStarting)}`);
  if (sheet.vehicleRego.trim()) lines.push(`Vehicle ${sheet.vehicleRego.trim()}`);
  if (sheet.kilometerReading.trim()) lines.push(`Odometer ${sheet.kilometerReading.trim()}`);
  lines.push('');

  if (!sheet.entries.length) {
    lines.push('No days were entered on this sheet.');
  } else {
    for (const e of sheet.entries) {
      const worked = entryHours(e);
      const bits: string[] = [];
      if (worked > 0) {
        const kind = e.hourKind === 'ord' ? '' : e.hourKind === 'ot' ? ' O/T' : ' D/T';
        const span = e.startTime && e.finishTime ? ` ${e.startTime}–${e.finishTime}` : '';
        bits.push(`${hours(worked)}h${kind}${span}`);
      }
      for (const [label, value] of [
        ['sick', e.sick], ['RDO', e.rdo], ['annual', e.annual],
        ['LWOP', e.lwop], ['public holiday', e.publicHoliday],
      ] as const) {
        const v = parseFloat(value);
        if (Number.isFinite(v) && v > 0) bits.push(`${hours(v)}h ${label}`);
      }

      const job = [e.jobNumber.trim(), e.siteName.trim()].filter(Boolean).join(' · ');
      const head = `${dayName(e.date)} ${auDate(e.date)}`.trim();
      lines.push(`${head}  ${job || 'No job recorded'}`);
      // Said out loud rather than left blank: a day row with nothing on it is
      // either a mistake or a day off, and the office should not have to guess.
      lines.push(`    ${bits.join(', ') || 'nothing recorded'}`);
      if (e.comments.trim()) lines.push(`    ${e.comments.trim()}`);
    }
  }

  lines.push('');
  lines.push(`Ordinary  ${hours(t.ord)}`);
  if (t.ot) lines.push(`Overtime  ${hours(t.ot)}`);
  if (t.dt) lines.push(`Double time  ${hours(t.dt)}`);
  if (t.sick) lines.push(`Sick  ${hours(t.sick)}`);
  if (t.rdo) lines.push(`RDO  ${hours(t.rdo)}`);
  if (t.annual) lines.push(`Annual leave  ${hours(t.annual)}`);
  if (t.lwop) lines.push(`Leave without pay  ${hours(t.lwop)}`);
  if (t.publicHoliday) lines.push(`Public holiday  ${hours(t.publicHoliday)}`);
  lines.push(`TOTAL  ${hours(t.grand)}`);
  lines.push('');
  lines.push('Sent from Safe QLD on the technician\'s phone. The full sheet is attached.');

  return lines.join('\n');
}

/**
 * Why this sheet is not ready to send, or null when it is.
 *
 * Checked before the mail app opens rather than after. A timesheet that reaches
 * payroll with no name on it cannot be filed against anyone, and one with no
 * hours is a week's pay missing — both are worth stopping at the phone rather
 * than discovering in the office on Friday.
 */
export function timesheetNotReady(sheet: Timesheet): string | null {
  if (!sheet.employeeName.trim()) {
    return 'This sheet has no technician name on it. Set your name in Settings, or type it on the sheet.';
  }
  if (!sheet.entries.length) {
    return 'There are no days on this sheet yet.';
  }
  const t = timesheetTotals(sheet);
  if (t.grand <= 0) {
    return 'Every day on this sheet is empty — no hours, no leave. Nothing would reach payroll.';
  }
  return null;
}
