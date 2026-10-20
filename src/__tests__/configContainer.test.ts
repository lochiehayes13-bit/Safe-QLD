import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createZip, utf8Bytes } from '@/export/zip';
import { FFP_MAGIC } from '@/parsers/ampacFfp';
import { readConfigStructure, readGroupPage, type ConfigStructure } from '@/parsers/container';

/**
 * Reading a configuration file as the tables its vendor tool wrote.
 *
 * The thing under test is a claim about all seven formats at once: that each
 * of them is named groups of records with named columns underneath, and that
 * one screen can therefore browse any of them. So these are built from the
 * same fixtures the individual parser tests use, and each asserts the same
 * two things — the groups are the ones the file actually contains, and the
 * columns line up with the values under them.
 *
 * Column alignment is the failure worth guarding. Three of the five formats
 * omit a field rather than writing it empty, so a record read before a later
 * record introduced a column is short — and a short row drawn against a longer
 * header shifts every value after the gap one cell to the left. Nothing
 * throws. The table just quietly says the wrong thing about every device in
 * it.
 */

/** The group by that name, or a failure that says which groups there were. */
function group(structure: ConfigStructure, name: string) {
  const found = structure.groups.find((g) => g.name === name);
  if (!found) {
    throw new Error(`No group "${name}". Found: ${structure.groups.map((g) => g.name).join(', ') || '(none)'}`);
  }
  return found;
}

/** The value of one column of one sampled row, by name rather than by index. */
function cell(structure: ConfigStructure, groupName: string, row: number, column: string): string {
  const g = group(structure, groupName);
  const at = g.columns.indexOf(column);
  if (at < 0) throw new Error(`Group "${groupName}" has no column "${column}". Columns: ${g.columns.join(', ')}`);
  const r = g.sample[row];
  if (!r) throw new Error(`Group "${groupName}" has no sampled row ${row}; it has ${g.sample.length}.`);
  return r[at] ?? '';
}

// ---------------------------------------------------------------------------
// Pertronic: a zip holding one text file of KEY=field:value records
// ---------------------------------------------------------------------------

const PERTRONIC = [
  'Panel: F220AU',
  'Target:v7.06',
  'OPTIONS=DESC:"TEST SITE" LOGTEST:N',
  'SITEINFO=Name:"TEST SITE" Desc1:"SAFE QLD FIRE PROTECTION"',
  // The first device carries no Out: field at all, and the second does. The
  // column is discovered on the second record, so the first must be padded
  // rather than left short.
  'L01D001=TYPE:OPT Z:1 DESC:"OFFICE SMOKE"',
  'L01D002=TYPE:HEAT Z:11 DESC:"PLANT HEAT" Out:L01M023',
  'L01M023=TYPE:RLYM Z:0 DESC:"SPARE RELAY" Out:',
  'Z001=DESC:"OFFICE AREA" TPERIOD:0',
  'Z011=DESC:"PLANT ROOM" TPERIOD:0',
  'LB001=Func:AND DESC:"STROBES" In:G020 Out:L01M23',
].join('\r\n');

function pertronicUtil(): Uint8Array {
  return createZip([
    { name: 'config.txt', data: utf8Bytes(PERTRONIC) },
    { name: 'notes.log', data: utf8Bytes('nothing to see') },
  ]);
}

describe('a Pertronic .util', () => {
  const structure = readConfigStructure(pertronicUtil(), 'VAXXAS.util');

  it('is described as the zip it is, and names the entry that holds the configuration', () => {
    expect(structure.packaging).toBe('zip');
    expect(structure.entries.map((e) => e.name)).toEqual(['config.txt', 'notes.log']);
    expect(structure.entries.filter((e) => e.isConfig).map((e) => e.name)).toEqual(['config.txt']);
    expect(structure.headline).toContain('config.txt');
  });

  it('groups records by what their key says they are, not by the key itself', () => {
    // Two devices keyed L01D001 and L01D002 are one table, not two.
    expect(group(structure, 'Loop devices').rowCount).toBe(2);
    expect(group(structure, 'Loop modules').rowCount).toBe(1);
    expect(group(structure, 'Zones').rowCount).toBe(2);
    expect(group(structure, 'Logic blocks').rowCount).toBe(1);
  });

  it('keeps a record that never had a column aligned with the ones that did', () => {
    // L01D001 has no Out:, and Out is the fourth column because L01D002
    // introduced it. Read positionally, its DESC would land under Out.
    expect(cell(structure, 'Loop devices', 0, 'Key')).toBe('L01D001');
    expect(cell(structure, 'Loop devices', 0, 'DESC')).toBe('OFFICE SMOKE');
    expect(cell(structure, 'Loop devices', 0, 'Out')).toBe('');
    expect(cell(structure, 'Loop devices', 1, 'Out')).toBe('L01M023');
  });

  it('keeps an empty field, which is the panel saying the output is not connected', () => {
    // `Out:` with nothing after it is different from no Out: at all, and the
    // format uses both.
    expect(cell(structure, 'Loop modules', 0, 'Out')).toBe('');
    expect(cell(structure, 'Loop modules', 0, 'DESC')).toBe('SPARE RELAY');
  });

  it('keeps the lines before the records rather than dropping them', () => {
    expect(group(structure, 'Header lines').rowCount).toBe(2);
  });

  it('puts the biggest table first, because that is what the file was opened for', () => {
    const counts = structure.groups.map((g) => g.rowCount);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });
});

