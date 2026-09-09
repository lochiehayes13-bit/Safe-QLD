import { SimproClient, collectionPath, type SimproConfig } from './client';
import { listOfficeAssetTypes, replaceOfficeAssetTypes, type OfficeAssetType, type OfficeCustomField } from '@/db/assetTypeRepo';
import type { AssetFieldValue } from '@/domain/assetChanges';
import { detectSystem } from '@/parsers/assetRegister';
import { assetTypeById, type SystemKind } from '@/seed/assetTypes';

export type { OfficeAssetType, OfficeCustomField };

/**
 * The office's asset types, and the two mappings between them and the
 * phone's own.
 *
 * Read from `setup/assetTypes/` — verified on the live build: nineteen rows
 * of {ID, Name}, and each type's fields at `setup/assetTypes/{id}/customFields/`
 * as {ID, Name, Type, Order, Locked, ListItems}, the last two only when asked
 * for by name. The `customerAssetTypes/` path the
 * public documentation suggests is a 404 "Invalid route" on this build, and
 * the type record itself carries no fields; the sub-collection does. So the
 * read is one request for the list and one per type for its fields, twenty
 * in all, made once and kept in simpro_asset_type until asked for again.
 *
 * The type mapping reuses `detectSystem` from the register importer, as the
 * asset sync does going the other way: the office names its types
 * "Category - Subcategory" and that function already matches the words. A
 * second table here would be a second thing to keep in step.
 */

interface RawType { ID?: number; Name?: string; Archived?: boolean }
interface RawField { ID?: number; Name?: string; Type?: string; Order?: number; ListItems?: unknown; Locked?: boolean }

/**
 * The columns a custom field is read with.
 *
 * `ListItems` and `Locked` are the reason this is spelled out: the
 * collection answers without either unless they are asked for by name, so
 * a plain read gives every List field no choices at all and says nothing
 * about the fields the office has locked. Verified against the live build
 * on 2026-09-09 — the same read with these columns returns all six.
 */
const FIELD_COLUMNS = 'ID,Name,Type,Order,ListItems,Locked';

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** The office's type names that name nothing to service: a template, not equipment. */
const TEMPLATE_TYPE = /master asset template/i;

export async function readAssetTypes(client: SimproClient): Promise<OfficeAssetType[]> {
  const types = await client.listAll<RawType>(collectionPath('setup/assetTypes'));
  const out: OfficeAssetType[] = [];
  for (const t of types) {
    if (t.ID === undefined || t.Archived === true) continue;
    const fields = await client.listAll<RawField>(collectionPath(`setup/assetTypes/${t.ID}/customFields`), { columns: FIELD_COLUMNS });
    out.push({
      id: String(t.ID),
      name: str(t.Name) ?? `Type ${t.ID}`,
      customFields: fields
        .filter((f) => f.ID !== undefined)
        .sort((a, b) => (a.Order ?? 0) - (b.Order ?? 0))
        .map((f) => ({
          id: Number(f.ID),
          name: str(f.Name) ?? `Field ${f.ID}`,
          type: str(f.Type) ?? 'Text',
          listItems: Array.isArray(f.ListItems) ? f.ListItems.map(String) : [],
          locked: f.Locked === true,
        })),
    });
  }
  return out;
}

/**
 * Fills the table from the office, and hands back what it holds.
 *
 * Called by the asset screens when the table is empty; a network failure
 * throws as the client's own error, and the screen says the office could not
 * be reached and offers to go on without creating the asset in Simpro.
 */
export async function refreshAssetTypes(config: SimproConfig): Promise<OfficeAssetType[]> {
  const types = await readAssetTypes(new SimproClient(config));
  await replaceOfficeAssetTypes(types);
  return types;
}

/** The table's rows, read from the office first where the table is empty. */
export async function officeAssetTypes(config: SimproConfig | undefined): Promise<OfficeAssetType[]> {
  const held = await listOfficeAssetTypes();
  if (held.length || !config) return held;
  return refreshAssetTypes(config);
}

