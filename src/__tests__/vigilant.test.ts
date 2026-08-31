import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { isVigilant, isVigilantBytes, parseVigilant, parseVigilantBytes } from '@/parsers/vigilant';
import { decodeCp1252, decodeXmlEntities, parseTagLine } from '@/parsers/lineTags';

/**
 * The Vigilant SmartConfig parser.
 *
 * Unusually for this project, the samples are public: Tyco publishes the
 * SmartConfig installers unauthenticated, and they carry 44 real template
 * files. Those are what this parser was built against. They are vendor files
 * rather than ours, so they are not committed either — the fixtures below
 * reproduce their structure, and the real ones are read when present.
 *
 * A blank template is genuinely blank, which turns out to be the useful test:
 * SmartConfig pre-creates all 999 zones and all 127 responder slots, so a
 * reader that does not tell a slot from a device reports a site with 999 zones
 * and 127 loops, every time, for every building.
 */

const MX1 = [
  '<MX1>',
  '<Sys_Info Title="Site Name Goes Here"/>',
  '<Information SmartConfigVersion="2.9.0.999" SaveDate="5/12/2019" OSVersion="Windows 7"/>',
  '<Hardware EquipAddress="2" AvailableFunctions="MX Loop 2" Port="??" />',
  '<Hardware EquipAddress="3" AvailableFunctions="MX Loop 3" Port="??" />',
  '<Hardware EquipAddress="244" AvailableFunctions="RZDU" Function="RZDU" Port="Port 0" />',
  '<System SystemName="Brisbane Depot" BrandingText="Vigilant MX1" Version="1.8X" ' +
    'StandardsDisplayText="AS 7240.2|AS 4428.3" SystemProfile="AU QLD" />',
  '<Zones ZoneNo="1" ZoneTypeProfile="Std Detection G1" ZoneName="Manual Call Point" LoggingProfile="Log All" ' +
    'Notes="Factory default zone" />',
  '<Zones ZoneNo="2" ZoneName="LEVEL 1 EAST" LoggingProfile="Log All" />',
  '<Zones ZoneNo="3" MX1LEDNo="3" LoggingProfile="Log All" />',
  '<Zones ZoneNo="4" MX1LEDNo="4" LoggingProfile="Log All" />',
  '<MainboardPoints Point="1" Type="ALM DEV" SubpointDesc="Status" PtText="Alarm Devices" Canbedisabled="Yes" />',
  '<MainboardPoints Point="2" Type="GPIN1" SubpointDesc="Input" PtText="Gen Purpose Input 1" />',
  '<MainboardPoints Point="3" Type="GPIN2" SubpointDesc="Input" />',
  '<Equipmentpoints Point="2.0" Type="Second Loop Card" SubpointDesc="Loop Left S/C" PtText="Loop 2 Left S/C" />',
  '<Equipmentpoints Point="2.1" Type="Second Loop Card" SubpointDesc="Loop Right S/C" PtText="Loop 2 Right S/C" />',
  '<PseudoPoints Point="1" PtText="Main Power Lost" />',
  '<PseudoPoints Point="2" />',
  '<PseudoPoints Point="3" />',
  '<LogicSubstitutions ID="1" NewName="$ALARM_DEVICES_FAULT" Substitutedtext="V997" Comments="" />',
  '<UserLogic eqn="; This page is for site specific user logic"/>',
  '<UserLogic eqn="* another comment style"/>',
  '<UserLogic eqn="$ALARM_DEVICES_FAULT = (FALSE)"/>',
  '<UserLogic eqn="BRALM = MZA OR MZB"/>',
  '<ZoneTypeProfiles ProfileName="Std Detection G1" Latching="Yes" />',
  '<OpticalProfiles ProfileName="Standard" Alarm="80" />',
  '</MX1>',
].join('\r\n');

