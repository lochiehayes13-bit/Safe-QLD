import { existsSync, readFileSync } from 'fs';
import { isPci, parsePci, parsePciLine } from '@/parsers/notifierPci';

/**
 * The Notifier .pci parser.
 *
 * Two things about this format shape the tests. It is not valid XML — the
 * notes field carries `&vbCrLf`, which no XML parser will accept — so the
 * malformed-entity case is a first-class requirement rather than an edge. And
 * its equations are the actual commissioned cause and effect, in text, which
 * means rendering them wrong produces a document that reads perfectly and
 * describes a building that does not exist.
 */

const HEAD = [
  '<Version Name = "6.1.0">',
  '</Version>',
  '<Xml Name = "ipswich hospital 4.0">',
  '<Notes Notes = " &vbCrLf  -- Configuration uploaded from panel on 15/08/2019 at 2:07:16 PM -- ">',
  '</Notes>',
  '<Node Name = "Node 3">',
  '<Point ModuleKey = "nNOD1" Label = "NODE 1" ActKey = "N1" />',
  '</Node>',
  '<Globals Name = "Globals" SiteName = "IPSWICH HOSPITAL" Contact1 = "SAFE QLD" Phone1 = "0733998988">',
  '</Globals>',
  '<Zones Name = "Zone Groups">',
  '<Point ModuleKey = "sZON21" Label = "TOWER BLK L 2" ActKey = "Z21" Avf = "N" />',
  '<Point ModuleKey = "sZON25" Label = "TOWER BLK" ActKey = "Z25" Avf = "N" />',
  '<Point ModuleKey = "sZON99" Label = "SOCIAL CLUB" ActKey = "Z99" Avf = "N" />',
  '</Zones>',
  '<NetPoints Name = "Network Points">',
  '<Point ModuleKey = "zPNT240" Label = "ASE ALM TOWER" Script = "VP240;" ActKey = "NP240" />',
  '<Point ModuleKey = "zPNT230" Label = "EVAC ZONE FT2-1" Script = "VP230;" ActKey = "NP230" />',
  '</NetPoints>',
];

const LOOP = [
  '<Flashscan Name = "R3:Addressable Loops">',
  '<Loop Name = "L 1:LOOP 1">',
  '<Point ModuleKey = "dL1FLD1" ModuleType = "6" PointId = "D1" Label = "PLANT ROOM" Script = "" Zone = "21"' +
    ' ZoneType = "PHOTO" Loop = "1" Device = "1" ActKey = "L1D1" />',
  '<Point ModuleKey = "dL1FLD2" ModuleType = "6" PointId = "D2" Label = "SERVICE TUNNEL" Script = "" Zone = "25"' +
    ' ZoneType = "HEAT" Loop = "1" Device = "2" ActKey = "L1D2" />',
  '<Point ModuleKey = "oL1FLM14" ModuleType = "0" PointId = "I14" Label = "MCP SUB FLOOR" Script = "" Zone = "21"' +
    ' ZoneType = "MCP" Loop = "1" Device = "14" ActKey = "L1M14" />',
  '<Point ModuleKey = "oL1FLM95" ModuleType = "3" PointId = "O95" Label = "LV2 SEC DOOR RELEASE"' +
    ' Script = "NP240;" Zone = "0" ZoneType = "" Loop = "1" Device = "95" ActKey = "L1M95" />',
  '</Loop>',
  '<Loop Name = "L 2:LOOP 2">',
  '<Point ModuleKey = "dL2FLD1" ModuleType = "6" PointId = "D1" Label = "WARD 3" Script = "" Zone = "21"' +
    ' ZoneType = "PHOTO" Loop = "2" Device = "1" ActKey = "L2D1" />',
  '</Loop>',
  '</Flashscan>',
];

const PANEL_OUTPUTS = [
  '<Ring0 Name = "Ring0">',
  '<Point ModuleKey = "bDEFO1" PointId = "O1" Label = "BELL OUTPUT" Script = "CAN NOT BE RE-PROGRAMMED"' +
    ' Zone = "0" ZoneType = "" ActKey = "0.4.O1" />',
  '<Point ModuleKey = "bDEFZ1" PointId = "Z1" Label = "PROGRAMMED POINT" Script = "" Zone = "0"' +
    ' ZoneType = "" ActKey = "0.1.Z1" />',
  '<Point ModuleKey = "xDEFO1" PointId = "O1" Label = "EVAC TRIP FT 2-1" Script = "NP230 AND !WI;"' +
    ' ActKey = "XR1" />',
  '<Point ModuleKey = "xDEFO2" PointId = "O2" Label = "STAGE STROBE" Script = "Z25;" ActKey = "XR2" />',
  '</Ring0>',
];

