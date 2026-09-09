import type { SimproClient } from './client';
import { SimproError } from './client';
import type { SyncResource } from './incremental';
import { assessIncremental, nextWatermark, planIncremental } from './incremental';
import type { PagedRead } from './mirrorResources';
import { SimproMore, addDays, timesheetWindow } from './moreResources';
import { readSyncState, writeSyncState } from './watermark';
import { qldIsoDay } from '@/domain/qldTime';
import { withMirrorTransaction } from '@/db/mirrorRepo';
import {
  pruneActivitySchedulesNotSyncedAt, pruneCatalogItemsNotSyncedAt, pruneContactsNotSyncedAt,
  pruneCreditNotesNotSyncedAt, pruneCustomerPaymentsNotSyncedAt, pruneLeadsNotSyncedAt, pruneVendorOrdersNotSyncedAt,
  pruneVendorsNotSyncedAt, replaceCatalogGroups, replaceSetupActivities, replaceSimproTimesheets,
  replaceVendorOrderLines, upsertActivitySchedule, upsertCatalogItem, upsertContact, upsertCreditNote,
  upsertCustomerPayment, upsertLead, upsertVendor, upsertVendorOrder, vendorOrdersWantingLines,
} from '@/db/moreRepo';

/**
 * The rest of Simpro, pulled after the main stages.
 *
 * v18's pull reads sites, jobs, assets, rates, staff, schedules, customers,
 * quotes, invoices and tasks. This reads what was still only in the office —
 * purchase orders and their suppliers, the office catalogue, contacts,
 * leads, the hours Simpro holds against each employee, activities, payments
 * and credit notes — into the v23 tables. It is its own module so the main
 * pull stays readable and so each of these stages can fail on its own: a
 * key that cannot read vendor orders still gets its contacts, and says so
 * in one line.
 *
 * The contract with ./sync is deliberately small. The pull hands over a
 * client, whether this is a full read, the run's start instant, a progress
 * callback numbered from zero, and whose phone this is; it gets back counts,
 * errors, notes and the modes each resource actually came down in, and
 * merges them into its own result.
 *
 * Every stage here follows the invoice stage in ./sync exactly: plan the
 * incremental read against the watermark, read with the verified column
 * set, refuse a thin read, judge whether the filter was honoured, write in
 * pages, and move the watermark only when the stage wrote without error.
 * After a full read that was not cut off at its ceiling, the rows the
 * office no longer returned are pruned; an incremental read saw only what
 * changed and prunes nothing.
 *
 * Which reads are incremental, as the live build answered on 9 September
 * 2026: purchase orders, suppliers, the catalogue, contacts, leads,
 * activity schedules, payments and credit notes all honour
 * `DateModified=gt(day)`. Catalogue groups and the activity list carry no
 * DateModified and are read whole inside their stage. The timesheet list
 * takes no DateModified and no paging: it is a window of one employee's
 * days, replaced whole.
 */

/** Which of Simpro's collections this module reads, in the order it reads them. */
export type MoreResource = Extract<SyncResource,
  'vendorOrders' | 'vendors' | 'catalogs' | 'contacts' | 'leads' | 'timesheets' | 'activities' | 'payments' | 'creditNotes'>;

export const MORE_RESOURCES: readonly MoreResource[] = [
  'vendorOrders', 'vendors', 'catalogs', 'contacts', 'leads', 'timesheets', 'activities', 'payments', 'creditNotes',
];

/** How many stages this module reports, so the pull can size its progress bar. */
export const MORE_STAGES = MORE_RESOURCES.length;

export interface MoreSyncInput {
  client: SimproClient;
  /** True to read everything regardless of watermarks. */
  force: boolean;
  /** The run's start instant, ISO; every row written this run is stamped with it. */
  startedAt: string;
  /**
   * Progress, numbered from zero within this module's stages. `total`
   * defaults to MORE_STAGES; a stage with a row count passes its own.
   */
  progress: (stage: string, done: number, total?: number) => void;
  /** Whose phone this is, so their hours are the ones read from the office. */
  staffId?: string;
}

export interface MoreSyncResult {
  /** Rows read per resource this run. */
  counts: Partial<Record<MoreResource, number>>;
  errors: string[];
  notes: string[];
  modes: Partial<Record<MoreResource, 'incremental' | 'full'>>;
}

/** How many list-level rows are written per commit. The same page as ./sync's. */
const WRITE_PAGE = 250;