const F4000 = [
  '<F4000-MX4428>',
  '<Sys_Info Title=""/>',
  '<Information SmartConfigVersion="2.8.0.999" SaveDate="12/09/2018" OSVersion="Windows 7"/>',
  '<AlarmTypeText Index="0" AlarmTypeText="Smoke  " />',
  '<AlarmTypeText Index="1" AlarmTypeText="Heat   " />',
  '<AlarmTypeText Index="3" AlarmTypeText="MCP    " />',
  '<System SystemName="New System" LCDZones="528" Version="3.22" />',
  '<Responders Resp="1" Type="MXP" Logical="50" MaxLEDs="5" PointIsolateEnable="Yes" />',
  '<Responders Resp="2" Logical="1" MaxLEDs="5" PointIsolateEnable="Yes" />',
  '<Responders Resp="3" Logical="1" MaxLEDs="5" />',
  '<Circuits Resp="1" Circuit="1" CctAttrib="Normal 1" MappedZones="1" />',
  '<Circuits Resp="1" Circuit="2" CctAttrib="Normal 1" MappedZones="2" />',
  '<Circuits Resp="1" Circuit="3" CctAttrib="Disabled" />',
  '<Circuits Resp="2" Circuit="1" CctAttrib="Normal 1" />',
  '<Circuits Resp="2" Circuit="2" CctAttrib="Normal 1" />',
  '<Relays Resp="1" Relay="1" Supervise="Yes" />',
  '<Relays Resp="4" Relay="1" Supervise="Yes" />',
  '<Zones Zone="1" CctRly="C1/1" Latching="Yes" MAF="Yes" />',
  '<Zones Zone="2" CctRly="C1/2" Latching="Yes" MAF="Yes" />',
  '<Zones Zone="3" Latching="Yes" MAF="Yes" />',
  '<Zones Zone="500" Latching="Yes" />',
  '<Logic eqn="* Type output logic here."/>',
  '<Logic eqn="EBA=MZA"/>',
  '<Logic eqn="WSA=MZA"/>',
  '<PointDefaults Type="814PH" PreAlarm="68" Alarm="80" />',
  '</F4000-MX4428>',
].join('\r\n');

describe('recognising the family', () => {
  it('reads the panel from the root element', () => {
    expect(isVigilant(MX1)).toBe(true);
    expect(isVigilant(F4000)).toBe(true);
    expect(isVigilant('<FP1600>\r\n<System SystemName="x" />')).toBe(true);
  });

  it('rejects other angle-bracket formats', () => {
    expect(isVigilant('<?xml version="1.0"?><site><zone n="1"/></site>')).toBe(false);
    expect(isVigilant('<Version Name = "6.1.0">')).toBe(false);
    expect(isVigilant('LEVEL 1 EAST\tSMOKE')).toBe(false);
  });

  it('refuses a file with no root it knows', () => {
    expect(() => parseVigilant('<Something>\r\n<System SystemName="x" />', 'x.mx1'))
      .toThrow(/does not begin with a Vigilant root element/i);
  });
});

describe('the Windows-1252 encoding', () => {
  // 30 of the 44 configuration files the vendor ships fail a strict UTF-8
  // decode. Read as UTF-8 they either throw or come back with replacement
  // characters in the middle of a zone name.
  it('decodes the bytes Delphi writes for smart quotes and dashes', () => {
    const bytes = Uint8Array.from([0x92, 0x93, 0x94, 0x96, 0x97, 0x85, 0x99]);
    expect(decodeCp1252(bytes)).toBe('’“”–—…™');
  });

  it('leaves the Latin-1 range alone', () => {
    // 0xE9 is e-acute in both Latin-1 and Windows-1252, and must not be
    // remapped by the 0x80-0x9F table.
    const bytes = Uint8Array.from([...'CAF'].map((c) => c.charCodeAt(0)).concat([0xe9]));
    expect(decodeCp1252(bytes)).toBe('café'.toUpperCase().slice(0, 3) + 'é');
    expect(decodeCp1252(Uint8Array.from([0xe9, 0xfc, 0xdf]))).toBe('éüß');
  });

  it('reads a zone name containing a curly apostrophe', () => {
    const line = '<Zones ZoneNo="7" ZoneName="LEVEL 1 \x92 EAST" />';
    const source = `<MX1>\r\n<System SystemName="S" />\r\n${line}\r\n</MX1>`;
    const bytes = Uint8Array.from([...source].map((c) => c.charCodeAt(0)));
    const zone = parseVigilantBytes(bytes, 'x.mx1').panels[0]!.zones.find((z) => z.number === 7)!;
    expect(zone.text).toBe('LEVEL 1 ’ EAST');
    expect(zone.text).not.toContain('�');
  });

  it('handles a file too large for one fromCharCode call', () => {
    // Built in chunks, because a multi-megabyte spread overflows the stack.
    const big = new Uint8Array(300000).fill(0x41);
    expect(decodeCp1252(big).length).toBe(300000);
  });

  it('recognises the format from bytes', () => {
    expect(isVigilantBytes(Uint8Array.from([...MX1].map((c) => c.charCodeAt(0))))).toBe(true);
    expect(isVigilantBytes(Uint8Array.from([0, 1, 2, 3, 4]))).toBe(false);
  });
});

