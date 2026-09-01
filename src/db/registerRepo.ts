import { getDb, newId, nowIso } from '@/db';
import { createAsset, findByExternalIds, updateAsset } from './assetRepo';
import { createSite, listSites } from './repo';
import {
  assetName, soonestDue, type ParsedRegister, type RegisterAsset,
} from '@/parsers/assetRegister';
import type { Frequency } from '@/seed/serviceRoutines';
import type { Site } from '@/domain/types';

/**
 * Loading an asset register into the app.
 *
 * This is what turns an empty app into the actual book of work: nearly thirteen
 * thousand assets across nine hundred sites, each with where it is and when its
 * routines fall due.
 *
 * The whole thing is keyed on the id the source system gave each asset, because
 * a register is re-exported constantly and every import after the first is an
 * update. Matching on name and location cannot do that — two extinguishers in
 * the same corridor are indistinguishable by anything except that id — and
 * getting it wrong produces a second copy of the building rather than an error.
 */

/** Names the source these ids belong to, so two systems cannot collide. */
export const REGISTER_SOURCE = 'asset-register';

export interface RegisterImportResult {
  sitesCreated: number;
  sitesMatched: number;
  assetsCreated: number;
  assetsUpdated: number;
  schedulesWritten: number;
  warnings: string[];
}

/**
 * Matches a register's site against one already held.
 *
 * By external id first. Falling back to the name is deliberate but narrow: the
 * first import of a site that was created by hand on a phone has no id to match
 * on, and the alternative is a duplicate site with the assets split across the
 * two.
 */
function matchSite(existing: Site[], externalId: string | undefined, name: string): Site | undefined {
  if (externalId) {
    const ref = `${REGISTER_SOURCE}:${externalId}`;
    const byRef = existing.find((s) => s.siteRef === ref);
    if (byRef) return byRef;
  }
  const wanted = name.trim().toLowerCase();
  return existing.find((s) => s.name.trim().toLowerCase() === wanted);
}

async function writeSchedule(
  assetId: string,
  schedule: RegisterAsset['schedule'],
  overhaul: RegisterAsset['lastOverhaul'],
): Promise<number> {
  const db = await getDb();
  const now = nowIso();
  let written = 0;

  for (const entry of schedule) {
    await db.runAsync(
      `INSERT INTO asset_schedule (id, assetId, frequency, nextDueAt, source, createdAt, updatedAt)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(assetId, frequency) DO UPDATE SET
         nextDueAt = excluded.nextDueAt, source = excluded.source, updatedAt = excluded.updatedAt`,
      newId(), assetId, entry.frequency as Frequency, entry.nextDueAt, 'register-import', now, now,
    );
    written++;
  }

  // The overhaul date belongs against the routine it is the record of, and the
  // register only ever carries one. Written to whatever precision it had — a
  // five-yearly test recorded as a month is not a day, and pretending otherwise
  // moves the next one.
  if (overhaul && overhaul.precision !== 'unreadable') {
    const target = schedule.find((s) => s.frequency === 'five-yearly' || s.frequency === 'ten-yearly');
    if (target) {
      await db.runAsync(
        `UPDATE asset_schedule
           SET lastDoneAt = ?, lastDonePrecision = ?, lastDoneRaw = ?, updatedAt = ?
         WHERE assetId = ? AND frequency = ?`,
        overhaul.iso ?? null, overhaul.precision, overhaul.raw, now, assetId, target.frequency,
      );
    }
  }
  return written;
}

export async function importAssetRegister(parsed: ParsedRegister): Promise<RegisterImportResult> {
  const result: RegisterImportResult = {
    sitesCreated: 0, sitesMatched: 0, assetsCreated: 0, assetsUpdated: 0,
    schedulesWritten: 0, warnings: [...parsed.warnings],
  };

  if (parsed.system === 'unknown') {
    result.warnings.push(
      'The system was not identified, so every asset would import with no type. Nothing was imported.',
    );
    return result;
  }

  // ---- Sites ------------------------------------------------------------
  const existing = await listSites();
  const siteIdByKey = new Map<string, string>();

  for (const site of parsed.sites) {
    const key = site.externalId ?? site.name;
    const match = matchSite(existing, site.externalId, site.name);
    if (match) {
      siteIdByKey.set(key, match.id);
      result.sitesMatched++;
      // Fill in the reference on a site that was created by hand, so the next
      // import matches on the id rather than the name.
      if (site.externalId && !match.siteRef) {
        await import('./repo').then((m) =>
          m.updateSite(match.id, { siteRef: `${REGISTER_SOURCE}:${site.externalId}` }));
      }
    } else {
      const created = await createSite({
        name: site.name,
        state: 'QLD',
        siteRef: site.externalId ? `${REGISTER_SOURCE}:${site.externalId}` : undefined,
      });
      siteIdByKey.set(key, created.id);
      result.sitesCreated++;
    }
  }

  // ---- Assets -----------------------------------------------------------
  const ids = parsed.assets.map((a) => a.externalId).filter((id): id is string => Boolean(id));
  const known = await findByExternalIds(REGISTER_SOURCE, ids);

  for (const asset of parsed.assets) {
    const siteId = siteIdByKey.get(asset.siteExternalId ?? asset.siteName);
    if (!siteId) continue;

    const nextDueAt = soonestDue(asset.schedule);
    const attributes: Record<string, string> = {};
    if (asset.descriptor) attributes.descriptor = asset.descriptor;
    if (asset.assetNumber) attributes.assetNumber = asset.assetNumber;
    if (asset.lastOverhaul?.raw) attributes.lastOverhaul = asset.lastOverhaul.raw;
    for (const [k, v] of Object.entries(asset.extra)) attributes[k] = v;

    const match = asset.externalId ? known.get(asset.externalId) : undefined;
    let assetId: string;

    if (match) {
      // The register is the office record for where an asset is and when it is
      // due. It is not the record for anything a technician wrote on the phone,
      // so the update is confined to the fields the register owns.
      await updateAsset(match.id, {
        siteId,
        name: assetName(asset),
        locationNote: asset.location,
        walkOrder: asset.walkOrder,
        nextDueAt,
        attributes: { ...match.attributes, ...attributes },
      });
      assetId = match.id;
      result.assetsUpdated++;
    } else {
      const created = await createAsset({
        siteId,
        assetTypeId: asset.assetTypeId,
        name: assetName(asset),
        locationNote: asset.location,
        notes: asset.notes,
        externalId: asset.externalId,
        externalSource: REGISTER_SOURCE,
        walkOrder: asset.walkOrder,
        installedDate: asset.serviceStartDate,
        nextDueAt,
        attributes,
      });
      assetId = created.id;
      result.assetsCreated++;
    }

    result.schedulesWritten += await writeSchedule(assetId, asset.schedule, asset.lastOverhaul);
  }

  return result;
}

/** The walk for a site, in the order the register puts it. */
export async function walkOrder(siteId: string): Promise<{ id: string; name: string; walkOrder: number | null }[]> {
  const db = await getDb();
  return db.getAllAsync<{ id: string; name: string; walkOrder: number | null }>(
    `SELECT id, name, walkOrder FROM asset WHERE siteId = ?
     ORDER BY CASE WHEN walkOrder IS NULL THEN 1 ELSE 0 END, walkOrder, name`,
    siteId,
  );
}
