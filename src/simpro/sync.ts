import { SimproClient, SimproError, type SimproConfig } from './client';
import { SimproResources, rejectedTheDateRange, scheduleDateFilter, type SimproSite } from './resources';
import {
  SimproMirror, dateSinceFilter, invoiceWindowStart, type PagedRead, type SimproCustomer, type SimproInvoice,
} from './mirrorResources';
import { assessIncremental, nextWatermark, planIncremental, type SyncResource } from './incremental';
import { readSyncState, writeSyncState } from './watermark';
import { flushSoon } from './flushSoon';
import { keysAlreadyOnJob } from './testResults';
import { reachabilityFailure, sendFailure } from './sendOutcome';
import { createSite, getSite, listSites, updateSite } from '@/db/repo';
import { saveRateCard } from '@/db/rateCardRepo';
import { replaceEmployees } from '@/db/employeeRepo';
import { replaceScheduleWindow } from '@/db/scheduleRepo';
import { addDays, scheduleWindow } from '@/domain/myDay';
import { qldIsoDay } from '@/domain/qldTime';
import {
  upsertJob, getJob, enqueueSync, pendingSync, markSynced, markSyncFailed, markSyncUnknown, abandonSync,
  setPurchaseStatus, type JobRecord,
} from '@/db/opsRepo';
import {
  getQuote, heldJobExternalIds, invoiceRowIsWhole, jobDetailIsStale, jobRowFromSimpro, jobsWantingDetail,
  linkJobInvoice, pruneCustomersNotSyncedAt, quotesWantingDetail, replaceJobChildren, replaceQuoteChildren,
  scheduledJobExternalIds, setSiteOffice, upsertCustomer, upsertInvoice, upsertQuote, upsertTasks,
  withMirrorTransaction, type JobChildren, type QuoteChildren,
} from '@/db/mirrorRepo';
import { markerFor, withMarker } from '@/domain/queueKey';
import { matchSiteByRefOrName } from '@/domain/siteNames';
import {
  attachmentContentKey, keysInNoteText, type OutboundAssetTest, type OutboundAttachment,
} from '@/domain/outboundWork';
import { uploadJobAttachment } from './attachments';
import { AttachmentFileMissing, readAttachmentForUpload, type ReadAttachment } from './attachmentFiles';
import { createAsset, findByExternalIds, updateAsset, type AssetRecord } from '@/db/assetRepo';
import { mapSimproAsset, SIMPRO_ASSET_SOURCE, statusFor } from './assetSync';
import type { Site } from '@/domain/types';

/**
 * Stamped on records this sync created, so a later pull updates them rather
 * than adding a second copy. Sites also arrive from CSV imports and from
 * technicians typing them on site, and those carry no external id at all.
 */
export const SIMPRO_SOURCE = 'simpro';

/**
 * Pulling Simpro down and pushing field work back up.
 *
 * Two rules shape this. Nothing the technician did on site may be lost, so
 * outbound work goes through a queue that survives the app closing and retries
 * on its own. And nothing from the office may quietly overwrite what someone
 * typed on site — a pull fills blanks and adds records, it does not clobber.
 *
 * The pull is a mirror, within what a phone should hold. Every site, job,
 * quote, invoice and customer comes down at list level; what sits *under* a
 * job — its sections and lines, notes, attachments, activity — is a dozen
 * requests a job and comes down only for the jobs somebody is booked to,
 * the ones the office touched lately, and the one somebody just opened.
 * See syncJobDetail and prefetchJobDetails.
 */

export interface SyncProgress {
  stage: string;
  done: number;
  total: number;
}

/** Stages a pull reports progress across. */
const TOTAL_STAGES = 12;

/** The job list ceiling. The build holds 4,562; the guard is against a runaway, not the book of work. */
const JOB_CEILING = 6000;
const QUOTE_CEILING = 6000;
const INVOICE_CEILING = 6000;
const CUSTOMER_CEILING = 10000;

/** How long a job's children are trusted before a sync reads them again. */
export const DETAIL_FRESH_MS = 15 * 60_000;
/** How many job records one pull will read children for. A dozen requests each. */
const DETAIL_PREFETCH_CAP = 60;
const QUOTE_PREFETCH_CAP = 20;
/** Jobs and quotes the office touched this recently get their children read ahead of being opened. */
const MODIFIED_WINDOW_DAYS = 14;

export interface SyncResult {
  sitesAdded: number;
  sitesUpdated: number;
  jobsAdded: number;
  jobsUpdated: number;
  /** Customer assets read from the office system's register. */
  assetsAdded: number;
  assetsUpdated: number;
  /**
   * Assets skipped because their site is not held locally.
   *
   * Two thirds of the office's sites carry no assets at all, and a site that
   * failed to match during this run leaves its assets with nowhere to go. Said
   * out loud rather than counted as success.
   */
  assetsWithoutSite: number;
  /** Labour rates and service fees read from the office system's setup. */
  ratesRead: number;
  feesRead: number;
  /** Staff on the office's books, so a phone can say whose it is. */
  employeesRead: number;
  /** Schedule blocks in the window around today, for everyone — the day screen filters. */
  schedulesRead: number;
  /** The mirror's list-level reads: companies and individuals, quotes, invoices in the window, tasks. */
  customersRead: number;
  quotesRead: number;
  invoicesRead: number;
  tasksRead: number;
  /** Jobs and quotes whose children were read this run. */
  jobDetailsRead: number;
  quoteDetailsRead: number;
  errors: string[];
  /**
   * Whether each resource actually came down incrementally.
   *
   * Reported rather than assumed. A server that does not understand the filter
   * returns everything and looks exactly like a busy day of changes, so the
   * result is checked and a watermark is only recorded when it holds.
   */
  modes: Partial<Record<SyncResource, 'incremental' | 'full'>>;
  notes: string[];
}

export interface PullOptions {
  incremental?: boolean;
  /**
   * Whose phone this is, so their booked jobs are the first to get their
   * children read. Without it the whole schedule window is used, soonest
   * first, and the cap decides how far that reaches.
   */
  staffId?: string;
  staffName?: string;
  /** Off to read lists only. On by default. */
  prefetchDetails?: boolean;
}

/**
 * Matches an incoming site to one already held, by external id then by name.
 *
 * The name fallback refuses a name that identifies more than one building —
 * see matchSiteByRefOrName. Three of this company's sites are called "Luggage
 * Direct", and folding a Simpro site onto whichever of them came first merges
 * three buildings' jobs and assets into one.
 */
function matchSite(existing: Site[], externalId: string, name: string) {
  return matchSiteByRefOrName(existing, `SIMPRO:${externalId}`, name);
}

/**
 * Every site held locally, keyed by the office's id.
 *
 * Seeded from the whole local table rather than from the sites a run
 * happened to read: on an incremental pull a handful of sites come down,
 * and an index built from those alone left every new job for any other
 * site with no site at all — and the upsert never revisited siteId, so
 * they stayed unlinked through every later pull.
 */
