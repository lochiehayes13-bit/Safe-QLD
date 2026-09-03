import type { DeviceType, TestRow } from '@/domain/types';
import type { BoosterTest, FlowTest, Form72, SprinklerFlowTest } from '@/domain/form72';
import { SECTION_ORDER, SYSTEM_FOR_TYPE } from '@/domain/reportSections';
import { SYSTEM_COLUMNS, SYSTEM_LABEL, type RegisterSystem } from '@/parsers/assetRegister';
import { SYSTEM_LABELS, assetTypeById, type SystemKind } from '@/seed/assetTypes';
import { installationForSystem } from '@/domain/statementEvidence';
import { qldIsoDay } from '@/domain/qldTime';

/**
 * The three forms, built from the asset register.
 *
 * The office's sites and their equipment come from Simpro's customer assets —
 * 3,059 sites and 12,568 assets in the `asset` table. The service report's
 * test sheet, Form 72's lists and the occupier statement were written earlier
 * against panel configuration imports, and read `panel` and `point`. A site
 * synced from the office has neither, so "add every device" added nothing,
 * Form 72 opened with every list blank, and the statement had to be filled
 * from memory.
 *
 * Everything here is pure and structural so it can be tested against an
 * invented register rather than a device. The one rule that runs through all
 * three builders: nothing the register does not know is invented. A blank
 * stays blank and is named as not recorded, because a form that fills a gap
 * with a plausible value is signed by somebody who did not know the gap was
 * there.
 */

/** What the builders need of an asset. `AssetRecord` satisfies it. */
export interface RegisterAsset {
  id: string;
  assetTypeId: string;
  name: string;
  code?: string;
  level?: string;
  room?: string;
  locationNote?: string;
  walkOrder?: number;
  status?: string;
  attributes: Record<string, string | number | boolean>;
  lastServicedAt?: string;
  lastResult?: string;
  nextDueAt?: string;
}

// ---------------------------------------------------------------------------
// Reading an asset
// ---------------------------------------------------------------------------

/**
 * The register system an asset belongs to.
 *
 * The report-section map answers for the serviced types; anything it does not
 * name falls back to the asset type's broad system, so a speaker or a flow
 * switch still lands under a heading rather than under "unknown".
 */
const REGISTER_SYSTEM_FOR_KIND: Record<SystemKind, RegisterSystem> = {
  detection: 'detection',
  ews: 'ews',
  aspirating: 'detection',
  sprinkler: 'sprinkler',
  hydrant: 'hydrant',
  'hose-reel': 'hose-reel',
  extinguisher: 'extinguisher',
  'emergency-lighting': 'emergency-lighting',
  pump: 'pump',
  gas: 'special-hazard',
  passive: 'unknown',
  door: 'fire-door',
  electrical: 'unknown',
  structure: 'unknown',
};

export function registerSystemFor(assetTypeId: string): RegisterSystem {
  const mapped = SYSTEM_FOR_TYPE[assetTypeId];
  if (mapped) return mapped;
  const kind = assetTypeById(assetTypeId)?.system;
  return kind ? REGISTER_SYSTEM_FOR_KIND[kind] : 'unknown';
}

const str = (v: string | number | boolean | undefined): string | undefined => {
  if (v === undefined || v === null || typeof v === 'boolean') return undefined;
  const s = String(v).trim();
  return s || undefined;
};

/**
 * The number written on the equipment.
 *
 * The register importer files it as assetNumber, the Simpro sync as tag as
 * well, and a hand-made asset has only its code. Any of them is what a
 * technician reads off the plate.
 */
export function assetTag(asset: RegisterAsset): string | undefined {
  return str(asset.attributes['assetNumber']) ?? str(asset.attributes['tag']) ?? str(asset.code);
}

/**
 * A heading reduced to what two people typing it would agree on: case,
 * spacing and punctuation dropped, "&" read as "and". The Simpro sync keeps
 * the office's custom-field names verbatim, and the office is not consistent
 * about "Equipment Type & Size" against "Equipment type and size".
 */
