import { qldInstant } from '@/domain/clockOn';
import type { BookPayload } from '@/domain/scheduling';

/**
 * Building a day, and putting it on the Simpro schedule.
 *
 * A technician picks the sites for a day in the order they mean to drive
 * them. Each site is sized from its asset register the way the month
 * planner sizes a visit, travel is charged between stops, and the day is
 * laid out from seven in the morning as back-to-back blocks. Every block
 * that has a Simpro job under it becomes one schedule booking, through the
 * same path the calendar screen already uses — read the office first, post
 * one block, hold it a minute so it can be taken back.
 *
 * Two honesties in the layout. A site with no open Simpro job is laid out
 * like any other so the day's total is right, but it is marked not bookable
 * and says why: the office has to raise a job before a block can exist. And
 * an estimate is an estimate — the day says how many hours it is over the
 * end of the shift rather than squeezing the last site into fifteen minutes.
 */

export interface DaySite {
  siteId: string;
  siteName: string;
  /** From the estimate engine, or a figure the technician typed over it. */
  estimateHours: number;
  /** The Simpro job the block would go on, where the site has one. */
  job?: { externalId: string; title?: string };
}

export interface DayStop extends DaySite {
  order: number;
  start: string;
  end: string;
  /** Minutes charged for getting here from the previous stop. */
  travelMinutes: number;
  bookable: boolean;
  /** Why it cannot go on the schedule, where it cannot. */
  why?: string;
  /**
   * Set where the stop had to move because the office already has this
   * person somewhere else at that hour. The words the screen prints.
   */
  pushedBy?: string;
}

/**
 * Something already on this person's calendar that day.
 *
 * The office books work too, and a day builder that lays a fresh day from
 * seven o'clock over the top of it produces a technician double-booked at
 * eight, on somebody else's job, with nothing on either screen saying so.
 */
export interface BusyBlock {
  start: string;
  end: string;
  /** What it is, for the line that says why the day starts at nine. */
  label: string;
}

export interface DayLayout {
  stops: DayStop[];
  totalHours: number;
  /** Hours past the end of the shift, zero when it fits. */
  overrunHours: number;
  endsAt?: string;
}

export const DAY_START = '07:00';
export const DAY_END = '15:30';
/** Charged between stops. Brisbane traffic, not a figure from anywhere. */
export const DEFAULT_TRAVEL_MINUTES = 20;
/** Shorter than this and a block is a tap on the calendar nobody can read. */
export const MIN_BLOCK_MINUTES = 15;

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

function toMinutes(clock: string): number | undefined {
  const m = clock.match(CLOCK);
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}

