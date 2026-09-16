import { qldInstant, type ClockEntry } from '@/domain/clockOn';

/**
 * A day off, booked straight onto the Simpro schedule.
 *
 * The old screen emailed a request to the supervisor and copied accounts,
 * and then somebody in the office typed it into Simpro as an activity so it
 * showed on the roster. The email was the slow half of that. Now the phone
 * writes the activity itself — Annual Leave, RDO, Sick, Unpaid — as a block
 * on the person's own schedule from seven to three, which is what Simpro
 * Mobile shows for the day and what the roster reads.
 *
 * It rides on the clock. A clock entry of kind `activity` already goes up as
 * an activity schedule, is read back before it is written so a retry cannot
 * post the day twice, and sits on Waiting to send until the office has it.
 * A day of leave is exactly that entry with a date in the future and the
 * office's leave activity on it, so nothing new has to be sent, and the
 * whole path that was verified against the live build carries it.
 *
 * The activity ids are the office's own, read off `setup/activities` by the
 * sync and matched here by name. Nothing is pinned in code: an office that
 * renames "RDO" to "Rostered day off" still matches, and one that has no
 * unpaid leave activity is told so rather than sent a guess.
 */

/** The day, as Simpro Mobile shows it. */
export const LEAVE_START = '07:00';
export const LEAVE_END = '15:00';

export type LeaveKindId = 'annual' | 'rdo' | 'sick' | 'unpaid';

export interface LeaveKind {
  id: LeaveKindId;
  label: string;
  /** What the office's activity is called, near enough. */
  match: RegExp;
}

export const LEAVE_KINDS: readonly LeaveKind[] = [
  { id: 'annual', label: 'Annual leave', match: /annual/i },
  { id: 'rdo', label: 'RDO', match: /\brdo\b|rostered day/i },
  { id: 'sick', label: 'Sick / personal', match: /sick|personal|carer/i },
  { id: 'unpaid', label: 'Unpaid leave', match: /unpaid|lwop|without pay/i },
];

/**
 * The timesheet's word for a day off, in the booking module's vocabulary.
 *
 * The sheet has five columns — sick, RDO, annual, LWOP and public holiday —
 * and only four of them are a day a technician books. A public holiday is
 * the office's to set: nobody applies for Anzac Day, and putting one on the
 * schedule as though it were leave would have it counted twice.
 */
export function bookableLeaveKind(sheetColumn: string): LeaveKind | undefined {
  switch (sheetColumn) {
    case 'annual': return leaveKind('annual');
    case 'rdo': return leaveKind('rdo');
    case 'sick': return leaveKind('sick');
    case 'lwop': return leaveKind('unpaid');
    default: return undefined;
  }
}

export function leaveKind(id: string): LeaveKind | undefined {
  return LEAVE_KINDS.find((k) => k.id === id);
}

export interface OfficeActivity { id: string; name: string }

/**
 * The office's activity for a kind of leave, or nothing.
 *
 * The first activity whose name matches, in the office's own order. An
 * office with "Sick / Personal Leave" and "Personal Leave (Carer)" both
 * would match the first; if that is ever wrong the fix is to say so here
 * rather than to pin an id.
 */
export function leaveActivityFor(kind: LeaveKind, activities: readonly OfficeActivity[]): OfficeActivity | undefined {
  return activities.find((a) => kind.match.test(a.name));
}

/** Whether an entry on the phone is a day of leave rather than a day of work. */
export function isLeaveEntry(e: Pick<ClockEntry, 'kind' | 'activityName'>): boolean {
  return e.kind === 'activity' && LEAVE_KINDS.some((k) => k.match.test(e.activityName ?? ''));
}

export function leaveKindOfEntry(e: Pick<ClockEntry, 'kind' | 'activityName'>): LeaveKind | undefined {
  if (e.kind !== 'activity') return undefined;
  return LEAVE_KINDS.find((k) => k.match.test(e.activityName ?? ''));
}

export interface LeaveInput {
  id: string;
  employeeId: string;
  /** The Queensland day, yyyy-mm-dd. */
  date: string;
  kind: LeaveKind;
  activity: OfficeActivity;
  note?: string;
}

export type LeaveBuild = { entry: ClockEntry } | { refused: string };

/**
 * The clock entry a day of leave is sent as.
 *
 * Closed from the start — seven to three — so the clock's own readiness
 * check passes it and its send path carries it. The date has to be a real
 * day and the employee a Simpro id, and both refusals are in words a person
 * can act on, because the screen shows them.
 */
export function buildLeaveEntry(input: LeaveInput): LeaveBuild {
  if (!/^\d+$/.test(input.employeeId.trim())) {
    return { refused: 'This phone is not signed in as a Simpro employee yet, so the day cannot be put on anybody\'s schedule.' };
  }
  const startedAt = qldInstant(input.date, LEAVE_START);
  const endedAt = qldInstant(input.date, LEAVE_END);
  if (!startedAt || !endedAt) return { refused: 'That is not a day the app can read.' };
  if (!/^\d+$/.test(input.activity.id)) return { refused: `The office's "${input.activity.name}" activity has no id the schedule accepts.` };

  const note = (input.note ?? '').trim();
  return {
    entry: {
      id: input.id,
      employeeExternalId: input.employeeId.trim(),
      kind: 'activity',
      activityExternalId: input.activity.id,
      activityName: input.activity.name,
      date: input.date,
      startedAt,
      endedAt,
      note: note || undefined,
    },
  };
}

/**
 * The days offered as chips: the next few weeks of working days.
 *
 * Weekends are left out of the chips rather than refused — a Saturday of
 * leave is rare and can be typed — because the chips are for the common
 * case, and the common case is "Friday off".
 */
export function upcomingWorkingDays(fromDay: string, weeks = 4): string[] {
  const out: string[] = [];
  const d = new Date(`${fromDay}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return out;
  for (let i = 0; i < weeks * 7; i++) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Reads a typed day: 7/9/2026, 7-9-26, 2026-09-07. */
export function parseLeaveDay(text: string): string | undefined {
  const s = text.trim();
  if (!s) return undefined;
  let y: number; let m: number; let day: number;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const au = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (iso) { y = Number(iso[1]); m = Number(iso[2]); day = Number(iso[3]); }
  else if (au) { day = Number(au[1]); m = Number(au[2]); y = Number(au[3]); if (y < 100) y += 2000; }
  else return undefined;
  const d = new Date(Date.UTC(y, m - 1, day, 12));
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== m - 1 || d.getUTCDate() !== day) return undefined;
  return d.toISOString().slice(0, 10);
}

/** A booking already on the day, on the phone or at the office. */
export interface ExistingLeave {
  date: string;
  activityName?: string;
  /** Where it is: still on this phone, or already on the office's schedule. */
  where: 'phone' | 'office';
}

/**
 * Why a day cannot be booked again, or nothing.
 *
 * The office's own copy of the schedule wins: a day the roster already
 * shows as leave is booked, whichever phone did it, and posting it again
 * would be answered as a duplicate at send time anyway — better to say so
 * before the tap than after.
 */
export function alreadyBooked(date: string, existing: readonly ExistingLeave[]): string | undefined {
  const hit = existing.find((e) => e.date === date);
  if (!hit) return undefined;
  const what = hit.activityName ? `${hit.activityName}` : 'leave';
  return hit.where === 'office'
    ? `${what} is already on your Simpro schedule for that day.`
    : `${what} is already booked for that day and waiting to send.`;
}