/**
 * Which register systems each of the phone's systems can be filed under.
 *
 * The importer's systems are the office's categories; the phone's are the
 * standards'. Most line up by name and the rest are listed: a suppression
 * cylinder is the office's special hazard, a water tank is on the pump
 * register, an aspirating detector is detection equipment.
 */
const REGISTER_SYSTEMS_FOR: Partial<Record<SystemKind, readonly string[]>> = {
  detection: ['detection', 'smoke-alarm'],
  aspirating: ['detection'],
  ews: ['ews'],
  sprinkler: ['sprinkler'],
  hydrant: ['hydrant'],
  'hose-reel': ['hose-reel'],
  extinguisher: ['extinguisher', 'fire-blanket'],
  'emergency-lighting': ['emergency-lighting'],
  pump: ['pump', 'water-tank'],
  gas: ['special-hazard'],
  door: ['fire-door', 'smoke-door'],
};

/**
 * The office type an asset of the phone's type should be created as.
 *
 * In order: the office's own name where the asset carries it (an asset the
 * sync filed under a type the phone does not know keeps the name in
 * `simproType`); the office type that maps to exactly this phone type; and
 * then any office type on the same system, with a door's register — smoke
 * or fire — honoured where the asset says which. Undefined where nothing
 * fits, and the screen asks the person rather than guessing.
 */
export function officeTypeForApp(
  assetTypeId: string,
  officeTypes: readonly OfficeAssetType[],
  hint: { simproType?: string; registerSystem?: string } = {},
): OfficeAssetType | undefined {
  const usable = officeTypes.filter((t) => !TEMPLATE_TYPE.test(t.name));
  if (hint.simproType) {
    const named = usable.find((t) => t.name.trim().toLowerCase() === hint.simproType!.trim().toLowerCase());
    if (named) return named;
  }
  const detected = usable.map((t) => ({ type: t, def: detectSystem(t.name, []) }));
  if (hint.registerSystem) {
    const byRegister = detected.find((d) => d.def?.system === hint.registerSystem);
    if (byRegister) return byRegister.type;
  }
  // Two registers can lead to one phone type (a smoke door and a fire door
  // are both the phone's fire-door), so the register named like the phone
  // type wins over whichever the office listed first.
  const exact = detected.find((d) => d.def?.assetTypeId === assetTypeId && d.def.system === assetTypeId)
    ?? detected.find((d) => d.def?.assetTypeId === assetTypeId);
  if (exact) return exact.type;
  const system = assetTypeById(assetTypeId)?.system;
  const systems = system ? REGISTER_SYSTEMS_FOR[system] ?? [] : [];
  for (const s of systems) {
    const match = detected.find((d) => d.def?.system === s);
    if (match) return match.type;
  }
  return undefined;
}

