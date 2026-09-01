import { getDb, nowIso } from './index';
import { listDefects } from './repo';
import { queryAssets } from './assetRepo';
import { assetTypeById } from '@/seed/assetTypes';
import type { RoutineRun } from './routineRunRepo';
import type { Defect } from '@/domain/types';
import {
  keyIdentity, planOutboundWork,
  type CompletedRoutineRun, type OutboundDefect, type OutboundPlan, type OutboundResult,
} from '@/domain/outboundWork';

/**
 * Assembling what goes back to the office, out of what the phone actually holds.
 *
 * The decisions all live in `@/domain/outboundWork`, which is pure and heavily
 * tested. This file only gathers: it reads the run, the asset events that run
 * wrote, and the defects it raised, and hands them over. Nothing here decides
 * what is sendable — that would put judgement in the one layer no test can
 * reach without a database.
 *
 * Two things it is careful about.
 *
 * **A result row is only claimed for a run when the event says so.** Asset
 * events carry the instant they happened, and a routine run carries the instant
 * it was recorded; matching them on "same day at the same site" would sweep in
 * a call-out done that morning and report it as part of the annual. So events
 * are matched inside a window around the run and the window is narrow, and
 * anything outside it simply is not part of this run's record.
 *
 * **What the office has already accepted is read from the database, not from
 * memory.** The queue on this handset does not survive a reinstall, and the one
 * thing that must survive it is the knowledge that a service was already
 * reported. That lives in `outbound_accepted` and is written the moment an item
 * is taken.
 */

/**
 * How far either side of a run's completion an asset event is treated as part
 * of it.
 *
 * Six hours. A routine service is recorded when the technician finishes, and
 * the events it wrote are minutes to a few hours old; a separate attendance at
 * the same site on the same day is the case this is guarding against, and the
 * two are rarely inside six hours of each other. Widening it to a day would
 * report a morning call-out as part of the afternoon's annual.
 */
export const RUN_EVENT_WINDOW_HOURS = 6;

interface EventRow {
  assetId: string;
  kind: string;
  occurredAt: string;
  summary: string;
  detail: string | null;
}

const outcomeOf = (kind: string): OutboundResult['outcome'] | undefined => {
  if (kind === 'passed') return 'pass';
  if (kind === 'failed') return 'fail';
  if (kind === 'not-tested') return 'not-tested';
  return undefined;
};

/** The Simpro job a run was carried out under, where one has been linked. */
export async function jobForRun(runId: string): Promise<string | undefined> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ jobId: string }>(
    'SELECT jobId FROM outbound_job_link WHERE runId = ?', [runId],
  );
  return row?.jobId;
}

export async function linkRunToJob(runId: string, jobId: string): Promise<void> {
  const db = await getDb();
  const trimmed = jobId.trim();
  if (!trimmed) {
    await db.runAsync('DELETE FROM outbound_job_link WHERE runId = ?', [runId]);
    return;
  }
  await db.runAsync(
    `INSERT INTO outbound_job_link (runId, jobId, linkedAt) VALUES (?, ?, ?)
     ON CONFLICT(runId) DO UPDATE SET jobId = excluded.jobId, linkedAt = excluded.linkedAt`,
    [runId, trimmed, nowIso()],
  );
}

/** Every key the office has taken, so a retry is a no-op rather than a duplicate. */
export async function acceptedKeys(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ key: string }>('SELECT key FROM outbound_accepted');
  return rows.map((r) => r.key);
}

export async function recordAccepted(input: {
  key: string;
  jobId: string;
  description?: string;
  urgency?: 'critical' | 'routine';
  at?: string;
}): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR IGNORE INTO outbound_accepted (key, identity, jobId, description, urgency, acceptedAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.key, keyIdentity(input.key) ?? input.key, input.jobId,
      input.description ?? '', input.urgency ?? 'routine', input.at ?? nowIso(),
    ],
  );
}

/**
 * The asset results a run produced.
 *
 * One row per asset, taking that asset's most recent qualifying event inside the
 * window — a check re-run after a repair should report as it finished, not as it
 * first failed.
 */
