import { existsSync, readFileSync } from 'fs';
import {
  canonicalRef, isPertronicUtil, isPertronicUtilText, parseFields,
  parsePertronicUtil, parsePertronicUtilText, unwrapPertronicUtil,
} from '@/parsers/pertronicUtil';
import { createZip, utf8Bytes } from '@/export/zip';

/**
 * The Pertronic .util parser.
 *
 * Most of these guard against a specific way this format lies to a careless
 * reader: it contains the configuration twice, it writes an unfitted address
 * as a device with a type, it spells the same device two different ways in
 * different sections, and it uses empty fields that will swallow the next
 * field given half a chance. None of those produce an error. All of them
 * produce a device list that looks right.
 */

const LIVE = [
  'Panel: F220AU',
  'Target:v7.06',
  'LastUpdate: 20240419 070615',
  'OPTIONS=DESC:"VAXXAS 04-04-25" LOGTEST:N TESTTIME:0800 MCPZone:2',
  'NETWORK=Enabled:N Sup:N ZOfs:0',
  'SITEINFO=Name:"VAXXAS BIO MEDICAL FACILITY" AuxFltInDesc:"" Desc1:"SAFE QLD FIRE PROTECTION"',
  'TIMEZONE=@Australia/Brisbane',
  'Loop0001=DESC:"Loop 1"',
  'Loop0002=DESC:"Loop 2"',
  'L01D001=CompositeDeviceData:0|0 TYPE:OPT Z:1 F:WEBADZL S:0 AVF:OFF DESC:"OFFICE SMOKE" Out: AAF:0',
  'L01D002=CompositeDeviceData:0|0 TYPE:HEAT Z:11 F:WEBADZL S:0 AVF:OFF DESC:"Outdoor Plant 4.6d" Out: AAF:0',
  'L01D003=TYPE:----',
  'L01D004=TYPE:----',
  'L01D005=CompositeDeviceData:0|0 TYPE:VES Z:19 F:DZ S:0 AVF:OFF DESC:"MASD 1 ALERT" Out:L01M023 AAF:0',
  'L01D006=CompositeDeviceData:0|0 TYPE:SW_H Z:0 F:H S:0 AVF:OFF DESC:"SPARE" Out: AAF:0',
  'L01D007=CompositeDeviceData:0|0 TYPE:SW3 Z:0 F:H S:0 AVF:OFF DESC:"3-WAY SWITCH" Out: AAF:0',
  'L01D008=CompositeDeviceData:0|0 TYPE:ISO Z:0 F:H S:0 AVF:OFF DESC:"ACF ISOLATE" Out: AAF:0',
  'L01M001=CompositeDeviceData:0|0 TYPE:WRN Z:11 F:H S:0 AVF:OFF DESC:"EXTERNAL PLANT ROOM STROBE" Out: AAF:0',
  'L01M021=CompositeDeviceData:0|0 TYPE:ACF Z:0 F:H S:0 AVF:OFF DESC:"MSSB - 1 FIRE TRIP" Out: AAF:0',
  'L01M023=CompositeDeviceData:0|0 TYPE:RLYM Z:0 F:H S:0 AVF:OFF DESC:"SPARE RELAY" Out: AAF:0',
  'L02M026=CompositeDeviceData:0|0 TYPE:ACF Z:0 F:H S:0 AVF:OFF DESC:"GAS PANEL FIRE TRIP" Out: AAF:0',
  'Z001=DESC:"OFFICE AREA" TPERIOD:0 TFLAGS:- TRun: TEnd: Out:G020 ',
  'Z011=DESC:"EXTERNAL PLANT ROOM" TPERIOD:0 TFLAGS:- TRun: TEnd: Out:G020 ',
  'Z019=DESC:"CLEAN CORRIDOR" TPERIOD:0 TFLAGS:- TRun: TEnd: Out:G001 ',
  'Z033=DESC:"UNUSED ZONE" TPERIOD:0 TFLAGS:- TRun: TEnd: ',
  // Note the references here are two-digit where the device records are three.
  'LB001=Func:AND DESC:"SECURITY OFFICE GFA" FLAGS:A Invert:02 In:G020,SE|ACFISO Out:L01M21,L02M26 ',
  'LB003=Func:AND DESC:"STROBES" FLAGS:W Invert:02 In:G020,SE|WARNISO Out:G001 ',
  'G001=DESC:"WARNING SYSTEM" Out:L01M01,L01M23',
];

