import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { isNle, parseNle } from '@/parsers/kentecNle';

/**
 * The Kentec / Incite .nle parser.
 *
 * The fixture below is a real SQLite database built to the same schema as a
 * Loop Explorer site file, so these run on CI where no customer configuration
 * exists. It is deliberately small but not simple: two loops, a multi-channel
 * module, placeholder zones alongside real ones, and a cause-and-effect rule
 * that points at a module channel — which is the combination that produced the
 * one bug worth having a regression test for.
 */

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'nle-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

let counter = 0;

interface Fixture {
  /** Zones beyond the placeholders. */
  zones?: [number, string][];
  placeholderZones?: number;
  devices?: { key: number; type: number; loop: number; address: number; fitted?: number }[];
  subs?: { key: number; device: number; sub: number; zone: number; text: string; subType?: number }[];
  localIo?: { number: number; zone: number; text: string; output: number }[];
  causes?: { key: number; addressType: number; zone?: number; loop?: number; address?: number; sub?: number }[];
  effects?: { key: number; addressType: number; zone?: number; loop?: number; address?: number; sub?: number }[];
  rules?: [number, string][];
  loops?: number;
}

function buildNle(f: Fixture = {}): Uint8Array {
  const path = join(dir, `site-${counter++}.nle`);
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE Network (NetworkKey INTEGER PRIMARY KEY AUTOINCREMENT, SiteName TEXT NOT NULL DEFAULT "",
      LE2DataVersion TEXT NOT NULL DEFAULT "1.0");
    CREATE TABLE Node (NodeKey INTEGER PRIMARY KEY AUTOINCREMENT, NetworkKey INTEGER NOT NULL DEFAULT 0,
      NodeAddress INTEGER NOT NULL DEFAULT 0, NodeName TEXT NOT NULL DEFAULT "",
      NumberOfLoops INTEGER NOT NULL DEFAULT 0, LoopProtocol TEXT NOT NULL DEFAULT "");
    CREATE TABLE NodeLoops (NodeLoopsKey INTEGER PRIMARY KEY AUTOINCREMENT, NodeKey INTEGER, StartingLoop INTEGER);
    CREATE TABLE Zones (ZoneKey INTEGER PRIMARY KEY AUTOINCREMENT, ZoneNumber INTEGER NOT NULL DEFAULT 0,
      ZoneName TEXT NOT NULL DEFAULT "", NetworkKey INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE Devices (DeviceKey INTEGER PRIMARY KEY AUTOINCREMENT, NodeKey INTEGER NOT NULL DEFAULT 0,
      DeviceTypeKey INTEGER NOT NULL DEFAULT 0, Address INTEGER NOT NULL DEFAULT 0,
      AttachedToLoopNumber INTEGER, IsFitted BOOLEAN NOT NULL DEFAULT 1);
    CREATE TABLE SubDevices (SubDeviceKey INTEGER PRIMARY KEY AUTOINCREMENT, DeviceKey INTEGER NOT NULL DEFAULT 0,
      Zone INTEGER NOT NULL DEFAULT 0, SubDeviceNumber INTEGER NOT NULL DEFAULT 0,
      LocationText TEXT NOT NULL DEFAULT "", SubType INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE LocalIO (LocalIOKey INTEGER PRIMARY KEY AUTOINCREMENT, NodeKey INTEGER NOT NULL DEFAULT 0,
      LocalIONumber INTEGER NOT NULL DEFAULT 0, Zone INTEGER NOT NULL DEFAULT 0,
      TextMsg TEXT NOT NULL DEFAULT "", Output BOOLEAN NOT NULL DEFAULT 0);
    CREATE TABLE IOModule (IOModuleKey INTEGER PRIMARY KEY AUTOINCREMENT, NodeKey INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IOChannels (IOChannelKey INTEGER PRIMARY KEY AUTOINCREMENT, IOModuleKey INTEGER NOT NULL DEFAULT 0,
      Zone INTEGER NOT NULL DEFAULT 0, IOChannelName TEXT NOT NULL DEFAULT "",
      IOChannelNumber INTEGER NOT NULL DEFAULT 0, Output BOOLEAN NOT NULL DEFAULT 0);
    CREATE TABLE ActionCE (ActionCEKey INTEGER PRIMARY KEY AUTOINCREMENT, Name TEXT NOT NULL DEFAULT "",
      OperatorKey INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE ActionCECauseDetail (ActionCECauseDetailKey INTEGER PRIMARY KEY AUTOINCREMENT,
      ActionCEKey INTEGER, AddressType INTEGER, ZoneNumber INTEGER, LoopNumber INTEGER,
      DeviceAddress INTEGER, SubDeviceNumber INTEGER, LocalIONumber INTEGER, IOModuleNumber INTEGER,
      IOChannelNumber INTEGER);
    CREATE TABLE ActionCEEffectDetail (ActionCEEffectDetailKey INTEGER PRIMARY KEY AUTOINCREMENT,
      ActionCEKey INTEGER, AddressType INTEGER, ZoneNumber INTEGER, LoopNumber INTEGER,
      DeviceAddress INTEGER, SubDeviceNumber INTEGER, LocalIONumber INTEGER, IOModuleNumber INTEGER,
      IOChannelNumber INTEGER);
  `);
  db.exec(`INSERT INTO Network (SiteName) VALUES ('Sandgate Hall')`);
  db.exec(`INSERT INTO Node (NetworkKey, NodeAddress, NodeName, NumberOfLoops, LoopProtocol)
           VALUES (1, 1, 'Town Hall Panel', ${f.loops ?? 2}, 'Hochiki')`);
  db.exec('INSERT INTO NodeLoops (NodeKey, StartingLoop) VALUES (1, 1)');
  db.exec('INSERT INTO IOModule (NodeKey) VALUES (1)');

  // Loop Explorer pre-creates thousands of zones named after their own number.
  for (let i = 0; i <= (f.placeholderZones ?? 400); i++) {
    db.exec(`INSERT INTO Zones (ZoneNumber, ZoneName, NetworkKey) VALUES (${i}, 'Zone ${i}', 1)`);
  }
  for (const [number, name] of f.zones ?? []) {
    db.exec(`UPDATE Zones SET ZoneName = '${name.replace(/'/g, "''")}' WHERE ZoneNumber = ${number}`);
  }
  for (const d of f.devices ?? []) {
    db.exec(`INSERT INTO Devices (DeviceKey, NodeKey, DeviceTypeKey, Address, AttachedToLoopNumber, IsFitted)
             VALUES (${d.key}, 1, ${d.type}, ${d.address}, ${d.loop}, ${d.fitted ?? 1})`);
  }
  for (const s of f.subs ?? []) {
    db.exec(`INSERT INTO SubDevices (SubDeviceKey, DeviceKey, Zone, SubDeviceNumber, LocationText, SubType)
             VALUES (${s.key}, ${s.device}, ${s.zone}, ${s.sub}, '${s.text.replace(/'/g, "''")}', ${s.subType ?? 3})`);
  }
  for (const io of f.localIo ?? []) {
    db.exec(`INSERT INTO LocalIO (NodeKey, LocalIONumber, Zone, TextMsg, Output)
             VALUES (1, ${io.number}, ${io.zone}, '${io.text.replace(/'/g, "''")}', ${io.output})`);
  }
  for (const [key, name] of f.rules ?? []) {
    db.exec(`INSERT INTO ActionCE (ActionCEKey, Name) VALUES (${key}, '${name.replace(/'/g, "''")}')`);
  }
  const detail = (t: string, rows: NonNullable<Fixture['causes']>) => {
    for (const r of rows) {
      db.exec(`INSERT INTO ${t} (ActionCEKey, AddressType, ZoneNumber, LoopNumber, DeviceAddress, SubDeviceNumber,
               LocalIONumber, IOModuleNumber, IOChannelNumber)
               VALUES (${r.key}, ${r.addressType}, ${r.zone ?? 0}, ${r.loop ?? 0}, ${r.address ?? 0},
                       ${r.sub ?? 0}, 0, 0, 0)`);
    }
  };
  detail('ActionCECauseDetail', f.causes ?? []);
  detail('ActionCEEffectDetail', f.effects ?? []);
  db.close();
  return new Uint8Array(readFileSync(path));
}

/** A small but representative site. */
const SITE: Fixture = {
  zones: [[9, 'PROP STORAGE'], [15, 'STAGE RISK 1'], [16, 'STAGE RISK 2']],
  devices: [
    { key: 1, type: 213, loop: 1, address: 1 },
    { key: 2, type: 213, loop: 1, address: 2 },
    { key: 3, type: 27, loop: 2, address: 101 },
    { key: 4, type: 39, loop: 2, address: 103 },
    { key: 5, type: 213, loop: 1, address: 9, fitted: 0 },
  ],
  subs: [
    { key: 1, device: 1, sub: 0, zone: 9, text: 'UNDER FLOOR' },
    { key: 2, device: 2, sub: 0, zone: 9, text: 'STORE 2' },
    // A four-channel module: this is what makes point references awkward.
    { key: 3, device: 3, sub: 0, zone: 0, text: 'ROLLER SHUTTER', subType: 11 },
    { key: 4, device: 3, sub: 1, zone: 0, text: '', subType: 7 },
    { key: 5, device: 3, sub: 2, zone: 0, text: '', subType: 7 },
    { key: 6, device: 3, sub: 3, zone: 0, text: '', subType: 6 },
    { key: 7, device: 4, sub: 0, zone: 0, text: 'STAGE BEACON', subType: 8 },
    { key: 8, device: 5, sub: 0, zone: 15, text: 'SPARE', subType: 3 },
  ],
  localIo: [
    { number: 4, zone: 15, text: 'MCP ON FIP DOOR', output: 0 },
    { number: 7, zone: 0, text: '', output: 1 },
  ],
  rules: [[1, 'STAGE ALARM BEACON'], [3, 'Roller Shutter Release']],
  causes: [
    { key: 1, addressType: 4, zone: 15 }, { key: 1, addressType: 4, zone: 16 },
    { key: 3, addressType: 4, zone: 15 },
  ],
  effects: [
    { key: 1, addressType: 0, loop: 2, address: 103, sub: 0 },
    // Channels 1 and 2 of the four-channel module, and channel 0 of it too:
    // channel 0 is the case that used to be written two different ways.
    { key: 3, addressType: 0, loop: 2, address: 101, sub: 0 },
    { key: 3, addressType: 0, loop: 2, address: 101, sub: 1 },
  ],
};

describe('recognising the format', () => {
  it('accepts a Loop Explorer database', () => {
    expect(isNle(buildNle(SITE))).toBe(true);
  });

  it('rejects a SQLite database that is not one', () => {
    const path = join(dir, 'other.sqlite');
    const db = new DatabaseSync(path);
    db.exec('CREATE TABLE Zones (a INTEGER); CREATE TABLE Widgets (b INTEGER)');
    db.close();
    // Shares a table name with the real schema, which is exactly why matching
    // on one table would be too loose.
    expect(isNle(new Uint8Array(readFileSync(path)))).toBe(false);
  });

  it('rejects something that is not SQLite at all', () => {
    expect(isNle(new TextEncoder().encode('LEVEL 1 EAST\nLEVEL 1 WEST'))).toBe(false);
  });
});

describe('reading a site', () => {
  const parsed = () => parseNle(buildNle(SITE), 'site.nle');

  it('reads the site and panel identity', () => {
    const c = parsed();
    expect(c.brand).toBe('kentec');
    expect(c.siteName).toBe('Sandgate Hall');
    expect(c.panels).toHaveLength(1);
    expect(c.panels[0]!.name).toBe('Town Hall Panel');
    expect(c.panels[0]!.nodeNumber).toBe(1);
  });

  it('reads the loop protocol the node names', () => {
    expect(parsed().panels[0]!.loops.map((l) => l.protocol)).toEqual(['hochiki-esp', 'hochiki-esp']);
  });

  it('keeps the zones in use and drops the four hundred placeholders', () => {
    // Loop Explorer creates a zone row for every addressable zone and names it
    // after its own number. Importing all of them buries the real ones.
    const zones = parsed().panels[0]!.zones;
    expect(zones.map((z) => z.number)).toEqual([9, 15, 16]);
    expect(zones.find((z) => z.number === 9)!.text).toBe('PROP STORAGE');
  });

  it('marks a zone nothing addresses as unused rather than dropping it', () => {
    // Zone 16 is named and appears in a cause, but has no devices.
    const zone = parsed().panels[0]!.zones.find((z) => z.number === 16)!;
    expect(zone.unused).toBe(true);
    expect(parsed().panels[0]!.zones.find((z) => z.number === 9)!.unused).toBe(false);
  });

  it('builds the point list from sub-devices, where the zone and text live', () => {
    const points = parsed().panels[0]!.points;
    const first = points.find((p) => p.pointRef === 'L1D1')!;
    expect(first.text).toBe('UNDER FLOOR');
    expect(first.zoneNumber).toBe(9);
    expect(first.zoneText).toBe('PROP STORAGE');
  });

  it('says it does not know the device type rather than inventing one', () => {
    // The type is a key into a library that does not travel with the file.
    const c = parsed();
    const point = c.panels[0]!.points.find((p) => p.pointRef === 'L1D1')!;
    expect(point.deviceType).toBe('unknown');
    expect(point.deviceTypeRaw).toMatch(/213/);
    expect(c.warnings.join(' ')).toMatch(/device types are not named/i);
  });

  it('marks an unfitted device as unused', () => {
    expect(parsed().panels[0]!.points.find((p) => p.pointRef === 'L1D9')!.unused).toBe(true);
  });

  it('imports panel terminals that are programmed and skips the blank ones', () => {
    const refs = parsed().panels[0]!.points.map((p) => p.pointRef);
    expect(refs).toContain('PANEL-IO-4');
    expect(refs).not.toContain('PANEL-IO-7');
  });
});

describe('addressing a multi-channel module', () => {
  it('gives channels a sub-address and single-channel devices none', () => {
    const points = parseNle(buildNle(SITE)).panels[0]!.points;
    expect(points.find((p) => p.pointRef === 'L2D101.0')!.subAddress).toBe(0);
    expect(points.find((p) => p.pointRef === 'L2D101.3')!.subAddress).toBe(3);
    // A single-channel detector must not gain a ".0", or every reference to it
    // disagrees with what the panel display shows.
    expect(points.find((p) => p.pointRef === 'L1D1')!.subAddress).toBeUndefined();
    expect(points.some((p) => p.pointRef === 'L1D1.0')).toBe(false);
  });

  it('writes cause-and-effect targets the same way the point list does', () => {
    // The regression this exists for: effect targets were written with a sub
    // number only when it was non-zero, while the point list used one whenever
    // the device had several channels. So a rule aimed at channel 0 of a module
    // named a point that did not exist — and nothing in the data said so.
    const panel = parseNle(buildNle(SITE)).panels[0]!;
    const refs = new Set(panel.points.map((p) => p.pointRef));
    const targets = panel.causeEffect.flatMap((r) => r.effects.map((e) => e.effectLabel.split(' → ')[1]!));

    expect(targets).toContain('L2D101.0');
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) expect([target, refs.has(target)]).toEqual([target, true]);
  });
});

