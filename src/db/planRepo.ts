import { getDb, nowIso } from './index';
import { routineById } from '@/seed/serviceRoutines';
import { routineDue } from '@/domain/schedule';
import {
  NOT_COUNTED_ASSET_TYPES,
  calendarMonthWindow,
  planWork,
  qldDate,
  type PlanRoutine,
  type PlanSite,
  type SystemCount,
  type UnplannedItem,
  type WorkPlan,
} from '@/domain/workPlan';

/**
 * Feeding the work planner from the database.
 *
 * Deliberately thin: every decision worth arguing about lives in
 * `@/domain/workPlan`, which imports nothing from here and can therefore be
 * tested. This file does four queries, joins them, and hands the result over.
 *
 * Four things it has to be honest about while doing that, because each one is
 * a place where the database knows less than it appears to:
 *
 *  - **A site with no asset rows is unknown, not empty.** The register is built
 *    site by site over years, so "no rows" means nobody has surveyed it far
 *    more often than it means the building is empty. Those sites come back with
 *    no asset counts at all, and the planner reports them rather than sizing a
 *    visit it cannot size.
 *  - **Sites carry no coordinates.** The site table holds a suburb and a
 *    postcode and nothing else, so a position has to be borrowed from the most
 *    recent job at that site, which came from the office system. It is
 *    second-hand and only used where a site has no locality at all.
 *  - **Only routines with a recorded history can be scheduled.** The schedule
 *    is anchored to the first service, so a routine never carried out at a site
 *    has no anchor to count from. The same reasoning the overdue list uses.
 *  - **A register row is not always a device to be walked.** The asset table is
 *    a tree and it keeps what has been taken out, so a plain COUNT(*) charges
 *    the removed detector, the loop it hung off and the panel above it as
 *    though each were a device. Both exclusions are applied here, against the
 *    list the planner publishes, so the reasoning stays in the tested module.
 */

export interface BuildPlanOptions {
  /** 0 plans the current month, 1 the next. Defaults to next month. */
  monthOffset?: number;
  technicians?: number;
  hoursPerDay?: number;
  /**
   * Dates nobody works. Nothing in this app knows Queensland's public holiday
   * list — it changes yearly and the show holiday is regional — so whatever is
   * passed here is what gets excluded, and the plan says when nothing was.
   */
  holidays?: string[];
  /** Overridable so a plan can be reproduced. Defaults to now. */
  now?: string;
}

interface SiteRow {
  id: string;
  name: string;
  suburb: string | null;
  postcode: string | null;
}

interface AssetCountRow {
  siteId: string;
  system: string;
  count: number;
}

interface PositionRow {
  siteId: string;
  latitude: number | null;
  longitude: number | null;
}

interface HistoryRow {
  siteId: string;
  routineId: string;
  /** Denormalised onto the run, so a retired routine still reads as something. */
  routineLabel: string;
  firstCompletedAt: string;
  lastCompletedAt: string;
  completedCount: number;
}

const NOT_COUNTED_TYPE_IDS = Object.keys(NOT_COUNTED_ASSET_TYPES);

/**
 * `t.id NOT IN ()` is a syntax error, not an empty exclusion, so the clause is
 * only written when there is something to exclude.
 */
const NOT_COUNTED_CLAUSE = NOT_COUNTED_TYPE_IDS.length
  ? `AND t.id NOT IN (${NOT_COUNTED_TYPE_IDS.map(() => '?').join(', ')})`
  : '';