const REFERENCE = [
  '++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++',
  '+++  Start of Reference Panel Config                               +++',
  '++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++',
  'OPTIONS=LOGTEST:N TESTTIME:0800',
  'SITEINFO=Name:"VAXXAS BIO MEDICAL FACILITY"',
  'Loop0001=DESC:"Loop 1"',
  'L01D001=CompositeDeviceData:0|0 TYPE:OPT Z:1 F:WEBADZL S:0 AVF:OFF DESC:"OFFICE SMOKE" Out: AAF:0',
  'L01D002=CompositeDeviceData:0|0 TYPE:HEAT Z:11 F:WEBADZL S:0 AVF:OFF DESC:"Outdoor Plant 4.6d" Out: AAF:0',
  'Z001=DESC:"OFFICE AREA" TPERIOD:0 TFLAGS:- TRun: TEnd: Out:G020 ',
  '----------------------------------------------------------------------',
  '---  End of Reference Panel Config                                 ---',
  '----------------------------------------------------------------------',
];

const TEXT = [...LIVE, ...REFERENCE].join('\r\n');

const util = (text = TEXT): Uint8Array => createZip([
  { name: 'ProjectDetails.xml', data: utf8Bytes('<Project><SiteName>New Site</SiteName></Project>') },
  { name: 'VAXXAS 04-04-25.txt', data: utf8Bytes(text) },
]);

describe('splitting a record into fields', () => {
  it('reads quoted and bare values', () => {
    const f = parseFields('TYPE:HEAT Z:11 DESC:"Outdoor Plant 4.6d" AAF:0');
    expect(f.get('TYPE')).toBe('HEAT');
    expect(f.get('Z')).toBe('11');
    expect(f.get('DESC')).toBe('Outdoor Plant 4.6d');
    expect(f.get('AAF')).toBe('0');
  });

  it('does not let an empty field swallow the next one', () => {
    // The regression this exists for. Allowing whitespace after the colon made
    // `Out: AAF:0` read as an output named "AAF:0", so every unconnected
    // detector in the file appeared to drive a plant shutdown — 272 of them in
    // the real file, all plausible-looking, none real.
    const f = parseFields('TYPE:OPT Z:1 DESC:"OFFICE" Out: AAF:0');
    expect(f.get('Out')).toBe('');
    expect(f.get('AAF')).toBe('0');
  });

  it('keeps consecutive empty fields distinct', () => {
    const f = parseFields('TPERIOD:0 TFLAGS:- TRun: TEnd: Out:G020');
    expect(f.get('TRun')).toBe('');
    expect(f.get('TEnd')).toBe('');
    expect(f.get('Out')).toBe('G020');
  });

  it('keeps a value containing a pipe or a slash intact', () => {
    const f = parseFields('CompositeDeviceData:0|0 In:G020,SE|ACFISO');
    expect(f.get('CompositeDeviceData')).toBe('0|0');
    expect(f.get('In')).toBe('G020,SE|ACFISO');
  });
});

describe('normalising a device reference', () => {
  it('pads a reference to the form the device records use', () => {
    // The file spells the same module L01M21 in a logic block and L01M001 in
    // its own record. Left alone, every effect points at nothing.
    expect(canonicalRef('L01M21')).toBe('L01M021');
    expect(canonicalRef('L1D1')).toBe('L01D001');
    expect(canonicalRef('L01M001')).toBe('L01M001');
  });

  it('leaves anything that is not a loop reference alone', () => {
    expect(canonicalRef('G020')).toBe('G020');
    expect(canonicalRef('SE|ACFISO')).toBe('SE|ACFISO');
  });
});