const FILE = [...HEAD, ...PANEL_OUTPUTS, ...LOOP].join('\r\n');

describe('reading a line as a tag', () => {
  it('reads attributes written with spaces round the equals', () => {
    const tag = parsePciLine('<Point ModuleKey = "dL1FLD1" Label = "PLANT ROOM" Zone = "21" />')!;
    expect(tag.name).toBe('Point');
    expect(tag.selfClosing).toBe(true);
    expect(tag.attrs).toMatchObject({ ModuleKey: 'dL1FLD1', Label: 'PLANT ROOM', Zone: '21' });
  });

  it('keeps an empty attribute, which is different from an absent one', () => {
    expect(parsePciLine('<Point Script = "" Label = "X" />')!.attrs.Script).toBe('');
    expect(parsePciLine('<Point Label = "X" />')!.attrs.Script).toBeUndefined();
  });

  it('decodes the five XML entities', () => {
    expect(parsePciLine('<Point Label = "A &amp; B &lt;C&gt; &quot;D&quot;" />')!.attrs.Label)
      .toBe('A & B <C> "D"');
  });

  it('leaves &vbCrLf alone, because it is not an entity', () => {
    // It is a fragment of Visual Basic that ended up in the string. Turning it
    // into a newline would be inventing content the panel never held.
    expect(parsePciLine('<Notes Notes = "a &vbCrLf b" />')!.attrs.Notes).toBe('a &vbCrLf b');
  });

  it('reads closing tags and ignores anything that is not a tag', () => {
    expect(parsePciLine('</Loop>')).toMatchObject({ name: 'Loop', closing: true });
    expect(parsePciLine('not a tag')).toBeUndefined();
    expect(parsePciLine('')).toBeUndefined();
  });
});

describe('recognising the format', () => {
  it('accepts a real one and rejects other angle-bracket formats', () => {
    expect(isPci(FILE)).toBe(true);
    expect(isPci('<?xml version="1.0"?><site><zone n="1"/></site>')).toBe(false);
    expect(isPci('LEVEL 1 EAST\tSMOKE')).toBe(false);
  });

  it('reads a file that is not well-formed XML', () => {
    // Two things here are fatal to an XML parser: there is no root element,
    // and `&vbCrLf` is not a defined entity. Both sit near the top of the
    // file, so a parser that validated first would fail before reaching a
    // single device. Reading line by line sidesteps both.
    expect(FILE).toContain('&vbCrLf');
    expect(FILE.trimStart().startsWith('<Version')).toBe(true);
    expect(FILE.trimEnd().endsWith('</Flashscan>')).toBe(true);
    expect(parsePci(FILE).panels[0]!.points.length).toBeGreaterThan(0);
  });
});

describe('reading a site', () => {
  const c = () => parsePci(FILE, 'site.pci');

  it('takes the site name from Globals and the node from the Node section', () => {
    expect(c().siteName).toBe('IPSWICH HOSPITAL');
    expect(c().panels[0]!.nodeNumber).toBe(3);
    expect(c().brand).toBe('notifier');
  });

  it('reads the loops and their labels', () => {
    expect(c().panels[0]!.loops).toEqual([
      { number: 1, label: 'LOOP 1' },
      { number: 2, label: 'LOOP 2' },
    ]);
  });

  it('reads device types from the panel vocabulary', () => {
    const points = c().panels[0]!.points;
    expect(points.find((p) => p.pointRef === 'L1D1')!.deviceType).toBe('smoke-photo');
    expect(points.find((p) => p.pointRef === 'L1D2')!.deviceType).toBe('heat');
    expect(points.find((p) => p.pointRef === 'L1M14')!.deviceType).toBe('mcp');
  });

  it('does not read a Y/N flag as a device type', () => {
    // The same attribute carries a device type on loop rows and a yes/no flag
    // elsewhere. Handing "Y" to the type normaliser has it matching on a letter.
    const withFlag = [...HEAD, '<Ring0 Name = "R">',
      '<Point ModuleKey = "bDEFZ4" PointId = "Z4" Label = "X" ZoneType = "Y" ActKey = "0.1.Z4" />',
      '</Ring0>'].join('\r\n');
    expect(parsePci(withFlag).panels[0]!.points[0]!.deviceType).toBe('unknown');
  });

  it('denormalises the zone text onto each point', () => {
    const point = c().panels[0]!.points.find((p) => p.pointRef === 'L1D1')!;
    expect(point.zoneNumber).toBe(21);
    expect(point.zoneText).toBe('TOWER BLK L 2');
  });

  it('marks a zone with no devices as unused rather than dropping it', () => {
    const zones = c().panels[0]!.zones;
    expect(zones.find((z) => z.number === 99)).toMatchObject({ text: 'SOCIAL CLUB', unused: true });
    expect(zones.find((z) => z.number === 21)!.unused).toBe(false);
  });

  it('lists physical points and leaves the panel logic out of the asset list', () => {
    // Software zones, virtual points and network programmed points are logic.
    // Listing them puts things on a test sheet that do not exist in the
    // building.
    const refs = c().panels[0]!.points.map((p) => p.pointRef);
    expect(refs).toContain('L1D1');
    expect(refs).toContain('0.4.O1');
    expect(refs).not.toContain('NP240');
    expect(refs).not.toContain('Z21');
  });

  it('marks an unprogrammed panel point as unused', () => {
    expect(c().panels[0]!.points.find((p) => p.pointRef === '0.1.Z1')!.unused).toBe(true);
  });

  it('says the panel model is not in the file', () => {
    expect(c().warnings.join(' ')).toMatch(/panel model is not recorded/i);
  });
});