export function headingKey(heading: string): string {
  return heading.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Lookup by heading, tolerant of case, spacing and punctuation. */
function attribute(asset: RegisterAsset, key: string): string | undefined {
  const direct = str(asset.attributes[key]);
  if (direct) return direct;
  const wanted = headingKey(key);
  for (const [k, v] of Object.entries(asset.attributes)) {
    if (headingKey(k) === wanted) return str(v);
  }
  return undefined;
}

/**
 * Headings the office has used for the type-and-size descriptor, tried in
 * turn when the system's own column is not on the asset. The live Simpro
 * asset types keep "Equipment Type" and "Battery Sizes" as two fields where
 * the CSV register has one "Equipment Type & Batt Sizes" column, so the
 * system's column alone found nothing on a synced pumpset.
 */
const DESCRIPTOR_HEADINGS = [
  'Extinguisher Type', 'Blanket Type & Size', 'Emergency Light Type & Size', 'Equipment Type & Size',
  'Equipment Type & Batt Sizes', 'Equipment Type & Batt Type', 'Equipment Type', 'Type & Size',
  'Size mm RG / QRT', 'EWIS Brand', 'Dimensions, Lockset, Closer', 'Doorset', 'Type',
];

/**
 * The type-and-size descriptor: "ABE 4.5kg", "Wet 100mm", "2 x 18W".
 *
 * The register importer stores it under `descriptor`; the Simpro sync keeps
 * the office's own heading verbatim, and those headings are the ones the
 * register's report columns already know.
 */
export function assetDescriptor(asset: RegisterAsset, system: RegisterSystem = registerSystemFor(asset.assetTypeId)): string | undefined {
  const own = attribute(asset, 'descriptor') ?? attribute(asset, SYSTEM_COLUMNS[system].descriptor);
  if (own) return own;
  for (const heading of DESCRIPTOR_HEADINGS) {
    const found = attribute(asset, heading);
    if (found) return found;
  }
  return undefined;
}

/** The register's label for the type, with the descriptor where it has one. */
export function assetTypeLabel(asset: RegisterAsset): string {
  const label = assetTypeById(asset.assetTypeId)?.label ?? asset.assetTypeId;
  const descriptor = assetDescriptor(asset);
  return descriptor ? `${label} — ${descriptor}` : label;
}

/**
 * Where the asset is, as one line.
 *
 * The Simpro sync names an asset by its location, so the name usually is the
 * place. Level and room are put in front only where the name does not already
 * carry them, so "Level 2 — Level 2 east corridor" does not happen.
 */
export function assetLocation(asset: RegisterAsset): string {
  const place = asset.name.trim() || asset.locationNote?.trim() || assetTypeById(asset.assetTypeId)?.label || 'Asset';
  const lower = place.toLowerCase();
  const prefix = [asset.level, asset.room]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p) && !lower.includes(p!.toLowerCase()));
  return prefix.length ? `${prefix.join(' · ')} — ${place}` : place;
}

/**
 * Equipment a technician could test.
 *
 * Levels, rooms and structure are the building, not equipment. An asset of a
 * type the app does not know is equipment nobody can classify, and a row for
 * it would be a row nobody could mark. Retired equipment is gone.
 */
export function isServiceable(asset: RegisterAsset): boolean {
  const type = assetTypeById(asset.assetTypeId);
  if (!type || type.system === 'structure') return false;
  return asset.status !== 'decommissioned' && asset.status !== 'removed';
}

/**
 * The panel vocabulary's nearest word for an asset type.
 *
 * The test sheet's `deviceType` was designed for loop devices, and most of a
 * register is not one. Where there is a real match it is used, so a detector
 * from the register gets the same default test method as one from a panel
 * file; everything else is 'unknown', and the row carries the register's own
 * type label beside it so the document never prints "Unknown" for an
 * extinguisher.
 */