function indexSitesByRemote(sites: readonly Site[], seed?: Map<string, string>): Map<string, string> {
  const map = new Map(seed);
  for (const site of sites) {
    const remoteId = site.externalSource === SIMPRO_SOURCE ? site.externalId : undefined;
    const fromRef = site.siteRef?.startsWith('SIMPRO:') ? site.siteRef.slice('SIMPRO:'.length) : undefined;
    const key = remoteId ?? fromRef;
    if (key && !map.has(key)) map.set(key, site.id);
  }
  return map;
}

/**
 * The error a stage records when the build refused its column set.
 *
 * The thin list the fallback read is ids and a name or two. Written over the
 * mirror it would blank every quote's stage and site, mark every invoice
 * unpaid and every customer current, and the pull would report success. So
 * a thin read is a failed stage: nothing is written, the watermark stays,
 * the last good mirror stands, and the refusal is in the notes in the
 * server's words for whoever fixes the column set.
 */
function columnsRefused(what: string, read: PagedRead<unknown>): string | undefined {
  return read.columnsRejected
    ? `Simpro refused the ${what} column set, so the ${what} list could not be read this run — it said: ${read.columnsRejected}`
    : undefined;
}

/** How many list-level rows are written per commit. See withMirrorTransaction. */
const WRITE_PAGE = 250;

/**
 * Writes a list in pages, each page one transaction.
 *
 * `each` keeps its own try and catch: one bad row records its error and the
 * rest of its page still lands, since a failed statement inside a
 * transaction fails alone.
 */
async function inPages<T>(items: readonly T[], each: (item: T, index: number) => Promise<void>): Promise<void> {
  for (let start = 0; start < items.length; start += WRITE_PAGE) {
    const page = items.slice(start, start + WRITE_PAGE);
    await withMirrorTransaction(async () => {
      for (const [i, item] of page.entries()) await each(item, start + i);
    });
  }
}

