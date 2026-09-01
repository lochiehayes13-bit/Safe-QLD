import {
  frequencySpec, scheduledDate, toleranceWindow,
  type Frequency as ComplianceFrequency,
} from '@/domain/qldCompliance';
import type { Frequency as RoutineFrequency } from '@/seed/serviceRoutines';

/**
 * What is due, and when.
 *
 * The scheduling rules already exist and are tested; nothing used them, so the
 * app could record that a routine was carried out and never say when the next
 * one falls. This joins the two.
 *
 * The important rule it inherits: a schedule is anchored to the first service,
 * never to the last one. Scheduling from the last completion lets drift
 * accumulate — a service done three weeks late becomes the new baseline, and
 * the system reports compliance while sliding steadily out of tolerance.
 */

/**
 * The routine vocabulary and the compliance vocabulary are not the same list.
 *
 * Routines are named the way technicians talk ("annual"); the standard's
 * schedule tables use its own ("yearly"). Two routine frequencies have no
 * schedule table behind them at all, and those return null rather than being
 * quietly mapped to the nearest thing — a quarterly routine given a yearly
 * tolerance would report compliance it has no basis for.
 */
export function complianceFrequency(f: RoutineFrequency): ComplianceFrequency | null {
  switch (f) {
    case 'monthly': return 'monthly';
    case 'six-monthly': return 'six-monthly';
    case 'annual': return 'yearly';
    case 'five-yearly': return 'five-yearly';
    case 'ten-yearly': return 'ten-yearly';
    // A commissioning activity happens once and is not scheduled again; a
    // quarterly routine is a Safe QLD interval with no Section 6 table behind
    // it. Neither has a tolerance this can assert.
    case 'commissioning':
    case 'quarterly':
    default:
      return null;
  }
}

export type DueState =
  | 'never-done'      // no record of this routine at this site
  | 'not-scheduled'   // no schedule table applies to this frequency
  | 'upcoming'        // due, but not yet inside the tolerance window
  | 'due'             // inside the tolerance window now
  | 'overdue';        // past the end of the tolerance window

export interface RoutineDue {
  routineId: string;
  frequency: RoutineFrequency;
  state: DueState;
  /** The date this occurrence is scheduled for, anchored to the first service. */
  scheduledFor?: string;
  /** Earliest and latest date it may be carried out and still be in tolerance. */
  window?: { earliest: string; latest: string };
  /** Negative when overdue, so "5 days late" and "5 days away" share arithmetic. */
  daysUntilDue?: number;
  /** When this routine was last carried out here. */
  lastCompletedAt?: string;
  /** How many times it has been carried out here. */
  completedCount: number;
}

function daysBetween(fromIso: string, toIso: string): number | null {
  const from = new Date(`${fromIso.slice(0, 10)}T00:00:00Z`).getTime();
  const to = new Date(`${toIso.slice(0, 10)}T00:00:00Z`).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

export interface RoutineHistory {
  routineId: string;
  frequency: RoutineFrequency;
  /** Earliest completion recorded here — the anchor the schedule counts from. */
  firstCompletedAt?: string;
  lastCompletedAt?: string;
  completedCount: number;
}

/**
 * Works out where a routine stands at one site.
 *
 * The next occurrence is counted from the anchor, not from the last service, so
 * a run that happened late does not move the schedule. That means a site three
 * weeks late on its annual is still due on the original anniversary, which is
 * the point.
 */
export function routineDue(history: RoutineHistory, todayIso: string): RoutineDue {
  const base: RoutineDue = {
    routineId: history.routineId,
    frequency: history.frequency,
    state: 'never-done',
    lastCompletedAt: history.lastCompletedAt,
    completedCount: history.completedCount,
  };

  const frequency = complianceFrequency(history.frequency);
  if (!frequency || !frequencySpec(frequency)) {
    return { ...base, state: 'not-scheduled' };
  }

  if (!history.firstCompletedAt || history.completedCount === 0) {
    return base;
  }

  // Occurrence 0 is the anchor itself, so the next one due is the count of
  // services already carried out.
  const scheduledFor = scheduledDate(history.firstCompletedAt, frequency, history.completedCount);
  if (!scheduledFor) return { ...base, state: 'not-scheduled' };

  const window = toleranceWindow(scheduledFor, frequency) ?? undefined;
  const today = todayIso.slice(0, 10);
  const daysUntilDue = daysBetween(today, scheduledFor) ?? undefined;

  let state: DueState = 'upcoming';
  if (window) {
    if (today > window.latest) state = 'overdue';
    else if (today >= window.earliest) state = 'due';
  } else if (daysUntilDue !== undefined && daysUntilDue < 0) {
    state = 'overdue';
  }

  return { ...base, state, scheduledFor, window, daysUntilDue };
}

/** Overdue first, then what is due soonest. Anything unschedulable sinks. */
export const DUE_ORDER: Record<DueState, number> = {
  overdue: 0, due: 1, 'never-done': 2, upcoming: 3, 'not-scheduled': 4,
};

export function sortByUrgency(items: RoutineDue[]): RoutineDue[] {
  return [...items].sort(
    (a, b) =>
      DUE_ORDER[a.state] - DUE_ORDER[b.state] ||
      (a.daysUntilDue ?? Number.POSITIVE_INFINITY) - (b.daysUntilDue ?? Number.POSITIVE_INFINITY) ||
      a.routineId.localeCompare(b.routineId),
  );
}

export const DUE_LABEL: Record<DueState, string> = {
  overdue: 'Overdue',
  due: 'Due now',
  'never-done': 'Never recorded',
  upcoming: 'Upcoming',
  'not-scheduled': 'No schedule',
};