/** The office's headings for the number written on the equipment. */
const TAG_FIELD = /^(asset\s*#|asset\s*number|asset\s*no\.?|tag\s*no\.?|tag\s*number)$/i;
const LOCATION_FIELD = /^location$/i;
const SERIAL_FIELD = /serial/i;

export interface FieldSource {
  code?: string;
  level?: string;
  room?: string;
  locationNote?: string;
  serial?: string;
  attributes: Record<string, string | number | boolean>;
}

const asText = (v: string | number | boolean | undefined): string => (v === undefined ? '' : String(v).trim());

/**
 * Where the asset is, in the office's one field for it.
 *
 * The sync writes the office's Location into `locationNote` and the phone's
 * own register holds level and room apart, so the note is the office's
 * words where there are any and the level and room joined where there are
 * not.
 */
export function locationFor(asset: Pick<FieldSource, 'level' | 'room' | 'locationNote'>): string {
  const note = asText(asset.locationNote);
  if (note) return note;
  return [asText(asset.level), asText(asset.room)].filter(Boolean).join(' ');
}

/** The number on the equipment: the office's, where the sync brought one, else the phone's code. */
export function tagFor(asset: Pick<FieldSource, 'code' | 'attributes'>): string {
  return asText(asset.attributes['assetNumber']) || asText(asset.attributes['tag']) || asText(asset.code);
}

/** Whether the office type has a field for the number on the equipment. */
export function hasTagField(officeType: Pick<OfficeAssetType, 'customFields'>): boolean {
  return officeType.customFields.some((f) => TAG_FIELD.test(f.name));
}

/**
 * What a create can be told apart from its own retry by, on the site's
 * list in the office: the tag, where the office type has a field for one;
 * else the location and the type together, where the type has a Location
 * field and the asset has a location; else nothing. The send looks the
 * asset up by this before it posts, and a create with nothing to look up
 * by is refused on New asset with the words below, because a reply that
 * could not be read would otherwise become two assets on the register.
 */
export function retryKeyFor(
  officeType: Pick<OfficeAssetType, 'customFields'>,
  asset: FieldSource,
): { tag: string } | { location: string } | undefined {
  if (hasTagField(officeType)) {
    const tag = tagFor(asset);
    if (tag) return { tag };
  }
  const location = locationFor(asset);
  if (location && officeType.customFields.some((f) => LOCATION_FIELD.test(f.name))) return { location };
  return undefined;
}

export const NO_RETRY_KEY_WORDS =
  'This asset type has no tag field in Simpro, so a retry could create it twice. Give it a location, or create it in the office instead and keep it on the phone only here.';

/**
 * Every custom field of the office type, with the asset's value for it.
 *
 * Location, the tag and the serial come from the asset's own columns; any
 * other field is read from the attributes under the office's own name for
 * it, which is where the sync put it — "Extinguisher Type", "FRL Level" —
 * so a value the office set and the phone edited goes back under the same
 * heading. Blank values are kept: the diff needs them to tell a field that
 * was cleared from one that was never there.
 */
export function customFieldsFor(asset: FieldSource, officeType: Pick<OfficeAssetType, 'customFields'>): AssetFieldValue[] {
  // A field the office locked is theirs; writing one is refused, and a
  // create refused for a field nobody on site can even see is a create the
  // technician cannot fix.
  return officeType.customFields.filter((f) => !f.locked).map((f) => {
    let value: string;
    if (LOCATION_FIELD.test(f.name)) value = locationFor(asset);
    else if (TAG_FIELD.test(f.name)) value = tagFor(asset);
    else if (SERIAL_FIELD.test(f.name)) value = asText(asset.serial) || asText(asset.attributes[f.name]);
    else value = asText(asset.attributes[f.name]);
    return { id: f.id, name: f.name, value };
  });
}

/**
 * The keys in an asset's attributes that are the phone's own, not the
 * office's fields: the frequencies and service-level ids the sync derived,
 * the register a door was filed under, the office's type name for an
 * unknown type, and the two copies of the tag the sync keeps beside the
 * office's own heading for it.
 */
const PHONE_KEYS = new Set(['frequencies', 'simproServiceLevels', 'registerSystem', 'simproType', 'tag', 'assetNumber']);

/**
 * An asset's office fields by name alone, for an asset the office already
 * holds.
 *
 * The sync keeps every custom field of a Simpro asset in the attributes
 * under the office's own heading — "Asset #", "Extinguisher Type" — and
 * Location in `locationNote`, so the names are all here and the ids are
 * not. The send resolves the ids from the office's record, and drops any
 * name the office's type does not have, so the phone's own type attributes
 * can ride along without harm. A serial edited on the phone goes under
 * whichever heading of the office's has "serial" in it, where there is one.
 */
export function customFieldsByName(asset: FieldSource): AssetFieldValue[] {
  const out: AssetFieldValue[] = [{ name: 'Location', value: locationFor(asset) }];
  const serial = asText(asset.serial);
  let serialPlaced = false;
  for (const [name, raw] of Object.entries(asset.attributes)) {
    if (PHONE_KEYS.has(name) || LOCATION_FIELD.test(name)) continue;
    let value = asText(raw);
    if (SERIAL_FIELD.test(name) && serial) { value = serial; serialPlaced = true; }
    out.push({ name, value });
  }
  if (serial && !serialPlaced) out.push({ name: 'Serial Number', value: serial });
  return out;
}