/** Ceilings on a read, the way the invoice list has one: a phone is not the office's archive. */
const CEILINGS = {
  vendorOrders: 3000, vendors: 5000, catalogs: 20000, contacts: 10000, leads: 2000,
  activities: 5000, payments: 6000, creditNotes: 2000,
} as const;

/** Orders whose lines are read: changed by the office in this many days, or against a job the phone holds. */
const ORDER_LINES_WINDOW_DAYS = 60;
/** How many orders' lines one run reads. One request each. */
const ORDER_LINES_CAP = 60;
/** Lines read within this long ago are kept, the same freshness the job details use. */
const ORDER_LINES_FRESH_MS = 15 * 60_000;

/** The weeks of one employee's hours held, back and ahead of today. */
const TIMESHEET_WEEKS_BACK = 8;
const TIMESHEET_WEEKS_AHEAD = 2;

function describe(e: unknown, what: string): string {
  if (e instanceof SimproError) {
    return e.status === 403
      ? `No permission to read ${what}. Simpro sets API permissions per endpoint.`
      : `${what}: ${e.message}`;
  }
  return `${what}: ${e instanceof Error ? e.message : String(e)}`;
}

/**
 * The error a stage records when the build refused its column set. The
 * thin list is ids and a name or two, and written over the mirror it would
 * blank every order's job and every contact's number; so a thin read is a
 * failed stage, nothing is written, and the refusal is reported in the
 * server's words for whoever fixes the column set.
 */
function columnsRefused(what: string, read: PagedRead<unknown>): string | undefined {
  return read.columnsRejected
    ? `Simpro refused the ${what} column set, so the ${what} list could not be read this run — it said: ${read.columnsRejected}`
    : undefined;
}

async function inPages<T>(items: readonly T[], each: (item: T, index: number) => Promise<void>): Promise<void> {
  for (let start = 0; start < items.length; start += WRITE_PAGE) {
    const page = items.slice(start, start + WRITE_PAGE);
    await withMirrorTransaction(async () => {
      for (const [i, item] of page.entries()) await each(item, start + i);
    });
  }
}

/** A record with an id and the office's modification stamp, which is all the stage runner needs to know about one. */
interface Stamped { id: string; DateModified?: string }

interface StageSpec<T extends Stamped> {
  resource: MoreResource;
  /** What the errors and notes call it. */
  what: string;
  /** The progress label while the list is read. */
  label: string;
  /** The progress label while the rows are written, with a count. */
  rowsLabel: string;
  read: (query: Record<string, string | number>) => Promise<PagedRead<T>>;
  write: (item: T, at: string) => Promise<void>;
  prune: (at: string) => Promise<number>;
  ceiling: number;
  /** Anything else the stage reads whole, after the list, inside the same try. */
  also?: (at: string) => Promise<void>;
}

/**
 * One list stage, start to finish. Returns the records it read so a stage
 * can do more with them, or nothing when it failed; the failure is already
 * in the result.
 */
async function listStage<T extends Stamped>(
  input: MoreSyncInput,
  result: MoreSyncResult,
  index: number,
  spec: StageSpec<T>,
): Promise<T[] | undefined> {
  const { startedAt, force, progress } = input;
  progress(spec.label, index);
  const state = await readSyncState(spec.resource);
  const plan = planIncremental(spec.resource, state.lastChangeSeenAt, { force });
  const errorsBefore = result.errors.length;
  try {
    const read = await spec.read(plan.query);
    const refused = columnsRefused(spec.what, read);
    if (refused) throw new Error(refused);
    const outcome = assessIncremental(read.items, plan, state.lastRecordCount);
    result.modes[spec.resource] = outcome.mode;
    if (outcome.note) result.notes.push(outcome.note);
    if (read.truncated) {
      result.notes.push(`More than ${spec.ceiling} ${spec.what} matched, so only the most recently changed were read.`);
    }
    let written = 0;
    await inPages(read.items, async (item, i) => {
      if (i % 50 === 0) progress(spec.rowsLabel, i, read.items.length);
      try {
        if (item.id) {
          await spec.write(item, startedAt);
          written++;
        }
      } catch (e) {
        result.errors.push(describe(e, `${spec.what} ${item.id}`));
      }
    });
    result.counts[spec.resource] = written;
    if (spec.also) await spec.also(startedAt);
    /*
     * Pruned only after a read that was asked for whole and saw everything:
     * an incremental read saw what changed, and a read cut at its ceiling
     * has not seen what lies past it, so either would delete rows the
     * office still has. The plan decides, not the outcome. The outcome
     * calls a filtered read 'full' when it came back with at least as many
     * rows as the last whole one — a fair guess about a filter the server
     * ignored, and exactly wrong on a small table the day the office
     * touches every row of it, when pruning on it would delete the rest.
     * A filter the server really ignored costs nothing here: the prune
     * simply waits for the next read that was asked for whole.
     * And only when every row landed: a row that failed to write is not
     * stamped with this run and would be pruned as gone.
     */
    if (plan.mode === 'full' && !read.truncated && result.errors.length === errorsBefore) {
      await spec.prune(startedAt);
    }
    if (result.errors.length === errorsBefore) {
      await writeSyncState({
        resource: spec.resource,
        lastSyncedAt: startedAt,
        ...nextWatermark(read.items as unknown as Record<string, unknown>[], outcome.mode, startedAt, state, read.truncated),
        mode: outcome.mode,
      }, startedAt);
    }
    return read.items;
  } catch (e) {
    result.errors.push(describe(e, spec.what));
    return undefined;
  }
}

