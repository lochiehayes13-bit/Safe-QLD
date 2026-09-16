import type { Defect } from '@/domain/types';
import { partsNeededFor, uncoveredDefects, type NeededPart, type UncoveredDefect } from '@/domain/partsNeeded';

/**
 * What to load before the next few days of work.
 *
 * Chris Scoffell asked for it in one sentence: "Would be nice to be able to
 * create a stock list for x number of days. Maybe referencing defect jobs and
 * pulling required stock from them." Everything needed to answer that was
 * already on the phone and none of it was joined up — the schedule knows which
 * buildings are booked, the defect register knows what is wrong in them, the
 * coded library knows what each fault takes to fix, and the van list knows what
 * is already in the back. This walks that chain once and prints the difference.
 *
 * The output is deliberately a *shortfall*, not a shopping list. "Six smoke
 * detector heads" is not useful to somebody who already has four in the van;
 * "get two" is. So every line carries what the work wants, what the van holds,
 * and the gap between them.
 *
 * Four things it is careful about, each of them a way a list like this lies:
 *
 *  - **A building booked three days running is one building.** Parts come from
 *    a site's open defects, so counting per schedule block would triple the
 *    order for a site somebody is spending the week at. Sites are collapsed
 *    before anything is counted.
 *  - **The schedule does not reach as far as the question.** The sync holds
 *    three weeks ahead (see SCHEDULE_DAYS_AHEAD). Asked for thirty days it
 *    answers for the twenty-one it has and says so, because a list that quietly
 *    covers two-thirds of what was asked for is worse than one that refuses.
 *  - **Not knowing is not the same as having none.** A part the van list has
 *    never carried comes back with no on-hand figure at all rather than zero.
 *    Zero reads as "checked, none there"; blank reads as "nobody has counted
 *    this", and they lead to different actions.
 *  - **Defects with nothing to order are still named.** A free-text defect and
 *    a labour-only one both contribute no parts, and a list that silently drops
 *    them looks complete while missing the reason for the visit.
 *
 * Pure — no database, no expo, no React. The screen reads it, the repository
 * feeds it, and every rule above is a test rather than a promise.
 */

/** How many days the list covers unless somebody says otherwise. A working week. */
export const DEFAULT_STOCK_DAYS = 7;

/**
 * The most days that can be asked for.
 *
 * Not an arbitrary ceiling: the schedule sync holds twenty-one days ahead, so
 * beyond that there is nothing to build a list out of. Asking is allowed up to
 * the edge of what the phone can actually answer, and no further.
 */
export const MAX_STOCK_DAYS = 21;

const DAY_MS = 86_400_000;

