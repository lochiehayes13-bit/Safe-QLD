import { detectSystem } from '@/parsers/assetRegister';
import type { AssetRecord } from '@/db/assetRepo';
import type { SimproAsset } from './resources';

/**
 * Turning a Simpro customer asset into one of this app's assets.
 *
 * Kept pure and free of the database so the mapping can be tested against the
 * real shapes rather than only exercised through a sync that needs a device.
 *
 * The type mapping deliberately reuses `detectSystem` from the register
 * importer rather than introducing a second table. Simpro names its types
 * "Category - Subcategory" ("Fire Detection and Alarm Systems - Smoke Alarms
 * and Heat Alarms"), and that function already normalises and matches on the
 * same words the CSV exports use. Checked against all fifteen type names on
 * the live build: every one resolves, covering all 12,546 assets. A second
 * table would be a second thing to keep in step, and the report already
 * assumes the register and the app agree about what a system is called.
 */

/** Stamped on assets this sync created, so a later pull updates rather than duplicates. */
export const SIMPRO_ASSET_SOURCE = 'simpro';

/**
 * Service level names as the office uses them, to the app's own frequencies.
 *
 * Lower-cased on lookup because the office writes "6 Monthly" and the register
 * exports write "6 monthly". "10 Yearly" appears on exactly one asset today,
 * which is precisely the sort of thing a mapping quietly drops.
 */
const FREQUENCY_BY_SERVICE_LEVEL: Record<string, string> = {
  'monthly': 'monthly',
  '3 monthly': 'quarterly',
  'quarterly': 'quarterly',
  '6 monthly': 'six-monthly',
  'six monthly': 'six-monthly',
  'yearly': 'annual',
  'annual': 'annual',
  '5 yearly': 'five-yearly',
  '10 yearly': 'ten-yearly',
};

export function frequencyForServiceLevel(name: string): string | undefined {
  return FREQUENCY_BY_SERVICE_LEVEL[name.trim().toLowerCase()];
}

/**
 * The office's own asset number, under whichever heading it used.
 *
 * Three different names for the same thing across the type set — "Asset #" on
 * most, "Asset Number" on hydrants, "Tag No." on smoke doors — and it is the
 * number physically written on the equipment, so it is what a technician
 * searches for when standing in front of it.
 */
export function tagNumber(custom: Record<string, string>): string | undefined {
  for (const key of ['Asset #', 'Asset Number', 'Tag No.', 'Tag No', 'Asset No']) {
    const v = custom[key]?.trim();
    if (v) return v;
  }
  return undefined;
}

/** The earliest date any of this asset's frequencies falls due. */
export function nextDue(asset: SimproAsset): string | undefined {
  const dates = asset.serviceLevels.map((l) => l.dueAt).filter((d): d is string => Boolean(d)).sort();
  return dates[0];
}

/**
 * A last test result the app understands.
 *
 * "No Test" is a real state on 7,263 of the 12,546 assets and means the office
 * has never recorded one — which is not a pass, not a failure, and not the same
 * as an untested asset a technician looked at and could not reach. It maps to
 * undefined so the app's own vocabulary is not stretched to cover it, and the
 * asset simply reads as never serviced.
 */
export function lastResult(simproResult: string | undefined): string | undefined {
  switch (simproResult?.trim().toLowerCase()) {
    case 'pass': return 'pass';
    case 'fail': return 'fail';
    default: return undefined;
  }
}

/**
 * The status a Simpro asset should carry locally.
 *
 * Exposed on its own so the sync can apply it on an update as well as on
 * creation: the update path patches blanks only, which is right for what a
 * technician recorded on site, but an asset the office has archived is not a
 * blank — it is gone, and it stayed in service on every phone for good.
 */
export function statusFor(remote: Pick<SimproAsset, 'archived'>): 'decommissioned' | 'in-service' {
  return remote.archived ? 'decommissioned' : 'in-service';
}

export interface MappedAsset {
  /** Ready to hand to createAsset, less the site which the caller resolves. */
  input: Partial<AssetRecord> & { assetTypeId: string };
  /** Simpro's site id, for the caller to resolve against the local site table. */
  remoteSiteId?: string;
  /**
   * Set when the type name matched nothing, so the caller can report it
   * rather than guess. The asset is still mapped, under the 'unknown' type
   * with the office's name for it in `attributes.simproType`: a lay-flat
   * hose the app has no routine for is still equipment on the site, and a
   * form that counts the register must see it to say it was not placed.
   */
  unmappedType?: string;
}

/** The office's type names that name nothing to service: a template, not equipment. */
const TEMPLATE_TYPE = /master asset template/i;

/**
 * Maps one Simpro asset.
 *
 * `lastServicedAt` and `lastResult` are carried across, but the caller must
 * only apply them where the local record is blank. What a technician entered on
 * site outranks the office copy — they were standing in front of the equipment.
 */
export function mapSimproAsset(asset: SimproAsset): MappedAsset {
  const def = asset.typeName && !TEMPLATE_TYPE.test(asset.typeName) ? detectSystem(asset.typeName, []) : undefined;
  const custom = asset.custom;
  const tag = tagNumber(custom);
  const location = custom['Location']?.trim();

  // Everything the office holds that has no column of its own is kept verbatim
  // rather than dropped: the type-specific fields ("Extinguisher Type",
  // "Emergency Light Type & Size", "FRL Level") are what identifies the
  // equipment, and they differ per type so there is no fixed column for them.
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(custom)) {
    if (key === 'Location') continue;
    const trimmed = value.trim();
    if (trimmed) attributes[key] = trimmed;
  }

  const frequencies = asset.serviceLevels
    .map((l) => frequencyForServiceLevel(l.name))
    .filter((f): f is string => Boolean(f));
  if (frequencies.length) attributes['frequencies'] = frequencies.join(',');

  // Fire and smoke doors share one asset type, and the type alone cannot say
  // which Schedule 2 row a door answers. The register the office keeps it
  // under can, so that is carried where the office named it.
  if (def?.system === 'smoke-door' || def?.system === 'fire-door') attributes['registerSystem'] = def.system;
  // What the office called a type the app does not know, kept by name so
  // the forms can list the asset as unrecognised rather than lose it.
  if (!def) attributes['simproType'] = asset.typeName?.trim() || '(no type)';

  const label = def?.label ?? asset.typeName?.trim() ?? 'Asset';
  return {
    remoteSiteId: asset.siteId,
    unmappedType: def ? undefined : (asset.typeName?.trim() || '(no type)'),
    input: {
      assetTypeId: def?.assetTypeId ?? 'unknown',
      externalId: asset.id,
      externalSource: SIMPRO_ASSET_SOURCE,
      // The office identifies an asset by where it is, so that is the name a
      // technician sees. Falling back to the tag and then the type keeps the
      // list readable rather than 5,372 rows all reading "Unnamed asset".
      name: location ?? (tag ? `${label} ${tag}` : label),
      locationNote: location,
      installedDate: asset.installedDate,
      status: statusFor(asset),
      lastServicedAt: asset.lastTestAt,
      lastResult: lastResult(asset.lastTestResult),
      nextDueAt: nextDue(asset),
      // Filed under assetNumber, which is where the register importer puts
      // it and the only key the routine service report reads; kept under tag
      // as well because that is where every earlier sync wrote it.
      attributes: tag ? { ...attributes, tag, assetNumber: tag } : attributes,
    },
  };
}
