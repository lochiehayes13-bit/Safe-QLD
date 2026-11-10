import { normaliseClock, spanProblem } from './scheduling';
import { typedDay } from './qldTime';

/** A booking or a move as typed on the schedule screen. */
export interface TypedSpan {
  date: string;
  start: string;
  end: string;
}

/**
 * The schedule screen's date and times, read.
 *
 * The date is typed the way the rest of the app takes one, dd/mm/yyyy (or
 * anything typedDay reads), and comes back as the ISO day the queue sends.
 * Times are 24-hour clock, normalised so 730 and 7:30 both mean 07:30.
 */
export function checkSpan(form: TypedSpan): TypedSpan | { why: string } {
  const date = typedDay(form.date);
  if (!date) return { why: 'Write the date as dd/mm/yyyy.' };
  const start = normaliseClock(form.start);
  const end = normaliseClock(form.end);
  if (!start || !end) return { why: 'Use 24-hour time, like 07:00.' };
  const problem = spanProblem({ date, start, end });
  return problem ? { why: problem } : { date, start, end };
}
