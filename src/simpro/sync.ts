import { SimproClient, SimproError, type SimproConfig } from './client';
import { SimproResources } from './resources';
import { assessIncremental, nextWatermark, planIncremental, type SyncResource } from './incremental';
import { readSyncState, writeSyncState } from './watermark';
import { createSite, listSites, updateSite } from '@/db/repo';
import { saveRateCard } from '@/db/rateCardRepo';
import { upsertJob, enqueueSync, pendingSync, markSynced, markSyncFailed, type JobRecord } from '@/db/opsRepo';
import { matchSiteByRefOrName } from '@/domain/siteNames';
import type { OutboundAssetTest } from '@/domain/outboundWork';
import { createAsset, findByExternalIds, updateAsset, type AssetRecord } from '@/db/assetRepo';
import { mapSimproAsset, SIMPRO_ASSET_SOURCE } from './assetSync';
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
 */

export interface SyncProgress {
  stage: string;
  done: number;
  total: number;
}

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

export async function pullFromSimpro(
  config: SimproConfig,
  onProgress?: (p: SyncProgress) => void,
  options?: { force?: boolean },
): Promise<SyncResult> {
  const client = new SimproClient(config);
  const api = new SimproResources(client);
  const result: SyncResult = {
    sitesAdded: 0, sitesUpdated: 0, jobsAdded: 0, jobsUpdated: 0,
    assetsAdded: 0, assetsUpdated: 0, assetsWithoutSite: 0,
    ratesRead: 0, feesRead: 0,
    errors: [], modes: {}, notes: [],
  };
  const startedAt = new Date().toISOString();

  onProgress?.({ stage: 'Reading sites', done: 0, total: 4 });

  // Ask only for what changed since the last successful sync. At nine hundred
  // sites a full pull every time is slow enough that it stops being done, which
  // is how a local copy quietly becomes weeks old.
  const siteState = await readSyncState('sites');
  const sitePlan = planIncremental('sites', siteState.lastChangeSeenAt, { force: options?.force });

  let remoteSites: Awaited<ReturnType<SimproResources['sites']>> = [];
  let siteMode: 'incremental' | 'full' = 'full';
  try {
    remoteSites = await api.sites(undefined, sitePlan.query);
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

  for (const [i, remote] of remoteSites.entries()) {
    if (i % 25 === 0) onProgress?.({ stage: 'Sites', done: i, total: remoteSites.length });
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
      if (match) {
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
        siteIdByExternal.set(remote.id, created.id);
        existing.push(created);
        result.sitesAdded++;
      }
    } catch (e) {
      result.errors.push(describe(e, `site ${remote.name}`));
    }
  }

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
      ),
      mode: siteMode,
    }, startedAt);
  }

  onProgress?.({ stage: 'Reading jobs', done: 1, total: 4 });

  const jobState = await readSyncState('jobs');
  const jobPlan = planIncremental('jobs', jobState.lastChangeSeenAt, { force: options?.force });
  const errorsBeforeJobs = result.errors.length;

  try {
    const remoteJobs = await api.jobs(jobPlan.query, 500);
    const outcome = assessIncremental(remoteJobs, jobPlan, jobState.lastRecordCount);
    result.modes.jobs = outcome.mode;
    if (outcome.note) result.notes.push(outcome.note);
    for (const [i, job] of remoteJobs.entries()) {
      if (i % 25 === 0) onProgress?.({ stage: 'Jobs', done: i, total: remoteJobs.length });
      try {
        const before = await upsertJobFromSimpro(job, siteIdByExternal);
        if (before) result.jobsAdded++;
        else result.jobsUpdated++;
      } catch (e) {
        result.errors.push(describe(e, `job ${job.id}`));
      }
    }
    if (result.errors.length === errorsBeforeJobs) {
      await writeSyncState({
        resource: 'jobs',
        lastSyncedAt: startedAt,
        ...nextWatermark(
          remoteJobs as unknown as Record<string, unknown>[],
          outcome.mode,
          startedAt,
          jobState,
        ),
        mode: outcome.mode,
      }, startedAt);
    }
  } catch (e) {
    result.errors.push(describe(e, 'jobs'));
  }

  onProgress?.({ stage: 'Reading assets', done: 2, total: 4 });

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
  const siteIdByRemote = new Map(siteIdByExternal);
  for (const site of existing) {
    const remoteId = site.externalSource === SIMPRO_SOURCE ? site.externalId : undefined;
    const fromRef = site.siteRef?.startsWith('SIMPRO:') ? site.siteRef.slice('SIMPRO:'.length) : undefined;
    const key = remoteId ?? fromRef;
    if (key && !siteIdByRemote.has(key)) siteIdByRemote.set(key, site.id);
  }

  const assetState = await readSyncState('assets');
  const assetPlan = planIncremental('assets', assetState.lastChangeSeenAt, { force: options?.force });
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

    for (const [i, remote] of remoteAssets.entries()) {
      if (i % 100 === 0) onProgress?.({ stage: 'Assets', done: i, total: remoteAssets.length });
      try {
        const mapped = mapSimproAsset(remote);
        if (mapped.unmappedType) {
          unmappedTypes.add(mapped.unmappedType);
          continue;
        }
        const siteId = mapped.remoteSiteId ? siteIdByRemote.get(mapped.remoteSiteId) : undefined;
        if (!siteId) {
          result.assetsWithoutSite++;
          continue;
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
    }

    if (unmappedTypes.size) {
      result.notes.push(
        `${unmappedTypes.size} Simpro asset type${unmappedTypes.size === 1 ? '' : 's'} did not match `
        + `anything this app knows about and ${unmappedTypes.size === 1 ? 'was' : 'were'} skipped: `
        + `${[...unmappedTypes].join(', ')}.`,
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
        ),
        mode: outcome.mode,
      }, startedAt);
    }
  } catch (e) {
    result.errors.push(describe(e, 'assets'));
  }

  onProgress?.({ stage: 'Reading rates', done: 3, total: 4 });

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

  onProgress?.({ stage: 'Done', done: 4, total: 4 });
  return result;
}

