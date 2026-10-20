import { DEVICE_TYPE_LABEL } from '@/parsers/deviceType';
import { buildZoneChart, type ZoneChart } from '@/domain/zoneChart';
import type {
  CauseEffectRule, DeviceType, Loop, ParsedPanel, Point, Zone,
} from '@/domain/types';

/**
 * Reading a configuration that is not in the database.
 *
 * The point browser at `app/site/points.tsx` filters with SQL, because the
 * points it shows were imported into a site. A configuration opened in the
 * Explorer has not been imported and must not be: filtering it is therefore
 * arithmetic over an array, and this is that arithmetic, kept away from the
 * screen so it can be held to a test.
 *
 * The shapes are the parser's rather than the database's — a parsed point has
 * no id and no panelId, because it is not a row and has not been given one.
 * That distinction is worth keeping in the types: an id here would be a
 * promise that the thing can be linked to, and nothing in a file that has not
 * been imported can be.
 */

export type ConfigPoint = Omit<Point, 'id' | 'panelId'>;
export type ConfigZone = Omit<Zone, 'id' | 'panelId'>;
export type ConfigLoop = Omit<Loop, 'id' | 'panelId'>;
export type ConfigRule = Omit<CauseEffectRule, 'id' | 'panelId'>;

// ---------------------------------------------------------------------------
// Searching
// ---------------------------------------------------------------------------

export interface PointFilter {
  /** Free text. Every word has to match something on the point. */
  text?: string;
  loop?: number;
  zone?: number;
  type?: DeviceType;
  /** Spare and unfitted addresses. Off by default, as a panel presents itself. */
  includeUnused?: boolean;
}

/**
 * The words a technician says for a device class, beyond its label.
 *
 * `DEVICE_TYPE_LABEL` has "MCP", and nobody standing in a stairwell says MCP
 * out loud — they say call point, or break glass. The panel's own device text
 * is no help either: the one in this app's own Pertronic sample reads "CARPARK
 * BREAK GLASS", and searching "call point" finds nothing.
 *
 * `@/domain/tradeVocabulary` holds the same synonyms for the standards search
 * and is the obvious thing to reach for, but its `expand` flattens a query into
 * one bag of terms — which is right for ranking a document and wrong here,
 * where every word has to match for the search to narrow. So the synonyms go
 * onto the device instead of into the query: a point carries the words for what
 * it is, and the search stays a plain "every word must appear".
 */
const SPOKEN_AS: Partial<Record<DeviceType, string>> = {
  mcp: 'call point break glass manual call point bga pull station',
  smoke: 'detector head smoke detector',
  'smoke-photo': 'detector head optical photoelectric smoke detector',
  'smoke-ion': 'detector head ionisation smoke detector',
  heat: 'detector head thermal rate of rise',
  multi: 'detector head multisensor multi criteria',
  beam: 'detector beam detector reflector',
  aspirating: 'vesda asd air sampling aspirating',
  flame: 'detector flame detector uv ir',
  duct: 'detector duct probe in duct',
  sounder: 'horn bell warning device occupant warning',
  'sounder-strobe': 'horn beacon combined warning device occupant warning',
  strobe: 'beacon visual alarm vad flasher',
  'module-input': 'module input module monitor module',
  'module-output': 'module output module control module',
  'module-io': 'module input output module io module',
  relay: 'relay output ancillary',
  isolator: 'isolator short circuit isolator sci',
  'sprinkler-flow': 'flow switch waterflow alarm valve',
  'sprinkler-valve': 'valve monitor tamper stop valve',
  wip: 'warden intercom warden phone ewis phone',
  'door-holder': 'door holder mag door magnet door release',
  gas: 'gas carbon monoxide co lpg',
};

/**
 * A search word that is an address rather than a word.
 *
 * "34", "1/34", "1/34.2", "l1". Not "l1p012", which is a point reference and
 * is matched as text like any other name the panel carries.
 */
const ADDRESS_WORD = /^l?\d+(?:[./]\d+)*$/;

/**
 * How a point reads as one string, for searching by words.
 *
 * Deliberately without the bare address in it, and that omission is the whole
 * design. Put the address in and "level 3" starts returning the plant-room
 * heat detector on level 1, because it happens to sit at address 3 — and every
 * search a technician runs on a building whose rooms are numbered produces a
 * list with a few of those in it. The address is still searchable; it is
 * searched separately, below, when the query is an address rather than words.
 *
 * The zone goes in as the phrase "zone 9" rather than as a bare 9, for the
 * same reason: "zone" has to be typed for the number to count.
 */
