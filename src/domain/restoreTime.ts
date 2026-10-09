import {
  QLD_UTC_OFFSET_HOURS, qldClock, qldDay, qldIsoDay, typedClock, typedDay,
} from './qldTime';

/**
 * The expected back-in-service time on an impairment.
 *
 * It was a free-text box with "YYYY-MM-DD HH:MM" as its placeholder, so what
 * reached the notice was whatever was typed, and the notice printed it raw.
 * Now it is a date and a time read the way the rest of the app reads them
 * (typedDay, typedClock), turned into the UTC instant every other timestamp in
 * the database is, so the notice prints it in Queensland time like the others.
 */

const HOUR_MS = 3_600_000;
const QUARTER_MS = 15 * 60_000;

/** A Queensland calendar day and clock time as a UTC instant. */
export function qldInstant(day: string, clock: string): string | undefined {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const c = /^(\d{2}):(\d{2})$/.exec(clock);
  if (!d || !c) return undefined;
  const ms = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(c[1]), Number(c[2]))
    - QLD_UTC_OFFSET_HOURS * HOUR_MS;
  return new Date(ms).toISOString();
}

/** What was typed, read: an instant (or nothing, when both boxes are empty), or why not. */
export type RestoreRead = { at: string | undefined } | { why: string };

/**
 * Reads the date and time boxes.
 *
 * Both empty is allowed: the time is often not known when the system goes
 * down, and the notice says "Not yet known". One without the other is not,
 * and neither is a time that has already gone.
 */
export function readRestoreTime(dateText: string, timeText: string, nowMs: number): RestoreRead {
  const date = dateText.trim();
  const time = timeText.trim();
  if (!date && !time) return { at: undefined };

  const day = typedDay(date);
  if (!day) return { why: 'Write the date as dd/mm/yyyy.' };
  if (!time) return { why: 'Add a time, like 14:30.' };
  const clock = typedClock(time);
  if (!clock) return { why: 'Use 24-hour time, like 14:30.' };

  const at = qldInstant(day, clock);
  if (!at) return { why: 'Write the date as dd/mm/yyyy.' };
  if (Date.parse(at) <= nowMs) return { why: 'That time has passed.' };
  return { at };
}

/** A stored time put back into the two boxes, or empty boxes for one that isn't an instant. */
export function restoreBoxes(at: string | undefined): { date: string; time: string } {
  const date = qldDay(at);
  const time = qldClock(at);
  return date && time ? { date, time } : { date: '', time: '' };
}

/** One-tap choices that fill both boxes. */
export interface RestorePick {
  label: string;
  date: string;
  time: string;
}

/**
 * The usual answers: a couple of hours, half a day, first thing tomorrow.
 *
 * Rounded up to the quarter hour, because "back at 14:37" is a precision
 * nobody has.
 */
export function restorePicks(nowMs: number): RestorePick[] {
  const roundUp = (ms: number) => Math.ceil(ms / QUARTER_MS) * QUARTER_MS;
  const boxes = (ms: number) => restoreBoxes(new Date(ms).toISOString());
  const picks: RestorePick[] = [
    { label: 'In 2 hours', ...boxes(roundUp(nowMs + 2 * HOUR_MS)) },
    { label: 'In 4 hours', ...boxes(roundUp(nowMs + 4 * HOUR_MS)) },
  ];

  const today = qldIsoDay(new Date(nowMs).toISOString());
  if (today) {
    const [y, m, d] = today.split('-').map(Number);
    const next = new Date(Date.UTC(y!, m! - 1, d! + 1));
    const pad = (n: number) => String(n).padStart(2, '0');
    const tomorrow = `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
    const seven = qldInstant(tomorrow, '07:00');
    if (seven) picks.push({ label: 'Tomorrow 7 am', ...restoreBoxes(seven) });
  }
  return picks;
}