describe('the archive', () => {
  it('recognises a .util and finds the configuration inside it', () => {
    expect(isPertronicUtil(util())).toBe(true);
    expect(unwrapPertronicUtil(util()).name).toBe('VAXXAS 04-04-25.txt');
  });

  it('rejects a zip that is not one', () => {
    const other = createZip([{ name: 'notes.txt', data: utf8Bytes('just some notes') }]);
    expect(isPertronicUtil(other)).toBe(false);
    expect(() => unwrapPertronicUtil(other)).toThrow(/no Pertronic panel configuration/i);
  });

  it('recognises the configuration text on its own', () => {
    expect(isPertronicUtilText(TEXT)).toBe(true);
    expect(isPertronicUtilText('LEVEL 1 EAST\tSMOKE')).toBe(false);
  });
});

describe('reading a site', () => {
  const c = () => parsePertronicUtil(util(), 'site.util');

  it('reads the site, model and firmware', () => {
    expect(c().siteName).toBe('VAXXAS BIO MEDICAL FACILITY');
    expect(c().model).toBe('F220AU v7.06');
    expect(c().brand).toBe('pertronic');
  });

  it('stops at the reference copy rather than importing everything twice', () => {
    // The file carries the configuration a second time, as the panel's
    // last-read-back state. Parsing straight through doubles every device, and
    // the duplicates are indistinguishable from the originals.
    const points = c().panels[0]!.points;
    expect(points.filter((p) => p.pointRef === 'L01D001')).toHaveLength(1);
    expect(points.filter((p) => p.pointRef === 'L01D002')).toHaveLength(1);
    expect(c().panels[0]!.zones.filter((z) => z.number === 1)).toHaveLength(1);
  });

  it('says so when there is no reference banner to stop at', () => {
    const c2 = parsePertronicUtilText(LIVE.join('\r\n'));
    expect(c2.warnings.join(' ')).toMatch(/no reference-config banner/i);
    expect(c2.panels[0]!.points.filter((p) => p.pointRef === 'L01D001')).toHaveLength(1);
  });

  it('marks a spare address as spare instead of importing it as a device', () => {
    // An empty address is written `TYPE:----`. Read as a type code it becomes
    // the commonest device on the panel.
    const points = c().panels[0]!.points;
    const spare = points.find((p) => p.pointRef === 'L01D003')!;
    expect(spare.unused).toBe(true);
    expect(spare.deviceType).toBe('unknown');
    expect(spare.deviceTypeRaw).toBeUndefined();
    // Ten addresses carry a device; the two `----` rows do not.
    expect(points.filter((p) => !p.unused)).toHaveLength(10);
    expect(points.filter((p) => p.unused)).toHaveLength(2);
  });

  it('maps the type codes it is sure of', () => {
    const t = (ref: string) => c().panels[0]!.points.find((p) => p.pointRef === ref)!.deviceType;
    expect(t('L01D001')).toBe('smoke-photo');
    expect(t('L01D002')).toBe('heat');
    expect(t('L01D005')).toBe('aspirating');
    expect(t('L01M021')).toBe('module-output');
    expect(t('L01M023')).toBe('relay');
  });

  it('prefers the description over the code where the code is only a class', () => {
    // WRN says "a warning device" and no more; the description says which.
    expect(c().panels[0]!.points.find((p) => p.pointRef === 'L01M001')!.deviceType).toBe('strobe');
    expect(c().panels[0]!.points.find((p) => p.pointRef === 'L01M001')!.deviceTypeRaw).toMatch(/^WRN/);
  });

  it('gives every device the vendor\'s own name for it', () => {
    // The code alone tells a technician nothing. "MS12" is meaningless at a
    // panel; "MS12 — M210E-CZR" is a module they can go and find.
    const raw = (ref: string) => c().panels[0]!.points.find((p) => p.pointRef === ref)!.deviceTypeRaw;
    expect(raw('L01D001')).toBe('OPT — Optical detector (device address)');
    expect(raw('L01D006')).toBe('SW_H — Switch Input (Hidden) (device address)');
    expect(raw('L01M021')).toBe('ACF — Ancillary Control Facility (module address)');
  });

  it('classes the four switch-input flavours as the one thing they are', () => {
    // SW, SW3, SW_H and ISO are all a monitored switch; the suffix says how
    // the panel presents it, not what is wired to it.
    const t = (ref: string) => c().panels[0]!.points.find((p) => p.pointRef === ref)!.deviceType;
    expect(t('L01D006')).toBe('module-input');
    expect(t('L01D007')).toBe('module-input');
    expect(t('L01D008')).toBe('module-input');
  });

  it('does not class a disable input as a loop isolator', () => {
    // FireUtils captions ISO "Switch Input (Disable)". In this app 'isolator'
    // means a short-circuit isolator on the loop, which is a different device
    // with a different test — and one that would then appear on a service
    // sheet that has none.
    expect(c().panels[0]!.points.find((p) => p.pointRef === 'L01D008')!.deviceType).not.toBe('isolator');
  });

  it('reports a code that is not in the vocabulary at all', () => {
    const withUnknown = TEXT.replace(
      'L01D006=CompositeDeviceData:0|0 TYPE:SW_H',
      'L01D006=CompositeDeviceData:0|0 TYPE:ZZTOP',
    );
    const c2 = parsePertronicUtilText(withUnknown);
    expect(c2.warnings.join(' ')).toMatch(/ZZTOP \(1\)/);
    expect(c2.panels[0]!.points.find((p) => p.pointRef === 'L01D006')!.deviceType).toBe('unknown');
  });

  it('does not report a code whose class is deliberately not claimed', () => {
    // "Plant" and "M221E" are named but their function is not stated, so they
    // import as unknown on purpose. Warning about them on every import would
    // teach the reader to skip the warning that does matter.
    const withPlant = TEXT.replace(
      'L01D006=CompositeDeviceData:0|0 TYPE:SW_H',
      'L01D006=CompositeDeviceData:0|0 TYPE:PLNT',
    );
    const c2 = parsePertronicUtilText(withPlant);
    expect(c2.warnings.join(' ')).not.toMatch(/not in the vocabulary/i);
    const point = c2.panels[0]!.points.find((p) => p.pointRef === 'L01D006')!;
    expect(point.deviceType).toBe('unknown');
    expect(point.deviceTypeRaw).toMatch(/PLNT — Plant/);
  });

  it('keeps the module and device address spaces apart', () => {
    // A loop carries both L01D001 and L01M001, and they are different devices.
    const refs = c().panels[0]!.points.map((p) => p.pointRef);
    expect(refs).toContain('L01D001');
    expect(refs).toContain('L01M001');
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('denormalises the zone text and marks an empty zone unused', () => {
    const panel = c().panels[0]!;
    expect(panel.points.find((p) => p.pointRef === 'L01D002')!.zoneText).toBe('EXTERNAL PLANT ROOM');
    expect(panel.zones.find((z) => z.number === 33)).toMatchObject({ text: 'UNUSED ZONE', unused: true });
    expect(panel.zones.find((z) => z.number === 1)!.unused).toBe(false);
  });
});

describe('cause and effect', () => {
  const rules = () => parsePertronicUtil(util()).panels[0]!.causeEffect;

  it('reads a zone driving an output group', () => {
    const rule = rules().find((r) => r.causeZoneNumber === 1)!;
    expect(rule.causeKind).toBe('zone-alarm');
    expect(rule.causeLabel).toBe('Zone 1 — OFFICE AREA');
    expect(rule.sourceLogic).toBe('Z001 Out:G020');
  });

  it('expands a group into its members so the matrix is readable', () => {
    const rule = rules().find((r) => r.causeZoneNumber === 19)!;
    expect(rule.effects[0]!.effectLabel).toContain('WARNING SYSTEM');
    expect(rule.effects[0]!.effectLabel).toContain('L01M001');
    expect(rule.effects[0]!.effectLabel).toContain('L01M023');
  });

  it('resolves every device reference to a point that exists', () => {
    // The references in logic blocks are written with fewer digits than the
    // device records use. Without normalising them the matrix is full of
    // targets that resolve to nothing, and nothing says so.
    const panel = parsePertronicUtil(util()).panels[0]!;
    const refs = new Set(panel.points.map((p) => p.pointRef));
    const targets = panel.causeEffect
      .flatMap((r) => r.effects.map((e) => e.effectLabel))
      .flatMap((label) => [...label.matchAll(/\bL\d+[DM]\d+\b/g)].map((m) => m[0]));

    expect(targets.length).toBeGreaterThan(3);
    for (const target of targets) expect([target, refs.has(target)]).toEqual([target, true]);
  });

  it('keeps a logic block verbatim, flags and all', () => {
    const rule = rules().find((r) => r.sourceLogic?.startsWith('LB001'))!;
    expect(rule.sourceLogic).toContain('FLAGS:A');
    expect(rule.sourceLogic).toContain('Invert:02');
    expect(rule.causeLabel).toContain('SECURITY OFFICE GFA');
  });

  it('reports a group the panel defines internally rather than pretending to know it', () => {
    expect(parsePertronicUtil(util()).warnings.join(' ')).toMatch(/G020 is referenced but not defined/i);
  });

  it('reads a device driving another device', () => {
    const rule = rules().find((r) => r.causePointRef === 'L01D005')!;
    expect(rule.causeKind).toBe('point-alarm');
    expect(rule.effects.map((e) => e.effectLabel.split(' ')[0])).toEqual(['L01M023']);
  });

  it('does not invent a rule for a device with no output', () => {
    // Every detector has an `Out:` field and most of them are empty.
    expect(rules().some((r) => r.causePointRef === 'L01D001')).toBe(false);
  });
});

/** Against the real Vaxxas file when present; never committed. */
const REAL = '/tmp/panels/pertronic-f220.util';
const describeReal = existsSync(REAL) ? describe : describe.skip;

describeReal('against the real Vaxxas configuration', () => {
  it('reads the live half of the file only', () => {
    const c = parsePertronicUtil(new Uint8Array(readFileSync(REAL)), 'pertronic-f220.util');
    expect(c.siteName).toBe('VAXXAS BIO MEDICAL FACILITY');
    expect(c.model).toBe('F220AU v7.06');
    const panel = c.panels[0]!;
    expect(panel.loops).toHaveLength(2);
    expect(panel.zones).toHaveLength(37);
    // 290 fitted addresses out of 516; the rest are spares.
    expect(panel.points.filter((p) => !p.unused)).toHaveLength(290);
    expect(panel.points.filter((p) => p.unused)).toHaveLength(226);
    // Nothing appears twice, which is what the reference section would cause.
    const refs = panel.points.map((p) => p.pointRef);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('resolves every device reference in the matrix', () => {
    const panel = parsePertronicUtil(new Uint8Array(readFileSync(REAL))).panels[0]!;
    const refs = new Set(panel.points.map((p) => p.pointRef));
    const targets = panel.causeEffect
      .flatMap((r) => r.effects.map((e) => e.effectLabel))
      .flatMap((label) => [...label.matchAll(/\bL\d+[DM]\d+\b/g)].map((m) => m[0]));
    expect(targets.length).toBeGreaterThan(50);
    expect(targets.filter((t) => !refs.has(t))).toEqual([]);
  });
});