async function upsertJobFromSimpro(
  job: Awaited<ReturnType<SimproResources['jobs']>>[number],
  siteIdByExternal: Map<string, string>,
): Promise<boolean> {
  const record: Partial<JobRecord> & { siteName: string; title: string } = {
    // A stable local id keyed off the external one, so re-pulling updates
    // rather than duplicating.
    id: `simpro-${job.id}`,
    externalId: job.id,
    siteId: job.siteId ? siteIdByExternal.get(job.siteId) : undefined,
    siteName: job.siteName ?? 'Unknown site',
    customerName: job.customerName,
    title: job.title,
    jobType: job.type,
    stage: job.stage,
    dueAt: job.dueAt,
    scheduledFor: job.issuedAt,
    status: job.stage?.toLowerCase() === 'complete' ? 'complete' : 'scheduled',
  };
  await upsertJob(record);
  return true;
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
// Outbound
// ---------------------------------------------------------------------------

export type OutboundKind = 'job-note' | 'purchase-order';

export interface JobNotePayload { jobId: string; subject: string; note: string }
export interface PurchaseOrderPayload {
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
 * exists to avoid.
 */
export async function queueJobNote(payload: JobNotePayload): Promise<void> {
  await enqueueSync('job-note', payload);
}

export async function queuePurchaseOrder(payload: PurchaseOrderPayload): Promise<void> {
  await enqueueSync('purchase-order', payload);
}

export interface FlushResult {
  sent: number;
  failed: number;
  remaining: number;
}

/**
 * Sends whatever is queued.
 *
 * Stops on the first authentication or permission failure rather than burning
 * through the queue's retry counts against a problem that will not fix itself.
 */
export async function flushQueue(config: SimproConfig): Promise<FlushResult> {
  const client = new SimproClient(config);
  const api = new SimproResources(client);
  const items = await pendingSync(50);
  let sent = 0;
  let failed = 0;

  for (const item of items) {
    try {
      const payload: unknown = JSON.parse(item.payload);
      if (item.kind === 'job-note') {
        const p = payload as JobNotePayload;
        await api.addJobNote(p.jobId, p.subject, p.note);
      } else if (item.kind === 'purchase-order') {
        const p = payload as PurchaseOrderPayload;
        await api.createPurchaseOrder(p);
      } else if (item.kind === 'asset-test') {
        const p = payload as OutboundAssetTest;
        await api.postAssetTest(p.externalAssetId, p.result, p.testedAt, p.serviceLevelId);
      } else {
        // Unknown kinds are marked done rather than retried forever.
        await markSynced(item.id);
        continue;
      }
      await markSynced(item.id);
      sent++;
    } catch (e) {
      failed++;
      await markSyncFailed(item.id, e instanceof Error ? e.message : String(e));
      if (e instanceof SimproError && (e.status === 401 || e.status === 403)) break;
    }
  }

  const remaining = (await pendingSync(1)).length;
  return { sent, failed, remaining };
}
