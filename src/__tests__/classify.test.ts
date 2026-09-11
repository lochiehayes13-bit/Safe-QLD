import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PANEL_CATALOGUE, classifyBytes, classifyFile, parserForBrand } from '@/parsers';

/**
 * Deciding what a picked file actually is.
 *
 * The order this asks its questions in is the whole design, and every step of
 * it was paid for by a wrong answer.
 *
 * Binary signatures come first because they are exact. Text sniffing next,
 * because a technician renaming a file is routine and the extension is then a
 * lie. The extension last, as the weakest evidence of the three. And the
 * tabular fallback — which triggers on nothing more than a few commas among
 * the first lines — is fenced off from binary content, because binary supplies
 * commas by accident and the technician gets a column mapper full of mojibake
 * instead of a probe that would have told them what the file was.
 *
 * The asset register is checked before all of it. A register is a CSV, so the
 * tabular path would happily claim it and hand somebody nine hundred sites to
 * map by hand.
 */

const bytes = (s: string): Uint8Array => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

/** A run of arbitrary bytes with enough commas to tempt the tabular sniff. */
const binaryWithCommas = (): Uint8Array => {
  const out: number[] = [];
  for (let i = 0; i < 400; i++) {
    out.push((i * 37) % 256);
    if (i % 9 === 0) out.push(0x2c); // a comma
    if (i % 40 === 0) out.push(0x0a); // a newline
  }
  return new Uint8Array(out);
};

const REGISTER_HEAD = 'Site Name,Asset Number,Walk Order,Type\nExample,1001,1,Extinguisher\n';

describe('the share pack', () => {
  it('is recognised by its signature, whatever it is called', () => {
    expect(classifyBytes('whatever.dat', bytes('SQLDbinary…')).kind).toBe('pack');
  });

  it('is recognised by its extension when the bytes are not to hand', () => {
    expect(classifyBytes('site.sqld', bytes('')).kind).toBe('pack');
    expect(classifyFile('site.sqld', '').kind).toBe('pack');
  });
});

describe('the asset register', () => {
  it('is claimed before the tabular path can take it', () => {
    /*
     * A register is a CSV. Without this the column mapper opens on it and a
     * technician is asked to map nine hundred sites by hand.
     */
    expect(classifyBytes('export.csv', bytes(REGISTER_HEAD)).kind).toBe('register');
  });

  it('is recognised whatever the file is called', () => {
    expect(classifyBytes('assets.txt', bytes(REGISTER_HEAD)).kind).toBe('register');
  });

  it('does not claim an ordinary CSV that merely has a site column', () => {
    // Both markers are needed. "Site Name" alone is half the panel exports ever
    // written.
    const ordinary = 'Site Name,Loop,Address,Device Text\nExample,1,1,Foyer\n';
    expect(classifyBytes('points.csv', bytes(ordinary)).kind).not.toBe('register');
  });
});

describe('binary content', () => {
  it('is never sent to the column mapper on the strength of a few commas', () => {
    /*
     * The bug this closes. Binary produces commas by accident, the tabular
     * fallback triggers on them, and the technician gets a screen of mojibake
     * to map instead of a probe that might have said what the file was.
     */
    expect(classifyBytes('config.bin', binaryWithCommas()).kind).toBe('unknown');
  });

  it('is still classified where a parser recognises its signature', () => {
    /*
     * The other half of the guard above, and this used to assert only that the
     * catalogue holds at least one signature — which it would have gone on
     * doing against a classifier that answered "unknown" for every binary file,
     * the exact thing it exists to rule out.
     *
     * So it classifies a real one. A Loop Explorer site file is a SQLite
     * database: binary, and full of accidental commas once there is any text in
     * it, which is what makes it the case worth testing rather than a
     * hypothetical one.
     */
    const bytes = kentecDatabase();
    const out = classifyBytes('site.nle', bytes);
    expect(out.kind).toBe('native-binary');
    expect(out.parser?.id).toBe('kentec-taktis');
  });

  it('recognises it by its signature rather than by its name', () => {
    /*
     * A technician renaming a file is routine, and the extension is then a lie.
     * Binary signatures are exact, which is why they are asked first — so the
     * answer must not move when the name does.
     */
    const bytes = kentecDatabase();
    for (const name of ['site.nle', 'site.bin', 'copy of site (2)', '']) {
      expect([name, classifyBytes(name, bytes).parser?.id]).toEqual([name, 'kentec-taktis']);
    }
  });

  it('has signatures to be recognised by', () => {
    // The pair above are only meaningful while the catalogue actually carries
    // byte signatures; without one they would be testing the extension.
    expect(PANEL_CATALOGUE.filter((p) => p.sniffBytes).length).toBeGreaterThan(0);
  });
});

describe('recognised and unreadable', () => {
  it('says so rather than saying unknown', () => {
    /*
     * A better answer than unknown, and it saves the technician going and
     * fetching the same file again. The Notifier .accdb exports are the case:
     * they carry a database password and no tool can open them.
     */
    const unreadable = PANEL_CATALOGUE.filter((p) => p.status === 'unreadable');
    expect(unreadable.length).toBeGreaterThan(0);

    for (const p of unreadable) {
      for (const ext of p.extensions) {
        const got = classifyBytes(`job${ext}`, binaryWithCommas());
        expect({ ext, kind: got.kind }).toEqual({ ext, kind: 'unreadable' });
      }
    }
  });

  it('carries the reason with it, so the screen can say why', () => {
    for (const p of PANEL_CATALOGUE.filter((x) => x.status === 'unreadable')) {
      expect({ brand: p.brand, has: !!p.limitation?.trim() })
        .toEqual({ brand: p.brand, has: true });
    }
  });
});

