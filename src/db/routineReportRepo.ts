import { getDb } from '@/db';
import { getSite } from './repo';
import {
  RESULT_FOR_EVENT, SECTION_ORDER, SYSTEM_FOR_TYPE,
} from '@/domain/reportSections';
import type { RegisterSystem } from '@/parsers/assetRegister';
import type {
  RoutineReportAsset, RoutineReportInput, RoutineReportSection, RoutineResult,
} from '@/export/routineServiceReport';
import { qldIsoDay } from '@/domain/qldTime';

/**
 * Assembling the routine service report from what was actually recorded.
 *
 * The report is built from the asset timeline rather than from a separate
 * report table, because the timeline is where the work lands: a routine run
 * writes a passed, failed or not-tested event against each asset it touched.
 * Reading it back means the document cannot say something different from the
 * record it came from.
 *
 * Assets with no event in the window are left out. A service report is a record
 * of work done on a visit, and listing an asset nobody went near — with an
 * empty result column — invites it to be read as attended and fine.
 */

interface Row {
  assetId: string;
  assetTypeId: string;
  name: string;
  locationNote: string | null;
  notes: string | null;
  attributes: string;
  kind: string;
  occurredAt: string;
  summary: string | null;
  detail: string | null;
  technician: string | null;
}

function attribute(raw: string, key: string): string | undefined {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

export interface RoutineReportQuery {
  siteId: string;
  /** ISO dates bounding the visit. */
  from: string;
  to: string;
  jobNumber?: string;
  workRequested?: string;
}

export async function buildRoutineReport(q: RoutineReportQuery): Promise<RoutineReportInput | null> {
  const site = await getSite(q.siteId);
  if (!site) return null;
  const db = await getDb();

  // The latest test event per asset inside the window. A routine re-run on the
  // same visit — a retest after a repair — should show the outcome that stands,
  // not the first attempt.
  const rows = await db.getAllAsync<Row>(
    `SELECT a.id AS assetId, a.assetTypeId, a.name, a.locationNote, a.notes, a.attributes,
            e.kind, e.occurredAt, e.summary, e.detail, e.technician
       FROM asset a
       JOIN asset_event e ON e.assetId = a.id
      WHERE a.siteId = ?
        AND e.kind IN ('passed','failed','not-tested')
        AND e.occurredAt >= ? AND e.occurredAt <= ?
        AND e.occurredAt = (
          SELECT MAX(e2.occurredAt) FROM asset_event e2
           WHERE e2.assetId = a.id AND e2.kind IN ('passed','failed','not-tested')
             AND e2.occurredAt >= ? AND e2.occurredAt <= ?
        )
      ORDER BY a.walkOrder IS NULL, a.walkOrder, a.name`,
    q.siteId, q.from, q.to, q.from, q.to,
  );

  if (!rows.length) return null;

  const bySystem = new Map<RegisterSystem, RoutineReportAsset[]>();
  let technician: string | undefined;

  for (const row of rows) {
    const system = SYSTEM_FOR_TYPE[row.assetTypeId] ?? 'unknown';
    const result = RESULT_FOR_EVENT[row.kind] ?? 'na';
    if (!technician && row.technician) technician = row.technician;

    const asset: RoutineReportAsset = {
      assetNumber: attribute(row.attributes, 'assetNumber'),
      location: row.locationNote ?? undefined,
      descriptor: attribute(row.attributes, 'descriptor'),
      overhaul: attribute(row.attributes, 'lastOverhaul'),
      date: qldIsoDay(row.occurredAt) ?? row.occurredAt,
      result,
      // A not-tested event carries its reason in the summary; that is the whole
      // point of recording it separately from a pass.
      notTestedReason: result === 'not-tested' ? row.summary ?? undefined : undefined,
      testNotes: result === 'not-tested' ? row.detail ?? undefined : row.detail ?? row.summary ?? undefined,
      /*
       * The asset's own note, off the register.
       *
       * The report prints a "Notes:" line under every asset because their own
       * one does, and this was the field behind it — declared, rendered, and
       * never filled, so the line came out blank on every row of every report.
       *
       * 453 assets in the real register carry one, and they are the kind of
       * thing the line exists for: "Switchboard in Office — use test switch",
       * "Logbook inside switchboard", "NIL OPERATION". A technician reads that
       * before starting, and a client reading the report sees what was known
       * about the asset at the time.
       */
      notes: row.notes?.trim() || undefined,
    };

    const list = bySystem.get(system);
    if (list) list.push(asset);
    else bySystem.set(system, [asset]);
  }

  const sections: RoutineReportSection[] = SECTION_ORDER
    .filter((system: RegisterSystem) => bySystem.has(system))
    .map((system: RegisterSystem) => ({ system, assets: bySystem.get(system)! }));

  return {
    jobNumber: q.jobNumber,
    customer: {
      name: site.clientName || site.name,
      address: [site.address, site.suburb, site.state, site.postcode].filter(Boolean).join(' '),
    },
    site: {
      name: site.name,
      address: [site.address, site.suburb, site.state, site.postcode].filter(Boolean).join(' '),
    },
    workRequested: q.workRequested,
    datePerformed: q.to.slice(0, 10),
    technicianName: technician,
    sections,
  };
}