// ---------------------------------------------------------------------------
// Notifier .pci: one self-closing tag per line
// ---------------------------------------------------------------------------

const PCI = [
  '<Version Name = "6.1.0">',
  '<Panel Name = "TEST" />',
  '<Point ModuleKey = "sZON21" Label = "TOWER BLK L 2" ActKey = "Z21" />',
  '<Point ModuleKey = "sZON25" Label = "TOWER BLK" ActKey = "Z25" Avf = "N" />',
  '<Point ModuleKey = "dL1FLD1" ModuleType = "6" Label = "PLANT ROOM" Zone = "21" />',
  'this line is not a tag at all',
].join('\r\n');

describe('a Notifier .pci', () => {
  const structure = readConfigStructure(utf8Bytes(PCI), 'TOWER.pci');

  it('reads a tag name as a table and its attributes as columns', () => {
    expect(structure.packaging).toBe('tagged-text');
    expect(group(structure, 'Point').rowCount).toBe(3);
    expect(group(structure, 'Point').columns).toEqual(['ModuleKey', 'Label', 'ActKey', 'Avf', 'ModuleType', 'Zone']);
  });

  it('aligns a row written before a later row introduced its columns', () => {
    // The first Point has no Avf, ModuleType or Zone; all three arrive later.
    expect(cell(structure, 'Point', 0, 'Label')).toBe('TOWER BLK L 2');
    expect(cell(structure, 'Point', 0, 'Avf')).toBe('');
    expect(cell(structure, 'Point', 0, 'Zone')).toBe('');
    expect(cell(structure, 'Point', 2, 'Zone')).toBe('21');
  });

  it('says how many lines it could not read rather than pretending there were none', () => {
    expect(structure.warnings.join(' ')).toContain('1 line is not');
  });
});

// ---------------------------------------------------------------------------
// Ampac .ffp: numbered sections of tab-separated rows
// ---------------------------------------------------------------------------

const FFP = [
  FFP_MAGIC,
  '',
  'File Version: 1000',
  'Project: Test Site',
  '[ P 10000 P 1',
  'MAIN FIRE PANEL\t1',
  ']',
  '[ Z 1 Z 1',
  'Y\tLEVEL 1 LOBBY\tN\tN\t0\t0',
  'Y\tLEVEL 1 PLANT\tN\tN\t0\t0',
  ']',
  '[ M 10101 X 2',
  '1\tL1 LOBBY SMOKE 1\tx02\tOPT\t0\t0',
  '2\tL1 PLANT HEAT\ta03\tHEAT\t0\t0',
  ']',
  '[ M 10102 X 2',
  '1\tLOOP 2 SOUNDER\ta03\tSOUND\t0\t0',
  ']',
].join('\n');

describe('an Ampac .ffp', () => {
  const structure = readConfigStructure(utf8Bytes(FFP), 'SITE.ffp');

  it('gathers the sections of a type into one table', () => {
    expect(structure.packaging).toBe('sectioned-text');
    // Two M sections, three rows between them, in one group.
    expect(group(structure, 'Sections of type M').rowCount).toBe(3);
    expect(group(structure, 'Sections of type Z').rowCount).toBe(2);
  });

  it('carries the section header so a row can be traced back to its loop', () => {
    // Without this column the third row is indistinguishable from the first.
    expect(cell(structure, 'Sections of type M', 0, 'Section')).toBe('M 10101 X 2');
    expect(cell(structure, 'Sections of type M', 2, 'Section')).toBe('M 10102 X 2');
    expect(cell(structure, 'Sections of type M', 2, 'Field 2')).toBe('LOOP 2 SOUNDER');
  });

  it('says what the four known section letters are for', () => {
    expect(group(structure, 'Sections of type Z').note).toContain('zone number');
    expect(group(structure, 'Sections of type P').note).toContain('panel');
  });

  it('puts the file version and project in the headline', () => {
    expect(structure.headline).toContain('1000');
    expect(structure.headline).toContain('Test Site');
  });
});

// ---------------------------------------------------------------------------
// Kentec .nle: a SQLite database
// ---------------------------------------------------------------------------

// Made at module load rather than in beforeAll: the fixture is built in the
// describe body below so the structure can be read once and asserted on from
// several tests, and describe bodies run before any hook does.
const dir = mkdtempSync(join(tmpdir(), 'container-'));
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

function nle(): Uint8Array {
  const path = join(dir, 'site.nle');
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE Zone (ZoneNumber INTEGER, ZoneText TEXT)');
  db.exec('CREATE TABLE Device (LoopNumber INTEGER, Address INTEGER, DeviceText TEXT, Blob BLOB)');
  db.exec("INSERT INTO Zone VALUES (1, 'GROUND FLOOR'), (2, 'LEVEL 1')");
  const insert = db.prepare('INSERT INTO Device VALUES (?, ?, ?, ?)');
  insert.run(1, 1, 'LOBBY SMOKE', new Uint8Array([1, 2, 3]));
  insert.run(1, 2, 'PLANT HEAT', null);
  insert.run(2, 1, 'LEVEL 1 MCP', null);
  db.close();
  return new Uint8Array(readFileSync(path));
}

