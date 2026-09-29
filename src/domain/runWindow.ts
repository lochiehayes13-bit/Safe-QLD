/**
 * Which recorded work belongs to which attendance.
 *
 * A routine run carries the instant it was recorded. The asset events and the
 * defects it produced carry the instants they happened. Nothing joins them: the
 * routine screen writes an event per asset and a run row at the end, and no
 * foreign key ties the two together.
 *
 * So attribution is by time, and the width of the window is the whole decision.
 * Matching on "same site, same day" is the obvious rule and it is wrong in the
 * direction that costs money: a call-out at eight in the morning and an annual
 * that afternoon are the same site on the same day, and sweeping the call-out's
 * six results into the annual reports a service that covered six assets it
 * never touched. The office invoices the annual on that count.
 *
 * Six hours is narrow enough that two attendances rarely fall inside it and
 * wide enough to hold a full day's routine — a technician who starts at eight
 * and records the run at four has events five hours either side of nothing in
 * particular, because the run is recorded at the end rather than the middle.
 * That asymmetry is why the window is centred on the run and counted both ways
 * rather than looked backwards only.
 *
 * This lives outside the database layer on purpose. It is the one judgement in
 * gathering a service record, and a judgement that needs a database to exercise
 * is a judgement nobody checks.
 */

/**
 * How far either side of a run an event is treated as part of it.
 *
 * Changing this changes which assets appear on a service note that goes to the
 * office, so it is a number with a reason rather than a tuning knob.
 */
export const RUN_WINDOW_HOURS = 6;

const HOUR_MS = 3_600_000;

/** Parses an instant, refusing what it cannot read rather than returning zero. */
export function instant(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso.trim());
  return Number.isFinite(ms) ? ms : undefined;
}

export interface RunWindow {
  /** ISO instant, inclusive. */
  from: string;
  /** ISO instant, inclusive. */
  to: string;
}

/**
 * The window around a run, or nothing where the run has no readable time.
 *
 * Returning undefined rather than a window around the epoch matters: a window
 * around 1970 quietly matches no events and reports a service with no results,
 * which the mapping then declines with "nothing recorded" — a true statement
 * about the wrong problem, and one nobody can act on.
 */
export function runWindow(completedAt: string | undefined, hours = RUN_WINDOW_HOURS): RunWindow | undefined {
  const centre = instant(completedAt);
  if (centre === undefined) return undefined;
  const span = hours * HOUR_MS;
  return {
    from: new Date(centre - span).toISOString(),
    to: new Date(centre + span).toISOString(),
  };
}

/**
 * Whether one recorded moment belongs to a run.
 *
 * Inclusive at both edges. An event exactly on the boundary is kept, because
 * excluding it drops a real result from a service note, and the cost of the
 * two errors is not symmetric: an asset wrongly included is visible on the note
 * and gets queried, an asset wrongly dropped is a coverage gap nobody sees.
 */
export function belongsToRun(
  occurredAt: string | undefined,
  completedAt: string | undefined,
  hours = RUN_WINDOW_HOURS,
): boolean {
  const at = instant(occurredAt);
  const centre = instant(completedAt);
  if (at === undefined || centre === undefined) return false;
  return Math.abs(at - centre) <= hours * HOUR_MS;
}

/**
 * Keeps the last qualifying entry per subject.
 *
 * A check re-run after a repair should report as it finished rather than as it
 * first failed, so the latest wins. Entries are compared on their own instants
 * rather than trusting the order they arrived in, because a query ordered by a
 * text timestamp and a list built in memory do not always agree.
 */
export function latestPerSubject<T>(
  rows: readonly T[],
  subjectOf: (row: T) => string,
  atOf: (row: T) => string | undefined,
): T[] {
  const best = new Map<string, { row: T; at: number }>();
  for (const row of rows) {
    const at = instant(atOf(row));
    if (at === undefined) continue;
    const subject = subjectOf(row);
    const existing = best.get(subject);
    if (!existing || at >= existing.at) best.set(subject, { row, at });
  }
  return [...best.values()].map((v) => v.row);
}