export async function resultsForRun(run: RoutineRun): Promise<OutboundResult[]> {
  const db = await getDb();
  const centre = Date.parse(run.completedAt);
  if (!Number.isFinite(centre)) return [];
  const span = RUN_EVENT_WINDOW_HOURS * 3_600_000;
  const from = new Date(centre - span).toISOString();
  const to = new Date(centre + span).toISOString();

  const rows = await db.getAllAsync<EventRow>(
    `SELECT e.assetId, e.kind, e.occurredAt, e.summary, e.detail
       FROM asset_event e
       JOIN asset a ON a.id = e.assetId
      WHERE a.siteId = ?
        AND e.occurredAt BETWEEN ? AND ?
        AND e.kind IN ('passed','failed','not-tested')
      ORDER BY e.occurredAt ASC`,
    [run.siteId, from, to],
  );
  if (!rows.length) return [];

  const latest = new Map<string, EventRow>();
  for (const row of rows) latest.set(row.assetId, row);

  const assets = await queryAssets({ siteId: run.siteId });
  const byId = new Map(assets.map((a) => [a.id, a]));

  const out: OutboundResult[] = [];
  for (const [assetId, row] of latest) {
    const outcome = outcomeOf(row.kind);
    if (!outcome) continue;
    const asset = byId.get(assetId);
    // The office finds an asset by the number written on its own tag, never by
    // the internal id, which means nothing to them and reads as a fault.
    const location = [asset?.level, asset?.room, asset?.locationNote]
      .map((p) => p?.trim())
      .filter((p): p is string => !!p)
      .join(' ');
    out.push({
      assetId,
      assetNumber: asset?.code,
      name: asset?.name,
      location: location || undefined,
      system: asset ? assetTypeById(asset.assetTypeId)?.system : undefined,
      outcome,
      // The reason lives in the event's own text; the summary is the check that
      // could not be carried out, the detail is why.
      notTestedReason: outcome === 'not-tested' ? (row.detail?.trim() || undefined) : undefined,
      notes: outcome === 'not-tested' ? undefined : (row.detail?.trim() || undefined),
    });
  }
  return out;
}

/** Maps a stored defect onto the fields the office needs, and no others. */
export function toOutboundDefect(d: Defect, sentToOfficeAt?: string): OutboundDefect {
  return {
    id: d.id,
    location: d.location,
    description: d.description,
    severity: d.severity === 'critical' ? 'critical' : 'non-critical',
    status: d.status === 'open' || d.status === 'rectified' || d.status === 'quoted' || d.status === 'closed'
      ? d.status
      : 'open',
    raisedAt: d.raisedAt,
    as1851Class: d.as1851Class,
    qldLimbInoperable: d.qldLimbInoperable,
    qldLimbAdverseImpact: d.qldLimbAdverseImpact,
    verbalNotifiedAt: d.verbalNotifiedAt,
    verbalNotifiedTo: d.verbalNotifiedTo,
    interimMeasures: d.interimMeasures,
    photoCount: d.photos.length || undefined,
    sentToOfficeAt,
  };
}

/**
 * Defects raised by a run.
 *
 * Matched on the same window as the results, for the same reason: a defect
 * raised on a call-out that morning belongs to the call-out.
 */
export async function defectsForRun(run: RoutineRun): Promise<Defect[]> {
  const centre = Date.parse(run.completedAt);
  if (!Number.isFinite(centre)) return [];
  const span = RUN_EVENT_WINDOW_HOURS * 3_600_000;
  const all = await listDefects(run.siteId);
  return all.filter((d) => {
    const at = Date.parse(d.raisedAt);
    return Number.isFinite(at) && Math.abs(at - centre) <= span;
  });
}

export interface RunPlan {
  run: CompletedRoutineRun;
  plan: OutboundPlan;
  /** The keys the office already holds, so a screen can say a retry is safe. */
  alreadySent: string[];
}

/**
 * Everything needed to review a send, gathered in one place.
 *
 * Deliberately returns the plan even where it declines everything. A screen that
 * showed nothing because nothing could be sent would leave a technician with no
 * idea why, and the reason is exactly the thing worth showing.
 */
export async function planForRun(
  run: RoutineRun,
  siteName: string,
  options: { reportRef?: string; siteAddress?: string } = {},
): Promise<RunPlan> {
  const [jobId, results, rawDefects, sent] = await Promise.all([
    jobForRun(run.id),
    resultsForRun(run),
    defectsForRun(run),
    acceptedKeys(),
  ]);

  const completed: CompletedRoutineRun = {
    runId: run.id,
    siteId: run.siteId,
    siteName,
    jobId,
    routineId: run.routineId,
    routineLabel: run.routineLabel,
    frequency: run.frequency,
    system: run.system,
    completedAt: run.completedAt,
    technician: run.technician,
    notes: run.notes,
    reportRef: options.reportRef,
  };

  const defects = rawDefects.map((d) => toOutboundDefect(d));

  /*
   * The run row's own counts are handed over to be cross-checked rather than
   * trusted. They were written by the routine screen from the checks it ran;
   * the result rows are the asset events. Where they disagree the plan sends
   * nothing, because the office would act on whichever number went out.
   */
  const plan = planOutboundWork(completed, results, defects, {
    alreadySentKeys: sent,
    declaredCounts: results.length
      ? { passed: run.checksPassed, failed: run.checksFailed, notTested: run.checksNotTested }
      : undefined,
  });

  return { run: completed, plan, alreadySent: sent };
}
