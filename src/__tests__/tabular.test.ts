import {
  FIELD_SPECS, guessMapping, importTabular, previewTabular, type ColumnMapping,
} from '@/parsers/tabular';

/**
 * The import path that works whatever the panel is.
 *
 * Every programming tool can produce a device list and every technician can
 * build one in a spreadsheet, so this is the route that makes the app useful on
 * a panel nobody has written a parser for. It is also the route with the most
 * ways to be quietly wrong, because it is guessing at somebody else's
 * spreadsheet.
 *
 * The guesses that matter: which column is which, and whether the first row is
 * a header or a device. Getting the second one wrong loses exactly one device
 * and reports success.
 */

const rows = (...lines: string[]) => lines.join('\n');

describe('guessMapping', () => {
  it('maps the obvious headers', () => {
    expect(guessMapping(['Loop', 'Address', 'Device Text', 'Zone']))
      .toEqual(['loop', 'address', 'text', 'zoneNumber']);
  });

  it('keeps Zone and Zone Text apart', () => {
    /*
     * The mapping bug this is built to avoid. "Zone" and "Zone Text" share a
     * word, and a naive matcher assigns both columns to the same field — so the
     * zone list comes in with numbers and no names, or names and no numbers.
     */
    const m = guessMapping(['Zone', 'Zone Text', 'Device Text']);
    expect(m).toEqual(['zoneNumber', 'zoneText', 'text']);
  });

  it('claims each field at most once', () => {
    // Two columns mapped to the same field means the second silently wins and
    // the first is discarded.
    const m = guessMapping(['Description', 'Location', 'Label', 'Name']);
    const claimed = m.filter((k) => k !== 'ignore');
    expect(claimed).toEqual([...new Set(claimed)]);
  });

  it('ignores a column it has no field for, rather than forcing one', () => {
    const m = guessMapping(['Loop', 'Installed By', 'Address']);
    expect(m[1]).toBe('ignore');
  });

  it('tolerates punctuation and case in a header', () => {
    expect(guessMapping(['LOOP #', 'Device-Address'])).toEqual(['loop', 'address']);
  });

  it('maps nothing from empty headers rather than guessing by position', () => {
    expect(guessMapping(['', '  ', ''])).toEqual(['ignore', 'ignore', 'ignore']);
  });

  it('has an alias list with no duplicate claiming two fields', () => {
    /*
     * A shared alias makes the mapping depend on the order FIELD_SPECS happens
     * to be written in, which is not a decision anybody made.
     */
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const spec of FIELD_SPECS) {
      for (const alias of spec.aliases) {
        const prior = seen.get(alias);
        if (prior && prior !== spec.key) clashes.push(`${alias}: ${prior} vs ${spec.key}`);
        else seen.set(alias, spec.key);
      }
    }
    expect(clashes).toEqual([]);
  });
});

describe('previewTabular', () => {
  it('reads a header row and guesses from it', () => {
    const p = previewTabular(rows('Loop,Address,Device Text', '1,1,Foyer detector'));
    expect(p.hasHeader).toBe(true);
    expect(p.headers).toEqual(['Loop', 'Address', 'Device Text']);
    expect(p.totalRows).toBe(1);
  });

  it('names columns by position where there is no header', () => {
    const p = previewTabular(rows('1,1,101', '1,2,102'));
    expect(p.hasHeader).toBe(false);
    expect(p.headers).toEqual(['Column 1', 'Column 2', 'Column 3']);
  });

  it('maps nothing when there is no header, rather than guessing from data', () => {
    // Column 1 is not evidence of anything. A guess here would be a mapping the
    // technician never made and would not think to check.
    const p = previewTabular(rows('1,1,101', '1,2,102'));
    expect(p.mapping.every((k) => k === 'ignore')).toBe(true);
  });

  it('counts every data row, not just the ones it shows', () => {
    const body = Array.from({ length: 30 }, (_, i) => `1,${i + 1},Device ${i + 1}`);
    const p = previewTabular(rows('Loop,Address,Text', ...body));
    expect(p.totalRows).toBe(30);
    expect(p.sampleRows.length).toBeLessThanOrEqual(8);
  });

  it('returns an honest empty preview for an empty file', () => {
    expect(previewTabular('')).toEqual({
      headers: [], mapping: [], sampleRows: [], totalRows: 0, hasHeader: false,
    });
  });
});