describe('decoding entities', () => {
  it('reads the numeric forms these files actually use', () => {
    // Vigilant writes &#x27; and &#x26; rather than the named entities.
    expect(decodeXmlEntities('A &#x26; B &#x27;C&#x27; &#x3c;D&#x3e;')).toBe("A & B 'C' <D>");
    expect(decodeXmlEntities('&#65;&#66;')).toBe('AB');
  });

  it('still reads the named forms', () => {
    expect(decodeXmlEntities('A &amp; B &lt;C&gt;')).toBe('A & B <C>');
  });

  it('leaves anything that is not an entity alone', () => {
    expect(decodeXmlEntities('a &vbCrLf b')).toBe('a &vbCrLf b');
    expect(decodeXmlEntities('100 & 200')).toBe('100 & 200');
  });

  it('reads an element name with a hyphen in it', () => {
    expect(parseTagLine('<F4000-MX4428>')?.name).toBe('F4000-MX4428');
  });
});

describe('reading an MX1 site', () => {
  const c = () => parseVigilant(MX1, 'site.mx1');

  it('reads the site, brand and version', () => {
    expect(c().brand).toBe('vigilant');
    // SystemName is what the technician sets; Sys_Info's Title is usually left
    // at the template default, so it must not win.
    expect(c().siteName).toBe('Brisbane Depot');
    expect(c().model).toBe('Vigilant MX1 1.8X');
  });

  it('reads the loops the hardware table declares', () => {
    expect(c().panels[0]!.loops.map((l) => l.number)).toEqual([2, 3]);
    expect(c().panels[0]!.loops[0]!.protocol).toBe('tyco-mx');
  });

  it('keeps named zones and drops the pre-created slots', () => {
    // SmartConfig writes a row for all 999 addressable zones and names none of
    // them. A reader that keeps them reports every building as having 999.
    expect(c().panels[0]!.zones.map((z) => z.number)).toEqual([1, 2]);
    expect(c().panels[0]!.zones[1]!.text).toBe('LEVEL 1 EAST');
  });

  it('keeps the zone profile and notes, which are the only type information there is', () => {
    const zone = c().panels[0]!.zones.find((z) => z.number === 1)!;
    expect(zone.type).toBe('Std Detection G1');
    expect(zone.text2).toBe('Factory default zone');
  });

  it('reads the panel-side point tables with readable references', () => {
    const refs = c().panels[0]!.points.map((p) => p.pointRef);
    expect(refs).toContain('MB-1');
    expect(refs).toContain('EQ-2.0');
    expect(refs).toContain('PSEUDO-1');
    // Not "EQUIPMENTPOINTS-2.0" — the element names are not spelled
    // consistently and are not fit to show a technician.
    expect(refs.some((r) => r!.includes('EQUIPMENTPOINTS'))).toBe(false);
  });

  it('splits a dotted address into equipment and subpoint', () => {
    const point = c().panels[0]!.points.find((p) => p.pointRef === 'EQ-2.1')!;
    expect(point.address).toBe(2);
    expect(point.subAddress).toBe(1);
    expect(point.text2).toBe('Loop Right S/C');
  });

  it('leaves out points the tool created and nobody programmed', () => {
    // The pseudo-point table alone carries 255 rows, of which a blank template
    // programs one.
    const refs = c().panels[0]!.points.map((p) => p.pointRef);
    expect(refs).toContain('PSEUDO-1');
    expect(refs).not.toContain('PSEUDO-2');
    expect(refs).not.toContain('MB-3');
  });

  it('skips profile libraries, which are settings rather than site data', () => {
    expect(c().warnings.join(' ')).not.toMatch(/ZoneTypeProfiles|OpticalProfiles/);
  });
});