function haystack(point: ConfigPoint): string {
  const parts = [
    point.text,
    point.text2 ?? '',
    point.pointRef ?? '',
    point.zoneText ?? '',
    point.deviceTypeRaw ?? '',
    DEVICE_TYPE_LABEL[point.deviceType] ?? '',
    SPOKEN_AS[point.deviceType] ?? '',
  ];
  if (point.zoneNumber !== undefined) parts.push(`zone ${point.zoneNumber}`);
  return parts.join(' ').toLowerCase();
}

/** Every way a point's address is written, for a query that is an address. */
function addressForms(point: ConfigPoint): string {
  if (point.address === undefined) return '';
  const sub = point.subAddress !== undefined ? `.${point.subAddress}` : '';
  const forms = [`${point.address}${sub}`];
  if (point.loopNumber !== undefined) {
    forms.push(`${point.loopNumber}/${point.address}${sub}`, `l${point.loopNumber}`);
  }
  return forms.join(' ');
}

/**
 * Points matching a filter.
 *
 * Words are ANDed, so "level 3 smoke" narrows rather than widens. A search
 * that ORs its words returns the whole loop the moment somebody types a common
 * word, which is worse than no search because it looks like it worked.
 *
 * A query whose every word is an address — "34", "1/34" — searches the
 * addresses as well. One that is not stays on the text, so a building with
 * numbered levels does not have its search quietly polluted by the addressing.
 */