describe('plain delimited text', () => {
  it('goes to the column mapper', () => {
    const csv = 'Loop,Address,Device Text\n1,1,Foyer detector\n1,2,Corridor\n';
    expect(classifyBytes('points.csv', bytes(csv)).kind).toBe('tabular');
  });

  it('goes there on its extension even with nothing recognisable inside', () => {
    expect(classifyFile('anything.csv', 'a\n').kind).toBe('tabular');
    expect(classifyFile('anything.tsv', 'a\n').kind).toBe('tabular');
  });
});

describe('the catalogue itself', () => {
  it('gives every entry a brand, a label and at least one extension', () => {
    const thin = PANEL_CATALOGUE
      .filter((p) => !p.brand || !p.brandLabel?.trim() || !p.extensions.length)
      .map((p) => p.brand);
    expect(thin).toEqual([]);
  });

  it('has no two readable entries claiming the same brand', () => {
    /*
     * A brand can legitimately appear twice — Notifier has a readable .pci and
     * an unreadable .accdb, which are different formats from the same vendor.
     * Two *readable* entries would be the problem: parserForBrand returns the
     * first match, so which parser runs would depend on the order the list
     * happens to be written in.
     */
    const readable = PANEL_CATALOGUE.filter((p) => p.parse || p.parseBytes).map((p) => p.brand);
    expect(readable).toEqual([...new Set(readable)]);
  });

  it('answers parserForBrand with a readable parser where the brand has one', () => {
    // The Notifier case again: asking for "notifier" must not hand back the
    // entry that exists only to say the format cannot be read.
    for (const brand of new Set(PANEL_CATALOGUE.filter((p) => p.parse || p.parseBytes).map((p) => p.brand))) {
      const found = parserForBrand(brand);
      expect({ brand, readable: Boolean(found?.parse || found?.parseBytes) })
        .toEqual({ brand, readable: true });
    }
  });

  it('finds a parser for every brand it lists', () => {
    for (const p of PANEL_CATALOGUE) {
      expect({ brand: p.brand, found: parserForBrand(p.brand)?.brand })
        .toEqual({ brand: p.brand, found: p.brand });
    }
  });

  it('finds nothing for a brand it does not list', () => {
    expect(parserForBrand('not-a-brand' as never)).toBeUndefined();
  });

  it('writes every extension lowercase with its dot, because matching is on a lowercased name', () => {
    /*
     * An extension stored as ".FFP" or as "ffp" never matches, and the failure
     * is silent — the file simply falls through to unknown and the parser looks
     * like it was never written.
     */
    const wrong = PANEL_CATALOGUE.flatMap((p) =>
      p.extensions.filter((e) => e !== e.toLowerCase() || !e.startsWith('.')));
    expect(wrong).toEqual([]);
  });

  it('gives an unreadable entry no parser, and a readable one a parser', () => {
    // "Recognised and unreadable" has to mean it, or the app offers to read
    // something it cannot.
    for (const p of PANEL_CATALOGUE) {
      const parseable = Boolean(p.parse || p.parseBytes);
      if (p.status === 'unreadable') {
        expect({ brand: p.brand, parseable }).toEqual({ brand: p.brand, parseable: false });
      }
    }
  });
});

describe('what it does with nothing', () => {
  it('does not crash on an empty file', () => {
    expect(classifyBytes('empty.dat', new Uint8Array()).kind).toBe('unknown');
  });

  it('does not crash on a file with no name', () => {
    expect(() => classifyBytes('', bytes('anything'))).not.toThrow();
  });
});

/**
 * A Loop Explorer site file, as far as recognising one goes.
 *
 * Three table names is the whole signature, and the text carries commas
 * deliberately: binary content producing commas by accident is what the
 * tabular fallback used to trip over.
 */
let sqliteDir: string | undefined;
let sqliteCount = 0;
afterAll(() => { if (sqliteDir) rmSync(sqliteDir, { recursive: true, force: true }); });

function kentecDatabase(): Uint8Array {
  sqliteDir ??= mkdtempSync(join(tmpdir(), 'classify-'));
  // A fresh file each call: DatabaseSync opens an existing one rather than
  // replacing it, and the second CREATE TABLE then throws.
  const path = join(sqliteDir, `site-${sqliteCount++}.nle`);
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE Node (NodeKey INTEGER PRIMARY KEY, NodeName TEXT)');
  db.exec('CREATE TABLE SubDevices (SubDeviceKey INTEGER PRIMARY KEY)');
  db.exec('CREATE TABLE Zones (ZoneKey INTEGER PRIMARY KEY)');
  db.exec("INSERT INTO Node (NodeName) VALUES ('PANEL 1, LEVEL 2, EAST RISER, PLANT')");
  db.close();
  return new Uint8Array(readFileSync(path));
}
