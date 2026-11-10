import { qldDay, typedDay } from './qldTime';

/**
 * A date box that takes dd/mm/yyyy and stores the ISO day.
 *
 * The boxes on the test sheet, the occupier statement and the baseline record
 * asked for YYYY-MM-DD, which nobody here writes. They now show dd/mm/yyyy and
 * read whatever typedDay reads (9/10/2026, 09.10.26, 09102026 straight off a
 * keypad), and store the ISO day the records and documents already use.
 *
 * A half-typed date is never stored: the screen keeps the text and stores only
 * once it reads as a day, or once the box is emptied.
 */

/** A stored day, or an instant, as it goes in the box. A value that is not a date is shown as it is. */
export function dayBox(stored: string | null | undefined): string {
  if (!stored) return '';
  return qldDay(stored) ?? stored;
}

export type DayRead =
  /** Reads as a day: store this ISO day. */
  | { day: string }
  /** The box is empty: clear the stored value. */
  | { day: null }
  /** Not a date yet: keep the text, store nothing, show why. */
  | { why: string };

export const DAY_HINT = 'Write it as dd/mm/yyyy.';

/** Reads what is in the box. */
export function readDayBox(text: string): DayRead {
  if (!text.trim()) return { day: null };
  const day = typedDay(text);
  return day ? { day } : { why: DAY_HINT };
}
