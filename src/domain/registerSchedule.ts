import { FREQUENCY_LABEL, type Frequency } from '@/seed/serviceRoutines';
import { qldIsoDay } from '@/domain/qldTime';

/**
 * What the register says is next due on one asset, routine by routine.
 *
 * The register carries a column per routine — 6 Monthly, Yearly, 5 Yearly —
 * and the importer writes one row per routine into `asset_schedule` for exactly
 * that reason: an extinguisher is due six-monthly, yearly and five-yearly on
 * three different dates, and the single `nextDueAt` on the asset row can only
 * hold the soonest of them.
 *
 * Thirty-one thousand of those rows went in on the real import and nothing ever
 * read one. The table was created, indexed on `nextDueAt` for a query nobody
 * wrote, and filled on every re-import; the asset screen showed the collapsed
 * date and the technician standing in front of the extinguisher had no way to
 * find out whether it was the six-monthly that was due or the pressure test.
 *
 * Those are not the same job. One is a look and a tag; the other takes the
 * extinguisher off site.
 *
 * ---
 *
 * The register states a date rather than describing a window, so the reading
 * here is deliberately flat: before today is overdue, today is due, after is
 * upcoming. No tolerance is applied, because a tolerance belongs to a schedule
 * counted from an anchor and this is the office's own answer, not a derived
 * one. Applying one here would quietly disagree with the source system.
 */

export type RegisterDueState = 'overdue' | 'due' | 'upcoming' | 'unscheduled';

export interface RegisterScheduleRow {
  frequency: Frequency;
  nextDueAt?: string | null;
  lastDoneAt?: string | null;
  /** How much of the last-done date the source actually recorded. */
  lastDonePrecision?: string | null;
  /** Exactly what the source's cell said, because the parse is lossy. */
  lastDoneRaw?: string | null;
}

export interface RegisterScheduleLine {
  frequency: Frequency;
  label: string;
  nextDueAt?: string;
  state: RegisterDueState;
  /** Negative when the date has gone. Absent where there is no date. */
  daysUntil?: number;
  /**
   * What the register recorded for the last one, as it recorded it.
   *
   * Kept as the source's own text rather than a formatted date. A five-yearly
   * recorded as "Jun-25" knows no day, and printing "01/06/2025" against it
   * invents one — on the routine where the next occurrence is five years out
   * and a month of drift compounds.
   */
  lastDone?: string;
  /** True where the last-done is a month or a year rather than a day. */
  lastDoneImprecise: boolean;
}

const ORDER: RegisterDueState[] = ['overdue', 'due', 'upcoming', 'unscheduled'];

function daysBetween(fromDay: string, toDay: string): number | undefined {
  const from = Date.parse(`${fromDay}T00:00:00Z`);
  const to = Date.parse(`${toDay}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return undefined;
  return Math.round((to - from) / 86_400_000);
}

/**
 * The register's schedule for one asset, soonest first.
 *
 * `asAt` is an instant or a calendar day; the comparison is made on the
 * Queensland day either way, because a routine falling due today reads as
 * overdue on any morning where the two disagree.
 */
export function registerScheduleLines(
  rows: readonly RegisterScheduleRow[],
  asAt: string,
): RegisterScheduleLine[] {
  const today = qldIsoDay(asAt);

  const lines = rows.map((row): RegisterScheduleLine => {
    const nextDueAt = qldIsoDay(row.nextDueAt ?? undefined);
    const precision = row.lastDonePrecision ?? undefined;
    const lastDone = row.lastDoneRaw?.trim() || qldIsoDay(row.lastDoneAt ?? undefined);

    let state: RegisterDueState = 'unscheduled';
    let daysUntil: number | undefined;
    if (nextDueAt && today) {
      daysUntil = daysBetween(today, nextDueAt);
      state = nextDueAt < today ? 'overdue' : nextDueAt === today ? 'due' : 'upcoming';
    } else if (nextDueAt) {
      // A date the register knows against a day this app could not read. The
      // date is still worth showing; the judgement is not made up.
      state = 'upcoming';
    }

    return {
      frequency: row.frequency,
      label: FREQUENCY_LABEL[row.frequency] ?? row.frequency,
      nextDueAt,
      state,
      daysUntil,
      lastDone: lastDone || undefined,
      lastDoneImprecise: precision === 'month' || precision === 'year',
    };
  });

  // Soonest first, and within a date the longer interval last: a five-yearly
  // and a six-monthly falling on the same day is the register's way of saying
  // they are done in one visit, and the bigger job is the one being planned
  // around.
  return lines.sort((a, b) => {
    const byState = ORDER.indexOf(a.state) - ORDER.indexOf(b.state);
    if (byState) return byState;
    const byDate = (a.nextDueAt ?? '').localeCompare(b.nextDueAt ?? '');
    if (byDate) return byDate;
    return INTERVAL_ORDER.indexOf(a.frequency) - INTERVAL_ORDER.indexOf(b.frequency);
  });
}

/** Shortest interval first. */
const INTERVAL_ORDER: Frequency[] = [
  'commissioning', 'monthly', 'quarterly', 'six-monthly', 'annual', 'five-yearly', 'ten-yearly',
];

export const REGISTER_DUE_LABEL: Record<RegisterDueState, string> = {
  overdue: 'Overdue',
  due: 'Due today',
  upcoming: 'Upcoming',
  unscheduled: 'No date in the register',
};

/**
 * What the register said about an asset that no screen was showing.
 *
 * The importer keeps every column it did not claim to understand — the comment
 * on `extra` says so in as many words — and then nothing displayed one. The
 * asset screen renders the attributes its *type definition* declares, so
 * anything the register carried and the type does not know about was stored on
 * every import and visible nowhere.
 *
 * On the real register that is 2,892 asset numbers, 281 fire doors' FRL level,
 * 243 tag numbers, and the battery sizes and flow-test columns. The asset
 * number is the worst of them: it is the number written on the asset's own tag,
 * which is how a technician standing in front of one says which row of the
 * register this is.
 *
 * Two are left out because they are already on the screen rather than missing:
 * the descriptor, which `assetName` builds the asset's name from, and the last
 * overhaul, which belongs against its routine in the schedule above.
 */
const ALREADY_SHOWN = new Set(['descriptor', 'lastOverhaul']);

/** The register's own heading for a key it did not have one for. */
const REGISTER_LABEL: Record<string, string> = {
  assetNumber: 'Asset number',
};

export interface RegisterAttribute {
  key: string;
  label: string;
  value: string;
}

export function registerAttributes(
  // Attribute values are whatever the asset row holds; a register column
  // arrives as text but a type-defined one can be a number or a flag.
  attributes: Readonly<Record<string, string | number | boolean>>,
  definedKeys: readonly string[],
): RegisterAttribute[] {
  const defined = new Set(definedKeys);
  const rows = Object.entries(attributes)
    .filter(([key]) => !defined.has(key) && !ALREADY_SHOWN.has(key))
    .map(([key, value]) => ({ key, label: REGISTER_LABEL[key] ?? key, value: String(value ?? '').trim() }))
    .filter((row) => row.value !== '');

  // The asset number first — it is the one a person is holding the device to
  // check — and the rest as the register headed them.
  return rows.sort((a, b) => {
    if (a.key === 'assetNumber') return -1;
    if (b.key === 'assetNumber') return 1;
    return a.label.localeCompare(b.label);
  });
}