describe('cause and effect from the equations', () => {
  const rules = () => parsePci(FILE).panels[0]!.causeEffect;

  it('keeps the equation verbatim alongside the rendering', () => {
    const rule = rules().find((r) => r.effects[0]!.effectLabel === 'LV2 SEC DOOR RELEASE')!;
    expect(rule.sourceLogic).toBe('NP240;');
  });

  it('names the tokens in an equation from their own labels', () => {
    const rule = rules().find((r) => r.effects[0]!.effectLabel === 'LV2 SEC DOOR RELEASE')!;
    expect(rule.causeLabel).toBe('NP240 (ASE ALM TOWER)');
  });

  it('keeps a negation, which reverses what the rule means', () => {
    // The regression this exists for: stripping "!" to look the token up
    // turned "not warning isolated" into "warning isolated". The rendered rule
    // then stated the exact opposite of what the panel does, and read
    // perfectly while doing it.
    const rule = rules().find((r) => r.effects[0]!.effectLabel === 'EVAC TRIP FT 2-1')!;
    expect(rule.causeLabel).toBe('NP230 (EVAC ZONE FT2-1) AND NOT WI');
    expect(rule.causeLabel).not.toMatch(/AND WI/);
    expect(rule.sourceLogic).toBe('NP230 AND !WI;');
  });

  it('records a single-zone equation as a zone alarm', () => {
    const rule = rules().find((r) => r.effects[0]!.effectLabel === 'STAGE STROBE')!;
    expect(rule.causeKind).toBe('zone-alarm');
    expect(rule.causeZoneNumber).toBe(25);
  });

  it('does not reduce a multi-zone equation to its first zone', () => {
    // "Z21 OR Z121" recorded as "zone 21" understates what trips the output.
    const multi = [...HEAD, '<Ring0 Name = "R">',
      '<Point ModuleKey = "xDEFO9" PointId = "O9" Label = "EVAC" Script = "Z21 OR Z25;" ActKey = "XR9" />',
      '</Ring0>'].join('\r\n');
    const rule = parsePci(multi).panels[0]!.causeEffect[0]!;
    expect(rule.causeZoneNumber).toBeUndefined();
    expect(rule.causeKind).toBe('other');
    expect(rule.sourceLogic).toBe('Z21 OR Z25;');
  });

  it('skips a point the panel says cannot be reprogrammed', () => {
    expect(rules().some((r) => r.effects[0]!.effectLabel === 'BELL OUTPUT')).toBe(false);
  });

  it('classifies the effect from the output label where it is unambiguous', () => {
    expect(rules().find((r) => r.effects[0]!.effectLabel === 'EVAC TRIP FT 2-1')!.effects[0]!.effectKind)
      .toBe('evacuation');
    expect(rules().find((r) => r.effects[0]!.effectLabel === 'LV2 SEC DOOR RELEASE')!.effects[0]!.effectKind)
      .toBe('door-release');
  });
});

/** Against the real Ipswich Hospital file when present; never committed. */
const REAL = '/tmp/panels/notifier.pci';
const describeReal = existsSync(REAL) ? describe : describe.skip;

describeReal('against the real Ipswich Hospital configuration', () => {
  it('reads all ten loops and every point', () => {
    const c = parsePci(readFileSync(REAL, 'latin1'), 'notifier.pci');
    expect(c.siteName).toBe('IPSWICH HOSPITAL MAIN FIRE CONTROL ROOM');
    const panel = c.panels[0]!;
    expect(panel.loops).toHaveLength(10);
    expect(panel.points.length).toBeGreaterThan(1500);
    expect(panel.causeEffect.length).toBeGreaterThan(100);
    // Every rendered equation that negates a token must say so.
    for (const rule of panel.causeEffect) {
      if (rule.sourceLogic?.includes('!')) expect(rule.causeLabel).toMatch(/NOT /);
    }
  });
});