describe('cause and effect', () => {
  const rules = () => parseNle(buildNle(SITE)).panels[0]!.causeEffect;

  it('keeps a multi-cause rule as one rule', () => {
    const rule = rules().find((r) => r.causeLabel === 'STAGE ALARM BEACON')!;
    expect(rule.causeZoneNumber).toBe(15);
    // Both zones are in the logic even though only the first is the typed field.
    expect(rule.sourceLogic).toMatch(/Zone 15/);
    expect(rule.sourceLogic).toMatch(/Zone 16/);
  });

  it('classifies a zone cause as a zone alarm', () => {
    expect(rules().every((r) => r.causeKind === 'zone-alarm')).toBe(true);
  });

  it('reads the effect class from the rule name where it is unambiguous', () => {
    expect(rules().find((r) => r.causeLabel === 'STAGE ALARM BEACON')!.effects[0]!.effectKind).toBe('strobes');
    expect(rules().find((r) => r.causeLabel === 'Roller Shutter Release')!.effects[0]!.effectKind)
      .toBe('door-release');
  });

  it('attaches network-level rules to one panel only', () => {
    // The tables belong to the network, not a node; duplicating them across
    // panels would multiply one commissioned rule into several.
    const c = parseNle(buildNle(SITE));
    expect(c.panels.filter((p) => p.causeEffect.length > 0)).toHaveLength(1);
  });

  it('says so when a rule has no detail rows rather than inventing effects', () => {
    const c = parseNle(buildNle({ ...SITE, causes: [], effects: [] }));
    expect(c.warnings.join(' ')).toMatch(/no cause or effect detail/i);
    expect(c.panels[0]!.causeEffect.every((r) => r.effects.length === 0)).toBe(true);
  });
});

