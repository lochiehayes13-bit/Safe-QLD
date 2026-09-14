import { DEVICE_TYPE_LABEL } from '@/parsers/deviceType';
import { addressLabel, type ConfigPoint, type ConfigZone } from '@/domain/configBrowse';
import type { DeviceType, PanelBrand } from '@/domain/types';

/**
 * What has changed between a configuration file and what the app already holds.
 *
 * This is the question a panel config is most often opened to answer, and
 * until now the only way to ask it was to import the file and watch the site
 * change under you. A builder hands over a config after a fit-out; a
 * contractor says nothing was touched; a panel has devices on it that are not
 * on last year's test sheet. In every case the useful answer is a short list —
 * six added, one gone, four relabelled — and not a site full of merged rows.
 *
 * Two rules keep the list honest.
 *
 * A device that changed is not reported as one gone and one arrived. Address
 * 34 on loop 1 called "LEVEL 3 STORE" where the app has "LEVEL 3 STOREROOM" is
 * one device with its text edited, and reporting it as a removal and an
 * addition turns a four-line answer into an eight-line one where every line is
 * half true.
 *
 * And where two sides cannot be compared, that is said rather than assumed.
 * A device with no address and no reference on either side cannot be matched
 * to anything — the panel's own terminals are usually like this — and counting
 * those as removed would report a change on every comparison ever run.
 */

/** How a device on one side was identified for matching. */
export type MatchBasis =
  /** Loop, address and channel: the panel's own identity for a device. */
  | 'address'
  /** The panel's point reference, where there is no loop address. */
  | 'reference'
  /** Nothing to match on. */
  | 'none';

export interface ComparedPoint {
  /** "1/34.2", or the point reference, or nothing. */
  where: string;
  text: string;
  zoneNumber?: number;
  deviceType: DeviceType;
  basis: MatchBasis;
}

/** One device that is on both sides and is not the same on both. */
export interface PointDifference {
  inFile: ComparedPoint;
  held: ComparedPoint;
  /** What differs, in the words a screen shows. Never empty. */
  differences: string[];
  /** True where the device is at a different address in the file. */
  moved: boolean;
}

export interface ZoneDifference {
  number: number;
  inFile?: string;
  held?: string;
}

export interface ConfigComparison {
  /** In the file and not held. */
  added: ComparedPoint[];
  /** Held and not in the file. */
  removed: ComparedPoint[];
  /** On both sides and different. */
  changed: PointDifference[];
  /** On both sides and identical. A count: nobody reads the list. */
  unchanged: number;
  zonesAdded: ZoneDifference[];
  zonesRemoved: ZoneDifference[];
  zonesRetexted: ZoneDifference[];
  /**
   * What this comparison could not do, in sentences.
   *
   * Present and shown even when the rest of the answer is empty, because
   * "nothing has changed" and "nothing could be compared" look identical on a
   * screen and mean opposite things.
   */
  caveats: string[];
}

/** The key a device is matched on, or nothing where it has none. */
function keyOf(point: ConfigPoint): { key: string; basis: MatchBasis } {
  if (point.address !== undefined) {
    const loop = point.loopNumber ?? 0;
    const sub = point.subAddress ?? 0;
    return { key: `a:${loop}/${point.address}.${sub}`, basis: 'address' };
  }
  const ref = point.pointRef?.trim();
  if (ref) return { key: `r:${ref.toLowerCase()}`, basis: 'reference' };
  return { key: '', basis: 'none' };
}

function compared(point: ConfigPoint, basis: MatchBasis): ComparedPoint {
  return {
    where: addressLabel(point),
    text: point.text.trim(),
    zoneNumber: point.zoneNumber,
    deviceType: point.deviceType,
    basis,
  };
}

