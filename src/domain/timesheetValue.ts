/**
 * What a week's attendances are worth at the charge-out rates.
 *
 * A timesheet is a payroll document — it records what a technician worked, not
 * what a client is billed. The two are not the same number and must not be
 * confused. What this adds is the other half: the same site visits priced at
 * the rate card, so a technician can see whether a week of work is worth what
 * it cost before the invoice run says so a month later.
 *
 * Everything here is an estimate and says so. The office system raises the
 * invoice; contract visits, variations and agreed caps are not visible from a
 * timesheet, so this is a sense-check and never a quote.
 */

import {
  chargeForAttendance, type AttendanceCharge, type HoursBand, type LabourRate, type ServiceFee,
} from './rates';
import { entryHours, parseTime, type HourKind, type Timesheet, type TimesheetEntry } from './timesheet';

/** Ordinary business hours, in minutes since midnight. */
const DAY_START = 7 * 60;
const DAY_END = 17 * 60;

/**
 * Which band an entry falls in.
 *
 * The hour kind the technician chose wins: overtime and double time are the
 * payroll side of the same fact, and the technician knows whether the job was
 * booked after hours better than a clock does. Where it is ordinary time, the
 * start time decides — an ordinary-time entry starting at 04:00 is an
 * after-hours attendance whatever the payroll bucket says.
 */
export function bandFor(entry: TimesheetEntry): HoursBand {
  const kind: HourKind = entry.hourKind;
  if (kind === 'ot' || kind === 'dt') return 'after-hours';
  const start = parseTime(entry.startTime);
  if (start === null) return 'normal';
  return start < DAY_START || start >= DAY_END ? 'after-hours' : 'normal';
}

export interface EntryValue {
  entryId: string;
  date: string;
  siteName: string;
  jobNumber: string;
  hours: number;
  band: HoursBand;
  charge: AttendanceCharge;
}

export interface TimesheetValue {
  entries: EntryValue[];
  /** Excluding GST. */
  subtotalCents: number;
  gstCents: number;
  totalCents: number;
  /** Worked hours that produced these figures. */
  hours: number;
  /** Entries with hours but no site name, which cannot be an attendance. */
  unattributed: number;
  warnings: string[];
}

export interface ValueOptions {
  rates: LabourRate[];
  fees: ServiceFee[];
  /**
   * Charge the attendance fee per entry. Off where the week is contract work
   * already covered by a service agreement, which is most routine servicing.
   */
  chargeAttendance?: boolean;
}

/**
 * Prices each attendance on the sheet.
 *
 * One entry is one attendance: the sheet is filled in per site visit, so a
 * technician who returned to the same site twice in a day is charged two
 * attendances, which is what actually happened.
 *
 * Leave is not an attendance and is skipped — pricing a sick day at the
 * charge-out rate would be nonsense.
 */
export function valueTimesheet(sheet: Timesheet, opts: ValueOptions): TimesheetValue {
  const entries: EntryValue[] = [];
  const warnings = new Set<string>();
  let unattributed = 0;
  let hours = 0;

  for (const e of sheet.entries) {
    const h = entryHours(e);
    if (h <= 0) continue;
    if (!e.siteName.trim() && !e.jobNumber.trim()) {
      unattributed += 1;
      continue;
    }
    const band = bandFor(e);
    const charge = chargeForAttendance({
      minutesOnSite: Math.round(h * 60),
      hours: band,
      rates: opts.rates,
      fees: opts.fees,
      chargeAttendance: opts.chargeAttendance,
    });
    for (const w of charge.warnings) warnings.add(w);
    hours += h;
    entries.push({
      entryId: e.id,
      date: e.date,
      siteName: e.siteName.trim(),
      jobNumber: e.jobNumber.trim(),
      hours: h,
      band,
      charge,
    });
  }

  if (unattributed > 0) {
    warnings.add(
      `${unattributed} entr${unattributed === 1 ? 'y has' : 'ies have'} hours but no site or job number, ` +
      'so there is nothing to attribute the value to.',
    );
  }

  const subtotalCents = entries.reduce((n, v) => n + v.charge.subtotalCents, 0);
  const gstCents = entries.reduce((n, v) => n + v.charge.gstCents, 0);

  return {
    entries,
    subtotalCents,
    gstCents,
    totalCents: subtotalCents + gstCents,
    hours: Math.round(hours * 100) / 100,
    unattributed,
    warnings: [...warnings],
  };
}