export function deviceTypeForAsset(asset: RegisterAsset): DeviceType {
  const pick = (key: string): string => (attribute(asset, key) ?? '').toLowerCase();
  switch (asset.assetTypeId) {
    case 'detector': {
      const kind = pick('detectorType');
      if (kind.startsWith('photo')) return 'smoke-photo';
      if (kind.startsWith('ion')) return 'smoke-ion';
      if (kind.startsWith('heat')) return 'heat';
      if (kind.startsWith('multi')) return 'multi';
      if (kind.startsWith('beam')) return 'beam';
      if (kind.startsWith('duct')) return 'duct';
      if (kind.startsWith('flame')) return 'flame';
      return 'smoke';
    }
    case 'smoke-alarm': return pick('alarmType').startsWith('heat') ? 'heat' : 'smoke';
    case 'mcp': return 'mcp';
    case 'module': {
      const kind = pick('moduleType');
      if (kind.startsWith('input')) return 'module-input';
      if (kind.startsWith('output')) return 'module-output';
      if (kind.startsWith('relay')) return 'relay';
      if (kind.startsWith('isolator')) return 'isolator';
      return 'module-io';
    }
    case 'speaker': return 'sounder';
    case 'strobe': return 'strobe';
    case 'wip': return 'wip';
    case 'asd':
    case 'sampling-point': return 'aspirating';
    case 'flow-switch': return 'sprinkler-flow';
    case 'sprinkler-valve': return 'sprinkler-valve';
    case 'gas-cylinder': return 'gas';
    default: return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// The service report's test sheet
// ---------------------------------------------------------------------------

/** A test row ready to insert: everything but the ids the database assigns. */
export type AssetTestRow = Omit<TestRow, 'id' | 'reportId'> & { assetId: string };

/** Text comparison that puts "Level 2" before "Level 10" and blanks last. */
function compareText(a: string | undefined, b: string | undefined): number {
  const x = a?.trim() ?? '';
  const y = b?.trim() ?? '';
  if (!x && !y) return 0;
  if (!x) return 1;
  if (!y) return -1;
  return x.localeCompare(y, 'en', { numeric: true, sensitivity: 'base' });
}

function compareNumber(a: number | undefined, b: number | undefined): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a - b;
}

const sectionRank = (system: RegisterSystem): number => {
  const i = SECTION_ORDER.indexOf(system);
  return i < 0 ? SECTION_ORDER.length : i;
};

/**
 * Sorts a register the way a technician walks it: system by system in the
 * report's order, then level, room, walk order and name.
 */
export function orderForWalk<T extends RegisterAsset>(assets: readonly T[]): T[] {
  return [...assets].sort((a, b) =>
    sectionRank(registerSystemFor(a.assetTypeId)) - sectionRank(registerSystemFor(b.assetTypeId))
    || compareText(a.level, b.level)
    || compareText(a.room, b.room)
    || compareNumber(a.walkOrder, b.walkOrder)
    || compareText(a.name, b.name)
    || a.id.localeCompare(b.id));
}

export interface TestRowsOptions {
  /** Assets already on the sheet, which are not added twice. */
  skipAssetIds?: ReadonlySet<string>;
  /**
   * Systems a panel configuration already covers on this report. Where a site
   * has both a panel file and a register, the detectors are on the sheet from
   * the panel already, and adding them again from the register doubles the
   * count and halves the coverage figure.
   */
  skipSystems?: ReadonlySet<RegisterSystem>;
  /** The sort index of the first row added, so appended rows follow the existing ones. */
  firstSortIndex?: number;
}

/**
 * One test row per serviceable asset, grouped by system and in walk order.
 *
 * The row carries the number on the equipment as its address, the register's
 * type label, and the system heading as its zone text, which is what the
 * printed sheet groups on. The asset id is what lets the result travel back to
 * the register.
 */
export function testRowsFromAssets(assets: readonly RegisterAsset[], options: TestRowsOptions = {}): AssetTestRow[] {
  const skipIds = options.skipAssetIds ?? new Set<string>();
  const skipSystems = options.skipSystems ?? new Set<RegisterSystem>();
  let sortIndex = options.firstSortIndex ?? 0;
  const rows: AssetTestRow[] = [];

  for (const asset of orderForWalk(assets)) {
    if (!isServiceable(asset) || skipIds.has(asset.id)) continue;
    const system = registerSystemFor(asset.assetTypeId);
    if (skipSystems.has(system)) continue;
    rows.push({
      assetId: asset.id,
      assetType: assetTypeLabel(asset),
      pointRef: assetTag(asset),
      deviceText: assetLocation(asset),
      deviceType: deviceTypeForAsset(asset),
      zoneText: SYSTEM_LABEL[system],
      result: 'untested',
      sortIndex: sortIndex++,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Form 72
// ---------------------------------------------------------------------------

export interface Form72Pump {
  location: string;
  ratedFlowLps?: number;
  ratedPressureKpa?: number;
}

export interface Form72Prefill {
  /** The system descriptor for the form's top corner, where the register can say. */
  systemLabel?: string;
  /** The hydrants, in walk order, for Part D. */
  hydrantLocations: string[];
  /** Booster assemblies, for Part E. */
  boosterLocations: string[];
  pumps: Form72Pump[];
  tanks: { location: string; capacityLitres?: number }[];
  /** Sprinkler valve sets, which is where the test points are, for Part G. */
  sprinklerTestPoints: string[];
  /** One line per list that was filled, for the summary shown after. */
  filled: string[];
  /** What the register does not hold, named rather than left as a silent blank. */
  notRecorded: string[];
}

const num = (v: string | undefined): number | undefined => {
  if (!v) return undefined;
  const n = Number(v.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** A location with the equipment number after it, which is how the form names a hydrant. */
function locationWithTag(asset: RegisterAsset): string {
  const tag = assetTag(asset);
  const place = assetLocation(asset);
  return tag && !place.includes(tag) ? `${place} (${tag})` : place;
}

/**
 * What the register can put on a Form 72.
 *
 * Only the water-based systems: hydrants and boosters for Parts D and E,
 * pumps and tanks for the water supply, sprinkler valve sets for Part G. The
 * test gauges of Part C are the technician's own instruments and no register
 * holds them, so they are named as not recorded rather than left as a blank
 * somebody might read as "no gauge used".
 */
export function form72FromAssets(assets: readonly RegisterAsset[]): Form72Prefill {
  const live = orderForWalk(assets).filter(isServiceable);
  const of = (typeId: string): RegisterAsset[] => live.filter((a) => a.assetTypeId === typeId);

  const hydrants = of('hydrant');
  const boosters = of('booster');
  const pumps = of('fire-pump');
  const tanks = of('water-tank');
  const valves = of('sprinkler-valve');

  const prefill: Form72Prefill = {
    hydrantLocations: hydrants.map(locationWithTag),
    boosterLocations: boosters.map(locationWithTag),
    pumps: pumps.map((p) => ({
      location: locationWithTag(p),
      ratedFlowLps: num(attribute(p, 'ratedFlow')),
      ratedPressureKpa: num(attribute(p, 'ratedPressure')),
    })),
    tanks: tanks.map((t) => ({ location: locationWithTag(t), capacityLitres: num(attribute(t, 'capacity')) })),
    sprinklerTestPoints: valves.map((v) => {
      const descriptor = assetDescriptor(v);
      const place = locationWithTag(v);
      return descriptor ? `${place} — ${descriptor}` : place;
    }),
    filled: [],
    notRecorded: [],
  };

  // The descriptor is derived, not typed, so it only says what the register
  // supports: a booster makes a hydrant system boosted, a valve set makes it
  // a sprinkler system, both make it combined.
  const hasHydrant = hydrants.length > 0 || boosters.length > 0;
  const hasSprinkler = valves.length > 0;
  if (hasHydrant && hasSprinkler) prefill.systemLabel = 'Combined Hydrant and Sprinkler System';
  else if (hasHydrant) prefill.systemLabel = boosters.length ? 'Boosted Hydrant System' : 'Fire Hydrant System';
  else if (hasSprinkler) prefill.systemLabel = 'Automatic Fire Sprinkler System';

  const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
  if (hydrants.length) prefill.filled.push(`${plural(hydrants.length, 'hydrant', 'hydrants')} into Part D`);
  else prefill.notRecorded.push('Hydrants: none in the register');
  if (boosters.length) prefill.filled.push(`${plural(boosters.length, 'booster assembly', 'booster assemblies')} into Part E`);
  else prefill.notRecorded.push('Booster: none in the register');
  if (pumps.length) prefill.filled.push(`${plural(pumps.length, 'fire pump', 'fire pumps')} — on-site pump set`);
  else prefill.notRecorded.push('Fire pump: none in the register');
  if (tanks.length) prefill.filled.push(`${plural(tanks.length, 'water tank', 'water tanks')} into the water supply note`);
  else prefill.notRecorded.push('Water storage tank: none in the register');
  if (valves.length) prefill.filled.push(`${plural(valves.length, 'sprinkler valve set', 'sprinkler valve sets')} into Part G`);
  else prefill.notRecorded.push('Sprinkler valve sets: none in the register');
  prefill.notRecorded.push('Test gauges and flow devices (Part C): the register does not hold test equipment — add yours');

  return prefill;
}

/** "Pump room (rated 16 L/s at 700 kPa)" — the duty named as the pump's, not as the system's requirement. */
function pumpLine(p: Form72Pump): string {
  const duty = [
    p.ratedFlowLps !== undefined ? `${p.ratedFlowLps} L/s` : undefined,
    p.ratedPressureKpa !== undefined ? `${p.ratedPressureKpa} kPa` : undefined,
  ].filter(Boolean).join(' at ');
  return duty ? `${p.location} (pump rated ${duty})` : p.location;
}

/** The parts of a Form 72 the register can fill. Structurally a Form72Patch. */
export type Form72PrefillPatch = {
  systemLabel?: string;
  flowTest?: FlowTest;
  booster?: BoosterTest;
  sprinklerFlow?: SprinklerFlowTest;
};

/**
 * Lays the register's lists onto a form, blanks only.
 *
 * A form somebody has started typing into keeps what they typed. Each list is
 * filled only where it is empty, so pressing the button twice, or on a form
 * with two hydrants already named, changes nothing that was a decision.
 */
export function applyForm72Prefill(
  form: Pick<Form72, 'flowTest' | 'booster' | 'sprinklerFlow'> & { systemLabel?: string },
  prefill: Form72Prefill,
): Form72PrefillPatch {
  const patch: Form72PrefillPatch = {};

  if (!form.systemLabel?.trim() && prefill.systemLabel) patch.systemLabel = prefill.systemLabel;

  const flow: FlowTest = { ...form.flowTest };
  let flowChanged = false;
  if (!flow.hydrantLocations.length && prefill.hydrantLocations.length) {
    flow.hydrantLocations = [...prefill.hydrantLocations];
    flowChanged = true;
  }
  if (flow.onSitePumpSet === undefined && prefill.pumps.length) {
    flow.onSitePumpSet = true;
    flowChanged = true;
  }
  if (!flow.comment?.trim() && prefill.tanks.length) {
    flow.comment = `Water supply from the register: ${prefill.tanks
      .map((t) => `tank at ${t.location}${t.capacityLitres ? ` (${t.capacityLitres} L)` : ''}`)
      .join('; ')}`;
    flowChanged = true;
  }
  if (flowChanged) patch.flowTest = flow;

  /*
   * The pump's rated duty goes into the comments, beside the pump, and no
   * further. Part E's required flow and pressure are the brigade booster
   * inlet requirement for the system, which is a design figure the register
   * does not hold; the pump's discharge duty is a different quantity, and
   * writing it into the required fields had the booster test judged against
   * the wrong number under a licensee's signature.
   */
  const booster: BoosterTest = { ...form.booster };
  if (!booster.comments?.trim() && (prefill.boosterLocations.length || prefill.pumps.length)) {
    const lines: string[] = [];
    if (prefill.boosterLocations.length) lines.push(`Booster assembly: ${prefill.boosterLocations.join('; ')}`);
    if (prefill.pumps.length) lines.push(`Fire pump: ${prefill.pumps.map(pumpLine).join('; ')}`);
    booster.comments = lines.join('\n');
    patch.booster = booster;
  }

  if (!form.sprinklerFlow.testPoints.length && prefill.sprinklerTestPoints.length) {
    patch.sprinklerFlow = {
      ...form.sprinklerFlow,
      testPoints: prefill.sprinklerTestPoints.map((location) => ({ location })),
    };
  }

  return patch;
}

// ---------------------------------------------------------------------------
// The occupier statement
// ---------------------------------------------------------------------------

/** What the register can say about one of the twenty-one prescribed installations. */
export type RegisterKnowledge =
  /** The register holds equipment for it. */
  | 'present'
  /** The register holds this site's equipment and none of it is this. */
  | 'absent'
  /** The register cannot name this installation — air handling, lifts, fire mains — so it says nothing. */
  | 'unknown';

export interface InstallationEvidence {
  installation: string;
  knowledge: RegisterKnowledge;
  assetCount: number;
  /** The latest last-test date the register holds across this installation's assets. */
  lastMaintainedDate?: string;
  /** The soonest date any of its assets falls due. */
  nextDueDate?: string;
}

export interface RegisterEvidence {
  installations: InstallationEvidence[];
  /** Serviceable assets whose system names no Schedule 2 row, with the reason, so they are placed by hand. */
  unplaced: { label: string; count: number; why: string }[];
  /** Assets of a type the app did not recognise, which it cannot place anywhere. */
  unrecognised: number;
  /** Serviceable assets the register holds for the site. */
  total: number;
}

/**
 * The register's own system for an asset, where one was recorded.
 *
 * Fire and smoke doors share one asset type, and the type alone cannot say
 * which row a door belongs on. A sync or import that knows the register it
 * read from can leave it here; nothing is assumed where it did not.
 */
function recordedRegisterSystem(asset: RegisterAsset): RegisterSystem | undefined {
  const v = str(asset.attributes['registerSystem']);
  return v === 'smoke-door' || v === 'fire-door' ? v : undefined;
}

/**
 * The Schedule 2 row an asset speaks for, or why it does not.
 *
 * Two types are handled before the broad system is asked. A fire blanket is
 * filed under the extinguisher system for servicing but is not one of the
 * twenty-one prescribed installations, and counting it made a kitchen with
 * two blankets and no extinguishers read "Fire extinguishers: present". A
 * door is either a fire doorset or a smoke doorset and the asset type does
 * not say which — both registers create the same type — so a door answers
 * neither row unless the register it came from was recorded on it.
 */
function installationForAsset(asset: RegisterAsset, system: SystemKind): ReturnType<typeof installationForSystem> {
  if (asset.assetTypeId === 'fire-blanket') return installationForSystem('fire-blanket');
  if (system === 'door') {
    const recorded = recordedRegisterSystem(asset);
    if (recorded) return installationForSystem(recorded);
    return {
      why: 'fire doorsets and smoke doorsets share one asset type and the register does not say which '
        + 'this door is, so neither row can be answered from it',
    };
  }
  return installationForSystem(system);
}

/**
 * The installations the register is able to name at all — those some asset
 * system reaches through installationForAsset. Only these can be proposed as
 * not present: a row no asset could ever have hit, "Smoke doorsets" being the
 * one that bit, was being struck off every site that held any equipment.
 * Doors are left out because a door cannot answer either door row.
 */
const NAMEABLE: ReadonlySet<string> = new Set(
  (Object.keys(SYSTEM_LABELS) as SystemKind[])
    .filter((kind) => kind !== 'door')
    .map((kind) => installationForSystem(kind).installation)
    .filter((v): v is string => Boolean(v)),
);

/**
 * What the register says about each prescribed installation.
 *
 * Present where the site holds equipment for it. Absent only where the
 * register holds this site's equipment and none of it is that installation —
 * and only for installations the register could have named, so "Emergency
 * lifts" stays unanswered rather than being struck off a form on the strength
 * of a register that never lists lifts. And absent is a note for the
 * summary, not an answer: the register is Safe QLD's serviced-equipment
 * list, not the building's, and a row another contractor maintains is not
 * struck because it is not on our file.
 */
export function occupierEvidenceFromAssets(assets: readonly RegisterAsset[]): RegisterEvidence {
  const counts = new Map<string, InstallationEvidence>();
  const unplaced = new Map<string, { label: string; count: number; why: string }>();
  let unrecognised = 0;
  let total = 0;

  for (const asset of assets) {
    const type = assetTypeById(asset.assetTypeId);
    // Counted before the serviceable check, which would drop it silently.
    if (!type) { unrecognised++; continue; }
    if (!isServiceable(asset)) continue;
    total++;
    const where = installationForAsset(asset, type.system);
    if (!where.installation) {
      const entry = unplaced.get(type.label) ?? { label: type.label, count: 0, why: where.why ?? '' };
      entry.count++;
      unplaced.set(type.label, entry);
      continue;
    }
    const evidence = counts.get(where.installation)
      ?? { installation: where.installation, knowledge: 'present' as const, assetCount: 0 };
    evidence.assetCount++;
    // The Queensland day of each date, not its UTC one: Simpro's LastTest is
    // a day already, but a result recorded on this phone is an instant.
    const last = qldIsoDay(asset.lastServicedAt);
    if (last && (!evidence.lastMaintainedDate || last > evidence.lastMaintainedDate)) evidence.lastMaintainedDate = last;
    const due = qldIsoDay(asset.nextDueAt);
    if (due && (!evidence.nextDueDate || due < evidence.nextDueDate)) evidence.nextDueDate = due;
    counts.set(where.installation, evidence);
  }

  const installations: InstallationEvidence[] = [];
  for (const name of NAMEABLE) {
    const found = counts.get(name);
    if (found) installations.push(found);
    else if (total > 0) installations.push({ installation: name, knowledge: 'absent', assetCount: 0 });
  }
  // A door row a recorded register system did name: present, never absent.
  for (const [name, found] of counts) {
    if (!NAMEABLE.has(name)) installations.push(found);
  }

  return {
    installations,
    unplaced: [...unplaced.values()].sort((a, b) => b.count - a.count),
    unrecognised,
    total,
  };
}

/** The shape of a stored statement row this prefill touches. */
export interface OccupierRowLike {
  installation: string;
  present: boolean;
  lastMaintainedDate?: string;
  nextDueDate?: string;
}

/**
 * Lays the register's evidence onto the statement's rows.
 *
 * A row the register holds equipment for is ticked and carries the dates
 * the register holds. A row it holds nothing for is left as the occupier had
 * it: the register is the equipment Safe QLD services, not everything in the
 * building, and a fire indicator panel another company maintains is still
 * there. Lowering a tick on the strength of our silence struck it from a
 * statement that goes to the Commissioner — so the prefill only ever raises,
 * and the screen names the rows we hold nothing for so they are checked.
 * The statement stays theirs: every answer here is a proposal they can
 * change on the screen.
 */
export function prefillOccupierRows<R extends OccupierRowLike>(rows: readonly R[], evidence: RegisterEvidence): R[] {
  const byName = new Map(evidence.installations.map((e) => [e.installation, e]));
  return rows.map((row) => {
    const found = byName.get(row.installation);
    if (!found || found.knowledge === 'unknown') return row;
    return {
      ...row,
      present: row.present || found.knowledge === 'present',
      lastMaintainedDate: found.lastMaintainedDate ?? row.lastMaintainedDate,
      nextDueDate: found.nextDueDate ?? row.nextDueDate,
    };
  });
}