/** The text of a device, lowercased and with its runs of space closed up. */
function normalisedText(point: ConfigPoint): string {
  return point.text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** What differs between two devices that are the same device. */
function differencesBetween(inFile: ConfigPoint, held: ConfigPoint): string[] {
  const out: string[] = [];

  if (normalisedText(inFile) !== normalisedText(held)) {
    out.push(held.text.trim()
      ? `Relabelled: was "${held.text.trim()}", now "${inFile.text.trim() || '(blank)'}"`
      : `Labelled "${inFile.text.trim()}", which was blank`);
  }

  if (inFile.zoneNumber !== held.zoneNumber) {
    const was = held.zoneNumber === undefined ? 'no zone' : `zone ${held.zoneNumber}`;
    const now = inFile.zoneNumber === undefined ? 'no zone' : `zone ${inFile.zoneNumber}`;
    out.push(`Moved from ${was} to ${now}`);
  }

  /*
   * A type change is reported only where both sides know the type. Half the
   * parsers in this app cannot read one and hand back 'unknown' for every
   * device, so comparing a file read by one of those against a site imported
   * from a CSV would report a type change on every device in the building —
   * which is a fact about the two readers and not about the panel.
   */
  if (inFile.deviceType !== held.deviceType
    && inFile.deviceType !== 'unknown' && held.deviceType !== 'unknown') {
    out.push(`Type changed: was ${DEVICE_TYPE_LABEL[held.deviceType] ?? held.deviceType}, `
      + `now ${DEVICE_TYPE_LABEL[inFile.deviceType] ?? inFile.deviceType}`);
  }

  return out;
}

export interface CompareOptions {
  /**
   * Whether to compare the spare and unfitted addresses too.
   *
   * Off by default. A panel with sixty programmed spares produces sixty lines
   * of nothing, and the question being asked is about the devices in the
   * building.
   */
  includeUnused?: boolean;
}

/**
 * Compares a configuration against the points the app already holds.
 *
 * The second pass is what makes this worth having. After matching on address,
 * anything left over on both sides is matched on its text — so a detector
 * moved from address 12 to address 14 during a refit reads as one device that
 * moved, not as one that vanished and one that appeared at the other end of
 * the list. The text has to be an exact match after case and spacing, and it
 * has to be unique on both sides: two devices both called "SPARE" say nothing
 * about which is which, and guessing there would invent a move that nobody
 * made.
 */
export function compareConfig(
  inFile: readonly ConfigPoint[],
  held: readonly ConfigPoint[],
  fileZones: readonly ConfigZone[] = [],
  heldZones: readonly ConfigZone[] = [],
  options: CompareOptions = {},
): ConfigComparison {
  const caveats: string[] = [];
  const keep = (p: ConfigPoint) => options.includeUnused || !p.unused;

  const fileList = inFile.filter(keep);
  const heldList = held.filter(keep);

  const unmatchable = (list: readonly ConfigPoint[]) => list.filter((p) => keyOf(p).basis === 'none');
  const fileUnmatchable = unmatchable(fileList);
  const heldUnmatchable = unmatchable(heldList);

  const fileByKey = new Map<string, ConfigPoint[]>();
  for (const p of fileList) {
    const { key } = keyOf(p);
    if (!key) continue;
    const list = fileByKey.get(key);
    if (list) list.push(p);
    else fileByKey.set(key, [p]);
  }

  const added: ComparedPoint[] = [];
  const removed: ComparedPoint[] = [];
  const changed: PointDifference[] = [];
  let unchanged = 0;

  const matchedFile = new Set<ConfigPoint>();
  const leftoverHeld: ConfigPoint[] = [];

  for (const h of heldList) {
    const { key, basis } = keyOf(h);
    if (!key) continue;
    const candidates = fileByKey.get(key);
    const f = candidates?.find((c) => !matchedFile.has(c));
    if (!f) {
      leftoverHeld.push(h);
      continue;
    }
    matchedFile.add(f);
    const diffs = differencesBetween(f, h);
    if (diffs.length) {
      changed.push({ inFile: compared(f, basis), held: compared(h, basis), differences: diffs, moved: false });
    } else {
      unchanged++;
    }
  }

  const leftoverFile = fileList.filter((p) => keyOf(p).basis !== 'none' && !matchedFile.has(p));

  /*
   * Second pass: the same device at a different address. Only where the text
   * names exactly one device on each side, because a name shared by two is not
   * an identity — the same reasoning that stops the site importers matching
   * three buildings called "Luggage Direct" onto one.
   */
  const byText = (list: readonly ConfigPoint[]) => {
    const map = new Map<string, ConfigPoint[]>();
    for (const p of list) {
      const t = normalisedText(p);
      if (!t) continue;
      const existing = map.get(t);
      if (existing) existing.push(p);
      else map.set(t, [p]);
    }
    return map;
  };

  const fileByText = byText(leftoverFile);
  const movedFile = new Set<ConfigPoint>();
  const movedHeld = new Set<ConfigPoint>();
  const heldByText = byText(leftoverHeld);

  for (const [text, heldSame] of heldByText) {
    const fileSame = fileByText.get(text);
    if (!fileSame || fileSame.length !== 1 || heldSame.length !== 1) continue;
    const f = fileSame[0]!;
    const h = heldSame[0]!;
    movedFile.add(f);
    movedHeld.add(h);
    const diffs = differencesBetween(f, h);
    changed.push({
      inFile: compared(f, keyOf(f).basis),
      held: compared(h, keyOf(h).basis),
      differences: [`Moved from ${h.address === undefined ? 'no address' : addressLabel(h)} to `
        + `${f.address === undefined ? 'no address' : addressLabel(f)}`, ...diffs],
      moved: true,
    });
  }

  for (const f of leftoverFile) if (!movedFile.has(f)) added.push(compared(f, keyOf(f).basis));
  for (const h of leftoverHeld) if (!movedHeld.has(h)) removed.push(compared(h, keyOf(h).basis));

  if (fileUnmatchable.length || heldUnmatchable.length) {
    const total = fileUnmatchable.length + heldUnmatchable.length;
    caveats.push(
      `${total.toLocaleString()} ${total === 1 ? 'point has' : 'points have'} no address and no reference, `
      + 'so nothing could be matched to them. They are usually the panel\'s own terminals. '
      + 'They are left out of this comparison rather than counted as changes.',
    );
  }

  if (!heldList.length) {
    caveats.push('Nothing is held for this site yet, so everything in the file reads as new.');
  }

  const zoneText = (list: readonly ConfigZone[]) => new Map(list.map((z) => [z.number, z.text.trim()]));
  const fileZoneText = zoneText(fileZones);
  const heldZoneText = zoneText(heldZones);
  const zonesAdded: ZoneDifference[] = [];
  const zonesRemoved: ZoneDifference[] = [];
  const zonesRetexted: ZoneDifference[] = [];

  for (const [number, text] of fileZoneText) {
    const was = heldZoneText.get(number);
    if (was === undefined) zonesAdded.push({ number, inFile: text });
    else if (was.toLowerCase() !== text.toLowerCase()) zonesRetexted.push({ number, inFile: text, held: was });
  }
  for (const [number, text] of heldZoneText) {
    if (!fileZoneText.has(number)) zonesRemoved.push({ number, held: text });
  }

  const byNumber = (a: ZoneDifference, b: ZoneDifference) => a.number - b.number;

  return {
    added,
    removed,
    changed,
    unchanged,
    zonesAdded: zonesAdded.sort(byNumber),
    zonesRemoved: zonesRemoved.sort(byNumber),
    zonesRetexted: zonesRetexted.sort(byNumber),
    caveats,
  };
}

/** True where the two sides are the same in every way this can see. */
export function noChanges(c: ConfigComparison): boolean {
  return c.added.length === 0 && c.removed.length === 0 && c.changed.length === 0
    && c.zonesAdded.length === 0 && c.zonesRemoved.length === 0 && c.zonesRetexted.length === 0;
}

/** The one line a screen leads with. */
export function describeComparison(c: ConfigComparison): string {
  if (noChanges(c)) {
    return c.unchanged
      ? `No differences across ${c.unchanged.toLocaleString()} devices.`
      : 'Nothing could be compared.';
  }
  const parts: string[] = [];
  if (c.added.length) parts.push(`${c.added.length} in the file and not here`);
  if (c.removed.length) parts.push(`${c.removed.length} here and not in the file`);
  if (c.changed.length) parts.push(`${c.changed.length} different`);
  const zones = c.zonesAdded.length + c.zonesRemoved.length + c.zonesRetexted.length;
  if (zones) parts.push(`${zones} zone${zones === 1 ? '' : 's'} changed`);
  return `${parts.join(', ')}.`;
}

// ---------------------------------------------------------------------------
// Is this even the right building?
// ---------------------------------------------------------------------------

/**
 * A disagreement between the file and the record, before anything is compared.
 *
 * This is the first question a technician asks of a config somebody hands
 * them, and until now the app could not ask it at all. Configs get handed over
 * on site by the dozen and half of them are last year's, or the building next
 * door. Working a device list for the wrong building burns the visit, and
 * writing one into a site puts the wrong device text into the register for
 * good.
 *
 * Both checks are deliberately weak in one direction: they fire only when both
 * sides say something and the two things said cannot be reconciled. A blank on
 * either side is not evidence, and nor is "other" — which is what a
 * column-mapped import and a hand-typed panel both record.
 */
export interface SiteMismatch {
  kind: 'name' | 'brand';
  title: string;
  body: string;
}

/** Names closed up for comparison: case, punctuation and runs of space. */
function comparableName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function siteMismatches(input: {
  /** The site name the file carries itself. */
  siteNameInFile?: string;
  /** The name of the site it has been tied to. */
  siteName?: string;
  /** The brand the file says it is. */
  fileBrand?: PanelBrand;
  /** The brands of the panels already on that site. */
  heldBrands?: readonly PanelBrand[];
}): SiteMismatch[] {
  const out: SiteMismatch[] = [];

  const inFile = comparableName(input.siteNameInFile ?? '');
  const held = comparableName(input.siteName ?? '');
  /*
   * Containment either way counts as agreement. The office holds "Vaxxas" and
   * the file says "VAXXAS BIO MEDICAL FACILITY"; the office holds "Ipswich
   * Hospital" and the file says "IPSWICH HOSPITAL MAIN FIRE CONTROL ROOM".
   * Both are the same building described at different lengths, and reporting
   * them would train somebody to ignore the banner.
   */
  if (inFile && held && !inFile.includes(held) && !held.includes(inFile)) {
    out.push({
      kind: 'name',
      title: 'This file names a different building',
      body: `The file calls itself "${input.siteNameInFile?.trim()}" and it is tied to `
        + `"${input.siteName?.trim()}". Worth settling before you read addresses off it.`,
    });
  }

  const fileBrand = input.fileBrand;
  const heldBrands = (input.heldBrands ?? []).filter((b) => b !== 'other');
  if (fileBrand && fileBrand !== 'other' && heldBrands.length && !heldBrands.includes(fileBrand)) {
    out.push({
      kind: 'brand',
      title: 'The panel on record here is a different make',
      body: `This file is a ${fileBrand} configuration and the site has `
        + `${[...new Set(heldBrands)].join(' and ')} on it. One of the two is wrong, and it is worth knowing `
        + 'which before you start working from a screen that does not match the panel.',
    });
  }

  return out;
}
