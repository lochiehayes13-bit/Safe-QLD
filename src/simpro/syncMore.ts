import type { SimproClient } from './client';
import type { SyncResource } from './incremental';

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

/**
 * Reads the v23 resources. Never throws: every stage catches its own
 * failure into `errors`, the way the main pull's stages do.
 *
 * Not yet wired to the build: each stage lands here as it is verified
 * against the office system's column sets.
 */
export async function pullMore(input: MoreSyncInput): Promise<MoreSyncResult> {
  input.progress('Reading the rest of Simpro', 0);
  return { counts: {}, errors: [], notes: [], modes: {} };
}
