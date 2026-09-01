import { SimproClient, SimproError, type SimproConfig } from './client';
import { SimproResources } from './resources';
import { assessIncremental, newestChange, planIncremental, type SyncResource } from './incremental';
import { readSyncState, writeSyncState } from './watermark';
import { createSite, listSites, updateSite } from '@/db/repo';
import { upsertJob, enqueueSync, pendingSync, markSynced, markSyncFailed, type JobRecord } from '@/db/opsRepo';
import type { Site } from '@/domain/types';

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

/** Matches an incoming site to one already held, by external id then by name. */
function matchSite(existing: Site[], externalId: string, name: string): Site | undefined {
  const byRef = existing.find((s) => s.siteRef === `SIMPRO:${externalId}`);
  if (byRef) return byRef;
  const target = name.trim().toLowerCase();
  return existing.find((s) => s.name.trim().toLowerCase() === target);
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
    errors: [], modes: {}, notes: [],
  };
  const startedAt = new Date().toISOString();

  onProgress?.({ stage: 'Reading sites', done: 0, total: 2 });

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
      const match = matchSite(existing, remote.id, remote.name);
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
      // From the records rather than the clock: a phone running fast would
      // otherwise skip everything written in the gap, silently and for good.
      lastChangeSeenAt: newestChange(remoteSites as unknown as Record<string, unknown>[])
        ?? (siteMode === 'full' ? startedAt : siteState.lastChangeSeenAt),
      lastRecordCount: siteMode === 'full' ? remoteSites.length : siteState.lastRecordCount,
      mode: siteMode,
    }, startedAt);
  }

  onProgress?.({ stage: 'Reading jobs', done: 1, total: 2 });

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
        lastChangeSeenAt: newestChange(remoteJobs as unknown as Record<string, unknown>[])
          ?? (outcome.mode === 'full' ? startedAt : jobState.lastChangeSeenAt),
        lastRecordCount: outcome.mode === 'full' ? remoteJobs.length : jobState.lastRecordCount,
        mode: outcome.mode,
      }, startedAt);
    }
  } catch (e) {
    result.errors.push(describe(e, 'jobs'));
  }

  onProgress?.({ stage: 'Done', done: 2, total: 2 });
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