describe('reading an F4000 / MX4428 site', () => {
  const c = () => parseVigilant(F4000, 'site.f4k');

  it('reads the panel from the root element', () => {
    expect(c().model).toBe('F4000 / MX4428 3.22');
    expect(c().siteName).toBe('New System');
  });

  it('treats a responder with no type as an empty card slot', () => {
    // A blank template carries a row for all 127 responders and types none of
    // them, so without this every site imports as 127 loops.
    expect(c().panels[0]!.loops.map((l) => l.number)).toEqual([1]);
    expect(c().panels[0]!.points.filter((p) => p.pointRef?.startsWith('RESP-'))).toHaveLength(1);
  });

  it('leaves out circuits and relays on a card that is not installed', () => {
    // A circuit on a card that is not there is not a spare address — there is
    // nothing there to be spare.
    const refs = c().panels[0]!.points.map((p) => p.pointRef);
    expect(refs).toContain('C1/1');
    expect(refs).not.toContain('C2/1');
    expect(refs).toContain('R1/1');
    expect(refs).not.toContain('R4/1');
  });

  it('marks a disabled circuit as unused rather than dropping it', () => {
    const circuit = c().panels[0]!.points.find((p) => p.pointRef === 'C1/3')!;
    expect(circuit.unused).toBe(true);
    expect(c().panels[0]!.points.find((p) => p.pointRef === 'C1/1')!.unused).toBe(false);
  });

  it('maps a circuit to the zone it drives', () => {
    const circuit = c().panels[0]!.points.find((p) => p.pointRef === 'C1/1')!;
    expect(circuit.zoneNumber).toBe(1);
    expect(circuit.loopNumber).toBe(1);
  });

  it('keeps a zone that points at a circuit even with no name', () => {
    // The F4000 family points the zone at its circuit rather than the reverse,
    // so a zone with CctRly set is configured even though it has no text.
    expect(c().panels[0]!.zones.map((z) => z.number)).toEqual([1, 2]);
    expect(c().panels[0]!.zones.every((z) => z.text === '')).toBe(true);
  });

  it('reports the panel alarm-type vocabulary rather than inventing types', () => {
    expect(c().warnings.join(' ')).toMatch(/Smoke, Heat, MCP/);
  });
});

describe('cause and effect from the logic equations', () => {
  it('splits an equation into its output and its cause', () => {
    const rule = parseVigilant(F4000).panels[0]!.causeEffect.find((r) => r.sourceLogic?.includes('EBA=MZA'))!;
    expect(rule.effects[0]!.effectLabel).toBe('EBA');
    expect(rule.causeLabel).toBe('MZA');
  });

  it('resolves a named substitution so the equation can be read', () => {
    const rule = parseVigilant(MX1).panels[0]!.causeEffect
      .find((r) => r.sourceLogic?.includes('ALARM_DEVICES_FAULT'))!;
    expect(rule.effects[0]!.effectLabel).toBe('$ALARM_DEVICES_FAULT (V997)');
  });

  it('keeps the equation verbatim', () => {
    const rule = parseVigilant(MX1).panels[0]!.causeEffect.find((r) => r.causeLabel === 'MZA OR MZB')!;
    expect(rule.sourceLogic).toBe('UserLogic: BRALM = MZA OR MZB');
  });

  it('skips comments in both styles the language allows', () => {
    const rules = parseVigilant(MX1).panels[0]!.causeEffect;
    expect(rules).toHaveLength(2);
    expect(rules.some((r) => r.causeLabel.includes('site specific user logic'))).toBe(false);
    expect(rules.some((r) => r.causeLabel.includes('another comment style'))).toBe(false);
  });
});