/** A calendar day moved by whole days. Date-only in, date-only out. */
function shiftDay(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from one calendar day to another, negative when it is in the past. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** A schedule block, as much of one as this needs. */
export interface StockRunBlock {
  /** The office's job number, where the block is against a job. */
  jobId?: string;
  /** The calendar day, yyyy-mm-dd. */
  date: string;
}

/** A job, as much of one as this needs. */
export interface StockRunJob {
  /** The local site id, where the phone holds the site. */
  siteId?: string;
  siteName: string;
  /** The office's job number, for tracing a line back to the work. */
  orderNo?: string;
}

/** A line on the van, as much of one as this needs. */
export interface StockOnHand {
  description: string;
  partNumber?: string;
  quantity: number;
}

export interface StockRunInput {
  /** Today, as a Queensland calendar day. */
  today: string;
  /** How many days to cover, counting today as the first. */
  days: number;
  /** The last day the schedule actually holds, from the sync's own window. */
  scheduleCoversTo: string;
  blocks: readonly StockRunBlock[];
  /** The jobs those blocks name, keyed by the office's job number. */
  jobs: ReadonlyMap<string, StockRunJob>;
  /** Every defect the phone holds for a site, keyed by local site id. */
  defectsBySite: ReadonlyMap<string, readonly Defect[]>;
  onHand: readonly StockOnHand[];
}

export interface StockRunLine {
  /** The coded library's own wording. It does not invent a part number. */
  description: string;
  unit: NeededPart['unit'];
  /** What the work in the window calls for. */
  needed: number;
  /**
   * What the van holds, where the van list carries this line at all.
   *
   * Absent means nobody has counted it, which is not zero. See the note at the
   * top: the two lead to different actions and must not be shown as one.
   */
  onHand?: number;
  /** The part number off the van line, where one matched. */
  partNumber?: string;
  /** How many to get. The whole need where the van does not carry the line. */
  short: number;
  defectCount: number;
  fromCodes: string[];
  /** The buildings that want it, named so a quantity can be argued with. */
  sites: string[];
}

export interface StockRunSite {
  siteId: string;
  siteName: string;
  /** The days it is booked inside the window, earliest first. */
  days: string[];
  /** The office job numbers booked on it. */
  jobNumbers: string[];
  openDefects: number;
}

export interface StockRun {
  from: string;
  /** The last day covered, which is not always the last day asked for. */
  to: string;
  /** Days actually covered. */
  days: number;
  /** Days asked for that the schedule does not reach. */
  beyondSchedule: number;
  lines: StockRunLine[];
  sites: StockRunSite[];
  /** Defects in the window that produced no parts, and why. */
  uncovered: UncoveredDefect[];
  /** Anything the reader has to know before trusting the list. */
  notes: string[];
}

/** Descriptions compared the way a person would: case and spacing do not count. */
function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The days a list can actually cover.
 *
 * Clamped at both ends. Below one there is no window at all; above the
 * schedule's own reach there is nothing to look at, and answering anyway would
 * mean printing a week of blanks as though the diary were empty.
 */
export function stockRunDays(asked: number): number {
  if (!Number.isFinite(asked)) return DEFAULT_STOCK_DAYS;
  return Math.min(MAX_STOCK_DAYS, Math.max(1, Math.floor(asked)));
}

/**
 * Builds the list.
 *
 * The order is the order the answer depends on: settle the window, find the
 * buildings in it, collapse them, take their open defects, turn those into
 * parts, then net the parts against the van.
 */
export function buildStockRun(input: StockRunInput): StockRun {
  const asked = stockRunDays(input.days);

  // The schedule's reach, not the question's. A day past the end of the sync
  // window holds nothing, and counting it as covered would read as a free day.
  const reach = daysBetween(input.today, input.scheduleCoversTo) + 1;
  const covered = Math.max(1, Math.min(asked, reach));
  const to = shiftDay(input.today, covered - 1);
  const beyondSchedule = Math.max(0, asked - covered);

  const notes: string[] = [];
  if (beyondSchedule > 0) {
    notes.push(
      `The schedule on this phone reaches ${input.scheduleCoversTo}, so this covers `
      + `${covered} ${covered === 1 ? 'day' : 'days'} of the ${asked} asked for. The last `
      + `${beyondSchedule} ${beyondSchedule === 1 ? 'day is' : 'days are'} not in it — `
      + `work booked then is not counted here.`,
    );
  }

  /*
   * The buildings booked in the window, each one once however many days it is
   * booked for. A site somebody is spending the week at would otherwise
   * contribute its defects five times over and the order would come back five
   * times too big.
   */
  const bySite = new Map<string, StockRunSite>();
  let blocksWithoutJob = 0;
  const jobsWithoutSite = new Set<string>();

  for (const block of input.blocks) {
    if (block.date < input.today || block.date > to) continue;
    if (!block.jobId) { blocksWithoutJob++; continue; }
    const job = input.jobs.get(block.jobId);
    if (!job || !job.siteId) { jobsWithoutSite.add(block.jobId); continue; }

    const entry = bySite.get(job.siteId);
    if (entry) {
      if (!entry.days.includes(block.date)) entry.days.push(block.date);
      if (job.orderNo && !entry.jobNumbers.includes(job.orderNo)) entry.jobNumbers.push(job.orderNo);
    } else {
      bySite.set(job.siteId, {
        siteId: job.siteId,
        siteName: job.siteName,
        days: [block.date],
        jobNumbers: job.orderNo ? [job.orderNo] : [],
        openDefects: 0,
      });
    }
  }

  if (blocksWithoutJob > 0) {
    notes.push(
      `${blocksWithoutJob} booked ${blocksWithoutJob === 1 ? 'block is' : 'blocks are'} not against a `
      + 'job — leave, or an appointment — so nothing was counted for them.',
    );
  }
  if (jobsWithoutSite.size > 0) {
    notes.push(
      `${jobsWithoutSite.size} booked ${jobsWithoutSite.size === 1 ? 'job' : 'jobs'} could not be `
      + `matched to a building this phone holds (${[...jobsWithoutSite].slice(0, 3).join(', ')}`
      + `${jobsWithoutSite.size > 3 ? ', and more' : ''}), so nothing was counted for `
      + `${jobsWithoutSite.size === 1 ? 'it' : 'them'}. Sync, then look again.`,
    );
  }

  // Open defects only. A rectified or quoted one is not work this trip has to
  // carry parts for, and counting it would send somebody out heavy.
  const defects: Defect[] = [];
  const siteOf = new Map<string, string>();
  for (const site of bySite.values()) {
    const open = (input.defectsBySite.get(site.siteId) ?? []).filter((d) => d.status === 'open');
    site.openDefects = open.length;
    for (const defect of open) {
      defects.push(defect);
      siteOf.set(defect.id, site.siteName);
    }
  }

  const sites = [...bySite.values()].sort(
    (a, b) => (a.days[0] ?? '').localeCompare(b.days[0] ?? '') || a.siteName.localeCompare(b.siteName),
  );
  for (const site of sites) site.days.sort();

  const parts = partsNeededFor(defects);
  const uncovered = uncoveredDefects(defects);

  /*
   * Which buildings drove each line, worked out the same way the quantities
   * were: by walking the defects again per part. `partsNeededFor` aggregates
   * away the defect, which is right for the number and no use for the trace.
   */
  const sitesForPart = new Map<string, Set<string>>();
  for (const defect of defects) {
    const name = siteOf.get(defect.id);
    if (!name) continue;
    for (const part of partsNeededFor([defect])) {
      const key = `${normalise(part.description)}|${part.unit}`;
      const set = sitesForPart.get(key) ?? new Set<string>();
      set.add(name);
      sitesForPart.set(key, set);
    }
  }

  // The van, by description. It is the only join the two sides share: the
  // library will not invent a part number, so there is no code to match on.
  const van = new Map<string, StockOnHand>();
  for (const item of input.onHand) {
    const key = normalise(item.description);
    const existing = van.get(key);
    // Two lines for the same thing in different locations are one pile.
    if (existing) existing.quantity += item.quantity;
    else van.set(key, { ...item });
  }

  const lines: StockRunLine[] = parts.map((part) => {
    const key = normalise(part.description);
    const held = van.get(key);
    const needed = part.quantity;
    const short = held ? Math.max(0, needed - held.quantity) : needed;
    return {
      description: part.description,
      unit: part.unit,
      needed,
      onHand: held?.quantity,
      partNumber: held?.partNumber,
      short,
      defectCount: part.defectCount,
      fromCodes: part.fromCodes,
      sites: [...(sitesForPart.get(`${key}|${part.unit}`) ?? [])].sort(),
    };
  });

  // Shortfall first — that is the list somebody walks to the store with — then
  // the biggest need, then alphabetically so the order is stable to read.
  lines.sort((a, b) => b.short - a.short || b.needed - a.needed || a.description.localeCompare(b.description));

  const untracked = lines.filter((l) => l.onHand === undefined).length;
  if (untracked > 0) {
    notes.push(
      `${untracked} of these ${untracked === 1 ? 'is' : 'are'} not on the van list at all, so there is `
      + 'no count to take away. They are shown as needed in full — add them to Van stock once and the '
      + 'next list will know.',
    );
  }
  if (sites.length && !defects.length) {
    notes.push('Nothing is open against the buildings booked in this window, so there is nothing to take.');
  }

  return { from: input.today, to, days: covered, beyondSchedule, lines, sites, uncovered, notes };
}
