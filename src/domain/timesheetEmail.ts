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
 * The subject is deliberately rigid, and stays rigid whoever the week is
 * addressed to. These land in one inbox from a dozen technicians every week,
 * and a subject that sorts and searches consistently is worth more than one
 * that reads nicely -- a subject that changed when somebody was copied in
 * would break the sort for the sake of information already in the To field.
 */

/** Where completed timesheets go. On every route, without exception. */
export const TIMESHEET_INBOX = 'accounts@safeqld.com.au';

/** The two people a technician can put on the email beside accounts. */
export const TIMESHEET_MATT = 'matt@safeqld.com.au';
export const TIMESHEET_LACHLAN = 'lachlan@safeqld.com.au';

/**
 * Who a week goes to.
 *
 * Accounts alone is the week's ordinary path and stays the default. The other
 * two exist because a week sometimes needs a person to see it the same day
 * rather than whenever payroll next opens the inbox -- a big overtime week, a
 * day somebody will query, a sheet that has to be approved before Friday.
 *
 * Accounts is on every one of them. That is the whole reason this is a fixed
 * list of routes instead of a free recipient field: the failure worth designing
 * out is a technician choosing "Matt" on a Tuesday and payroll never receiving
 * the week at all. There is a test below the line that no route can drop it.
 */
export type TimesheetRouteId = 'accounts' | 'accounts-matt' | 'accounts-lachlan';

export interface TimesheetRoute {
  id: TimesheetRouteId;
  /** The segment label. Short, because three of them share a handset's width. */
  short: string;
  /** What the send button says. */
  action: string;
  /** Who gets it, in words, for the screen's own sentences and its alerts. */
  who: string;
  /** Every address on the email. Accounts is always among them. */
  to: readonly string[];
}

export const TIMESHEET_ROUTES: readonly TimesheetRoute[] = [
  {
    id: 'accounts',
    short: 'Accounts',
    action: 'Email to accounts',
    who: 'accounts',
    to: [TIMESHEET_INBOX],
  },
  {
    id: 'accounts-matt',
    short: '+ Matt',
    action: 'Email accounts & Matt',
    who: 'accounts and Matt',
    to: [TIMESHEET_INBOX, TIMESHEET_MATT],
  },
  {
    id: 'accounts-lachlan',
    short: '+ Lachlan',
    action: 'Email accounts & Lachlan',
    who: 'accounts and Lachlan',
    to: [TIMESHEET_INBOX, TIMESHEET_LACHLAN],
  },
];

/**
 * The route an id names, or accounts alone.
 *
 * Falls back rather than throwing, and falls back to the narrowest route there
 * is. An id nobody recognises -- a stale choice, a typo, a value from a build
 * that had a fourth route -- must not silently copy somebody in on a week's pay.
 */
export function timesheetRoute(id: string | null | undefined): TimesheetRoute {
  const found = TIMESHEET_ROUTES.find((r) => r.id === id);
  // The first route is accounts alone, and the test below the line holds it there.
  return found ?? (TIMESHEET_ROUTES[0] as TimesheetRoute);
}

/** The addresses of a route as a person reads them: "a@x and b@x". */
export function routeAddresses(route: TimesheetRoute): string {
  const [first, ...rest] = route.to;
  if (!first) return TIMESHEET_INBOX;
  if (!rest.length) return first;
  return `${[first, ...rest.slice(0, -1)].join(', ')} and ${rest[rest.length - 1]}`;
}

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
      if (worked !== 0) {
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

      for (const extra of e.extras ?? []) bits.push(extra);

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
