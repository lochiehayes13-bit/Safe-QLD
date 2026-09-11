import type {
  AddressProtocol, CauseEffectRule, Loop, ParsedConfig, ParsedPanel, Point, Zone,
} from '@/domain/types';
import { effectKindFromLabel } from './effectKind';
import { SqliteError, type SqlRow, type SqliteFile, isSqlite, readSqlite } from './sqliteRead';

/**
 * Kentec / Incite site files (.nle), as written by Loop Explorer 2.
 *
 * The file is a SQLite database with an unusually candid schema — Network,
 * Node, Zones, Devices, SubDevices, and a family of cause-and-effect tables —
 * so this is mapping rather than reverse engineering.
 *
 * One thing it cannot do, and says so rather than papering over: name the
 * device types. `Devices.DeviceTypeKey` is a foreign key into Loop Explorer's
 * own device library, and that library does not travel with the site file.
 * The key is preserved verbatim so it can be resolved later, but inventing a
 * type for it would put "smoke detector" on a service sheet on no evidence.
 *
 * The addressing is two-level: a Device holds the loop address, and its
 * SubDevices hold the channels. A single-channel detector has exactly one
 * SubDevice, and that is where its zone and location text live — so the point
 * list is built from SubDevices, not Devices.
 */

const PARSER_ID = 'kentec-nle@1';

/** Loop Explorer names the protocol in plain text on the Node row. */
const PROTOCOLS: { match: RegExp; protocol: AddressProtocol }[] = [
  { match: /HOCHIKI/i, protocol: 'hochiki-esp' },
  { match: /APOLLO.*DISCOVERY/i, protocol: 'apollo-discovery' },
  { match: /APOLLO.*(XP95|CORE)/i, protocol: 'apollo-xp95' },
  { match: /APOLLO/i, protocol: 'apollo-xp95' },
  { match: /SYSTEM\s*SENSOR/i, protocol: 'system-sensor' },
];

function protocolFor(raw: unknown): AddressProtocol | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  return PROTOCOLS.find((p) => p.match.test(raw))?.protocol;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'bigint') return Number(v);
  return undefined;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * True when a zone name is Loop Explorer's own filler rather than a real one.
 *
 * The tool pre-creates every addressable zone — 2001 rows in a two-loop hall —
 * and names them "Zone 1", "Zone 2" and so on. Importing all of them would
 * bury the fourteen zones that exist in the building.
 */
function isPlaceholderZoneName(name: string, number: number): boolean {
  return new RegExp(`^ZONE\\s*0*${number}$`, 'i').test(name.trim());
}

export function isNle(bytes: Uint8Array): boolean {
  if (!isSqlite(bytes)) return false;
  try {
    const names = readSqlite(bytes).tables().map((t) => t.name.toLowerCase());
    // Node and SubDevices together are specific to this schema; either alone
    // is a plausible table name in someone else's database.
    return names.includes('node') && names.includes('subdevices') && names.includes('zones');
  } catch {
    return false;
  }
}

/** Rows of a table, or an empty list when the table is absent. */
function rowsOf(db: SqliteFile, name: string): SqlRow[] {
  const t = db.table(name);
  return t ? db.rows(t) : [];
}

/**
 * The cause-and-effect families, each stored as a header table plus a cause
 * detail and an effect detail table sharing its name.
 *
 * Read generically because which families are populated is a property of the
 * site, not the format: this hall uses only ActionCE, but a building with
 * suppression will have ReleaseCE and one with AAF will have AAFCE, and none
 * of those should need a code change to import.
 */
const CE_FAMILIES = ['Action', 'AAF', 'Disabled', 'Release', 'Test', 'Voice', 'Sensitivity'];

/** AddressType 4 addresses a zone; 0 addresses a device on a loop. */
const ADDRESS_TYPE_ZONE = 4;

/**
 * How a loop address is written, given how many channels its device has.
 *
 * This has to agree exactly with the point list. A cause-and-effect rule that
 * names "L2D101" while the point it means is called "L2D101.0" is a reference
 * that resolves to nothing, and nothing in the data says so — the matrix simply
 * shows an output that appears to exist nowhere on the panel.
 */
type PointRefFn = (loop: number, address: number, sub: number) => string;

function makePointRef(multiChannel: ReadonlySet<string>): PointRefFn {
  return (loop, address, sub) =>
    multiChannel.has(`${loop}/${address}`) ? `L${loop}D${address}.${sub}` : `L${loop}D${address}`;
}