describe('refusing what it cannot read', () => {
  it('rejects a database with no Node row', () => {
    const path = join(dir, 'empty.nle');
    const db = new DatabaseSync(path);
    db.exec('CREATE TABLE Node (NodeKey INTEGER PRIMARY KEY); CREATE TABLE Zones (a INTEGER);' +
            'CREATE TABLE SubDevices (b INTEGER)');
    db.close();
    expect(() => parseNle(new Uint8Array(readFileSync(path)))).toThrow(/No Node row/i);
  });

  it('reports a device pointing at a zone that has no row', () => {
    const c = parseNle(buildNle({
      placeholderZones: 5,
      zones: [[3, 'PLANT ROOM']],
      devices: [{ key: 1, type: 213, loop: 1, address: 1 }, { key: 2, type: 213, loop: 1, address: 2 }],
      subs: [
        { key: 1, device: 1, sub: 0, zone: 3, text: 'FINE' },
        { key: 2, device: 2, sub: 0, zone: 88, text: 'ORPHAN' },
      ],
    }));
    expect(c.warnings.join(' ')).toMatch(/Zones 88 are addressed by devices but have no row/i);
    // The zone with a row is still imported normally.
    expect(c.panels[0]!.zones.map((z) => z.number)).toEqual([3]);
    // And the orphan's point keeps its zone number, just with no text for it.
    const orphan = c.panels[0]!.points.find((p) => p.text === 'ORPHAN')!;
    expect(orphan.zoneNumber).toBe(88);
    expect(orphan.zoneText).toBeUndefined();
  });
});

/** Against the real Sandgate Hall file when present; never committed. */
const REAL = '/tmp/panels/taktis.nle';
const describeReal = existsSync(REAL) ? describe : describe.skip;

describeReal('against the real Sandgate Hall configuration', () => {
  it('reads it whole, with every cross-reference resolving', () => {
    const c = parseNle(new Uint8Array(readFileSync(REAL)), 'taktis.nle');
    expect(c.siteName).toBe('Sandgate Hall Original');
    const panel = c.panels[0]!;
    expect(panel.loops).toHaveLength(2);
    // Seventeen real zones out of 2001 rows in the table.
    expect(panel.zones).toHaveLength(17);
    expect(panel.points.length).toBeGreaterThan(100);
    expect(panel.causeEffect).toHaveLength(2);

    const refs = new Set(panel.points.map((p) => p.pointRef));
    for (const rule of panel.causeEffect) {
      for (const effect of rule.effects) {
        const target = effect.effectLabel.split(' → ')[1]!;
        if (/^L\d+D/.test(target)) expect([target, refs.has(target)]).toEqual([target, true]);
      }
    }
  });
});