/**
 * The lines under the purchase orders that are worth it this run.
 *
 * One request per order, so not every order on the books: the ones the
 * office changed in the last two months or that sit against a job the
 * phone holds, capped, and skipped where read in the last quarter hour.
 * A failure here is a note rather than an error, the way a job's families
 * are: the list stage stood on its own and its watermark is right.
 */
async function readOrderLines(more: SimproMore, input: MoreSyncInput, result: MoreSyncResult): Promise<void> {
  const today = qldIsoDay(input.startedAt);
  if (!today) return;
  const wanted = await vendorOrdersWantingLines({
    modifiedSince: addDays(today, -ORDER_LINES_WINDOW_DAYS),
    freshAfter: new Date(Date.parse(input.startedAt) - ORDER_LINES_FRESH_MS).toISOString(),
    limit: ORDER_LINES_CAP,
  });
  const failures: string[] = [];
  let thin: string | undefined;
  for (const [i, id] of wanted.entries()) {
    input.progress('Purchase order lines', i, wanted.length);
    try {
      const read = await more.vendorOrderLines(id);
      // A thin line list names the parts without their quantities. It is
      // not written: the list stages refuse a thin read for the same
      // reason, and writing it here would replace lines read whole last
      // week with lines that have lost their counts, stamped as current.
      // Said once so the column set gets fixed; the orders stay wanted
      // until it is.
      if (read.columnsRejected) {
        thin = read.columnsRejected;
        continue;
      }
      await replaceVendorOrderLines(id, read.items, input.startedAt);
    } catch (e) {
      failures.push(`order ${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (thin) result.notes.push(`Simpro refused the purchase order line column set, so no lines were read this run — it said: ${thin}`);
  if (failures.length) {
    result.notes.push(
      `${failures.length} of ${wanted.length} purchase orders could not have their lines read: `
      + failures.slice(0, 3).join('; ') + (failures.length > 3 ? '; …' : ''),
    );
  }
}

/**
 * This person's hours from the office, a window of weeks, replaced whole.
 *
 * Not incremental and never will be on this build: the list carries no
 * DateModified and ignores paging. The window is the unit — what the
 * office says about those weeks is written over what the phone had for
 * them — and a phone that does not know whose it is skips the stage and
 * says so, since everyone's hours is not a thing a phone should hold.
 */
async function timesheetStage(more: SimproMore, input: MoreSyncInput, result: MoreSyncResult, index: number): Promise<void> {
  input.progress('Reading your hours', index);
  if (!input.staffId) {
    result.notes.push('Hours from the office were not read: this phone does not know whose it is yet. Set your name in Settings.');
    return;
  }
  const errorsBefore = result.errors.length;
  try {
    const window = timesheetWindow(input.startedAt, TIMESHEET_WEEKS_BACK, TIMESHEET_WEEKS_AHEAD);
    const rows = await more.timesheets({ employeeId: input.staffId, from: window.from, to: window.to });
    const written = await replaceSimproTimesheets({ employeeId: input.staffId, ...window }, rows, input.startedAt);
    result.counts.timesheets = written;
    result.modes.timesheets = 'full';
    if (result.errors.length === errorsBefore) {
      await writeSyncState({
        resource: 'timesheets',
        lastSyncedAt: input.startedAt,
        // The window is re-read whole every run, so the mark is the run
        // itself rather than a record's stamp the rows do not carry.
        lastChangeSeenAt: input.startedAt,
        lastRecordCount: written,
        mode: 'full',
      }, input.startedAt);
    }
  } catch (e) {
    result.errors.push(describe(e, 'your hours'));
  }
}

/**
 * Reads the v23 resources. Never throws: every stage catches its own
 * failure into `errors`, the way the main pull's stages do.
 */
export async function pullMore(input: MoreSyncInput): Promise<MoreSyncResult> {
  const more = new SimproMore(input.client);
  const result: MoreSyncResult = { counts: {}, errors: [], notes: [], modes: {} };

  const orders = await listStage(input, result, 0, {
    resource: 'vendorOrders', what: 'purchase orders', label: 'Reading purchase orders', rowsLabel: 'Purchase orders',
    read: (q) => more.vendorOrdersPaged(q, CEILINGS.vendorOrders),
    write: upsertVendorOrder, prune: pruneVendorOrdersNotSyncedAt, ceiling: CEILINGS.vendorOrders,
  });
  if (orders) {
    try {
      await readOrderLines(more, input, result);
    } catch (e) {
      result.notes.push(`Purchase order lines were not read this run: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  await listStage(input, result, 1, {
    resource: 'vendors', what: 'suppliers', label: 'Reading suppliers', rowsLabel: 'Suppliers',
    read: (q) => more.vendorsPaged(q, CEILINGS.vendors),
    write: upsertVendor, prune: pruneVendorsNotSyncedAt, ceiling: CEILINGS.vendors,
  });

  await listStage(input, result, 2, {
    resource: 'catalogs', what: 'catalogue items', label: 'Reading the catalogue', rowsLabel: 'Catalogue',
    read: (q) => more.catalogsPaged(q, CEILINGS.catalogs),
    write: upsertCatalogItem, prune: pruneCatalogItemsNotSyncedAt, ceiling: CEILINGS.catalogs,
    // The groups are a few dozen rows with no modification date: read
    // whole and replaced whole, inside the catalogue stage since a group
    // without its items is nothing to show.
    also: async (at) => {
      const groups = await more.catalogGroups();
      const refused = columnsRefused('catalogue group', groups);
      if (refused) throw new Error(refused);
      await replaceCatalogGroups(groups.items, at);
    },
  });

  await listStage(input, result, 3, {
    resource: 'contacts', what: 'contacts', label: 'Reading contacts', rowsLabel: 'Contacts',
    read: (q) => more.contactsPaged(q, CEILINGS.contacts),
    write: upsertContact, prune: pruneContactsNotSyncedAt, ceiling: CEILINGS.contacts,
  });

  await listStage(input, result, 4, {
    resource: 'leads', what: 'leads', label: 'Reading leads', rowsLabel: 'Leads',
    read: (q) => more.leadsPaged(q, CEILINGS.leads),
    write: upsertLead, prune: pruneLeadsNotSyncedAt, ceiling: CEILINGS.leads,
  });

  await timesheetStage(more, input, result, 5);

  await listStage(input, result, 6, {
    resource: 'activities', what: 'activities', label: 'Reading activities', rowsLabel: 'Activities',
    read: (q) => more.activitySchedulesPaged(q, CEILINGS.activities),
    write: upsertActivitySchedule, prune: pruneActivitySchedulesNotSyncedAt, ceiling: CEILINGS.activities,
    also: async (at) => {
      const kinds = await more.setupActivities();
      const refused = columnsRefused('activity list', kinds);
      if (refused) throw new Error(refused);
      await replaceSetupActivities(kinds.items, at);
    },
  });

  await listStage(input, result, 7, {
    resource: 'payments', what: 'payments', label: 'Reading payments', rowsLabel: 'Payments',
    read: (q) => more.customerPaymentsPaged(q, CEILINGS.payments),
    write: upsertCustomerPayment, prune: pruneCustomerPaymentsNotSyncedAt, ceiling: CEILINGS.payments,
  });

  await listStage(input, result, 8, {
    resource: 'creditNotes', what: 'credit notes', label: 'Reading credit notes', rowsLabel: 'Credit notes',
    read: (q) => more.creditNotesPaged(q, CEILINGS.creditNotes),
    write: upsertCreditNote, prune: pruneCreditNotesNotSyncedAt, ceiling: CEILINGS.creditNotes,
  });

  return result;
}