export function filterPoints(points: readonly ConfigPoint[], filter: PointFilter = {}): ConfigPoint[] {
  const words = (filter.text ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const byAddress = words.length > 0 && words.every((w) => ADDRESS_WORD.test(w));

  return points.filter((p) => {
    if (!filter.includeUnused && p.unused) return false;
    if (filter.loop !== undefined && p.loopNumber !== filter.loop) return false;
    if (filter.zone !== undefined && p.zoneNumber !== filter.zone) return false;
    if (filter.type !== undefined && p.deviceType !== filter.type) return false;
    if (!words.length) return true;
    const text = byAddress ? `${haystack(p)} ${addressForms(p)}` : haystack(p);
    return words.every((w) => matches(text, w));
  });
}

/**
 * Whether one search word is in a point's text.
 *
 * A word of digits has to sit on its own, and a word of letters does not. That
 * asymmetry is not tidiness: a point reference is `L1P003`, and a plain
 * substring test makes every search containing a "3" return it. On a building
 * with numbered levels — which is most of them — "level 3" comes back with the
 * level 1 plant detector in it, because that detector is at address 3. The
 * technician cannot see why, and after twice they stop trusting the box.
 *
 * Letters keep the substring test because half of what is typed is a partial
 * word: "lob" for lobby, "carp" for carpark, "smok" for smoke.
 */
function matches(text: string, word: string): boolean {
  if (!/^\d+$/.test(word)) return text.includes(word);
  return new RegExp(`\\b${word}\\b`).test(text);
}

/**
 * Points in the order a panel walks them: loop, then address, then channel.
 *
 * Sorted rather than left in file order because the file's order is the
 * vendor tool's, and three of the formats write their tables in an order that
 * has nothing to do with the loop — which makes a point list unreadable beside
 * a panel that is stepping through addresses in order.
 *
 * Points with no address at all sort last. They are the panel's own terminals
 * and network points, and they belong after the loops rather than before
 * address 1 of loop 1.
 */
export function inPanelOrder(points: readonly ConfigPoint[]): ConfigPoint[] {
  return [...points].sort((a, b) => {
    const loop = (a.loopNumber ?? Number.MAX_SAFE_INTEGER) - (b.loopNumber ?? Number.MAX_SAFE_INTEGER);
    if (loop) return loop;
    const address = (a.address ?? Number.MAX_SAFE_INTEGER) - (b.address ?? Number.MAX_SAFE_INTEGER);
    if (address) return address;
    const sub = (a.subAddress ?? -1) - (b.subAddress ?? -1);
    if (sub) return sub;
    return a.text.localeCompare(b.text);
  });
}

// ---------------------------------------------------------------------------
// What a loop holds
// ---------------------------------------------------------------------------

export interface LoopRow {
  number: number;
  label?: string;
  /** Devices on it, spares included. */
  devices: number;
  /** Of those, the ones marked spare or unfitted. */
  spare: number;
  lowestAddress?: number;
  highestAddress?: number;
  /**
   * Addresses between the lowest and the highest with nothing at them.
   *
   * A count, not a list, because on a loop half-filled at commissioning the
   * list is sixty numbers and says nothing the count does not. It is a note
   * rather than a fault: leaving room to extend is normal practice.
   */
  freeInRange: number;
  /** True where the loop is declared by the panel but carries nothing. */
  empty: boolean;
}

/**
 * Each loop with what is on it.
 *
 * Built from the declared loops and from the addressing together, because the
 * two disagree in real files and both halves matter: a loop the panel declares
 * and nothing addresses is an empty card, and a loop nothing declares but
 * devices sit on is a card the configuration has not accounted for. Dropping
 * either would hide one of those.
 */
export function loopRows(panel: Pick<ParsedPanel, 'loops' | 'points'>): LoopRow[] {
  const byLoop = new Map<number, ConfigPoint[]>();
  for (const p of panel.points) {
    if (p.loopNumber === undefined) continue;
    const list = byLoop.get(p.loopNumber);
    if (list) list.push(p);
    else byLoop.set(p.loopNumber, [p]);
  }

  const declared = new Map(panel.loops.map((l) => [l.number, l]));
  const numbers = [...new Set([...declared.keys(), ...byLoop.keys()])].sort((a, b) => a - b);

  return numbers.map((number) => {
    const points = byLoop.get(number) ?? [];
    const addresses = points
      .map((p) => p.address)
      .filter((a): a is number => a !== undefined);
    const unique = new Set(addresses);
    const lowest = addresses.length ? Math.min(...addresses) : undefined;
    const highest = addresses.length ? Math.max(...addresses) : undefined;

    return {
      number,
      label: declared.get(number)?.label,
      devices: points.length,
      spare: points.filter((p) => p.unused).length,
      lowestAddress: lowest,
      highestAddress: highest,
      freeInRange: lowest !== undefined && highest !== undefined
        ? Math.max(0, highest - lowest + 1 - unique.size)
        : 0,
      empty: points.length === 0,
    };
  });
}

// ---------------------------------------------------------------------------
// What a panel holds
// ---------------------------------------------------------------------------

export interface DeviceCount {
  type: DeviceType;
  label: string;
  count: number;
}

/** Device classes on a panel, most common first. */
export function deviceBreakdown(points: readonly ConfigPoint[], includeUnused = false): DeviceCount[] {
  const counts = new Map<DeviceType, number>();
  for (const p of points) {
    if (!includeUnused && p.unused) continue;
    counts.set(p.deviceType, (counts.get(p.deviceType) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, label: DEVICE_TYPE_LABEL[type] ?? 'Device', count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** The zone chart this panel's own configuration implies. */
export function zoneChartFor(panel: Pick<ParsedPanel, 'zones' | 'points'>, includeUnused = false): ZoneChart {
  /*
   * Cast because `buildZoneChart` takes the database's shapes and these are
   * the parser's — the difference is an id and a panelId, neither of which it
   * reads. Adding ids here would mean inventing them, and an invented id on
   * something that has not been imported is a handle to a row that does not
   * exist.
   */
  return buildZoneChart(
    panel.zones as Zone[],
    panel.points as Point[],
    includeUnused,
  );
}

/** The loops a panel's points actually sit on, in order. */
export function loopNumbers(points: readonly ConfigPoint[]): number[] {
  return [...new Set(points.map((p) => p.loopNumber).filter((n): n is number => n !== undefined))]
    .sort((a, b) => a - b);
}

/** The device classes present, for a filter row that offers only what is there. */
export function typesPresent(points: readonly ConfigPoint[]): DeviceType[] {
  return [...new Set(points.map((p) => p.deviceType))]
    .sort((a, b) => (DEVICE_TYPE_LABEL[a] ?? a).localeCompare(DEVICE_TYPE_LABEL[b] ?? b));
}

/** How a point's address reads on screen: "1/34.2", or its reference, or nothing. */
export function addressLabel(point: ConfigPoint): string {
  if (point.address === undefined) return point.pointRef ?? '';
  const sub = point.subAddress !== undefined ? `.${point.subAddress}` : '';
  return point.loopNumber === undefined
    ? `${point.address}${sub}`
    : `${point.loopNumber}/${point.address}${sub}`;
}