describe('header detection', () => {
  it('treats a row of words as a header', () => {
    expect(previewTabular(rows('Loop,Address,Text', '1,1,Foyer')).hasHeader).toBe(true);
  });

  it('treats a row of numbers as data', () => {
    expect(previewTabular(rows('1,1,101', '1,2,102')).hasHeader).toBe(false);
  });

  it('lets the caller override the detection, and the override wins', () => {
    /*
     * This is the safety valve, and it has to actually work. A device list with
     * no header whose first row is mostly text — "L1,001,Detector,Level 3" —
     * reads as a header, and the first device on the panel is silently eaten.
     * The import screen shows the detection so a person can correct it; if the
     * correction did nothing the screen would be worse than useless.
     */
    const text = rows('L1,001,Detector,Level 3 foyer', 'L1,002,Detector,Level 3 east');
    const mapping: ColumnMapping = ['loop', 'address', 'deviceType', 'text'];

    const eaten = importTabular(text, { panelName: 'P', mapping, hasHeader: true });
    const kept = importTabular(text, { panelName: 'P', mapping, hasHeader: false });

    expect(eaten.panels[0]!.points).toHaveLength(1);
    expect(kept.panels[0]!.points).toHaveLength(2);
    expect(kept.panels[0]!.points[0]!.text).toBe('Level 3 foyer');
  });
});

describe('importTabular', () => {
  const mapping: ColumnMapping = ['loop', 'address', 'text', 'zoneNumber', 'zoneText'];
  const text = rows(
    'Loop,Address,Device Text,Zone,Zone Text',
    '1,1,Foyer detector,1,Ground floor',
    '1,2,Corridor detector,1,Ground floor',
    '2,1,Plant room detector,7,Plant',
  );

  it('reads every device row', () => {
    const c = importTabular(text, { panelName: 'FIP', mapping });
    expect(c.panels[0]!.points).toHaveLength(3);
  });

  it('builds a zone list out of a device list, because most exports have no zone sheet', () => {
    const c = importTabular(text, { panelName: 'FIP', mapping });
    const zones = c.panels[0]!.zones;
    expect(zones.map((z) => z.number).sort((a, b) => a - b)).toEqual([1, 7]);
    expect(zones.find((z) => z.number === 7)!.text).toBe('Plant');
  });

  it('does not create a second zone for a repeated zone number', () => {
    const c = importTabular(text, { panelName: 'FIP', mapping });
    expect(c.panels[0]!.zones.filter((z) => z.number === 1)).toHaveLength(1);
  });

  it('tolerates the way people actually write a loop or an address', () => {
    // "L1", "001", "Zone 003", "12A" all appear in real exports.
    const c = importTabular(
      rows('Loop,Address,Device Text,Zone', 'L1,001,Foyer,Zone 003'),
      { panelName: 'FIP', mapping: ['loop', 'address', 'text', 'zoneNumber'] },
    );
    const p = c.panels[0]!.points[0]!;
    expect(p.loopNumber).toBe(1);
    expect(p.address).toBe(1);
    expect(p.zoneNumber).toBe(3);
  });

  it('does not invent a zone from a number with no name against it', () => {
    /*
     * A zone is created from a device list only where the list actually names
     * one. A zone row reading "Zone 3" with no text is not a zone the panel
     * has, it is a number this app read off a device — and inventing an empty
     * zone puts a blank row on a zone chart that gets signed.
     *
     * Nothing is lost by leaving it out: the point keeps its zone number, so
     * the coverage screen still reports a device pointing at a zone the table
     * does not have, which is the honest way for that gap to show.
     */
    const c = importTabular(
      rows('Loop,Address,Device Text,Zone', 'L1,001,Foyer,Zone 003'),
      { panelName: 'FIP', mapping: ['loop', 'address', 'text', 'zoneNumber'] },
    );
    expect(c.panels[0]!.zones).toEqual([]);
    expect(c.panels[0]!.points[0]!.zoneNumber).toBe(3);
  });

  it('warns when no device text column was mapped', () => {
    // A point list of blank descriptions is not obviously broken on screen —
    // it looks like a panel where nobody typed any device text.
    const c = importTabular(text, { panelName: 'FIP', mapping: ['loop', 'address', 'ignore', 'ignore', 'ignore'] });
    expect(c.warnings.join(' ')).toContain('No device text column');
  });

  it('warns when nothing identifies the device', () => {
    const c = importTabular(text, { panelName: 'FIP', mapping: ['ignore', 'ignore', 'text', 'ignore', 'ignore'] });
    expect(c.warnings.join(' ')).toContain('No address or point reference');
  });

  it('says the file had nothing in it rather than returning an empty panel silently', () => {
    const c = importTabular('', { panelName: 'FIP' });
    expect(c.panels).toEqual([]);
    expect(c.warnings.join(' ')).toContain('no readable rows');
  });

  it('skips a row carrying no identity and no text', () => {
    const c = importTabular(
      rows('Loop,Address,Device Text', '1,1,Foyer', ',,', '1,2,Corridor'),
      { panelName: 'FIP', mapping: ['loop', 'address', 'text'] },
    );
    expect(c.panels[0]!.points).toHaveLength(2);
  });

  it('records which parser read the file, so a bad import can be traced', () => {
    expect(importTabular(text, { panelName: 'FIP', mapping }).parser).toBe('tabular@1');
  });

  it('carries the brand through rather than asserting one it was not told', () => {
    expect(importTabular(text, { panelName: 'FIP', mapping }).brand).toBe('other');
    expect(importTabular(text, { panelName: 'FIP', mapping, brand: 'ampac' }).brand).toBe('ampac');
  });
});