export async function pullFromSimpro(
  config: SimproConfig,
  onProgress?: (p: SyncProgress) => void,
  options?: PullOptions,
): Promise<SyncResult> {
  /*
   * A pull reads everything, every time.
   *
   * The incremental machinery below is kept and still works — it asks only for
   * what changed since the last successful sync — but it is no longer what a
   * press of the button does. Incremental sync is only ever as good as its
   * watermark, and a watermark can be wrong in ways nobody sees: a record
   * edited without its modified date moving, a filter the server quietly
   * ignored, a sync that half-failed and left the mark further forward than the
   * data it actually stored. Each of those leaves the phone confidently stale,
   * and stale in this app means a technician standing in front of equipment the
   * office has since changed.
   *
   * A full read of 3,059 sites and 12,546 assets is about six minutes on a
   * decent signal. That is the price of never wondering.
   */
  const force = !options?.incremental;
  const client = new SimproClient(config);
  const api = new SimproResources(client);
  const mirror = new SimproMirror(client);
  const result: SyncResult = {
    sitesAdded: 0, sitesUpdated: 0, jobsAdded: 0, jobsUpdated: 0,
    assetsAdded: 0, assetsUpdated: 0, assetsWithoutSite: 0,
    ratesRead: 0, feesRead: 0, employeesRead: 0, schedulesRead: 0,
    customersRead: 0, quotesRead: 0, invoicesRead: 0, tasksRead: 0,
    jobDetailsRead: 0, quoteDetailsRead: 0,
    errors: [], modes: {}, notes: [],
  };
  const startedAt = new Date().toISOString();
  const progress = (stage: string, done: number, total = TOTAL_STAGES) => onProgress?.({ stage, done, total });

  // One check, before any stage runs. Each stage would otherwise fail on its
  // own and report the same missing-secret sentence twelve times, which reads
  // as twelve separate faults and hides the single thing that fixes all of them.
  const missing = await SimproClient.missingCredentials(config);
  if (missing) {
    result.errors.push(missing);
    progress('Not connected', 0);
    return result;
  }

  progress('Reading sites', 0);

  // Read against the watermark even on a full pull: the mark is still recorded,
  // so switching back to incremental later has somewhere to start from.
  const siteState = await readSyncState('sites');
  const sitePlan = planIncremental('sites', siteState.lastChangeSeenAt, { force });

  let remoteSites: SimproSite[] = [];
  let siteMode: 'incremental' | 'full' = 'full';
  let sitesTruncated = false;
  // Set when the build refused the public-notes column: the notes are then
  // unknown, not blank, and nothing already held is touched.
  let siteNotesUnread = false;
  try {
    const read = await api.sitesPaged(undefined, sitePlan.query);
    remoteSites = read.sites;
    sitesTruncated = read.truncated;
    siteNotesUnread = !!read.columnsRejected;
    if (read.columnsRejected) {
      result.notes.push(`Simpro refused the site public-notes column, so site notes were not read — it said: ${read.columnsRejected}`);
    }
    if (read.truncated) {
      result.notes.push(
        `The site read stopped at ${remoteSites.length} records before reaching the end. `
        + 'The watermark was not moved, so the rest are still asked for next time.',
      );
    }
    const outcome = assessIncremental(remoteSites, sitePlan, siteState.lastRecordCount);
    siteMode = outcome.mode;
    result.modes.sites = outcome.mode;
    if (outcome.note) result.notes.push(outcome.note);
  } catch (e) {
    result.errors.push(describe(e, 'sites'));
  }

  const existing = await listSites();
  // Keyed by external id so jobs can find the site they belong to.
  const siteIdByExternal = new Map<string, string>();

  await inPages(remoteSites, async (remote, i) => {
    if (i % 25 === 0) progress('Sites', i, remoteSites.length);
    try {
      const { match, ambiguous } = matchSite(existing, remote.id, remote.name);
      if (ambiguous) {
        // Said out loud rather than resolved. A second site is visible and can
        // be merged by hand; two buildings folded together cannot be taken
        // apart, because nothing records which service belonged to which.
        result.notes.push(
          `${ambiguous.length} sites are already called "${remote.name}", so Simpro site `
          + `${remote.id} could not be matched to one of them by name and has been added `
          + 'separately. Set its reference on the right one to join them.',
        );
      }
      let localId: string;
      if (match) {
        localId = match.id;
        siteIdByExternal.set(remote.id, match.id);
        // Only fill what is blank locally. Someone on site knows better than
        // the office record, and overwriting their correction loses it.
        const patch: Partial<Site> = {};
        if (!match.address && remote.address) patch.address = remote.address;
        if (!match.suburb && remote.suburb) patch.suburb = remote.suburb;
        if (!match.postcode && remote.postcode) patch.postcode = remote.postcode;
        if (!match.clientName && remote.customerName) patch.clientName = remote.customerName;
        if (!match.siteRef) patch.siteRef = `SIMPRO:${remote.id}`;
        // The office's contact, which is what a report's Contact, Mobile and
        // Email rows print. Filled only where blank, like everything else here.
        if (!match.contactName && remote.contactName) patch.contactName = remote.contactName;
        if (!match.contactEmail && remote.contactEmail) patch.contactEmail = remote.contactEmail;
        if (!match.contactWorkPhone && remote.contactWorkPhone) patch.contactWorkPhone = remote.contactWorkPhone;
        if (!match.contactMobile && remote.contactMobile) patch.contactMobile = remote.contactMobile;
        if (!match.externalId) {
          patch.externalId = remote.id;
          patch.externalSource = SIMPRO_SOURCE;
        }
        if (Object.keys(patch).length) {
          await updateSite(match.id, patch);
          result.sitesUpdated++;
        }
      } else {
        const created = await createSite({
          name: remote.name,
          address: remote.address,
          suburb: remote.suburb,
          state: remote.state,
          postcode: remote.postcode,
          clientName: remote.customerName,
          siteRef: `SIMPRO:${remote.id}`,
          contactName: remote.contactName,
          contactEmail: remote.contactEmail,
          contactWorkPhone: remote.contactWorkPhone,
          contactMobile: remote.contactMobile,
          externalId: remote.id,
          externalSource: SIMPRO_SOURCE,
        });
        localId = created.id;
        siteIdByExternal.set(remote.id, created.id);
        existing.push(created);
        result.sitesAdded++;
      }
      // The office's own words about the site, and whose it is. These are
      // the office's outright — nobody corrects them on the doorstep — so
      // they are written whole, blank included, where the list carried them.
      await setSiteOffice(localId, {
        publicNotes: siteNotesUnread ? undefined : (remote.publicNotes ?? null),
        customerExternalId: remote.customerExternalId ?? null,
      });
    } catch (e) {
      result.errors.push(describe(e, `site ${remote.name}`));
    }
  });

  // The watermark is only written when the pull actually succeeded. Recording
  // one after a failure would make the next sync skip everything that changed
  // while the network was down.
  if (!result.errors.length) {
    await writeSyncState({
      resource: 'sites',
      lastSyncedAt: startedAt,
      // From the records rather than the clock, and unchanged where an
      // incremental pull learned nothing. See nextWatermark, which is where
      // that rule is written down and tested.
      ...nextWatermark(
        remoteSites as unknown as Record<string, unknown>[],
        siteMode,
        startedAt,
        siteState,
        sitesTruncated,
      ),
      mode: siteMode,
    }, startedAt);
  }

  progress('Reading jobs', 1);

  const siteIdByRemote = indexSitesByRemote(existing, siteIdByExternal);

  /*
   * Every job on the books, at list level, with the full column set.
   *
   * The ceiling was 500 against 4,562 jobs, so a full pull held the five
   * hundred most recently changed and called itself a sync. The list row now
   * carries what the job screen shows — order number, status and its colour,
   * technicians, the sell total — and what sits under a job is read on demand
   * further down.
   */
  const jobState = await readSyncState('jobs');
  const jobPlan = planIncremental('jobs', jobState.lastChangeSeenAt, { force });
  const errorsBeforeJobs = result.errors.length;

  try {
    const { jobs: remoteJobs, truncated: jobsTruncated } = await api.jobsPaged(jobPlan.query, JOB_CEILING);
    const outcome = assessIncremental(remoteJobs, jobPlan, jobState.lastRecordCount);
    result.modes.jobs = outcome.mode;
    if (outcome.note) result.notes.push(outcome.note);
    if (jobsTruncated) {
      result.notes.push(
        `More than ${JOB_CEILING} jobs matched, so only the ${JOB_CEILING} most recently changed were read. `
        + 'The watermark was not moved, so the rest are still asked for next time.',
      );
    }
    const held = await heldJobExternalIds();
    await inPages(remoteJobs, async (job, i) => {
      if (i % 25 === 0) progress('Jobs', i, remoteJobs.length);
      try {
        await upsertJob(jobRowFromSimpro(job, job.siteId ? siteIdByRemote.get(job.siteId) : undefined));
        if (held.has(job.id)) result.jobsUpdated++;
        else result.jobsAdded++;
      } catch (e) {
        result.errors.push(describe(e, `job ${job.id}`));
      }
    });
    if (result.errors.length === errorsBeforeJobs) {
      await writeSyncState({
        resource: 'jobs',
        lastSyncedAt: startedAt,
        ...nextWatermark(
          remoteJobs as unknown as Record<string, unknown>[],
          outcome.mode,
          startedAt,
          jobState,
          jobsTruncated,
        ),
        mode: outcome.mode,
      }, startedAt);
    }
  } catch (e) {
    result.errors.push(describe(e, 'jobs'));
  }

  progress('Reading assets', 2);

  /*
   * The register itself: 12,546 assets across 898 of the office's sites.
   *
   * Nothing pulled these before. The endpoint was written and never called, so
   * a technician arriving on site had the site record and no idea what
   * equipment was in the building — the one thing the job is about.
   *
   * The site index is seeded from every site held locally, not only from the
   * ones this run happened to read. On an incremental sync a handful of sites
   * come down and the rest of the index would be empty, so all but a few
   * thousand assets would be filed as having no site and skipped.
   */

  const assetState = await readSyncState('assets');
  const assetPlan = planIncremental('assets', assetState.lastChangeSeenAt, { force });
  const errorsBeforeAssets = result.errors.length;
  const unmappedTypes = new Set<string>();

  try {
    const { assets: remoteAssets, truncated } = await api.customerAssetsPaged(undefined, assetPlan.query);
    if (truncated) {
      // The ceiling was hit, so this is a partial register. Said plainly: a
      // technician who trusts a short list walks past equipment.
      result.notes.push(
        `The asset read stopped at ${remoteAssets.length} records before reaching the end. `
        + 'The register held locally is incomplete.',
      );
    }
    const outcome = assessIncremental(remoteAssets, assetPlan, assetState.lastRecordCount);
    result.modes.assets = outcome.mode;
    if (outcome.note) result.notes.push(outcome.note);

    const known = await findByExternalIds(SIMPRO_ASSET_SOURCE, remoteAssets.map((a) => a.id));

    await inPages(remoteAssets, async (remote, i) => {
      if (i % 100 === 0) progress('Assets', i, remoteAssets.length);
      try {
        const mapped = mapSimproAsset(remote);
        // Filed under the unknown type rather than skipped: equipment the
        // app has no routine for is still on the site, and a form that
        // counts the register must be able to say it was not placed.
        if (mapped.unmappedType) unmappedTypes.add(mapped.unmappedType);
        const siteId = mapped.remoteSiteId ? siteIdByRemote.get(mapped.remoteSiteId) : undefined;
        if (!siteId) {
          result.assetsWithoutSite++;
          return;
        }
        const match = known.get(remote.id);
        if (match) {
          // Blanks only. A result the technician recorded on site outranks the
          // office's copy of it, and this runs after every job.
          const patch: Partial<AssetRecord> = {};
          if (!match.locationNote && mapped.input.locationNote) patch.locationNote = mapped.input.locationNote;
          if (!match.installedDate && mapped.input.installedDate) patch.installedDate = mapped.input.installedDate;
          if (!match.lastServicedAt && mapped.input.lastServicedAt) patch.lastServicedAt = mapped.input.lastServicedAt;
          if (!match.lastResult && mapped.input.lastResult) patch.lastResult = mapped.input.lastResult;
          if (statusFor(remote) === 'decommissioned' && match.status !== 'decommissioned') {
            // Not a blank either. An asset the office has archived is gone,
            // and it stayed in service on every phone for good.
            patch.status = 'decommissioned';
          }
          if (mapped.input.nextDueAt && match.nextDueAt !== mapped.input.nextDueAt) {
            // The exception to blanks-only: when the next service falls due is
            // the office's to set, and a stale date sends nobody or sends them
            // to the wrong building on the wrong day.
            patch.nextDueAt = mapped.input.nextDueAt;
          }
          if (Object.keys(patch).length) {
            await updateAsset(match.id, patch);
            result.assetsUpdated++;
          }
        } else {
          await createAsset({ ...mapped.input, siteId, assetTypeId: mapped.input.assetTypeId });
          result.assetsAdded++;
        }
      } catch (e) {
        result.errors.push(describe(e, `asset ${remote.id}`));
      }
    });

    if (unmappedTypes.size) {
      result.notes.push(
        `${unmappedTypes.size} Simpro asset type${unmappedTypes.size === 1 ? '' : 's'} did not match `
        + `anything this app knows about; ${unmappedTypes.size === 1 ? 'its' : 'their'} assets are held as `
        + `unrecognised equipment with no service routine: ${[...unmappedTypes].join(', ')}.`,
      );
    }
    if (result.assetsWithoutSite) {
      result.notes.push(
        `${result.assetsWithoutSite} assets were skipped because their Simpro site is not held on `
        + 'this device. Pull sites first, or run a forced sync.',
      );
    }

    if (result.errors.length === errorsBeforeAssets) {
      await writeSyncState({
        resource: 'assets',
        lastSyncedAt: startedAt,
        ...nextWatermark(
          remoteAssets as unknown as Record<string, unknown>[],
          outcome.mode,
          startedAt,
          assetState,
          truncated,
        ),
        mode: outcome.mode,
      }, startedAt);
    }
  } catch (e) {
    result.errors.push(describe(e, 'assets'));
  }

  progress('Reading rates', 3);

  // Always whole: the setup endpoints carry no modification date, so there is
  // nothing to ask "what changed" against. It is cheap — a rate card is tens of
  // records, not thousands — and it is the data a wrong copy costs most.
  const errorsBeforeRates = result.errors.length;
  try {
    const card = await api.rateCard();
    for (const u of card.unreadable) {
      result.errors.push(`${u.what}: ${u.error}`);
    }
    if (card.rates.length || card.fees.length) {
      await saveRateCard(card.rates, card.fees);
      result.ratesRead = card.rates.length;
      result.feesRead = card.fees.length;
      result.notes.push(...card.notes);
      // Worth carrying up: a rate filed one letter out is never selected for
      // anyone, and nothing else in the app will ever mention it.
      result.notes.push(...card.suspect);
    }
    result.modes.rates = 'full';
    if (result.errors.length === errorsBeforeRates) {
      await writeSyncState({
        resource: 'rates',
        lastSyncedAt: startedAt,
        lastChangeSeenAt: startedAt,
        lastRecordCount: card.rates.length + card.fees.length,
        mode: 'full',
      }, startedAt);
    }
  } catch (e) {
    result.errors.push(describe(e, 'rates'));
  }

  progress('Reading employees', 4);

  /*
   * The staff list, whole, every time. A few dozen rows, no modification date
   * to filter on, and the reason it exists is to let a phone say whose it is —
   * so somebody who has left must stop being offered, which only a wholesale
   * replace guarantees. Its own try: a key that cannot read employees still
   * gets its sites and assets, and says so in one line.
   */
  try {
    const people = await api.employees();
    result.employeesRead = await replaceEmployees(people);
    result.modes.employees = 'full';
    result.notes.push(
      `${result.employeesRead} ${result.employeesRead === 1 ? 'employee' : 'employees'} read from Simpro.`,
    );
    await writeSyncState({
      resource: 'employees',
      lastSyncedAt: startedAt,
      lastChangeSeenAt: startedAt,
      lastRecordCount: result.employeesRead,
      mode: 'full',
    }, startedAt);
  } catch (e) {
    result.errors.push(describe(e, 'employees'));
  }

  progress('Reading schedules', 5);

  /*
   * The office's schedule for a window around today — a week back, three
   * weeks ahead — for everyone, so the day screen can pick out one person's
   * without a second sync when the phone learns whose it is.
   *
   * One read with a date-range filter, which Simpro documents but this
   * sandbox could not confirm against the build. If the build rejects the
   * filter the server's own words go into the notes, and today and tomorrow
   * are read a day at a time instead, so the technician still gets the two
   * days that matter most. The window replaced locally is the one actually
   * read, so a fallback does not throw away the rest of the month.
   */
  try {
    const window = scheduleWindow(startedAt);
    let covered = { from: window.from, to: window.to };
    let blocks: Awaited<ReturnType<SimproResources['schedulesBetween']>>;
    try {
      blocks = await api.schedulesBetween(window.from, window.to);
    } catch (e) {
      const rejectedFilter = e instanceof SimproError && rejectedTheDateRange(e.status, e.message);
      if (!rejectedFilter) throw e;
      result.notes.push(
        `Simpro rejected the schedule date filter Date=${scheduleDateFilter(window.from, window.to)} `
        + `— it said: ${e.message} Only today and tomorrow were read, a day at a time.`,
      );
      blocks = [
        ...(await api.schedulesForDate(window.today)),
        ...(await api.schedulesForDate(window.tomorrow)),
      ];
      covered = { from: window.today, to: window.tomorrow };
    }
    result.schedulesRead = await replaceScheduleWindow(covered.from, covered.to, blocks);
    result.modes.schedules = 'full';
    result.notes.push(
      `${result.schedulesRead} schedule ${result.schedulesRead === 1 ? 'block' : 'blocks'} read `
      + `for ${covered.from} to ${covered.to}.`,
    );
    await writeSyncState({
      resource: 'schedules',
      lastSyncedAt: startedAt,
      lastChangeSeenAt: startedAt,
      lastRecordCount: result.schedulesRead,
      mode: 'full',
    }, startedAt);
  } catch (e) {
    result.errors.push(describe(e, 'schedules'));
  }

  progress('Reading customers', 6);

  /*
   * Every customer — 2,482 companies and a handful of individuals — at list
   * level. Whole on a full pull, and then the ones the pull did not see are
   * pruned: a customer deleted in the office has to leave the phone too, and
   * only a full read can say who was not there. The individuals are read in
   * their own try so an unverified column set on four rows cannot cost the
   * companies.
   */
  const customerState = await readSyncState('customers');
  const customerPlan = planIncremental('customers', customerState.lastChangeSeenAt, { force });
  const errorsBeforeCustomers = result.errors.length;
  try {
    const companies = await mirror.companiesPaged(customerPlan.query, CUSTOMER_CEILING);
    const companiesRefused = columnsRefused('customer', companies);
    if (companiesRefused) result.errors.push(companiesRefused);
    /*
     * The individuals are their own read and their own try, so the four
     * rows on this build cannot cost the companies. But a read that failed
     * or came back thin is not a read that saw nobody: the prune below
     * deletes every customer the run did not stamp, and with the
     * individuals unread that was every individual customer, every time
     * the read failed. So the prune waits for both reads to come back
     * whole and uncut.
     */
    let individuals: PagedRead<SimproCustomer> | undefined;
    try {
      individuals = await mirror.individualsPaged(customerPlan.query, CUSTOMER_CEILING);
      const refused = columnsRefused('individual customer', individuals);
      if (refused) result.errors.push(refused);
    } catch (e) {
      result.notes.push(`Individual customers were not read: ${describe(e, 'individuals')}`);
    }
    const customers = [
      ...(companiesRefused ? [] : companies.items),
      ...(individuals && !individuals.columnsRejected ? individuals.items : []),
    ];
    const outcome = assessIncremental(customers, customerPlan, customerState.lastRecordCount);
    result.modes.customers = outcome.mode;
    if (outcome.note) result.notes.push(outcome.note);
    if (companies.truncated) {
      result.notes.push(`The customer read stopped at ${companies.items.length} records before reaching the end.`);
    }
    if (individuals?.truncated) {
      result.notes.push(`The individual customer read stopped at ${individuals.items.length} records before reaching the end.`);
    }
    await inPages(customers, async (c, i) => {
      if (i % 100 === 0) progress('Customers', i, customers.length);
      try {
        if (c.id) await upsertCustomer(c, startedAt);
        result.customersRead++;
      } catch (e) {
        result.errors.push(describe(e, `customer ${c.id}`));
      }
    });
    const sawEveryone = outcome.mode === 'full' && !companies.truncated && individuals !== undefined && !individuals.truncated;
    if (result.errors.length === errorsBeforeCustomers) {
      if (sawEveryone) {
        const pruned = await pruneCustomersNotSyncedAt(startedAt);
        if (pruned) result.notes.push(`${pruned} ${pruned === 1 ? 'customer' : 'customers'} no longer in Simpro removed.`);
      }
      await writeSyncState({
        resource: 'customers',
        lastSyncedAt: startedAt,
        ...nextWatermark(
          customers as unknown as Record<string, unknown>[], outcome.mode, startedAt, customerState,
          companies.truncated || !!individuals?.truncated,
        ),
        mode: outcome.mode,
      }, startedAt);
    }
  } catch (e) {
    result.errors.push(describe(e, 'customers'));
  }

  progress('Reading quotes', 7);

  const quoteState = await readSyncState('quotes');
  const quotePlan = planIncremental('quotes', quoteState.lastChangeSeenAt, { force });
  const errorsBeforeQuotes = result.errors.length;
  try {
    const read = await mirror.quotesPaged(quotePlan.query, QUOTE_CEILING);
    const refused = columnsRefused('quote', read);
    if (refused) throw new Error(refused);
    const outcome = assessIncremental(read.items, quotePlan, quoteState.lastRecordCount);
    result.modes.quotes = outcome.mode;
    if (outcome.note) result.notes.push(outcome.note);
    if (read.truncated) {
      result.notes.push(`More than ${QUOTE_CEILING} quotes matched, so only the most recently changed were read.`);
    }
    await inPages(read.items, async (q, i) => {
      if (i % 50 === 0) progress('Quotes', i, read.items.length);
      try {
        if (q.id) await upsertQuote(q, q.siteId ? siteIdByRemote.get(q.siteId) : undefined, startedAt);
        result.quotesRead++;
      } catch (e) {
        result.errors.push(describe(e, `quote ${q.id}`));
      }
    });
    if (result.errors.length === errorsBeforeQuotes) {
      await writeSyncState({
        resource: 'quotes',
        lastSyncedAt: startedAt,
        ...nextWatermark(read.items as unknown as Record<string, unknown>[], outcome.mode, startedAt, quoteState, read.truncated),
        mode: outcome.mode,
      }, startedAt);
    }
  } catch (e) {
    result.errors.push(describe(e, 'quotes'));
  }

  progress('Reading invoices', 8);

  /*
   * Two years of invoices by issue date on a full pull; only what changed on
   * an incremental one. Two years is what a conversation on site reaches
   * back to — "you still owe us for March" — and the rest stays in the
   * office where the money is chased.
   */
  const invoiceState = await readSyncState('invoices');
  const invoicePlan = planIncremental('invoices', invoiceState.lastChangeSeenAt, { force });
  const errorsBeforeInvoices = result.errors.length;
  try {
    const query = invoicePlan.mode === 'full'
      ? { DateIssued: dateSinceFilter(invoiceWindowStart(startedAt)) }
      : invoicePlan.query;
    const read = await mirror.invoicesPaged(query, INVOICE_CEILING);
    const refused = columnsRefused('invoice', read);
    if (refused) throw new Error(refused);
    const outcome = assessIncremental(read.items, invoicePlan, invoiceState.lastRecordCount);
    result.modes.invoices = outcome.mode;
    if (outcome.note) result.notes.push(outcome.note);
    if (read.truncated) {
      result.notes.push(`More than ${INVOICE_CEILING} invoices matched, so only the most recently changed were read.`);
    }
    await inPages(read.items, async (inv, i) => {
      if (i % 50 === 0) progress('Invoices', i, read.items.length);
      try {
        if (inv.id) await upsertInvoice(inv, startedAt);
        result.invoicesRead++;
      } catch (e) {
        result.errors.push(describe(e, `invoice ${inv.id}`));
      }
    });
    if (result.errors.length === errorsBeforeInvoices) {
      await writeSyncState({
        resource: 'invoices',
        lastSyncedAt: startedAt,
        ...nextWatermark(read.items as unknown as Record<string, unknown>[], outcome.mode, startedAt, invoiceState, read.truncated),
        mode: outcome.mode,
      }, startedAt);
    }
  } catch (e) {
    result.errors.push(describe(e, 'invoices'));
  }

  progress('Reading tasks', 9);

  // A handful of rows, read whole; the company list carries no job link, so
  // the rows are upserted rather than replaced and keep the link a job read made.
  try {
    const read = await mirror.tasks();
    const refused = columnsRefused('task', read);
    if (refused) throw new Error(refused);
    result.tasksRead = await upsertTasks(read.items, startedAt);
    result.modes.tasks = 'full';
    await writeSyncState({
      resource: 'tasks',
      lastSyncedAt: startedAt,
      lastChangeSeenAt: startedAt,
      lastRecordCount: result.tasksRead,
      mode: 'full',
    }, startedAt);
  } catch (e) {
    result.errors.push(describe(e, 'tasks'));
  }

  if (options?.prefetchDetails !== false) {
    progress('Reading job details', 10);

    /*
     * What sits under a job, for the jobs that will be opened: the ones on
     * the schedule from today out, this person's first where the phone knows
     * whose it is, and then whatever the office touched in the last
     * fortnight. Capped, because each is a dozen requests, and skipped where
     * read in the last quarter hour.
     */
    try {
      const window = scheduleWindow(startedAt);
      const scheduled = await scheduledJobExternalIds({
        from: window.today, to: window.to, staffId: options?.staffId, staffName: options?.staffName,
      });
      const wanted = await jobsWantingDetail({
        preferExternalIds: scheduled,
        modifiedSince: addDays(window.today, -MODIFIED_WINDOW_DAYS),
        maxAgeMs: DETAIL_FRESH_MS,
        limit: DETAIL_PREFETCH_CAP,
      });
      const out = await readJobDetails(mirror, siteIdByRemote, wanted, (done, total) => progress('Job details', done, total));
      result.jobDetailsRead = out.read;
      if (out.partial.length) {
        // One line for the whole run, not one per job: a key that cannot
        // read notes says so once, in the server's words.
        result.notes.push(
          `Some job records were read without every family under them: ${out.partial.slice(0, 3).join('; ')}`
          + (out.partial.length > 3 ? '; …' : ''),
        );
      }
      if (out.failures.length) {
        result.notes.push(
          `${out.failures.length} of ${wanted.length} job records could not be read in full: `
          + out.failures.slice(0, 3).map((f) => `job ${f.externalId}: ${f.error}`).join('; ')
          + (out.failures.length > 3 ? '; …' : ''),
        );
      }
    } catch (e) {
      result.errors.push(describe(e, 'job details'));
    }

    progress('Reading quote details', 11);

    try {
      const today = qldIsoDay(startedAt) ?? '';
      const wanted = await quotesWantingDetail({
        modifiedSince: addDays(today, -MODIFIED_WINDOW_DAYS),
        maxAgeMs: DETAIL_FRESH_MS,
        limit: QUOTE_PREFETCH_CAP,
      });
      const failures: string[] = [];
      for (const [i, id] of wanted.entries()) {
        progress('Quote details', i, wanted.length);
        try {
          await readQuoteDetail(mirror, siteIdByRemote, id);
          result.quoteDetailsRead++;
        } catch (e) {
          failures.push(`quote ${id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (failures.length) {
        result.notes.push(
          `${failures.length} of ${wanted.length} quote records could not be read in full: `
          + failures.slice(0, 3).join('; ') + (failures.length > 3 ? '; …' : ''),
        );
      }
    } catch (e) {
      result.errors.push(describe(e, 'quote details'));
    }
  }

  progress('Done', TOTAL_STAGES);
  return result;
}

function describe(e: unknown, what: string): string {
  if (e instanceof SimproError) {
    return e.status === 403
      ? `No permission to read ${what}. Simpro sets API permissions per endpoint.`
      : `${what}: ${e.message}`;
  }
  return `${what}: ${e instanceof Error ? e.message : String(e)}`;
}

// ---------------------------------------------------------------------------
// What sits under a job: read on demand
// ---------------------------------------------------------------------------

export type JobDetailOutcome =
  | { status: 'synced'; /** Child families that could not be read, with the server's words. */ partial: string[] }
  | { status: 'fresh' }
  | { status: 'missing' }
  | { status: 'not-simpro' }
  | { status: 'failed'; error: string };

/**
 * Reads one job's record and everything under it, and stores it.
 *
 * The record itself has to come back or nothing is written. Each child
 * family — sections and lines, notes, attachments, the timeline, tasks,
 * invoices — is its own request and its own try: a key that cannot read
 * notes still gets the sections, and the family it could not read is left
 * as it was rather than wiped. The job is stamped read when at least one
 * family came back, so a permission the office has not granted is not
 * asked for every minute; a job where nothing under it could be read is a
 * failed read and says so, rather than a fresh stamp over last week's
 * children.
 *
 * The record is written as the record (`fromDetail`), so a note the office
 * deleted leaves the phone. Invoices under the job are only linked, not
 * written whole, unless the row plainly is the invoice — see
 * linkJobInvoice for why.
 */
async function readOneJobDetail(
  mirror: SimproMirror,
  siteIdByRemote: Map<string, string>,
  job: Pick<JobRecord, 'id' | 'externalId'>,
): Promise<string[]> {
  const externalId = job.externalId!;
  const detail = await mirror.jobDetail(externalId);
  const siteId = detail.siteId ? siteIdByRemote.get(detail.siteId) : undefined;
  await upsertJob({ ...jobRowFromSimpro(detail, siteId), id: job.id }, { fromDetail: true });

  const partial: string[] = [];
  let familiesRead = 0;
  const children: Partial<JobChildren> = {};
  const attempt = async <K extends keyof JobChildren>(key: K, what: string, read: () => Promise<JobChildren[K]>) => {
    try {
      children[key] = await read();
      familiesRead++;
    } catch (e) {
      partial.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  await attempt('sections', 'sections', () => mirror.jobSections(externalId));
  await attempt('notes', 'notes', () => mirror.jobNotes(externalId));
  await attempt('attachments', 'attachments', () => mirror.jobAttachments(externalId));
  await attempt('timeline', 'timeline', () => mirror.jobTimelines(externalId));
  await attempt('tasks', 'tasks', () => mirror.jobTasks(externalId));

  let invoices: SimproInvoice[] = [];
  try {
    invoices = await mirror.jobInvoices(externalId);
    familiesRead++;
  } catch (e) {
    partial.push(`invoices: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!familiesRead) {
    throw new Error(`nothing under the job could be read: ${partial.join('; ')}`);
  }

  const at = new Date().toISOString();
  await withMirrorTransaction(async () => {
    await replaceJobChildren(job.id, children, at);
    for (const inv of invoices) {
      if (!inv.id) continue;
      if (invoiceRowIsWhole(inv)) await upsertInvoice(inv, at);
      else await linkJobInvoice(externalId, inv, at);
    }
  });
  return partial;
}

async function readJobDetails(
  mirror: SimproMirror,
  siteIdByRemote: Map<string, string>,
  jobs: readonly { id: string; externalId: string }[],
  onProgress?: (done: number, total: number) => void,
): Promise<{
  read: number;
  failures: { externalId: string; error: string }[];
  /** The distinct family errors across the jobs that were read, for one note. */
  partial: string[];
}> {
  let read = 0;
  const failures: { externalId: string; error: string }[] = [];
  const partial = new Set<string>();
  for (const [i, job] of jobs.entries()) {
    onProgress?.(i, jobs.length);
    try {
      for (const p of await readOneJobDetail(mirror, siteIdByRemote, job)) partial.add(p);
      read++;
    } catch (e) {
      failures.push({ externalId: job.externalId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { read, failures, partial: [...partial] };
}

/**
 * Reads a job's record and children now, for the screen that just opened it.
 *
 * Skipped where they were read in the last quarter hour, unless forced: a
 * screen that re-reads on every focus would otherwise spend a dozen
 * requests each time somebody flicks back to it. A job that did not come
 * from the office has nothing to read.
 */
export async function syncJobDetail(
  config: SimproConfig,
  localJobId: string,
  options: { force?: boolean; maxAgeMs?: number } = {},
): Promise<JobDetailOutcome> {
  const job = await getJob(localJobId);
  if (!job) return { status: 'missing' };
  if (!job.externalId) return { status: 'not-simpro' };
  if (!options.force && !jobDetailIsStale(job, options.maxAgeMs ?? DETAIL_FRESH_MS)) return { status: 'fresh' };

  const missing = await SimproClient.missingCredentials(config);
  if (missing) return { status: 'failed', error: missing };

  try {
    const mirror = new SimproMirror(new SimproClient(config));
    const siteIdByRemote = indexSitesByRemote(await listSites());
    const partial = await readOneJobDetail(mirror, siteIdByRemote, job);
    return { status: 'synced', partial };
  } catch (e) {
    return { status: 'failed', error: describe(e, `job ${job.externalId}`) };
  }
}

/**
 * Reads the children of several jobs, the way a pull does at its end, for a
 * caller that knows which ones matter — a day screen, say, before the van
 * leaves signal. Jobs read within the last quarter hour are skipped unless
 * forced; the cap is the same as the pull's.
 */
export async function prefetchJobDetails(
  config: SimproConfig,
  options: { jobIds: readonly string[]; force?: boolean; limit?: number },
  onProgress?: (p: SyncProgress) => void,
): Promise<{ read: number; skipped: number; failures: { jobId: string; error: string }[] }> {
  const missing = await SimproClient.missingCredentials(config);
  if (missing) return { read: 0, skipped: 0, failures: options.jobIds.map((jobId) => ({ jobId, error: missing })) };

  const mirror = new SimproMirror(new SimproClient(config));
  const siteIdByRemote = indexSitesByRemote(await listSites());
  const limit = options.limit ?? DETAIL_PREFETCH_CAP;

  const wanted: { id: string; externalId: string }[] = [];
  let skipped = 0;
  for (const id of options.jobIds) {
    const job = await getJob(id);
    if (!job?.externalId) { skipped++; continue; }
    if (!options.force && !jobDetailIsStale(job, DETAIL_FRESH_MS)) { skipped++; continue; }
    if (wanted.length >= limit) { skipped++; continue; }
    wanted.push({ id: job.id, externalId: job.externalId });
  }

  const out = await readJobDetails(mirror, siteIdByRemote, wanted, (done, total) =>
    onProgress?.({ stage: 'Job details', done, total }));
  const byExternal = new Map(wanted.map((w) => [w.externalId, w.id]));
  return {
    read: out.read,
    skipped,
    failures: out.failures.map((f) => ({ jobId: byExternal.get(f.externalId) ?? f.externalId, error: f.error })),
  };
}

// ---------------------------------------------------------------------------
// Quotes: the same, on demand
// ---------------------------------------------------------------------------

async function readQuoteDetail(mirror: SimproMirror, siteIdByRemote: Map<string, string>, externalId: string): Promise<string[]> {
  const detail = await mirror.quoteDetail(externalId);
  const at = new Date().toISOString();
  await upsertQuote(detail, detail.siteId ? siteIdByRemote.get(detail.siteId) : undefined, at, { fromDetail: true });

  const partial: string[] = [];
  const children: Partial<QuoteChildren> = {};
  const attempt = async <K extends keyof QuoteChildren>(key: K, read: () => Promise<QuoteChildren[K]>) => {
    try {
      children[key] = await read();
    } catch (e) {
      partial.push(`${key}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  await attempt('sections', () => mirror.quoteSections(externalId));
  await attempt('notes', () => mirror.quoteNotes(externalId));
  await attempt('attachments', () => mirror.quoteAttachments(externalId));
  await replaceQuoteChildren(externalId, children, at);
  return partial;
}

export type QuoteDetailOutcome =
  | { status: 'synced'; partial: string[] }
  | { status: 'fresh' }
  | { status: 'missing' }
  | { status: 'failed'; error: string };

/** Reads one quote's record and children now. Skipped where read in the last quarter hour unless forced. */
export async function syncQuoteDetail(
  config: SimproConfig,
  quoteExternalId: string,
  options: { force?: boolean; maxAgeMs?: number } = {},
): Promise<QuoteDetailOutcome> {
  const quote = await getQuote(quoteExternalId);
  if (!quote) return { status: 'missing' };
  if (!options.force && !jobDetailIsStale(quote, options.maxAgeMs ?? DETAIL_FRESH_MS)) return { status: 'fresh' };

  const missing = await SimproClient.missingCredentials(config);
  if (missing) return { status: 'failed', error: missing };

  try {
    const mirror = new SimproMirror(new SimproClient(config));
    const siteIdByRemote = indexSitesByRemote(await listSites());
    const partial = await readQuoteDetail(mirror, siteIdByRemote, quoteExternalId);
    return { status: 'synced', partial };
  } catch (e) {
    return { status: 'failed', error: describe(e, `quote ${quoteExternalId}`) };
  }
}

// ---------------------------------------------------------------------------
// Sites: the office's own record, on demand
// ---------------------------------------------------------------------------

export type SiteDetailOutcome =
  | { status: 'synced' }
  | { status: 'fresh' }
  | { status: 'missing' }
  | { status: 'not-simpro' }
  | { status: 'failed'; error: string };

/**
 * Reads the office's own record of a site, for the screen that just opened
 * it: the public notes and the customer number, which the site list may
 * not carry. The same quarter-hour rule as a job. A site that did not come
 * from the office has no record to read.
 */
export async function syncSiteDetail(
  config: SimproConfig,
  localSiteId: string,
  options: { force?: boolean; maxAgeMs?: number } = {},
): Promise<SiteDetailOutcome> {
  const site = await getSite(localSiteId);
  if (!site) return { status: 'missing' };
  const externalId = site.externalSource === SIMPRO_SOURCE && site.externalId
    ? site.externalId
    : site.siteRef?.startsWith('SIMPRO:') ? site.siteRef.slice('SIMPRO:'.length) : undefined;
  if (!externalId) return { status: 'not-simpro' };
  if (!options.force && !jobDetailIsStale(site, options.maxAgeMs ?? DETAIL_FRESH_MS)) return { status: 'fresh' };

  const missing = await SimproClient.missingCredentials(config);
  if (missing) return { status: 'failed', error: missing };

  try {
    const detail = await new SimproMirror(new SimproClient(config)).siteDetail(externalId);
    await setSiteOffice(localSiteId, {
      publicNotes: detail.publicNotes ?? null,
      customerExternalId: detail.customers[0]?.id ?? null,
      detailSyncedAt: new Date().toISOString(),
    });
    return { status: 'synced' };
  } catch (e) {
    return { status: 'failed', error: describe(e, `site ${externalId}`) };
  }
}

// ---------------------------------------------------------------------------
// Outbound
// ---------------------------------------------------------------------------

/**
 * What the queue carries. Every kind here has a branch in flushQueue; a kind
 * without one is marked sent and silently dropped, which is why the two are
 * added together or not at all.
 */
export type OutboundKind = 'job-note' | 'purchase-order' | 'asset-test' | 'attachment';

export interface JobNotePayload { jobId: string; subject: string; note: string }
/** A photograph bound for a job's attachments. The plan builds it; see attachmentsForDefect. */
export type JobAttachmentPayload = OutboundAttachment;
export interface PurchaseOrderPayload {
  /** The local purchase request, so the order id Simpro returns can be written back onto it. */
  requestId?: string;
  jobId?: string;
  vendorId?: number;
  notes?: string;
  lines: { partNumber: string; description: string; quantity: number }[];
}

/**
 * Queues work for the office.
 *
 * Queued rather than sent, always — a technician in a basement has no signal,
 * and losing a defect note because of that is exactly the failure this app
 * exists to avoid. The queue is then sent a moment later if there is signal,
 * so queued and sent are usually two seconds apart; see ./flushSoon.
 */
export async function queueJobNote(payload: JobNotePayload): Promise<void> {
  await enqueueSync('job-note', payload);
  flushSoon();
}

export async function queuePurchaseOrder(payload: PurchaseOrderPayload): Promise<void> {
  await enqueueSync('purchase-order', payload);
  flushSoon();
}

/**
 * Queues one photograph for a job's attachments.
 *
 * The file is not read here. A photograph is megabytes and the phone may be
 * in a basement, so the queue row carries the path and the file is read the
 * moment it is sent. The key is the job, the name and the size on disk —
 * never the path, which differs between phones and moves on reinstall — so
 * the same photograph of the same defect queues once however many times the
 * send screen is pressed. Returns whether it was already there.
 */
export async function queueJobAttachment(payload: JobAttachmentPayload): Promise<{ id: string; duplicate: boolean }> {
  const key = attachmentContentKey({ jobId: payload.jobId, filename: payload.filename, sizeBytes: payload.sizeBytes });
  const row = await enqueueSync('attachment', { ...payload, key }, { contentKey: key });
  if (!row.duplicate) flushSoon();
  return row;
}

/**
 * The file behind a queued attachment, or why it could not be read.
 *
 * A read failure is never an unknown outcome — no request went out — and a
 * missing file is final: no retry brings it back, so it is said once and the
 * item is closed. Anything else (no memory for the bitmap, a locked file)
 * gets the ordinary retries.
 */
async function readQueuedAttachment(
  payload: JobAttachmentPayload,
): Promise<{ file: ReadAttachment } | { error: string; permanent: boolean }> {
  try {
    return { file: await readAttachmentForUpload(payload) };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : String(e),
      permanent: e instanceof AttachmentFileMissing,
    };
  }
}

export interface FlushResult {
  sent: number;
  failed: number;
  remaining: number;
  /**
   * Set when the run stopped before the queue was through: the office could
   * not be reached, the credentials were refused, the build is throttling,
   * or the connection is not set up. The rows it did not reach are left
   * pending with their attempts untouched, since nothing was their fault.
   */
  stopped?: { why: 'credentials' | 'throttled' | 'configuration' | 'offline'; reason: string };
}

/** The Simpro job an item is bound for, where it has one. */
function jobIdOf(kind: string, payload: unknown): string | undefined {
  if (kind === 'asset-test') return undefined;
  const id = (payload as { jobId?: unknown } | null)?.jobId;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Sends whatever is queued.
 *
 * Before the first item, one small read: if the office cannot be reached
 * at all — no signal, no secret, a secret the office has regenerated —
 * the run stops there with nothing touched. Without that the failure
 * landed on the first item instead, where a token that never came back was
 * indistinguishable from a request that never came back, and the item and
 * every one after it were filed as unknown for a person to adjudicate.
 *
 * What to do with each failure after that is decided in ./sendOutcome. A
 * stop leaves the rest pending; nothing after it would go either, and
 * five failed attempts each would only spend the retries against a problem
 * the office fixes.
 */
export async function flushQueue(config: SimproConfig): Promise<FlushResult> {
  const items = await pendingSync(50);
  if (!items.length) return { sent: 0, failed: 0, remaining: 0 };

  const client = new SimproClient(config);
  const api = new SimproResources(client);
  let sent = 0;
  let failed = 0;
  let stopped: FlushResult['stopped'];

  try {
    await client.listCompanies();
  } catch (e) {
    const failure = reachabilityFailure(e);
    if (failure) return { sent, failed, remaining: items.length, stopped: { why: failure.why, reason: failure.reason } };
  }

  for (const item of items) {
    const key = item.contentKey ?? undefined;
    let payload: unknown;
    try {
      payload = JSON.parse(item.payload);
    } catch (e) {
      // Not a send that failed: a row that cannot be read will never be
      // sendable, so it is closed now with the reason on it.
      failed++;
      await abandonSync(item.id, `The queued item could not be read: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    try {
      if (item.kind === 'job-note') {
        const p = payload as JobNotePayload;
        /*
         * A note keyed the way the service record is — a Safe QLD marker in
         * the text — may already be on the job: another handset sent it, or
         * this one did before a reinstall emptied the queue. The job's notes
         * are the record that survives the phone, so they are read first,
         * the way the service record's sender does. Where they cannot be
         * read the note goes anyway; a duplicate is recoverable and a lost
         * completion is not.
         */
        if (key && keysInNoteText(markerFor(key)).length) {
          const onJob = await keysAlreadyOnJob(client, p.jobId);
          if (onJob?.has(key)) {
            await markSynced(item.id);
            sent++;
            continue;
          }
        }
        // The marker rides in the note itself, so the job carries the proof
        // that this was sent even if the phone that sent it is gone.
        await api.addJobNote(p.jobId, p.subject, key ? withMarker(p.note, key) : p.note);
      } else if (item.kind === 'purchase-order') {
        const p = payload as PurchaseOrderPayload;
        const order = await api.createPurchaseOrder({ ...p, notes: key ? withMarker(p.notes, key) : p.notes });
        if (p.requestId) await setPurchaseStatus(p.requestId, 'ordered', order.id);
      } else if (item.kind === 'asset-test') {
        const p = payload as OutboundAssetTest;
        await api.postAssetTest(p.externalAssetId, p.result, p.testedAt, p.serviceLevelId);
      } else if (item.kind === 'attachment') {
        const p = payload as JobAttachmentPayload;
        const read = await readQueuedAttachment(p);
        if ('error' in read) {
          failed++;
          if (read.permanent) await abandonSync(item.id, read.error);
          else await markSyncFailed(item.id, read.error);
          continue;
        }
        // A 2xx without a file id in the reply is still accepted bytes; the
        // reply shape was not verified on the live build, so it is not
        // insisted on. An upload that got no reply at all falls through to
        // the unknown rule below like any other post.
        await uploadJobAttachment(client, p.jobId, {
          filename: read.file.filename, mimeType: read.file.mimeType, base64: read.file.base64,
        });
      } else {
        // Unknown kinds are marked done rather than retried forever.
        await markSynced(item.id);
        continue;
      }
      await markSynced(item.id);
      sent++;
    } catch (e) {
      const failure = sendFailure({ kind: item.kind, jobId: jobIdOf(item.kind, payload) }, e);
      if (failure.outcome === 'stop') {
        stopped = { why: failure.why, reason: failure.reason };
        break;
      }
      failed++;
      if (failure.outcome === 'abandon') {
        // The server refused the body by name or by size; sending the same
        // megabytes again would only be told the same thing.
        await abandonSync(item.id, failure.reason);
      } else if (failure.outcome === 'retry') {
        // The server answered, so it did not act: safe to try again.
        await markSyncFailed(item.id, failure.reason);
      } else {
        /*
         * No answer at all: the request may have arrived and been acted on
         * before the connection died. A vendor order raised twice is real
         * money and a note posted twice is a real duplicate, so this is not
         * retried by the app. It waits for a person on Waiting to send, who
         * can check Simpro for the marker and either send it again or let it
         * go.
         */
        await markSyncUnknown(item.id, failure.reason);
      }
    }
  }

  const remaining = (await pendingSync(1000)).length;
  return stopped ? { sent, failed, remaining, stopped } : { sent, failed, remaining };
}