function toClock(minutes: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Rounded to the quarter hour the calendar draws in, never below the minimum. */
export function blockMinutes(estimateHours: number): number {
  if (!Number.isFinite(estimateHours) || estimateHours <= 0) return MIN_BLOCK_MINUTES;
  return Math.max(MIN_BLOCK_MINUTES, Math.round((estimateHours * 60) / 15) * 15);
}

/**
 * Lays the day out around what is already booked.
 *
 * The busy blocks come from the office's own calendar for this person on
 * this day. A stop that would land on top of one is moved to after it,
 * rather than being drawn over it: the calendar is the office's, the day
 * being built is a proposal, and the proposal loses.
 */
export function layOutDay(
  sites: readonly DaySite[],
  options: { start?: string; end?: string; travelMinutes?: number; busy?: readonly BusyBlock[] } = {},
): DayLayout {
  const startAt = toMinutes(options.start ?? DAY_START) ?? toMinutes(DAY_START)!;
  const endAt = toMinutes(options.end ?? DAY_END) ?? toMinutes(DAY_END)!;
  const travel = Math.max(0, options.travelMinutes ?? DEFAULT_TRAVEL_MINUTES);
  const busy = (options.busy ?? [])
    .map((b) => ({ from: toMinutes(b.start), to: toMinutes(b.end), label: b.label }))
    .filter((b): b is { from: number; to: number; label: string } => b.from !== undefined && b.to !== undefined && b.to > b.from)
    .sort((a, b) => a.from - b.from);

  /** Pushes past every block the given span would land on, and says which. */
  const clear = (from: number, minutes: number): { from: number; pushedBy?: string } => {
    let at = from;
    let pushedBy: string | undefined;
    // Repeated because clearing one block can land on the next.
    for (let pass = 0; pass < busy.length + 1; pass += 1) {
      const hit = busy.find((b) => at < b.to && at + minutes > b.from);
      if (!hit) break;
      at = hit.to;
      pushedBy = hit.label;
    }
    return { from: at, pushedBy };
  };

  let cursor = startAt;
  const stops: DayStop[] = sites.map((site, i) => {
    const travelMinutes = i === 0 ? 0 : travel;
    cursor += travelMinutes;
    const minutes = blockMinutes(site.estimateHours);
    const cleared = clear(cursor, minutes);
    cursor = cleared.from;
    const start = toClock(cursor);
    cursor += minutes;
    const end = toClock(cursor);
    const bookable = Boolean(site.job?.externalId);
    return {
      ...site,
      order: i + 1,
      start,
      end,
      travelMinutes,
      bookable,
      why: bookable ? undefined : 'No open Simpro job at this site, so there is no schedule to put a block on. Ask the office to raise one.',
      pushedBy: cleared.pushedBy,
    };
  });

  const totalMinutes = stops.length ? cursor - startAt : 0;
  const overrun = Math.max(0, cursor - endAt);
  return {
    stops,
    totalHours: Math.round((totalMinutes / 60) * 4) / 4,
    overrunHours: stops.length ? Math.round((overrun / 60) * 4) / 4 : 0,
    endsAt: stops.length ? toClock(cursor) : undefined,
  };
}

/** Moves one stop earlier or later; the layout is recomputed by the caller. */
export function moveStop<T>(list: readonly T[], index: number, direction: -1 | 1): T[] {
  const to = index + direction;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const out = [...list];
  const [item] = out.splice(index, 1);
  out.splice(to, 0, item!);
  return out;
}

export interface BookingPlan {
  /** One payload per bookable stop, in day order — each its own schedule record. */
  payloads: (Omit<BookPayload, 'sectionId' | 'costCenterId'> & { siteId: string; jobTitle?: string })[];
  /** Stops left off, with why. */
  skipped: { stop: DayStop; why: string }[];
}

/**
 * The bookings a laid-out day turns into, minus the cost centre.
 *
 * The section and cost centre are the one thing the layout cannot know:
 * they are read off the job's mirror at booking time, and a job with more
 * than one is a question for the screen. Everything else — who, which job,
 * which day, which minutes, and the moment before which it can be taken
 * back — is decided here, once, so every block of the day carries the same
 * undo window.
 */
export function bookingsFor(
  layout: DayLayout,
  input: { employeeId: string; date: string; notBefore: string },
): BookingPlan {
  const payloads: BookingPlan['payloads'] = [];
  const skipped: BookingPlan['skipped'] = [];
  const validDay = Boolean(qldInstant(input.date, '00:00'));
  for (const stop of layout.stops) {
    if (!stop.bookable || !stop.job) {
      skipped.push({ stop, why: stop.why ?? 'No job.' });
      continue;
    }
    if (!/^\d+$/.test(input.employeeId.trim())) {
      skipped.push({ stop, why: 'This phone is not signed in as a Simpro employee.' });
      continue;
    }
    if (!validDay) {
      skipped.push({ stop, why: 'The day is not one the app can read.' });
      continue;
    }
    payloads.push({
      employeeId: input.employeeId.trim(),
      jobId: stop.job.externalId,
      jobTitle: stop.job.title,
      siteId: stop.siteId,
      siteName: stop.siteName,
      date: input.date,
      start: stop.start,
      end: stop.end,
      notBefore: input.notBefore,
    });
  }
  return { payloads, skipped };
}

/** "3 stops, 6.5 h, finishing 14:10" */
export function dayHeadline(layout: DayLayout): string {
  if (!layout.stops.length) return 'Nothing on the day yet';
  const stops = `${layout.stops.length} stop${layout.stops.length === 1 ? '' : 's'}`;
  const over = layout.overrunHours ? `, ${layout.overrunHours} h past the end of the shift` : '';
  return `${stops}, ${layout.totalHours} h, finishing about ${layout.endsAt}${over}`;
}