function pointRefFor(row: SqlRow, refFor: PointRefFn): string | undefined {
  const loop = num(row.LoopNumber);
  const address = num(row.DeviceAddress);
  if (loop === undefined || address === undefined || address === 0) return undefined;
  return refFor(loop, address, num(row.SubDeviceNumber) ?? 0);
}

function describeTarget(row: SqlRow, refFor: PointRefFn): string {
  const zone = num(row.ZoneNumber);
  if (num(row.AddressType) === ADDRESS_TYPE_ZONE && zone !== undefined) return `Zone ${zone}`;
  const ref = pointRefFor(row, refFor);
  if (ref) return ref;
  const local = num(row.LocalIONumber);
  if (local) return `Panel I/O ${local}`;
  const io = num(row.IOModuleNumber);
  const channel = num(row.IOChannelNumber);
  if (io && channel) return `I/O module ${io} channel ${channel}`;
  return 'unresolved target';
}

function parseCauseEffect(
  db: SqliteFile,
  refFor: PointRefFn,
  warnings: string[],
): Omit<CauseEffectRule, 'id' | 'panelId'>[] {
  const rules: Omit<CauseEffectRule, 'id' | 'panelId'>[] = [];

  for (const family of CE_FAMILIES) {
    const headers = rowsOf(db, `${family}CE`);
    if (!headers.length) continue;

    const causes = rowsOf(db, `${family}CECauseDetail`);
    const effects = rowsOf(db, `${family}CEEffectDetail`);
    const keyColumn = `${family}CEKey`;

    if (!causes.length && !effects.length) {
      warnings.push(
        `${headers.length} ${family} cause-and-effect ${headers.length === 1 ? 'rule' : 'rules'} ` +
        `have no cause or effect detail rows in this file; their names were imported but not their logic.`,
      );
    }

    for (const header of headers) {
      const key = num(header[keyColumn]);
      if (key === undefined) continue;

      const label = str(header.Name) || `${family} rule ${key}`;
      const myCauses = causes.filter((c) => num(c[keyColumn]) === key);
      const myEffects = effects.filter((e) => num(e[keyColumn]) === key);

      // A rule with several causes is one rule in the panel, so it stays one
      // rule here; the individual causes are rendered into sourceLogic rather
      // than split into rules that never existed.
      const first = myCauses[0];
      const causeZone = first && num(first.AddressType) === ADDRESS_TYPE_ZONE ? num(first.ZoneNumber) : undefined;

      rules.push({
        causeLabel: label,
        causeKind: causeZone !== undefined ? 'zone-alarm' : myCauses.length ? 'point-alarm' : 'other',
        causeZoneNumber: causeZone,
        causePointRef: first && causeZone === undefined ? pointRefFor(first, refFor) : undefined,
        effects: myEffects.map((e, i) => ({
          id: `${family}-${key}-${i}`,
          effectLabel: `${label} → ${describeTarget(e, refFor)}`,
          effectKind: effectKindFromLabel(label) ?? 'other',
          state: 'operates' as const,
        })),
        sourceLogic:
          `${family}CE ${key}: ` +
          `causes [${myCauses.map((c) => describeTarget(c, refFor)).join(', ') || 'none recorded'}] ` +
          `-> effects [${myEffects.map((e) => describeTarget(e, refFor)).join(', ') || 'none recorded'}]`,
      });
    }
  }

  return rules;
}