describe('saying what it did not read', () => {
  it('names an unrecognised record type instead of dropping it silently', () => {
    // This is the important one. The vendor templates are blank of site data,
    // so the table that carries loop devices has never been seen here. If a
    // real site file has one, the difference between saying so and not is the
    // difference between a known gap and a device list quietly missing most of
    // the building.
    const withUnknown = MX1.replace('</MX1>', [
      '<MXPoints Point="1.3.4" PtText="PLANT ROOM" />',
      '<MXPoints Point="1.3.5" PtText="STAIR" />',
      '</MX1>',
    ].join('\r\n'));
    const c = parseVigilant(withUnknown, 'site.mx1');
    expect(c.warnings.join(' ')).toMatch(/<MXPoints> x2/);
    expect(c.warnings.join(' ')).toMatch(/nothing has been guessed at/i);
  });

  it('says when a file is a blank template rather than a site', () => {
    const blank = ['<F4000-MX4428>', '<System SystemName="New System" />',
      '<Responders Resp="1" Logical="1" />', '<Zones Zone="1" Latching="Yes" />', '</F4000-MX4428>'].join('\r\n');
    expect(parseVigilant(blank).warnings.join(' ')).toMatch(/blank SmartConfig template/i);
  });
});

/**
 * Against the vendor's own template files when present.
 *
 * They are downloadable without a login from the Tyco Safety Products ANZ
 * public downloads page — sf0432.exe is SmartConfig for MX1 and sf0278.exe is
 * SmartConfig for MX4428 — and extract with innoextract. They are the vendor's
 * files rather than ours, so they are not committed.
 */
const TEMPLATE_DIRS = ['/tmp/vigilant/app', '/tmp/vigilant/app/Old_Templates', '/tmp/vig4428/app'];
const templates = TEMPLATE_DIRS.filter(existsSync).flatMap((d) =>
  readdirSync(d).filter((f) => /\.(mxt|mx1|f4k|f4t|16t|ion|iot)$/i.test(f)).map((f) => join(d, f)));

const describeReal = templates.length ? describe : describe.skip;

describeReal('against the vendor template files', () => {
  it('reads every one of them without throwing', () => {
    expect(templates.length).toBeGreaterThan(10);
    for (const path of templates) {
      const bytes = new Uint8Array(readFileSync(path));
      expect([path, isVigilantBytes(bytes)]).toEqual([path, true]);
      const c = parseVigilantBytes(bytes, path);
      expect([path, c.brand]).toEqual([path, 'vigilant']);
      expect([path, c.panels.length]).toEqual([path, 1]);
    }
  });

  it('does not report a blank template as a site full of zones', () => {
    const mx1 = templates.find((p) => /MX1_AU_Template_V1\.80/.test(p));
    if (!mx1) return;
    const panel = parseVigilantBytes(new Uint8Array(readFileSync(mx1))).panels[0]!;
    // 999 zone rows in the file; one of them is named.
    expect(panel.zones.length).toBeLessThan(20);
    expect(panel.points.length).toBeGreaterThan(300);
    expect(panel.loops.length).toBeGreaterThan(0);
    expect(panel.causeEffect.length).toBeGreaterThan(50);
  });

  it('reads the one-loop sample as one loop', () => {
    const oneLoop = templates.find((p) => /OneLoop\.f4t/.test(p));
    if (!oneLoop) return;
    const panel = parseVigilantBytes(new Uint8Array(readFileSync(oneLoop))).panels[0]!;
    // 127 responder rows in the file; one has a type.
    expect(panel.loops).toHaveLength(1);
    expect(panel.points.filter((p) => p.pointRef?.startsWith('C'))).toHaveLength(4);
  });
});
