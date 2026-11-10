import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PANEL_CATALOGUE, classifyBytes, classifyFile } from '@/parsers';
import { createZip, utf8Bytes } from '@/export/zip';

/**
 * The catalogue and how a picked file is routed.
 *
 * The routing is where a mistake is most expensive, because it is upstream of
 * every parser: a binary site file decoded to text before anyone looks at it
 * is corrupted before the parser that could have read it is even chosen.
 */

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'registry-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

describe('the catalogue itself', () => {
  it('has a unique id per entry', () => {
    const ids = PANEL_CATALOGUE.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('backs every claim of reading a file with a parser', () => {
    // A 'native' entry with no parse function tells a technician the app reads
    // their panel and then does not.
    for (const p of PANEL_CATALOGUE.filter((e) => e.status === 'native' || e.status === 'partial')) {
      expect([p.id, Boolean(p.parse || p.parseBytes)]).toEqual([p.id, true]);
      expect([p.id, p.extensions.length > 0]).toEqual([p.id, true]);
    }
  });

  it('does not attach a parser to an entry that says it cannot read the file', () => {
    for (const p of PANEL_CATALOGUE.filter((e) => e.status === 'planned' || e.status === 'unreadable')) {
      expect([p.id, Boolean(p.parse || p.parseBytes)]).toEqual([p.id, false]);
    }
  });

  it('explains itself wherever it falls short', () => {
    for (const p of PANEL_CATALOGUE.filter((e) => e.status === 'unreadable' || e.status === 'partial')) {
      expect([p.id, Boolean(p.limitation)]).toEqual([p.id, true]);
    }
    for (const p of PANEL_CATALOGUE) {
      expect([p.id, Boolean(p.howToExport)]).toEqual([p.id, true]);
    }
  });

  it('writes extensions in the form the matcher expects', () => {
    for (const p of PANEL_CATALOGUE) {
      for (const ext of p.extensions) {
        expect([p.id, ext]).toEqual([p.id, ext.toLowerCase()]);
        expect(ext.startsWith('.')).toBe(true);
      }
    }
  });
});

describe('routing a picked file', () => {
  it('sends a share pack to the pack reader by its magic bytes', () => {
    expect(classifyBytes('anything.dat', utf8Bytes('SQLDxxxx')).kind).toBe('pack');
    expect(classifyBytes('site.sqld', new Uint8Array(8)).kind).toBe('pack');
  });

  it('routes a SQLite site file without decoding it to text first', () => {
    const path = join(dir, 'site.nle');
    const db = new DatabaseSync(path);
    db.exec(`
      CREATE TABLE Network (NetworkKey INTEGER PRIMARY KEY, SiteName TEXT);
      CREATE TABLE Node (NodeKey INTEGER PRIMARY KEY, NodeName TEXT, NumberOfLoops INTEGER, LoopProtocol TEXT,
        NodeAddress INTEGER, NetworkKey INTEGER);
      CREATE TABLE Zones (ZoneKey INTEGER PRIMARY KEY, ZoneNumber INTEGER, ZoneName TEXT);
      CREATE TABLE Devices (DeviceKey INTEGER PRIMARY KEY, NodeKey INTEGER);
      CREATE TABLE SubDevices (SubDeviceKey INTEGER PRIMARY KEY, DeviceKey INTEGER);
      INSERT INTO Network VALUES (1, 'Hall');
      INSERT INTO Node VALUES (1, 'Panel', 1, 'Hochiki', 1, 1);
    `);
    db.close();
    const found = classifyBytes('site.nle', new Uint8Array(readFileSync(path)));
    expect(found.kind).toBe('native-binary');
    expect(found.parser?.id).toBe('kentec-taktis');
    expect(found.parser?.parseBytes).toBeDefined();
  });

  it('routes a zipped vendor project by looking inside it', () => {
    const util = createZip([
      { name: 'ProjectDetails.xml', data: utf8Bytes('<Project/>') },
      { name: 'SITE B.txt', data: utf8Bytes('Panel: F220AU\r\nTarget:v7.06\r\nOPTIONS=DESC:"x"\r\n') },
    ]);
    expect(classifyBytes('site.util', util).parser?.id).toBe('pertronic-util');
  });

  it('recognises content over extension', () => {
    // Technicians rename files constantly, and a .txt holding a Notifier
    // configuration should still import as one.
    const pci = '<Version Name = "6.1.0">\r\n</Version>\r\n<Point ModuleKey = "sZON1" Label = "A" ActKey = "Z1" />';
    const found = classifyFile('exported.txt', pci);
    expect(found.kind).toBe('native');
    expect(found.parser?.id).toBe('notifier-pci');
  });

  it('falls back to the extension when the content says nothing', () => {
    expect(classifyFile('site.ffp', 'not actually an ffp').parser?.id).toBe('ampac-firefinder');
  });

  it('says an encrypted format is unreadable rather than unknown', () => {
    // "Unknown" invites the technician to fetch the same file again. Naming it
    // saves that trip and says what to fetch instead.
    const accdb = new Uint8Array(2000);
    accdb.set(utf8Bytes('\x00\x01\x00\x00Standard ACE DB'), 0);
    const found = classifyBytes('Cube_Main_FIP.accdb', accdb);
    expect(found.kind).toBe('unreadable');
    expect(found.parser?.limitation).toMatch(/password/i);
    expect(found.parser?.howToExport).toMatch(/\.pci/);
  });

  it('still routes a CSV to the column mapper', () => {
    expect(classifyBytes('points.csv', utf8Bytes('Address,Zone,Text\n1,1,HALL\n')).kind).toBe('tabular');
    expect(classifyBytes('points.dat', utf8Bytes('Address\tZone\tText\n1\t1\tHALL\n')).kind).toBe('tabular');
  });

  it('gives up honestly on something it does not know', () => {
    expect(classifyBytes('mystery.bin', Uint8Array.from({ length: 500 }, (_, i) => (i * 7) % 256)).kind)
      .toBe('unknown');
  });

  it('does not send binary content to the column mapper', () => {
    // The tabular fallback matches on a few commas or tabs among the first
    // lines, and arbitrary bytes supply those by accident. The result was a
    // column-mapping screen full of mojibake, where the probe would at least
    // have said what the file appears to be.
    const binary = Uint8Array.from({ length: 4000 }, (_, i) => (i * 7 + 3) % 256);
    expect(classifyBytes('mystery.dat', binary).kind).toBe('unknown');
    expect(classifyBytes('mystery.pcf', binary).kind).toBe('unknown');
    // A real delimited export is still routed, control characters and all.
    const csv = utf8Bytes('Address,Zone,Text\n1,1,HALL\n2,1,STAIR\n');
    expect(classifyBytes('points.dat', csv).kind).toBe('tabular');
  });

  it('does not mistake a text file for a binary format', () => {
    const text = utf8Bytes('LEVEL 1 EAST\nLEVEL 1 WEST\n');
    expect(['native-binary', 'pack']).not.toContain(classifyBytes('notes.log', text).kind);
  });
});
