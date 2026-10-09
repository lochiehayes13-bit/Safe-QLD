import { addDays } from './clockOn';
import { alreadyBooked, type ExistingLeave } from './leaveBooking';

/**
 * A run of days off, booked in one go.
 *
 * Each day is still its own booking underneath: one clock entry, one queue
 * row, one activity block on the Simpro schedule, exactly as a single day is
 * booked. What this adds is the run: the weekdays between two dates, weekends
 * skipped, and each day checked against what is already booked the same way
 * a single day is, so a week that already has a Wednesday RDO books the other
 * four and says which one it left out.
 */

/** The most weekdays one booking covers: about three months. A slip in the year should not book a year. */
export const MAX_LEAVE_DAYS = 65;

/** What has been picked so far: a first day, and a last day where it is a run. */
export interface LeavePick {
  from?: string;
  to?: string;
}

function isWeekend(day: string): boolean {
  const d = new Date(`${day}T12:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
}

/**
 * The days a pick books.
 *
 * One day is booked as picked, a Saturday included, as it always was. A run
 * is its weekdays only: nobody takes annual leave on a Sunday, and an activity
 * block on one would be read as leave the person did not ask for.
 */
export function leaveDays(from: string, to?: string): { days: string[] } | { refused: string } {
  if (!to || to === from) return { days: [from] };
  if (to < from) return { refused: 'The last day is before the first.' };
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (isWeekend(d)) continue;
    days.push(d);
    if (days.length > MAX_LEAVE_DAYS) return { refused: `That's over ${MAX_LEAVE_DAYS} working days. Book it in parts.` };
  }
  if (!days.length) return { refused: 'No weekdays in that range.' };
  return { days };
}

export interface LeavePlan {
  /** The days that will be booked, oldest first. */
  book: string[];
  /** Days in the run already booked, on the phone or in Simpro. Left out, not booked twice. */
  skipped: string[];
  /** Why nothing can be booked, where nothing can. */
  refused?: string;
}

/**
 * What booking a pick would do: which days go, which are already booked.
 *
 * The clash check is the single day's own, `alreadyBooked`, asked once a day.
 * A single day that clashes is refused in its words; a run books what is free
 * and is refused only when nothing is.
 */
export function planLeave(pick: { from: string; to?: string }, today: string, existing: readonly ExistingLeave[]): LeavePlan {
  const range = leaveDays(pick.from, pick.to);
  if ('refused' in range) return { book: [], skipped: [], refused: range.refused };
  if (today && pick.from < today) return { book: [], skipped: [], refused: 'That day has passed. Ask the office.' };
  const book: string[] = [];
  const skipped: string[] = [];
  for (const day of range.days) (alreadyBooked(day, existing) ? skipped : book).push(day);
  if (!book.length) {
    return {
      book,
      skipped,
      refused: range.days.length === 1 ? alreadyBooked(range.days[0]!, existing) : 'Every day in that range is already booked.',
    };
  }
  return { book, skipped };
}

/**
 * The pick after a day chip is tapped.
 *
 * The first tap is the first day. A later day tapped next makes it a run; an
 * earlier one starts again from there. Tapping the same day again clears it,
 * and any tap after a run is finished starts a new pick.
 */
export function tapLeaveDay(pick: LeavePick, day: string): LeavePick {
  if (!pick.from || pick.to) return { from: day };
  if (day === pick.from) return {};
  if (day < pick.from) return { from: day };
  return { from: pick.from, to: day };
}