describe('a Kentec .nle', () => {
  const bytes = nle();
  const structure = readConfigStructure(bytes, 'BUILDING.nle');

  it('lists the vendor tool’s own tables with their columns', () => {
    expect(structure.packaging).toBe('sqlite');
    expect(structure.groups.map((g) => g.name).sort()).toEqual(['Device', 'Zone']);
    expect(group(structure, 'Device').columns).toEqual(['LoopNumber', 'Address', 'DeviceText', 'Blob']);
    expect(group(structure, 'Device').rowCount).toBe(3);
  });

  it('renders a value a person can read, including the ones that are not text', () => {
    expect(cell(structure, 'Device', 0, 'DeviceText')).toBe('LOBBY SMOKE');
    // A blob has no readable form, so its size is the honest answer; a null is
    // blank rather than the word "null", which reads as a value.
    expect(cell(structure, 'Device', 0, 'Blob')).toBe('«3 bytes»');
    expect(cell(structure, 'Device', 1, 'Blob')).toBe('');
  });

  it('hands back a page of one table when somebody scrolls into it', () => {
    const page = readGroupPage(bytes, 'BUILDING.nle', 'Device', 1, 1);
    expect(page).toBeDefined();
    expect(page?.total).toBe(3);
    expect(page?.offset).toBe(1);
    expect(page?.rows).toEqual([['1', '2', 'PLANT HEAT', '']]);
  });

  it('returns nothing for a table that is not there, rather than an empty one', () => {
    // An empty page would read as a table that exists and has nothing in it.
    expect(readGroupPage(bytes, 'BUILDING.nle', 'NoSuchTable')).toBeUndefined();
  });

  it('clamps a page asked for past the end instead of reading off it', () => {
    const page = readGroupPage(bytes, 'BUILDING.nle', 'Device', 99, 10);
    expect(page?.offset).toBe(3);
    expect(page?.rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Everything else
// ---------------------------------------------------------------------------

describe('a delimited export', () => {
  const csv = 'Loop,Address,Device Text,Zone\n1,1,LOBBY SMOKE,1\n1,2,PLANT HEAT,2\n';
  const structure = readConfigStructure(utf8Bytes(csv), 'points.csv');

  it('is one table with the header as its columns', () => {
    expect(structure.packaging).toBe('delimited-text');
    expect(structure.groups).toHaveLength(1);
    expect(group(structure, 'points.csv').columns).toEqual(['Loop', 'Address', 'Device Text', 'Zone']);
    expect(group(structure, 'points.csv').rowCount).toBe(2);
  });
});

describe('plain text that is not a table', () => {
  const structure = readConfigStructure(utf8Bytes('one\ntwo\nthree\n'), 'notes.txt');

  it('is shown as its lines rather than split on a delimiter that was never there', () => {
    expect(structure.packaging).toBe('text');
    expect(group(structure, 'notes.txt').columns).toEqual(['Line']);
    expect(group(structure, 'notes.txt').rowCount).toBe(3);
  });

  it('does not invent a fourth line out of the trailing newline', () => {
    expect(group(structure, 'notes.txt').sample).toEqual([['one'], ['two'], ['three']]);
  });
});

describe('a file that is not text and not a container we know', () => {
  const bytes = new Uint8Array(512);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37) % 256;
  const structure = readConfigStructure(bytes, 'mystery.bin');

  it('describes what it appears to be rather than giving up', () => {
    // "Unsupported" is no use to the person holding the only copy of a
    // configuration nobody has written a parser for. The probe already answers
    // the question anybody asks next — container, compressed, encrypted, any
    // structure left — so that is what the raw view of an unknown file is.
    expect(structure.packaging).toBe('binary');
    expect(structure.groups).toEqual([]);
    expect(structure.headline).toContain('mystery.bin is not text');
    expect(structure.headline).toContain('no recognised signature');
  });
});

describe('an empty file', () => {
  it('is not mistaken for text with nothing in it', () => {
    const structure = readConfigStructure(new Uint8Array(0), 'empty.nle');
    expect(structure.packaging).toBe('binary');
    expect(structure.byteLength).toBe(0);
    expect(structure.groups).toEqual([]);
  });
});

describe('the sample', () => {
  it('is capped, and the count still reports the whole table', () => {
    const lines = ['<Version Name = "1">'];
    for (let i = 1; i <= 60; i++) lines.push(`<Point ModuleKey = "sZON${i}" Label = "ZONE ${i}" />`);
    const structure = readConfigStructure(utf8Bytes(lines.join('\n')), 'big.pci', 5);
    expect(group(structure, 'Point').rowCount).toBe(60);
    expect(group(structure, 'Point').sample).toHaveLength(5);
  });
});
