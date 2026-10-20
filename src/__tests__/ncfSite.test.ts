import { existsSync, readFileSync } from 'fs';
import { NcfError, isNcf, parseNcf, parseSiteTable } from '@/parsers/ncfSite';
import { createZip, utf8Bytes } from '@/export/zip';

/**
 * The .NCF site-table reader.
 *
 * This layout was worked out from a single sample, which is thin evidence for
 * a binary format. So the reader does not trust it — it checks the layout on
 * every file and refuses when the checks fail, and most of what follows is
 * about those refusals. The failure being designed against is not an
 * exception; it is a zone list that looks entirely reasonable and is wrong.
 */

const SLOT = 112;

/** Builds a SITE table: two header slots, then one slot per record. */
function siteTable(
  siteName: string,
  records: { id: number; label: string }[],
  opts: { kind?: number; labelLength?: (real: number) => number } = {},
): Uint8Array {
  const bytes = new Uint8Array((2 + records.length) * SLOT);

  // The site name lives in the second slot, length-prefixed.
  bytes[SLOT + 8] = siteName.length;
  for (let i = 0; i < siteName.length; i++) bytes[SLOT + 9 + i] = siteName.charCodeAt(i);

  records.forEach((record, index) => {
    const at = (2 + index) * SLOT;
    bytes[at + 8] = opts.kind ?? 3;
    bytes[at + 12] = record.id & 0xff;
    bytes[at + 13] = (record.id >> 8) & 0xff;
    bytes[at + 16] = opts.labelLength ? opts.labelLength(record.label.length) : record.label.length;
    for (let i = 0; i < record.label.length; i++) bytes[at + 17 + i] = record.label.charCodeAt(i);
  });
  return bytes;
}

const ZONES = [
  { id: 1, label: 'ZONE 1' },
  { id: 2, label: 'ZONE 2' },
  { id: 3, label: 'ZONE 3' },
  { id: 4, label: 'ZONE 4' },
  { id: 5, label: 'MCP ON FIRE PANEL DOOR' },
  { id: 6, label: 'ZONE 6' },
  { id: 0x320, label: 'WIRELESS INTERFACE DEVICE' },
  { id: 0x321, label: 'WARNING SYSTEM DEVICE' },
  { id: 0x385, label: 'SITE FIRE PANEL' },
];

const archive = (site = siteTable('CARINA BUS DEPOT', ZONES)): Uint8Array => createZip([
  { name: 'SITE', data: site },
  { name: 'CARINA BUS DEPOT.pcf', data: Uint8Array.from({ length: 400 }, (_, i) => (i * 37 + 11) % 256) },
  { name: 'CARINA BUS DEPOT.txt', data: new Uint8Array(0) },
]);

describe('recognising the archive', () => {
  it('accepts a zip holding SITE and a .pcf', () => {
    expect(isNcf(archive())).toBe(true);
  });

  it('rejects a zip without both', () => {
    expect(isNcf(createZip([{ name: 'SITE', data: utf8Bytes('x') }]))).toBe(false);
    expect(isNcf(createZip([{ name: 'a.pcf', data: utf8Bytes('x') }]))).toBe(false);
    expect(isNcf(utf8Bytes('not a zip'))).toBe(false);
  });
});

describe('reading the site table', () => {
  it('reads the site name and every record', () => {
    const { siteName, records } = parseSiteTable(siteTable('CARINA BUS DEPOT', ZONES));
    expect(siteName).toBe('CARINA BUS DEPOT');
    expect(records).toHaveLength(ZONES.length);
    expect(records[4]).toEqual({ id: 5, label: 'MCP ON FIRE PANEL DOOR' });
  });

  it('refuses a table that is not a whole number of records', () => {
    const truncated = siteTable('SITE', ZONES).slice(0, 3 * SLOT + 40);
    expect(() => parseSiteTable(truncated)).toThrow(NcfError);
    expect(() => parseSiteTable(truncated)).toThrow(/not a whole number/i);
  });

  it('refuses a record whose declared length does not match its text', () => {
    // This is the load-bearing check. If the layout is wrong the length byte
    // lands on some other field, and the label that comes back is made of
    // whatever happened to be adjacent.
    expect(() => parseSiteTable(siteTable('SITE', ZONES, { labelLength: (n) => n + 4 })))
      .toThrow(/does not carry a readable length-prefixed label/i);
    expect(() => parseSiteTable(siteTable('SITE', ZONES, { labelLength: (n) => n - 2 })))
      .toThrow(/does not carry a readable length-prefixed label/i);
  });

  it('refuses a record marked with a kind it has not seen', () => {
    expect(() => parseSiteTable(siteTable('SITE', ZONES, { kind: 9 })))
      .toThrow(/record layout the reader has not seen/i);
  });
});

describe('reading a site', () => {
  it('imports the zones and leaves the equipment entries out', () => {
    const c = parseNcf(archive(), 'site.NCF');
    expect(c.siteName).toBe('CARINA BUS DEPOT');
    expect(c.panels[0]!.zones.map((z) => z.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(c.panels[0]!.zones[4]!.text).toBe('MCP ON FIRE PANEL DOOR');
    expect(c.warnings.join(' ')).toMatch(/WIRELESS INTERFACE DEVICE/);
  });

  it('refuses rather than renumbering when a label contradicts its id', () => {
    // Where a label reads "ZONE 4" the record's own id has to agree, or the id
    // field is not the zone number and importing would renumber the site.
    const wrong = siteTable('SITE', [{ id: 1, label: 'ZONE 1' }, { id: 2, label: 'ZONE 7' }]);
    expect(() => parseNcf(archive(wrong))).toThrow(/is not the zone number/i);
  });

  it('does not claim a brand it cannot know', () => {
    const c = parseNcf(archive());
    expect(c.brand).toBe('other');
    expect(c.warnings.join(' ')).toMatch(/brand and model are not recorded/i);
  });

  it('says plainly that no devices came across', () => {
    const c = parseNcf(archive());
    expect(c.panels[0]!.points).toEqual([]);
    expect(c.panels[0]!.loops).toEqual([]);
    expect(c.panels[0]!.causeEffect).toEqual([]);
    expect(c.warnings.join(' ')).toMatch(/no devices, loops or cause-and-effect came across/i);
    expect(c.warnings.join(' ')).toMatch(/\.pcf/);
  });

  it('rejects an archive with no SITE entry', () => {
    expect(() => parseNcf(createZip([{ name: 'a.pcf', data: utf8Bytes('x') }])))
      .toThrow(/no SITE entry/i);
  });
});

/** Against the real Carina Bus Depot file when present; never committed. */
const REAL = '/tmp/panels/pertronic.NCF';
const describeReal = existsSync(REAL) ? describe : describe.skip;

describeReal('against the real Carina Bus Depot file', () => {
  it('reads the site and its six zones', () => {
    const c = parseNcf(new Uint8Array(readFileSync(REAL)), 'pertronic.NCF');
    expect(c.siteName).toBe('CARINA BUS DEPOT');
    expect(c.panels[0]!.zones).toHaveLength(6);
    expect(c.panels[0]!.zones.map((z) => z.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(c.panels[0]!.zones[4]!.text).toBe('MCP ON FIRE PANEL DOOR');
  });
});