export function parseNle(bytes: Uint8Array, fileName = ''): ParsedConfig {
  let db: SqliteFile;
  try {
    db = readSqlite(bytes);
  } catch (e) {
    throw new SqliteError(
      `${fileName || 'This file'} could not be read as a Loop Explorer database: ` +
      `${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const warnings: string[] = [];
  const network = rowsOf(db, 'Network')[0];
  const siteName = str(network?.SiteName) || undefined;

  const nodes = rowsOf(db, 'Node');
  if (!nodes.length) throw new SqliteError('No Node row — this is a SQLite file but not a Loop Explorer site.');

  const zoneRows = rowsOf(db, 'Zones');
  const deviceRows = rowsOf(db, 'Devices');
  const subRows = rowsOf(db, 'SubDevices');
  const localIoRows = rowsOf(db, 'LocalIO');
  const ioModuleRows = rowsOf(db, 'IOModule');
  const ioChannelRows = rowsOf(db, 'IOChannels');
  const nodeLoopRows = rowsOf(db, 'NodeLoops');

  // Which loop addresses carry more than one channel, so a reference to one
  // is written the same way in the point list and in the matrix.
  const channelCount = new Map<string, number>();
  const deviceLocation = new Map<number, string>();
  for (const d of deviceRows) {
    const key = num(d.DeviceKey);
    const loop = num(d.AttachedToLoopNumber);
    const address = num(d.Address);
    if (key !== undefined && loop !== undefined && address !== undefined) {
      deviceLocation.set(key, `${loop}/${address}`);
    }
  }
  for (const s of subRows) {
    const at = deviceLocation.get(num(s.DeviceKey) ?? -1);
    if (at) channelCount.set(at, (channelCount.get(at) ?? 0) + 1);
  }
  const multiChannel = new Set([...channelCount].filter(([, n]) => n > 1).map(([at]) => at));
  const refFor = makePointRef(multiChannel);

  // Cause and effect is stored against the network, not a node, so it is read
  // once and attached to the first panel rather than duplicated across them.
  const causeEffect = parseCauseEffect(db, refFor, warnings);

  const typeKeys = new Set(deviceRows.map((d) => num(d.DeviceTypeKey)).filter((k) => k !== undefined));
  if (typeKeys.size) {
    warnings.push(
      `Device types are not named in this file. Loop Explorer stores them as library keys ` +
      `(${[...typeKeys].sort((a, b) => a - b).join(', ')}) and the library is not part of the site file, ` +
      `so every point is imported with an unknown type and the key kept for reference.`,
    );
  }

  const panels: ParsedPanel[] = nodes.map((node, nodeIndex) => {
    const nodeKey = num(node.NodeKey);
    const nodeAddress = num(node.NodeAddress);
    const protocol = protocolFor(node.LoopProtocol);

    const myDevices = deviceRows.filter((d) => num(d.NodeKey) === nodeKey);
    const deviceByKey = new Map(myDevices.map((d) => [num(d.DeviceKey), d]));

    // ---- Loops -----------------------------------------------------------
    const declaredLoops = num(node.NumberOfLoops) ?? 0;
    const loopStart = num(nodeLoopRows.find((l) => num(l.NodeKey) === nodeKey)?.StartingLoop) ?? 1;
    const loopNumbers = new Set<number>();
    for (let i = 0; i < declaredLoops; i++) loopNumbers.add(loopStart + i);
    // A device on a loop the node does not admit to having is still a device;
    // trust the addressing over the count.
    for (const d of myDevices) {
      const l = num(d.AttachedToLoopNumber);
      if (l !== undefined && l > 0) loopNumbers.add(l);
    }
    const loops: Omit<Loop, 'id' | 'panelId'>[] = [...loopNumbers]
      .sort((a, b) => a - b)
      .map((number) => ({ number, label: `Loop ${number}`, protocol }));

    // ---- Points ----------------------------------------------------------
    const points: Omit<Point, 'id' | 'panelId'>[] = [];
    const subsByDevice = new Map<number, SqlRow[]>();
    for (const s of subRows) {
      const key = num(s.DeviceKey);
      if (key === undefined || !deviceByKey.has(key)) continue;
      const list = subsByDevice.get(key);
      if (list) list.push(s);
      else subsByDevice.set(key, [s]);
    }

    for (const device of myDevices) {
      const deviceKey = num(device.DeviceKey);
      const address = num(device.Address);
      const loopNumber = num(device.AttachedToLoopNumber);
      const typeKey = num(device.DeviceTypeKey);
      const fitted = num(device.IsFitted) !== 0;
      const subs = (deviceKey !== undefined ? subsByDevice.get(deviceKey) : undefined) ?? [];
      const isMultiChannel = loopNumber !== undefined && address !== undefined
        && multiChannel.has(`${loopNumber}/${address}`);

      if (!subs.length) {
        // A Device with no SubDevice has no zone and no text — it is an address
        // the tool reserved. Recorded so the address is not silently missing.
        points.push({
          loopNumber, address,
          pointRef: loopNumber && address ? `L${loopNumber}D${address}` : undefined,
          text: '',
          deviceTypeRaw: typeKey !== undefined ? `Loop Explorer device type ${typeKey}` : undefined,
          deviceType: 'unknown',
          unused: true,
        });
        continue;
      }

      for (const sub of subs) {
        const subNumber = num(sub.SubDeviceNumber) ?? 0;
        const zoneNumber = num(sub.Zone);
        points.push({
          loopNumber,
          address,
          // Only a genuinely multi-channel device gets a sub-address; putting
          // ".0" on every single-channel detector would make every point
          // reference disagree with what the panel display shows.
          subAddress: isMultiChannel ? subNumber : undefined,
          pointRef: loopNumber && address ? refFor(loopNumber, address, subNumber) : undefined,
          text: str(sub.LocationText),
          deviceTypeRaw:
            typeKey !== undefined
              ? `Loop Explorer device type ${typeKey}${num(sub.SubType) !== undefined ? `, subtype ${num(sub.SubType)}` : ''}`
              : undefined,
          deviceType: 'unknown',
          zoneNumber: zoneNumber && zoneNumber > 0 ? zoneNumber : undefined,
          unused: !fitted,
        });
      }
    }

    // Panel-mounted inputs and outputs. Only the programmed ones: Loop
    // Explorer pre-creates every terminal, and an import full of blank
    // "Panel I/O 17" rows is noise on a test sheet.
    for (const io of localIoRows) {
      if (num(io.NodeKey) !== nodeKey) continue;
      const text = str(io.TextMsg);
      if (!text) continue;
      const number = num(io.LocalIONumber);
      const zoneNumber = num(io.Zone);
      points.push({
        pointRef: number !== undefined ? `PANEL-IO-${number}` : undefined,
        text,
        deviceTypeRaw: num(io.Output) ? 'Panel output' : 'Panel input',
        deviceType: 'unknown',
        zoneNumber: zoneNumber && zoneNumber > 0 ? zoneNumber : undefined,
        unused: false,
      });
    }

    const myIoModules = new Set(
      ioModuleRows.filter((m) => num(m.NodeKey) === nodeKey).map((m) => num(m.IOModuleKey)),
    );
    for (const channel of ioChannelRows) {
      if (!myIoModules.has(num(channel.IOModuleKey))) continue;
      const text = str(channel.IOChannelName);
      if (!text) continue;
      const number = num(channel.IOChannelNumber);
      const zoneNumber = num(channel.Zone);
      points.push({
        pointRef: number !== undefined ? `IO-CH-${number}` : undefined,
        text,
        deviceTypeRaw: num(channel.Output) ? 'I/O module output' : 'I/O module input',
        deviceType: 'unknown',
        zoneNumber: zoneNumber && zoneNumber > 0 ? zoneNumber : undefined,
        unused: false,
      });
    }

    // ---- Zones -----------------------------------------------------------
    const usedZones = new Set(
      points.map((p) => p.zoneNumber).filter((z): z is number => z !== undefined),
    );
    for (const rule of causeEffect) {
      if (rule.causeZoneNumber !== undefined) usedZones.add(rule.causeZoneNumber);
    }

    const zones: Omit<Zone, 'id' | 'panelId'>[] = [];
    const seenZoneNumbers = new Set<number>();
    for (const row of zoneRows) {
      const number = num(row.ZoneNumber);
      if (number === undefined || number <= 0) continue;
      const text = str(row.ZoneName);
      const named = text.length > 0 && !isPlaceholderZoneName(text, number);
      // Keep a zone if it was named, or if something addresses it. Everything
      // else is a slot the tool created and nobody used.
      if (!named && !usedZones.has(number)) continue;
      if (seenZoneNumbers.has(number)) continue;
      seenZoneNumbers.add(number);
      zones.push({ number, text, unused: !usedZones.has(number) });
    }
    zones.sort((a, b) => a.number - b.number);

    // A device pointing at a zone with no row at all is worth saying out loud:
    // its zone text will be blank everywhere downstream.
    const missing = [...usedZones].filter((z) => !seenZoneNumbers.has(z)).sort((a, b) => a - b);
    if (missing.length) {
      warnings.push(`Zones ${missing.join(', ')} are addressed by devices but have no row in the zone table.`);
    }

    // Denormalise the zone text onto every point: it is the single most useful
    // column on a point list and the join is not available downstream.
    const zoneText = new Map(zones.map((z) => [z.number, z.text]));
    for (const p of points) {
      if (p.zoneNumber !== undefined) p.zoneText = zoneText.get(p.zoneNumber) ?? undefined;
    }

    return {
      name: str(node.NodeName) || (nodeAddress !== undefined ? `Node ${nodeAddress}` : 'Panel'),
      brand: 'kentec' as const,
      nodeNumber: nodeAddress,
      zones,
      points,
      loops,
      // Cause and effect belongs to the network; attaching it to every node
      // would multiply one rule into several identical ones.
      causeEffect: nodeIndex === 0 ? causeEffect : [],
    };
  });

  return { brand: 'kentec', siteName, panels, warnings, parser: PARSER_ID };
}