export async function buildWorkPlan(options: BuildPlanOptions = {}): Promise<WorkPlan> {
  const asked = options.now ?? nowIso();
  const today = qldDate(asked);
  if (!today) {
    // Falling back to nowIso().slice(0, 10) here would plan from a different
    // date than the caller asked for, and would do it by slicing a UTC instant
    // — the exact day-early bug qldDate exists to prevent. The planner already
    // knows how to say "that is not a date I can read"; let it say so.
    return planWork([], [], { today: asked });
  }
  const window = calendarMonthWindow(today, options.monthOffset ?? 1);

  const db = await getDb();

  const [siteRows, assetRows, positionRows, historyRows] = await Promise.all([
    db.getAllAsync<SiteRow>('SELECT id, name, suburb, postcode FROM site'),
    // Only what is still there and still a device. `removed` and
    // `decommissioned` rows are kept so a site's history reads correctly, and
    // counting them would charge a technician for walking detectors that came
    // out in 2019. The excluded types are panels, loops, sampling points and
    // sprinkler heads, whose minutes the planner charges somewhere else — its
    // list, its reasons, and a test holds it against the type catalogue.
    db.getAllAsync<AssetCountRow>(
      `SELECT a.siteId AS siteId, t.system AS system, COUNT(*) AS count
       FROM asset a JOIN asset_type t ON a.assetTypeId = t.id
       WHERE a.status NOT IN ('removed', 'decommissioned')
         ${NOT_COUNTED_CLAUSE}
       GROUP BY a.siteId, t.system`,
      ...NOT_COUNTED_TYPE_IDS,
    ),
    // Newest job per site that carries a position. A site visited last week is
    // a better guide to where it is than one visited in 2019, and either is
    // only used when the site has no suburb at all.
    db.getAllAsync<PositionRow>(
      `SELECT siteId, latitude, longitude FROM job
       WHERE siteId IS NOT NULL AND latitude IS NOT NULL AND longitude IS NOT NULL
       ORDER BY updatedAt DESC`,
    ),
    db.getAllAsync<HistoryRow>(
      `SELECT siteId,
              routineId,
              MAX(routineLabel) AS routineLabel,
              MIN(completedAt) AS firstCompletedAt,
              MAX(completedAt) AS lastCompletedAt,
              COUNT(*)         AS completedCount
       FROM routine_run GROUP BY siteId, routineId`,
    ),
  ]);

  const countsBySite = new Map<string, SystemCount[]>();
  for (const row of assetRows) {
    countsBySite.set(row.siteId, [...(countsBySite.get(row.siteId) ?? []), { system: row.system, count: row.count }]);
  }

  const positionBySite = new Map<string, PositionRow>();
  for (const row of positionRows) {
    if (!positionBySite.has(row.siteId)) positionBySite.set(row.siteId, row);
  }

  const sites: PlanSite[] = siteRows.map((row) => {
    const position = positionBySite.get(row.id);
    return {
      siteId: row.id,
      siteName: row.name,
      suburb: row.suburb ?? undefined,
      postcode: row.postcode ?? undefined,
      latitude: position?.latitude ?? undefined,
      longitude: position?.longitude ?? undefined,
      // Absent rather than empty: see the note at the top of this file.
      assetCounts: countsBySite.get(row.id),
    };
  });

  const siteNames = new Map(siteRows.map((r) => [r.id, r.name]));
  const routines: PlanRoutine[] = [];
  const unknownRoutines: UnplannedItem[] = [];

  for (const row of historyRows) {
    const routine = routineById(row.routineId);
    if (!routine) {
      // A run recorded against a routine this build does not hold — a retired
      // id, or one from a newer version. The run's own denormalised frequency
      // could be read here, but a frequency string with no routine behind it
      // cannot be trusted to schedule against, so it is reported instead.
      unknownRoutines.push({
        siteId: row.siteId,
        siteName: siteNames.get(row.siteId),
        routineId: row.routineId,
        // The label is what the technician's own run recorded; it is a
        // description, not a schedule. The frequency is left undefined on
        // purpose — putting a plausible one here would print "Annual" on the
        // one list the office acts on, for a routine nothing can date.
        routineLabel: row.routineLabel || undefined,
        reason: 'unknown-routine',
        detail: `A service is recorded against routine "${row.routineId}", which this version of the app `
          + 'does not hold. Nothing here knows how often it falls due, so it cannot be planned.',
      });
      continue;
    }
    const due = routineDue(
      {
        routineId: routine.id,
        frequency: routine.frequency,
        firstCompletedAt: row.firstCompletedAt,
        lastCompletedAt: row.lastCompletedAt,
        completedCount: row.completedCount,
      },
      today,
    );
    routines.push({
      siteId: row.siteId,
      routineId: routine.id,
      routineLabel: routine.label,
      system: routine.system,
      frequency: routine.frequency,
      state: due.state,
      scheduledFor: due.scheduledFor,
      window: due.window,
    });
  }

  const plan = planWork(routines, sites, {
    today,
    window,
    technicians: options.technicians,
    hoursPerDay: options.hoursPerDay,
    holidays: options.holidays,
  });

  if (!unknownRoutines.length) return plan;

  const unplanned = [...plan.unplanned, ...unknownRoutines];
  return { ...plan, unplanned, summary: { ...plan.summary, unplanned: unplanned.length } };
}

/**
 * How much of the book the planner can actually see.
 *
 * Shown above the plan because the honest reading of "October looks quiet"
 * depends entirely on it: a month that looks light because half the book has no
 * asset register is not a light month.
 */
export interface PlanCoverage {
  sites: number;
  sitesWithAssets: number;
  sitesWithLocality: number;
  routinesWithHistory: number;
}

export async function planCoverage(): Promise<PlanCoverage> {
  const db = await getDb();
  // Both counts have to be the same counts the plan itself makes, or the
  // banner above the month contradicts the list below it. A site whose only
  // asset rows are decommissioned detectors has no register as far as the
  // planner is concerned, and a postcode of "QLD 4127" is not a locality —
  // GLOB is SQLite's four-digit test, matching normalisePostcode.
  const row = await db.getFirstAsync<PlanCoverage>(
    `SELECT (SELECT COUNT(*) FROM site) AS sites,
            (SELECT COUNT(DISTINCT a.siteId) FROM asset a JOIN asset_type t ON a.assetTypeId = t.id
              WHERE a.status NOT IN ('removed', 'decommissioned')
                ${NOT_COUNTED_CLAUSE}) AS sitesWithAssets,
            (SELECT COUNT(*) FROM site
              WHERE (suburb IS NOT NULL AND TRIM(suburb) <> '')
                 OR (postcode IS NOT NULL AND TRIM(postcode) GLOB '[0-9][0-9][0-9][0-9]')) AS sitesWithLocality,
            (SELECT COUNT(*) FROM (SELECT 1 FROM routine_run GROUP BY siteId, routineId)) AS routinesWithHistory`,
    ...NOT_COUNTED_TYPE_IDS,
  );
  return row ?? { sites: 0, sitesWithAssets: 0, sitesWithLocality: 0, routinesWithHistory: 0 };
}
